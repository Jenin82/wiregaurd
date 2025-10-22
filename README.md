# WireGuard

Bring up a WireGuard tunnel on Ubuntu runners with automatic teardown.

## Inputs

- `config` (**required**): Base64-encoded `wg-quick` config (e.g., `wg0.conf`).
- `iface` (default `wg0`): Interface name.
- `check_ip` (default `true`): If `true`, prints public IP and sets `public_ip` output.
- `apt_update` (default `false`): Run `apt-get update` before install.

## Outputs

- `public_ip`: The detected public IP after the tunnel is up (if `check_ip=true`).

## Example

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: rohittp0/wiregaurd@v2
        with:
          config: ${{ secrets.WG_CLIENT_CONF_BASE64 }}
```

## Generating WG_CLIENT_CONF_BASE64

```bash
base64 -w0 wg0.conf > wg0.conf.b64
```

Paste into repository/org secret WG_CLIENT_CONF_BASE64
