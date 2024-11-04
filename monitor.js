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
    baseDir: '/root/projects/',  // Update this to your base directory
    excludeDirs: ['core', '_db', '_migration'],  // Directories to exclude
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
        const timeout = 3000;
        let isResolved = false;

        const httpCheck = () => {
            const httpReq = http.get({
                hostname: domain,
                path: '/',
                timeout: timeout,
                headers: {
                    'User-Agent': 'Monitor/1.0'
                }
            }, (res) => {
                if (!isResolved) {
                    isResolved = true;
                    res.destroy();
                    resolve(true);
                }
            });

            httpReq.on('error', () => {
                if (!isResolved) {
                    isResolved = true;
                    resolve(false);
                }
            });

            httpReq.on('timeout', () => {
                httpReq.destroy();
            });
        };

        const httpsReq = https.get({
            hostname: domain,
            path: '/',
            timeout: timeout,
            rejectUnauthorized: false,
            headers: {
                'User-Agent': 'Monitor/1.0'
            }
        }, (res) => {
            if (!isResolved) {
                isResolved = true;
                res.destroy();
                resolve(true);
            }
        });

        httpsReq.on('error', () => {
            httpCheck();
        });

        httpsReq.on('timeout', () => {
            httpsReq.destroy();
            httpCheck();
        });

        // Global timeout
        setTimeout(() => {
            if (!isResolved) {
                isResolved = true;
                resolve(false);
            }
        }, timeout * 2);
    });
}

async function findSites() {
    try {
        const directories = await fs.readdir(CONFIG.baseDir);
        const sites = [];

        for (const dir of directories) {
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

app.get('/metrics', async (req, res) => {
    try {
        console.log('Starting metrics collection...');
        siteStatus.reset();

        const sites = await findSites();
        console.log(`Found ${sites.length} sites to check`);

        // Process more sites in parallel with shorter timeouts
        const chunkSize = 50;
        const chunks = [];

        for (let i = 0; i < sites.length; i += chunkSize) {
            chunks.push(sites.slice(i, i + chunkSize));
        }

        // Process chunks in parallel
        await Promise.all(chunks.map(async (chunk) => {
            await Promise.all(chunk.map(async (site) => {
                try {
                    const isUp = await checkSite(site.domain);
                    siteStatus.labels(site.domain, site.directory).set(isUp ? 1 : 0);
                } catch (error) {
                    console.error(`Error checking ${site.domain}:`, error);
                    siteStatus.labels(site.domain, site.directory).set(0);
                }
            }));
        }));

        const metrics = await register.metrics();
        res.set('Content-Type', register.contentType);
        res.set('Connection', 'close');
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