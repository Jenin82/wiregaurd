# WireGuard

Bring up a WireGuard tunnel on Ubuntu runners with automatic teardown.

## Inputs

- `config` (**required**): Base64-encoded `wg-quick` config (e.g., `wg0.conf`).
- `iface` (default `wg0`): Interface name.
- `check_ip` (default `true`): If `true`, prints public IP and sets `public_ip` output.
- `apt_update` (default `false`): Run `apt-get update` before install.
- `domains` (optional): Comma-separated list of domains to route through WireGuard for split tunneling. If not specified, all traffic is routed through WireGuard (based on your config's `AllowedIPs`).

## Outputs

- `public_ip`: The detected public IP after the tunnel is up (if `check_ip=true`).

## Examples

### Basic Usage (Route All Traffic)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
```

### Split Tunneling (Route Specific Domains Only)

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v1.1
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
          domains: 'example.com,api.service.io,internal.company.net'
```

When using split tunneling with the `domains` parameter:
- Only traffic to the specified domains will be routed through the WireGuard tunnel
- All other traffic will use the default network connection
- The action automatically resolves domains to IP addresses (both IPv4 and IPv6)
- Routes are cleaned up automatically when the workflow completes

**Important**: When using split tunneling, ensure your WireGuard config does NOT include `AllowedIPs = 0.0.0.0/0` or `::/0`, as this would route all traffic through the tunnel regardless of the `domains` setting. Instead, use a minimal `AllowedIPs` setting like the peer's internal IP address.

## Generating WG_CLIENT_CONF_BASE64

```bash
base64 -w0 wg0.conf > wg0.conf.b64
```

Paste into repository/org secret WG_CLIENT_CONF_BASE64
