app.get('/metrics', async (req, res) => {
    try {
        siteStatus.reset();
        const sites = await findSites();

        // Check sites in chunks to avoid overwhelming the system
        const chunkSize = 10;
        for (let i = 0; i < sites.length; i += chunkSize) {
            const chunk = sites.slice(i, i + chunkSize);
            await Promise.all(chunk.map(async (site) => {
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

            // Add a small delay between chunks
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const metrics = await register.metrics();
        res.set('Content-Type', register.contentType);
        res.end(metrics);
    } catch (error) {
        console.error('Error serving metrics:', error);
        res.status(500).send('Error collecting metrics');
    }
});

async function checkSite(domain) {
    return new Promise(async (resolve) => {
        let isResolved = false;

        // Function to safely resolve only once
        const safeResolve = (value) => {
            if (!isResolved) {
                isResolved = true;
                resolve(value);
            }
        };

        // Helper function for HTTP(S) requests
        const makeRequest = (protocol, options) => {
            return new Promise((resolveRequest) => {
                const client = protocol.get(options, (res) => {
                    // Consider any response as success, even error pages
                    const statusCode = res.statusCode;
                    console.log(`${options.protocol} check for ${domain}: Response status ${statusCode}`);
                    res.resume();
                    resolveRequest(true);
                });

                client.on('error', (err) => {
                    console.log(`${options.protocol} check for ${domain} failed:`, err.message);
                    resolveRequest(false);
                });

                client.on('timeout', () => {
                    console.log(`${options.protocol} check for ${domain} timed out`);
                    client.destroy();
                    resolveRequest(false);
                });
            });
        };

        try {
            // Try HTTPS first
            const httpsOptions = {
                hostname: domain,
                port: 443,
                path: '/',
                timeout: 10000,
                protocol: 'https:', // Changed from 'HTTPS' to 'https:'
                rejectUnauthorized: false,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                }
            };

            const isHttpsUp = await makeRequest(https, httpsOptions);
            if (isHttpsUp) {
                return safeResolve(true);
            }

            // If HTTPS fails, try HTTP
            const httpOptions = {
                hostname: domain,
                port: 80,
                path: '/',
                timeout: 10000,
                protocol: 'http:', // Changed from 'HTTP' to 'http:'
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36'
                }
            };

            const isHttpUp = await makeRequest(http, httpOptions);
            safeResolve(isHttpUp);

        } catch (error) {
            console.error(`Error checking ${domain}:`, error.message);
            safeResolve(false);
        }

        // Ensure we resolve after timeout
        setTimeout(() => safeResolve(false), 15000);
    });
}