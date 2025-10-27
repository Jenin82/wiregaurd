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
| `preserve_github_connectivity` | No | `"true"` | Add host routes that bypass the VPN for GitHub control-plane endpoints to keep logs and status updates working |

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

      # Optional: explicitly preserve GitHub connectivity (defaults to true)
      # with:
      #   preserve_github_connectivity: 'true'
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

### 3b. Full-Tunnel Configs (Caution)

If your `wg0.conf` uses full-tunnel `AllowedIPs = 0.0.0.0/0, ::/0`, keep `preserve_github_connectivity: true` (default) so the action adds bypass routes for key GitHub domains. This prevents job logs and status updates from hanging.

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
          preserve_github_connectivity: 'true' # recommended for full-tunnel configs
```

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

### Connectivity Preservation for GitHub (Recommended)

To keep GitHub Actions job logs and status updates working when a VPN is active, this action can add host routes that bypass the tunnel for core GitHub endpoints (both IPv4 and IPv6). This is controlled by `preserve_github_connectivity` (defaults to `true`).

Endpoints include (non-exhaustive):

- github.com
- api.github.com
- raw.githubusercontent.com
- objects.githubusercontent.com
- actions.githubusercontent.com
- pkg-containers.githubusercontent.com
- githubusercontent.com
- github-cloud.s3.amazonaws.com

If you set `preserve_github_connectivity: 'false'`, all traffic matching your WireGuard config will go through the tunnel and you may see hangs in logs or status updates with full-tunnel `AllowedIPs`.

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

### Cleanup

This action now includes a post-job cleanup step that:
- Tears down the WireGuard interface (`wg-quick down <iface>`) if it is up
- Removes any GitHub bypass routes that were added

This improves reliability for both GitHub-hosted and self-hosted runners. On self-hosted runners, it helps prevent persistent route state between jobs.

## Troubleshooting

### Routes not working?

- Verify your WireGuard config doesn't use `AllowedIPs = 0.0.0.0/0`
- Check that domains resolve correctly (DNS issues)
- Ensure the WireGuard peer accepts traffic for the routed IPs
- If using full-tunnel configs, leave `preserve_github_connectivity` set to `true`

### "Interface exists but no domains or IPs specified"

This warning appears when you call the action a second time without providing `domains` or `ips`. It's harmless but indicates nothing was done.

### DNS resolution failures

Some domains may not have IPv4 or IPv6 records. The action logs warnings but continues. Check the logs for details.

## Contributing

Issues and pull requests are welcome! Please report bugs or suggest features at [GitHub Issues](https://github.com/rohittp0/wiregaurd/issues).
