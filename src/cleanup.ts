import * as core from "@actions/core";
import * as exec from "@actions/exec";

async function cleanup() {
    try {
        const iface = core.getState("iface") || "wg0";
        // Try to tear down; don't fail the whole job if this errors
        await exec.exec("sudo", ["wg-quick", "down", iface], { ignoreReturnCode: true });
        core.info(`WireGuard interface '${iface}' is down.`);
    } catch (err: any) {
        core.warning(`WireGuard teardown had issues: ${err?.message || err}`);
    }
}

cleanup().then();
