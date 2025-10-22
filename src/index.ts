import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import { promises as fs } from "fs";
import * as os from "os";
import * as path from "path";

async function run() {
    try {
        if (process.platform !== "linux") {
            core.setFailed("This action currently supports only Linux runners.");
            return;
        }

        const iface = core.getInput("iface") || "wg0";
        const b64 = core.getInput("config", { required: true });
        const checkIp = (core.getInput("check_ip") || "true").toLowerCase() === "true";
        const aptUpdate = (core.getInput("apt_update") || "false").toLowerCase() === "true";

        // Decode config safely to a temp file first
        const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-"));
        const tmpConf = path.join(tmpDir, `${iface}.conf`);
        await fs.writeFile(tmpConf, Buffer.from(b64, "base64").toString("utf8"), { mode: 0o600 });

        // Install WireGuard (Ubuntu)
        if (aptUpdate) {
            await exec.exec("sudo", ["apt-get", "update"]);
        }
        await exec.exec("sudo", ["apt-get", "install", "-y", "wireguard"]);

        // Place config into /etc/wireguard/<iface>.conf with 600 perms
        const etcDir = "/etc/wireguard";
        await io.mkdirP(etcDir);
        const etcConf = path.join(etcDir, `${iface}.conf`);
        await exec.exec("sudo", ["cp", tmpConf, etcConf]);
        await exec.exec("sudo", ["chmod", "600", etcConf]);

        // Bring interface up
        await exec.exec("sudo", ["wg-quick", "up", iface]);

        // Save state for post (teardown)
        core.saveState("iface", iface);

        // Optional: check external IP (use a simple endpoint)
        if (checkIp) {
            const { stdout, stderr } = await exec.getExecOutput("curl", ["-fsSL", "https://ifconfig.me"],
                { silent: true, ignoreReturnCode: true }
            );
            const ip = stdout.trim();
            if (ip) {
                core.setOutput("public_ip", ip);
                core.info(`Public IP via WG: ${ip}`);
            } else {
                core.error(stderr)
                core.warning("Could not determine public IP (curl failed or blocked).");
            }
        }

        core.info(`WireGuard interface '${iface}' is up.`);
    } catch (err: any) {
        core.setFailed(`WireGuard setup failed: ${err?.message || err}`);
    }
}

run().then();
