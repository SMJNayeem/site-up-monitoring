# Site Monitor System

A robust, automated monitoring system designed to track the operational status of multiple web applications across different domains. This system provides real-time status monitoring through Prometheus metrics, offering a minimalist yet effective approach to service health checking.

## System Architecture

The monitoring system consists of three main components working in harmony to provide continuous site status monitoring. At its core, a Node.js-based monitoring service actively probes each site's health status. This service works in conjunction with Prometheus for metrics collection and storage, creating a reliable system for tracking site availability.

The monitor service is designed to automatically discover sites by scanning directories and reading environment files, eliminating the need for manual configuration when adding new sites. It operates using a simple yet effective health check mechanism that attempts both HTTPS and HTTP connections to determine site availability.

![alt text](<images/Untitled diagram-2024-11-03-090553.png>)


### Component Breakdown

The monitoring stack consists of:

1. **Monitor Service**: A Node.js application that serves as the primary component for site discovery and health checking. It reads environment files to identify sites and performs health checks.

2. **Prometheus**: The metrics collection and storage system that regularly scrapes our monitor service for site status data.

3. **Environment Files**: Configuration files within each site's directory containing essential information like domain names and ports.


## System Flow

The monitoring process follows a continuous cycle:

1. When Prometheus sends a scrape request to the monitor's `/metrics` endpoint, it triggers the site discovery process.

2. The monitor service scans the base directory, identifying all site directories (excluding specified ones like 'core' and 'nginx').

3. For each valid directory found, the service reads the `.env` file to extract domain information.

4. The service then performs health checks on each discovered domain:
   - First attempts an HTTPS connection
   - Falls back to HTTP if HTTPS fails
   - Considers any successful response (including error pages) as indicating the site is "up"

5. Results are aggregated and returned to Prometheus in its metric format.

6. This cycle repeats based on Prometheus's scrape interval (default: 1 minute).

![alt text](<images/Untitled diagram-2024-11-03-083438.png>)


### Security Architecture

The system is designed with security in mind, maintaining a clear separation between internal monitoring components and external services. Prometheus, our metrics collection system, operates exclusively within the internal network boundary, protected by multiple security layers:

1. **Network Isolation**: Prometheus runs on localhost, accessible only from within the server
2. **Firewall Protection** (Optional): UFW rules restrict access to Prometheus ports 
```
# Block external access to Prometheus
sudo ufw deny 9090

# Allow only local connections
sudo ufw allow from 127.0.0.1 to any port 9090
```
3. **Service Hardening**: Systemd service configurations implement security best practices


### Component Interaction

- The Monitor Service operates as an intermediary between Prometheus and external services
- Site health checks are performed over both HTTPS (primary) and HTTP (fallback)
- All sensitive components (Prometheus, configuration files) remain within the internal network boundary
- External communication occurs only for necessary health checks


## Installation and Setup

Follow these steps to set up the monitoring system:

1. First, prepare the monitoring directory:
```bash
mkdir -p path/to/site-monitor
cd path/to/site-monitor
npm init -y
npm install express prom-client
```

2. Create the monitor service file:
```bash
nano monitor.js
```
Copy the code for monitor.js


3. Set up the systemd service for automatic startup:
```bash
sudo nano /etc/systemd/system/site-monitor.service
```
Copy the site-monitor service code

4. Enhance the Prometheus service security by updating the systemd service file:
```bash
sudo nano /etc/systemd/system/prometheus.service
```
Copy the prometheus service code


4. Install and configure Prometheus:
```bash
sudo apt-get update
sudo apt-get install prometheus
```

5. Configure Prometheus by editing its configuration file:
```bash
sudo nano /etc/prometheus/prometheus.yml
```
Copy the code for prometheus.yml


6. Start the services:
```bash
sudo systemctl daemon-reload
sudo systemctl enable site-monitor
sudo systemctl start site-monitor
sudo systemctl restart prometheus
```

## Usage and Monitoring

The system provides several endpoints for monitoring and debugging:

### Metrics Endpoint
Access the metrics at `http://localhost:9092/metrics`. The output will look like:
```
# HELP site_up Site status: 1 for up, 0 for down
# TYPE site_up gauge
site_up{site_dir="site1",domain="example1.com"} 1
site_up{site_dir="site2",domain="example2.com"} 0
```

### Debug Endpoint
Use `http://localhost:9092/debug` to see detailed information about discovered sites and their current status.

### Test Endpoint
Test specific domains using `http://localhost:9092/test/example.com`.

## Site Discovery and Configuration

The monitor automatically discovers sites by scanning directories in the configured base path. For a site to be monitored, it needs:

1. A directory in the base path (default: /root)
2. An `.env` file containing a `DOMAIN_NAME` entry

The system automatically excludes specific directories (like 'core' and 'nginx') and only processes directories containing valid environment files.

## Monitoring Logic

The health check implementation follows a sophisticated approach:

1. **HTTPS First**: The system first attempts an HTTPS connection to each domain, following modern web security practices.

2. **HTTP Fallback**: If HTTPS fails, the system automatically attempts an HTTP connection, ensuring compatibility with sites not yet using HTTPS.

3. **Response Validation**: Any response from the server (even error pages) is considered a successful health check, as it indicates the service is running.

4. **Timeout Handling**: Connections are limited to 5 seconds to prevent hanging on unresponsive sites.

## Troubleshooting

If sites aren't being detected:
1. Verify the base directory path in the monitor configuration
2. Check environment file permissions
3. Ensure environment files contain the correct DOMAIN_NAME format
4. Review the service logs: `sudo journalctl -u site-monitor -f`

For metric collection issues:
1. Verify Prometheus is running: `sudo systemctl status prometheus`
2. Check Prometheus targets at `http://localhost:9091/targets`
3. Review Prometheus logs: `sudo journalctl -u prometheus -f`

## Security Considerations

The monitor service:
- Handles HTTPS connections securely
- Accepts self-signed certificates for internal services
- Runs with minimal required permissions
- Implements timeout protection against hanging connections
