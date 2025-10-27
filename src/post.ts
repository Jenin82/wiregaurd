import * as core from "@actions/core";
import * as exec from "@actions/exec";

const STATE_IFACE = "wg_iface";
const STATE_BYPASS_ROUTES = "bypass_routes"; // JSON string of {ip:string, family:'v4'|'v6'}[]

type BypassRoute = { ip: string; family: 'v4'|'v6' };

async function checkInterfaceExists(iface: string): Promise<boolean> {
  const result = await exec.getExecOutput("ip", ["link", "show", iface], {ignoreReturnCode: true, silent: true});
  return result.exitCode === 0;
}

async function removeBypassRoutes(routes: BypassRoute[]): Promise<void> {
  for (const r of routes) {
    try {
      if (r.family === 'v6') {
        await exec.exec("sudo", ["ip", "-6", "route", "del", `${r.ip}/128`], {ignoreReturnCode: true});
      } else {
        await exec.exec("sudo", ["ip", "route", "del", `${r.ip}/32`], {ignoreReturnCode: true});
      }
    } catch (e: any) {
      core.debug(`Failed to delete bypass route ${r.ip}: ${e?.message || e}`);
    }
  }
}

async function runPost() {
  try {
    const iface = core.getState(STATE_IFACE);
    const routesJson = core.getState(STATE_BYPASS_ROUTES);

    if (routesJson) {
      try {
        const routes: BypassRoute[] = JSON.parse(routesJson);
        await removeBypassRoutes(routes);
      } catch (e: any) {
        core.debug(`Failed to parse/remove bypass routes: ${e?.message || e}`);
      }
    }

    if (iface) {
      const exists = await checkInterfaceExists(iface);
      if (exists) {
        core.info(`Tearing down WireGuard interface '${iface}'...`);
        await exec.exec("sudo", ["wg-quick", "down", iface], {ignoreReturnCode: true});
      }
    }
  } catch (err: any) {
    core.warning(`Post cleanup failed: ${err?.message || err}`);
  }
}

runPost().then();
