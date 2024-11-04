
const siteStatus = new prom.Gauge({
    name: 'site_up',
    help: 'Site status: 1 = up, 0 = down',
    labelNames: ['domain', 'directory']
});

siteStatus.labels(site.domain, site.directory).set(isUp ? 1 : 0);
siteStatus.labels(site.domain, site.directory).set(0);