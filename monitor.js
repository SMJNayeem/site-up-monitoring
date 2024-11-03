const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const https = require('https');
const http = require('http');
const prom = require('prom-client');

const app = express();
const register = new prom.Registry();
prom.collectDefaultMetrics = () => { };

// Configuration
const CONFIG = {
    baseDir: '/root',  // Update this to your base directory
    excludeDirs: ['core', 'nginx'],  // Directories to exclude
    port: 9092
};

// Create the metric
const siteStatus = new prom.Gauge({
    name: 'site_up',
    help: 'Site status: 1 = up, 0 = down',
    labelNames: ['domain', 'directory']
});

register.registerMetric(siteStatus);

async function checkSite(domain) {
    return new Promise((resolve) => {
        // First try HTTPS
        const httpsReq = https.get({
            hostname: domain,
            path: '/',
            timeout: 5000,
            rejectUnauthorized: false // Allow self-signed certificates
        }, (res) => {
            console.log(`HTTPS check for ${domain}: UP (status: ${res.statusCode})`);
            res.resume();
            resolve(true);
        });

        httpsReq.on('error', () => {
            // If HTTPS fails, try HTTP
            const httpReq = http.get({
                hostname: domain,
                path: '/',
                timeout: 5000
            }, (res) => {
                console.log(`HTTP check for ${domain}: UP (status: ${res.statusCode})`);
                res.resume();
                resolve(true);
            });

            httpReq.on('error', (err) => {
                console.log(`All checks failed for ${domain}: ${err.message}`);
                resolve(false);
            });

            httpReq.on('timeout', () => {
                console.log(`HTTP check timeout for ${domain}`);
                httpReq.destroy();
                resolve(false);
            });
        });

        httpsReq.on('timeout', () => {
            console.log(`HTTPS check timeout for ${domain}`);
            httpsReq.destroy();
            // Don't resolve here, let the error handler try HTTP
        });
    });
}

async function findSites() {
    try {
        const directories = await fs.readdir(CONFIG.baseDir);
        const sites = [];

        for (const dir of directories) {
            // Skip excluded directories
            if (CONFIG.excludeDirs.includes(dir)) {
                console.log(`Skipping excluded directory: ${dir}`);
                continue;
            }

            try {
                const envPath = path.join(CONFIG.baseDir, dir, '.env');
                const envExists = await fs.access(envPath).then(() => true).catch(() => false);

                if (!envExists) {
                    console.log(`No .env file in ${dir}, skipping`);
                    continue;
                }

                console.log(`Reading env file from: ${dir}`);
                const envContent = await fs.readFile(envPath, 'utf8');
                const domainMatch = envContent.match(/DOMAIN_NAME=(.+)/);

                if (domainMatch) {
                    const domain = domainMatch[1].trim()
                        .replace(/^['"]/, '')    // Remove leading quotes
                        .replace(/['"]$/, '')    // Remove trailing quotes
                        .replace(/^https?:\/\//, '')  // Remove protocol
                        .replace(/\/+$/, '');    // Remove trailing slashes

                    if (domain) {
                        sites.push({
                            directory: dir,
                            domain: domain
                        });
                        console.log(`Found site: ${domain} in directory: ${dir}`);
                    }
                }
            } catch (err) {
                console.error(`Error processing ${dir}:`, err.message);
            }
        }

        console.log(`Total sites found: ${sites.length}`);
        return sites;
    } catch (error) {
        console.error('Error reading directories:', error);
        return [];
    }
}

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        // Reset metrics before collecting new data
        siteStatus.reset();

        const sites = await findSites();

        // Check all sites in parallel
        await Promise.all(sites.map(async (site) => {
            try {
                const isUp = await checkSite(site.domain);
                console.log(`Status for ${site.domain} (${site.directory}) = ${isUp ? 'UP' : 'DOWN'}`);

                siteStatus.set({
                    domain: site.domain,
                    directory: site.directory
                }, isUp ? 1 : 0);
            } catch (error) {
                console.error(`Error checking ${site.domain}:`, error);
                siteStatus.set({
                    domain: site.domain,
                    directory: site.directory
                }, 0);
            }
        }));

        const metrics = await register.metrics();
        res.set('Content-Type', register.contentType);
        res.end(metrics);
    } catch (error) {
        console.error('Error serving metrics:', error);
        res.status(500).send('Error collecting metrics');
    }
});

// Debug endpoint
app.get('/debug', async (req, res) => {
    try {
        const sites = await findSites();
        const statuses = await Promise.all(sites.map(async (site) => ({
            ...site,
            status: await checkSite(site.domain) ? 'UP' : 'DOWN'
        })));

        res.json({
            baseDir: CONFIG.baseDir,
            excludedDirs: CONFIG.excludeDirs,
            totalSites: sites.length,
            sites: statuses
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Individual site test endpoint
app.get('/test/:domain', async (req, res) => {
    const domain = req.params.domain;
    try {
        const isUp = await checkSite(domain);
        res.json({
            domain: domain,
            status: isUp ? 'UP' : 'DOWN',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({
            domain: domain,
            error: error.message
        });
    }
});

app.listen(CONFIG.port, () => {
    console.log(`Monitor running on port ${CONFIG.port}`);
    console.log('Base directory:', CONFIG.baseDir);
    console.log('Excluded directories:', CONFIG.excludeDirs.join(', '));
});