import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import {promises as fs} from "fs";
import * as os from "os";
import * as path from "path";
import {promises as dns} from "dns";

const STATE_IFACE = "wg_iface";
const STATE_BYPASS_ROUTES = "bypass_routes"; // JSON string of {ip:string, family:'v4'|'v6'}[]

async function checkInterfaceExists(iface: string): Promise<boolean> {
    const result = await exec.getExecOutput("ip", ["link", "show", iface], {ignoreReturnCode: true, silent: true});
    return result.exitCode === 0;
}

async function addSingleRoute(ip: string, iface: string): Promise<void> {
    const isIpv6 = ip.includes(":");
    const cidr = isIpv6 ? `${ip}/128` : `${ip}/32`;
    const ipCommand = isIpv6 ? ["ip", "-6"] : ["ip"];

    await exec.exec("sudo", [...ipCommand, "route", "add", cidr, "dev", iface]);
}

async function resolveDomainIPs(domain: string): Promise<string[]> {
    const ips: string[] = [];

    // Resolve IPv4
    try {
        const ipv4Addresses = await dns.resolve4(domain);
        ips.push(...ipv4Addresses);
    } catch (err: any) {
        if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
            core.warning(`Failed to resolve IPv4 for ${domain}: ${err.message}`);
        }
    }

    // Resolve IPv6
    try {
        const ipv6Addresses = await dns.resolve6(domain);
        ips.push(...ipv6Addresses);
    } catch (err: any) {
        if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
            core.warning(`Failed to resolve IPv6 for ${domain}: ${err.message}`);
        }
    }

    return ips;
}

async function addRoutesForDomains(domains: string[], iface: string): Promise<void> {
    if (!domains.length) return;

    core.info(`Adding routes for ${domains.length} domain(s)...`);
    let routeCount = 0;

    for (const domain of domains) {
        core.info(`Resolving ${domain}...`);
        const ips = await resolveDomainIPs(domain);

        for (const ip of ips) {
            try {
                core.info(`Adding route for ${domain} (${ip}) via ${iface}`);
                await addSingleRoute(ip, iface);
                routeCount++;
            } catch (err: any) {
                core.warning(`Failed to add route for ${ip}: ${err.message}`);
            }
        }
    }

    core.info(`Added ${routeCount} route(s) for domains.`);
}

async function addRoutesForIPs(ips: string[], iface: string): Promise<void> {
    if (!ips.length) return;

    core.info(`Adding routes for ${ips.length} IP address(es)...`);
    let routeCount = 0;

    for (const ip of ips) {
        try {
            const cidr = ip.includes(":") ? `${ip}/128` : `${ip}/32`;
            core.info(`Adding route for ${cidr} via ${iface}`);
            await addSingleRoute(ip, iface);
            routeCount++;
        } catch (err: any) {
            core.warning(`Failed to add route for ${ip}: ${err.message}`);
        }
    }

    core.info(`Added ${routeCount} route(s) for IPs.`);

}

async function addRoutes(domains: string[], ips: string[], iface: string): Promise<void> {
    await addRoutesForDomains(domains, iface);
    await addRoutesForIPs(ips, iface);
}

async function installWireGuard(): Promise<void> {
    core.info("Installing WireGuard...");
    // Avoid interactive hangs and ensure fresh package lists
    try {
        await exec.exec("sudo", ["apt-get", "update"]);
    } catch (e: any) {
        core.warning(`apt-get update failed: ${e?.message || e}`);
    }
    await exec.exec("sudo", ["env", "DEBIAN_FRONTEND=noninteractive", "apt-get", "install", "-y", "--no-install-recommends", "wireguard"]);
}

async function setupWireGuardConfig(config: string, iface: string): Promise<void> {
    // Decode config to temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-"));
    const tmpConf = path.join(tmpDir, `${iface}.conf`);
    await fs.writeFile(tmpConf, Buffer.from(config, "base64").toString("utf8"), {mode: 0o600});

    // Copy to /etc/wireguard with proper permissions
    const etcDir = "/etc/wireguard";
    await io.mkdirP(etcDir);
    const etcConf = path.join(etcDir, `${iface}.conf`);
    await exec.exec("sudo", ["cp", tmpConf, etcConf]);
    await exec.exec("sudo", ["chmod", "600", etcConf]);
}

async function startWireGuardInterface(iface: string): Promise<void> {
    core.info(`Starting WireGuard interface '${iface}'...`);
    await exec.exec("sudo", ["wg-quick", "up", iface]);
    core.info(`WireGuard interface '${iface}' is up.`);
}

async function setupWireGuard(config: string, iface: string): Promise<void> {
    await installWireGuard();
    await setupWireGuardConfig(config, iface);
    await startWireGuardInterface(iface);
}

async function handleAddRouteMode(domains: string[], ips: string[], iface: string): Promise<void> {
    core.info(`WireGuard interface '${iface}' already exists. Adding routes...`);

    if (!domains.length && !ips.length) {
        core.warning("Interface exists but no domains or IPs specified. Nothing to do.");
        return;
    }

    await addRoutes(domains, ips, iface);
    core.info("Route addition complete.");
}

