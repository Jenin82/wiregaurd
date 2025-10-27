# WireGuard

A GitHub Action that brings up WireGuard tunnels on Ubuntu runners with dynamic domain-based routing and split tunneling support.

## Features

- 🌐 **Dynamic domain routing** - Add routes for domains discovered during workflow execution
- 🎯 **Split tunneling** - Route only specific domains/IPs through the VPN
- 📍 **Direct IP routing** - Support for both IPv4 and IPv6 addresses

## Inputs

| Input     | Required | Default | Description                                                                    |
|-----------|----------|---------|--------------------------------------------------------------------------------|
| `config`  | ✅ Yes    | -       | Base64-encoded `wg-quick` configuration file                                   |
| `domains` | No       | `""`    | Comma-separated list of domains to route through WireGuard                     |
| `ips`     | No       | `""`    | Comma-separated list of IP addresses (IPv4 or IPv6) to route through WireGuard |

## Usage Examples

### 1. Basic Setup (Route All Traffic)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
```

### 2. Split Tunneling (Specific Domains)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
          domains: 'api.internal.company.com,database.service.io'
```

### 3. Dynamic Domain Addition (The Power Use Case!)

This is the primary use case - add routes for domains discovered during workflow execution:

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      # Initial WireGuard setup
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}

      # Query internal VPN-only server to get dynamic domain
      - name: Get dynamic endpoint
        id: endpoint
        run: |
          DOMAIN=$(curl http://internal-vpn-only-server.local/api/get-endpoint)
          echo "domain=$DOMAIN" >> $GITHUB_OUTPUT

      # Dynamically add route for the discovered domain
      - uses: rohittp0/wiregaurd@v2
        with:
          domains: ${{ steps.endpoint.outputs.domain }}

      # Now you can access the dynamic domain
      - name: Deploy to dynamic endpoint
        run: curl https://${{ steps.endpoint.outputs.domain }}/deploy
```

**How it works:**
- First call: Sets up WireGuard interface (detected automatically)
- Second call: Detects interface exists, only adds routes for new domain

### 4. Direct IP Routing

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
          ips: '10.0.1.50,10.0.2.100,2001:db8::1'
```

### 5. Combined Domains and IPs

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
          domains: 'api.internal.com,db.internal.com'
          ips: '192.168.1.100,10.0.0.50'
```

### 6. Multiple Dynamic Route Additions

You can call the action multiple times to add routes as needed:

```yaml
jobs:
  multi-service-deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}

      - name: Add route for service A
        uses: rohittp0/wiregaurd@v2
        with:
          domains: 'service-a.internal.local'

      - name: Deploy to service A
        run: ./deploy-service-a.sh

      - name: Add route for service B
        uses: rohittp0/wiregaurd@v2
        with:
          domains: 'service-b.internal.local'

      - name: Deploy to service B
        run: ./deploy-service-b.sh
```

## Configuration Guide

### Generating WG_CLIENT_CONF_BASE64

Encode your WireGuard configuration file:

```bash
base64 -w0 wg0.conf > wg0.conf.b64
```

Then add the contents to your GitHub repository or organization secrets as `WG_CLIENT_CONF_BASE64`.

### WireGuard Config for Split Tunneling

**Important:** When using the `domains` or `ips` parameters for split tunneling, configure your WireGuard config appropriately:

#### ❌ Don't use this (routes all traffic):
```ini
[Interface]
PrivateKey = your-private-key
Address = 10.0.0.2/32

[Peer]
PublicKey = server-public-key
Endpoint = vpn.example.com:51820
AllowedIPs = 0.0.0.0/0, ::/0  # ❌ This routes ALL traffic
```

#### ✅ Use this instead (allows split tunneling):
```ini
[Interface]
PrivateKey = your-private-key
Address = 10.0.0.2/32

