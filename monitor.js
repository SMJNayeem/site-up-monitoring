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
    baseDir: '/root',  // Base directory where all folders are located
    excludeDirs: ['core', 'nginx', 'amardokan', '.git', 'snap', 'go'],  // Directories to exclude
    port: 9092
};

const siteStatus = new prom.Gauge({
    name: 'site_up',
    help: 'Site status: 1 for up, 0 for down',
    labelNames: ['site_dir', 'domain']
});
register.registerMetric(siteStatus);

// Improved site checking function
async function checkSite(domain) {
    // Try HTTPS first
    const httpsCheck = () => {
        return new Promise((resolve) => {
            const req = https.get({
                hostname: domain,
                path: '/',
                timeout: 5000,
                rejectUnauthorized: false
            }, (res) => {
                console.log(`HTTPS check for ${domain}: UP (status: ${res.statusCode})`);
                res.resume();
                resolve(true);
            });

            req.on('error', (err) => {
                console.log(`HTTPS check for ${domain} failed: ${err.message}, trying HTTP...`);
                resolve(false);
            });

            req.on('timeout', () => {
                console.log(`HTTPS check for ${domain} timed out, trying HTTP...`);
                req.destroy();
                resolve(false);
            });
        });
    };

    // HTTP fallback check
    const httpCheck = () => {
        return new Promise((resolve) => {
            const req = http.get({
                hostname: domain,
                path: '/',
                timeout: 5000
            }, (res) => {
                console.log(`HTTP check for ${domain}: UP (status: ${res.statusCode})`);
                res.resume();
                resolve(true);
            });

            req.on('error', (err) => {
                console.log(`HTTP check for ${domain} failed: ${err.message}`);
                resolve(false);
            });

            req.on('timeout', () => {
                console.log(`HTTP check for ${domain} timed out`);
                req.destroy();
                resolve(false);
            });
        });
    };

    const isHttpsUp = await httpsCheck();
    if (isHttpsUp) return true;

    const isHttpUp = await httpCheck();
    return isHttpUp;
}

// Find all sites from directories
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
                    console.log(`No .env file found in ${dir}, skipping`);
                    continue;
                }

                console.log(`Reading env file from: ${dir}`);
                const envContent = await fs.readFile(envPath, 'utf8');
                const domain = envContent.match(/DOMAIN_NAME=(.+)/)?.[1];

                if (domain) {
                    const cleanDomain = domain.trim()
                        .replace(/^https?:\/\//, '')  // Remove protocol if present
                        .replace(/\/+$/, '');         // Remove trailing slashes

                    sites.push({
                        directory: dir,
                        domain: cleanDomain
                    });
                    console.log('Found site:', { directory: dir, domain: cleanDomain });
                }
            } catch (err) {
                console.error(`Error processing ${dir}:`, err.message);
            }
        }

        console.log('Total sites found:', sites.length);
        return sites;
    } catch (error) {
        console.error('Error reading directories:', error);
        return [];
    }
}

// Metrics endpoint
app.get('/metrics', async (req, res) => {
    try {
        const sites = await findSites();

        // Check all sites in parallel
        await Promise.all(sites.map(async (site) => {
            try {
                const isUp = await checkSite(site.domain);
                console.log(`Status for ${site.directory} (${site.domain}) = ${isUp ? 'UP' : 'DOWN'}`);

                siteStatus.set({
                    site_dir: site.directory,
                    domain: site.domain
                }, isUp ? 1 : 0);
            } catch (error) {
                console.error(`Error checking ${site.domain}:`, error);
                siteStatus.set({
                    site_dir: site.directory,
                    domain: site.domain
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

// Test endpoint
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