async function handleSetupMode(config: string, domains: string[], ips: string[], iface: string): Promise<void> {
    core.info("Setting up WireGuard interface...");

    await setupWireGuard(config, iface);
    await addRoutes(domains, ips, iface);

    core.info("WireGuard setup complete.");
}

function parseInputList(input: string): string[] {
    return input.split(",").map(item => item.trim()).filter(item => item);
}

type DefaultRoute = { family: 'v4'|'v6', dev?: string, via?: string };

async function getDefaultRoutes(): Promise<DefaultRoute[]> {
    const routes: DefaultRoute[] = [];
    try {
        const out4 = await exec.getExecOutput("ip", ["route", "show", "default"], {silent: true});
        for (const line of out4.stdout.split("\n")) {
            const m = line.match(/default(?:\s+via\s+(\S+))?(?:\s+dev\s+(\S+))?/);
            if (m) routes.push({family: 'v4', via: m[1], dev: m[2]});
        }
    } catch {}
    try {
        const out6 = await exec.getExecOutput("ip", ["-6", "route", "show", "default"], {silent: true});
        for (const line of out6.stdout.split("\n")) {
            const m = line.match(/default(?:\s+via\s+(\S+))?(?:\s+dev\s+(\S+))?/);
            if (m) routes.push({family: 'v6', via: m[1], dev: m[2]});
        }
    } catch {}
    return routes;
}

const GITHUB_ENDPOINTS = [
    "github.com",
    "api.github.com",
    "raw.githubusercontent.com",
    "objects.githubusercontent.com",
    "actions.githubusercontent.com",
    "pkg-containers.githubusercontent.com",
    "githubusercontent.com",
    "github-cloud.s3.amazonaws.com",
];

async function addBypassRoutesForGithub(defaults: DefaultRoute[]): Promise<{ip:string,family:'v4'|'v6'}[]> {
    const added: {ip:string,family:'v4'|'v6'}[] = [];
    core.info("Ensuring GitHub control-plane connectivity (bypass routes)...");
    for (const host of GITHUB_ENDPOINTS) {
        let v4: string[] = [];
        let v6: string[] = [];
        try { v4 = await dns.resolve4(host); } catch {}
        try { v6 = await dns.resolve6(host); } catch {}

        for (const ip of v4) {
            const def = defaults.find(d => d.family === 'v4' && d.via && d.dev);
            if (!def || !def.via || !def.dev) continue;
            try {
                await exec.exec("sudo", ["ip", "route", "add", `${ip}/32`, "via", def.via, "dev", def.dev]);
                added.push({ip, family:'v4'});
                core.info(`Bypass route added: ${host} (${ip}) via ${def.via} dev ${def.dev}`);
            } catch (e:any) {
                core.debug(`Bypass v4 route for ${ip} may already exist: ${e?.message || e}`);
            }
        }
        for (const ip of v6) {
            const def = defaults.find(d => d.family === 'v6' && d.via && d.dev);
            if (!def || !def.via || !def.dev) continue;
            try {
                await exec.exec("sudo", ["ip", "-6", "route", "add", `${ip}/128`, "via", def.via, "dev", def.dev]);
                added.push({ip, family:'v6'});
                core.info(`Bypass route added: ${host} (${ip}) via ${def.via} dev ${def.dev}`);
            } catch (e:any) {
                core.debug(`Bypass v6 route for ${ip} may already exist: ${e?.message || e}`);
            }
        }
    }
    return added;
}

async function run() {
    try {
        if (process.platform !== "linux") {
            core.setFailed("This action currently supports only Linux runners.");
            return;
        }

        // Parse inputs
        const iface = core.getInput("iface") || "wg0";
        const domains = parseInputList(core.getInput("domains") || "");
        const ips = parseInputList(core.getInput("ips") || "");
        const preserveGithub = (core.getInput("preserve_github_connectivity") || "true").toLowerCase() !== 'false';

        // Save iface for post cleanup
        core.saveState(STATE_IFACE, iface);

        // Determine mode based on interface existence
        const interfaceExists = await checkInterfaceExists(iface);

        // Capture default routes prior to any changes
        const defaults = await getDefaultRoutes();
        if (preserveGithub) {
            try {
                const added = await addBypassRoutesForGithub(defaults);
                if (added.length) {
                    core.saveState(STATE_BYPASS_ROUTES, JSON.stringify(added));
                }
            } catch (e:any) {
                core.warning(`Failed to add GitHub bypass routes: ${e?.message || e}`);
            }
        }

        if (interfaceExists) {
            await handleAddRouteMode(domains, ips, iface);
        } else {
            const config = core.getInput("config", {required: true});
            await handleSetupMode(config, domains, ips, iface);
        }
    } catch (err: any) {
        core.setFailed(`WireGuard action failed: ${err?.message || err}`);
    }
}

run().then();