[Peer]
PublicKey = server-public-key
Endpoint = vpn.example.com:51820
AllowedIPs = 10.0.0.1/32  # ✅ Only the peer's IP, routes controlled by action
```

With the minimal `AllowedIPs` configuration, the action takes full control of routing, allowing you to specify exactly which domains/IPs should go through the tunnel.

## How It Works

### Automatic Mode Detection

The action automatically determines what to do based on whether the WireGuard interface already exists:

1. **Setup Mode** (first invocation):
   - Installs WireGuard
   - Configures the interface
   - Brings up the tunnel
   - Adds routes for specified domains/IPs

2. **Add-Route Mode** (subsequent invocations):
   - Detects existing interface
   - Resolves domains to IPs (both IPv4 and IPv6)
   - Adds specific routes for each IP
   - No reinstallation or reconfiguration

### DNS Resolution

- Domains are resolved to both IPv4 and IPv6 addresses
- Routes are added for all resolved IPs
- Failed resolutions log warnings but don't fail the workflow
- Route additions are idempotent (adding the same route twice is safe)

### Route Management

Routes are added with `/32` (IPv4) or `/128` (IPv6) prefix lengths, ensuring only traffic to those specific IPs goes through the tunnel.

## Design Decisions

### Why No Cleanup?

This action doesn't include cleanup functionality because:
- GitHub-hosted runners are ephemeral and destroyed after each job
- The entire VM/container is wiped, including all network configurations
- Cleanup would add complexity without benefit for the primary use case

**Note for self-hosted runners:** If you're using self-hosted runners, be aware that routes will persist between jobs. You may want to manually clean up or restart the runner between jobs.

## Troubleshooting

### Action appears to hang or has delayed logs

**Version 2.0+** includes fixes for these issues:

- **Real-time logging**: All command output now streams immediately instead of buffering
- **Timeout protection**: Operations have configurable timeouts to prevent indefinite hangs
- **Progress indicators**: Visual feedback shows the action is working during long operations
- **DNS retry logic**: Failed DNS lookups are retried with exponential backoff

**If you're still experiencing issues:**

1. **Check the logs carefully** - Look for timeout messages or DNS resolution warnings
2. **Verify DNS is working** - Test domain resolution manually: `nslookup your-domain.com`
3. **Check WireGuard config** - Ensure your config doesn't have PostUp/PreDown scripts that hang
4. **Monitor execution time** - The action logs total execution time at completion

**Timeout Configuration:**

The action has built-in timeouts:
- DNS resolution: 10 seconds per lookup (3 retry attempts)
- WireGuard interface startup: 60 seconds
- Route addition: 10 seconds per route

### Action hangs during `wg-quick up`

**Common causes:**

1. **DNS resolution in config** - If your WireGuard config's `Endpoint` uses a domain name that can't be resolved
2. **PostUp/PreDown scripts** - Scripts in your config that hang or wait for input
3. **Network connectivity** - Unable to reach the WireGuard endpoint

**Solutions:**

```ini
# Use IP address instead of domain for Endpoint
[Peer]
Endpoint = 203.0.113.1:51820  # ✅ IP address
# Instead of:
# Endpoint = vpn.example.com:51820  # ❌ May cause DNS lookup delays
```

**Diagnostic steps:**

1. Test your config locally first: `sudo wg-quick up wg0`
2. Check systemd logs if startup fails: `sudo journalctl -u wg-quick@wg0`
3. Verify endpoint is reachable: `ping -c 3 <endpoint-ip>`

### Routes not working?

- Verify your WireGuard config doesn't use `AllowedIPs = 0.0.0.0/0`
- Check that domains resolve correctly (DNS issues)
- Ensure the WireGuard peer accepts traffic for the routed IPs
- Verify routes were added: `ip route show dev wg0`

### "Interface exists but no domains or IPs specified"

This warning appears when you call the action a second time without providing `domains` or `ips`. It's harmless but indicates nothing was done.

### DNS resolution failures

**Symptoms:**
- Warning: `Failed to resolve <domain> after 3 attempts`
- Routes not added for specific domains

**Causes:**
- Domain doesn't exist or has no DNS records
- DNS server timeout or unreachable
- Network connectivity issues

**The action automatically:**
- Retries DNS lookups 3 times with 2-second delays
- Times out after 10 seconds per lookup
- Continues with other domains if one fails

**Manual verification:**
```bash
# Test DNS resolution
dig +short your-domain.com
nslookup your-domain.com
```

### Long-running workflows

For workflows that run for extended periods:

1. **Initial setup is fast** - WireGuard setup typically completes in 10-30 seconds
2. **Route additions are incremental** - Each domain/IP adds ~1-2 seconds
3. **Progress is logged** - Watch for `[X/Y]` progress indicators in logs
4. **Timeouts prevent hangs** - Operations fail fast rather than hanging indefinitely

**Performance tips:**
- Minimize the number of domains (resolve to IPs beforehand if possible)
- Use IP addresses directly when known
- Batch route additions in a single action call rather than multiple calls

## Contributing

Issues and pull requests are welcome! Please report bugs or suggest features at [GitHub Issues](https://github.com/rohittp0/wiregaurd/issues).
