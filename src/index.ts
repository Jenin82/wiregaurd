import * as core from "@actions/core";
import * as exec from "@actions/exec";
import * as io from "@actions/io";
import {promises as fs} from "fs";
import * as os from "os";
import * as path from "path";
import {promises as dns} from "dns";

// Configuration constants
const DNS_TIMEOUT_MS = 10000; // 10 seconds
const DNS_RETRY_ATTEMPTS = 3;
const DNS_RETRY_DELAY_MS = 2000; // 2 seconds
const WG_QUICK_TIMEOUT_MS = 60000; // 60 seconds
const ROUTE_ADD_TIMEOUT_MS = 10000; // 10 seconds

// Real-time output listeners for exec commands
const createOutputListeners = () => ({
    stdout: (data: Buffer) => {
        process.stdout.write(data);
    },
    stderr: (data: Buffer) => {
        process.stderr.write(data);
    }
});

// Timeout wrapper for promises
async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, operation: string): Promise<T> {
    let timeoutHandle: NodeJS.Timeout;
    
    const timeoutPromise = new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => {
            reject(new Error(`Operation '${operation}' timed out after ${timeoutMs}ms`));
        }, timeoutMs);
    });
    
    try {
        const result = await Promise.race([promise, timeoutPromise]);
        clearTimeout(timeoutHandle!);
        return result;
    } catch (err) {
        clearTimeout(timeoutHandle!);
        throw err;
    }
}

// Sleep utility for retry delays
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function checkInterfaceExists(iface: string): Promise<boolean> {
    try {
        const result = await withTimeout(
            exec.getExecOutput("ip", ["link", "show", iface], {
                ignoreReturnCode: true,
                silent: true
            }),
            5000,
            `check interface ${iface}`
        );
        return result.exitCode === 0;
    } catch (err: any) {
        core.warning(`Failed to check interface existence: ${err.message}`);
        return false;
    }
}

async function addSingleRoute(ip: string, iface: string): Promise<void> {
    const isIpv6 = ip.includes(":");
    const cidr = isIpv6 ? `${ip}/128` : `${ip}/32`;
    const ipCommand = isIpv6 ? ["ip", "-6"] : ["ip"];

    await withTimeout(
        exec.exec("sudo", [...ipCommand, "route", "add", cidr, "dev", iface], {
            listeners: createOutputListeners()
        }),
        ROUTE_ADD_TIMEOUT_MS,
        `add route ${cidr}`
    );
}

async function resolveDomainIPsWithRetry(domain: string, attempt: number = 1): Promise<string[]> {
    const ips: string[] = [];

    try {
        // Resolve IPv4 with timeout
        try {
            const ipv4Addresses = await withTimeout(
                dns.resolve4(domain),
                DNS_TIMEOUT_MS,
                `resolve IPv4 for ${domain}`
            );
            ips.push(...ipv4Addresses);
            core.info(`✓ Resolved ${ipv4Addresses.length} IPv4 address(es) for ${domain}`);
        } catch (err: any) {
            if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
                core.debug(`IPv4 resolution failed for ${domain}: ${err.message}`);
            }
        }

        // Resolve IPv6 with timeout
        try {
            const ipv6Addresses = await withTimeout(
                dns.resolve6(domain),
                DNS_TIMEOUT_MS,
                `resolve IPv6 for ${domain}`
            );
            ips.push(...ipv6Addresses);
            core.info(`✓ Resolved ${ipv6Addresses.length} IPv6 address(es) for ${domain}`);
        } catch (err: any) {
            if (err.code !== 'ENOTFOUND' && err.code !== 'ENODATA') {
                core.debug(`IPv6 resolution failed for ${domain}: ${err.message}`);
            }
        }

        if (ips.length === 0) {
            throw new Error(`No IP addresses found for ${domain}`);
        }

        return ips;
    } catch (err: any) {
        if (attempt < DNS_RETRY_ATTEMPTS) {
            core.warning(`DNS resolution attempt ${attempt} failed for ${domain}, retrying in ${DNS_RETRY_DELAY_MS}ms...`);
            await sleep(DNS_RETRY_DELAY_MS);
            return resolveDomainIPsWithRetry(domain, attempt + 1);
        }
        core.warning(`Failed to resolve ${domain} after ${DNS_RETRY_ATTEMPTS} attempts: ${err.message}`);
        return [];
    }
}

async function addRoutesForDomains(domains: string[], iface: string): Promise<void> {
    if (!domains.length) return;

    core.info(`📡 Adding routes for ${domains.length} domain(s)...`);
    let routeCount = 0;
    let domainCount = 0;

    for (const domain of domains) {
        domainCount++;
        core.info(`[${domainCount}/${domains.length}] Resolving ${domain}...`);
        const ips = await resolveDomainIPsWithRetry(domain);

        if (ips.length === 0) {
            core.warning(`⚠️  Skipping ${domain} - no IP addresses resolved`);
            continue;
        }

        for (const ip of ips) {
            try {
                core.info(`  → Adding route for ${domain} (${ip}) via ${iface}`);
                await addSingleRoute(ip, iface);
                routeCount++;
            } catch (err: any) {
                core.warning(`  ✗ Failed to add route for ${ip}: ${err.message}`);
            }
        }
    }

    core.info(`✓ Added ${routeCount} route(s) for ${domains.length} domain(s).`);
}

async function addRoutesForIPs(ips: string[], iface: string): Promise<void> {
    if (!ips.length) return;

    core.info(`🔗 Adding routes for ${ips.length} IP address(es)...`);
    let routeCount = 0;
    let ipCount = 0;

    for (const ip of ips) {
        ipCount++;
        try {
            const cidr = ip.includes(":") ? `${ip}/128` : `${ip}/32`;
            core.info(`[${ipCount}/${ips.length}] Adding route for ${cidr} via ${iface}`);
            await addSingleRoute(ip, iface);
            routeCount++;
        } catch (err: any) {
            core.warning(`✗ Failed to add route for ${ip}: ${err.message}`);
        }
    }

    core.info(`✓ Added ${routeCount}/${ips.length} route(s) for IPs.`);
}

async function addRoutes(domains: string[], ips: string[], iface: string): Promise<void> {
    await addRoutesForDomains(domains, iface);
    await addRoutesForIPs(ips, iface);
}

async function installWireGuard(): Promise<void> {
    core.info("📦 Installing WireGuard...");
    
    // Update package list first
    core.info("Updating package list...");
    await exec.exec("sudo", ["apt-get", "update", "-qq"], {
        listeners: createOutputListeners()
    });
    
    // Install WireGuard with real-time output
    await exec.exec("sudo", ["apt-get", "install", "-y", "wireguard"], {
        listeners: createOutputListeners()
    });
    
    core.info("✓ WireGuard installed successfully");
}

async function setupWireGuardConfig(config: string, iface: string): Promise<void> {
    core.info("📝 Setting up WireGuard configuration...");
    
    // Decode config to temp file
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "wg-"));
    const tmpConf = path.join(tmpDir, `${iface}.conf`);
    await fs.writeFile(tmpConf, Buffer.from(config, "base64").toString("utf8"), {mode: 0o600});
    core.debug(`Config written to temp file: ${tmpConf}`);

    // Copy to /etc/wireguard with proper permissions
    const etcDir = "/etc/wireguard";
    await io.mkdirP(etcDir);
    const etcConf = path.join(etcDir, `${iface}.conf`);
    await exec.exec("sudo", ["cp", tmpConf, etcConf], {
        listeners: createOutputListeners()
    });
    await exec.exec("sudo", ["chmod", "600", etcConf], {
        listeners: createOutputListeners()
    });
    
    core.info(`✓ Configuration saved to ${etcConf}`);
}

async function startWireGuardInterface(iface: string): Promise<void> {
    core.info(`🚀 Starting WireGuard interface '${iface}'...`);
    core.info("This may take up to 60 seconds...");
    
    try {
        await withTimeout(
            exec.exec("sudo", ["wg-quick", "up", iface], {
                listeners: createOutputListeners()
            }),
            WG_QUICK_TIMEOUT_MS,
            `start WireGuard interface ${iface}`
        );
        
        // Verify interface is up
        const result = await exec.getExecOutput("sudo", ["wg", "show", iface], {
            listeners: createOutputListeners()
        });
        
        if (result.exitCode === 0) {
            core.info(`✓ WireGuard interface '${iface}' is up and running`);
        } else {
            throw new Error(`Interface started but verification failed`);
        }
    } catch (err: any) {
        core.error(`Failed to start WireGuard interface: ${err.message}`);
        
        // Try to get more diagnostic info
        core.info("Attempting to gather diagnostic information...");
        await exec.exec("sudo", ["systemctl", "status", `wg-quick@${iface}`], {
            ignoreReturnCode: true,
            listeners: createOutputListeners()
        });
        
        throw err;
    }
}

async function setupWireGuard(config: string, iface: string): Promise<void> {
    await installWireGuard();
    await setupWireGuardConfig(config, iface);
    await startWireGuardInterface(iface);
}

async function handleAddRouteMode(domains: string[], ips: string[], iface: string): Promise<void> {
    core.info(`🔄 WireGuard interface '${iface}' already exists. Adding routes...`);

    if (!domains.length && !ips.length) {
        core.warning("⚠️  Interface exists but no domains or IPs specified. Nothing to do.");
        return;
    }

    await addRoutes(domains, ips, iface);
    core.info("✓ Route addition complete.");
}

async function handleSetupMode(config: string, domains: string[], ips: string[], iface: string): Promise<void> {
    core.info("🔧 Setting up WireGuard interface...");

    await setupWireGuard(config, iface);
    
    if (domains.length > 0 || ips.length > 0) {
        core.info("\n📍 Adding custom routes...");
        await addRoutes(domains, ips, iface);
    }

    core.info("\n✅ WireGuard setup complete!");
}

function parseInputList(input: string): string[] {
    return input.split(",").map(item => item.trim()).filter(item => item);
}

async function run() {
    const startTime = Date.now();
    
    try {
        core.info("🔐 WireGuard GitHub Action Starting...");
        core.info("=".repeat(50));
        
        if (process.platform !== "linux") {
            core.setFailed("❌ This action currently supports only Linux runners.");
            return;
        }

        // Parse inputs
        const iface = core.getInput("iface") || "wg0";
        const domains = parseInputList(core.getInput("domains") || "");
        const ips = parseInputList(core.getInput("ips") || "");

        core.info(`Interface: ${iface}`);
        core.info(`Domains: ${domains.length > 0 ? domains.join(", ") : "none"}`);
        core.info(`IPs: ${ips.length > 0 ? ips.join(", ") : "none"}`);
        core.info("=".repeat(50));
        core.info("");

        // Determine mode based on interface existence
        core.info("🔍 Checking if WireGuard interface exists...");
        const interfaceExists = await checkInterfaceExists(iface);

        if (interfaceExists) {
            await handleAddRouteMode(domains, ips, iface);
        } else {
            const config = core.getInput("config", {required: true});
            await handleSetupMode(config, domains, ips, iface);
        }
        
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        core.info("");
        core.info("=".repeat(50));
        core.info(`✅ WireGuard action completed successfully in ${duration}s`);
        core.info("=".repeat(50));
    } catch (err: any) {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        core.error("");
        core.error("=".repeat(50));
        core.error(`❌ WireGuard action failed after ${duration}s`);
        core.error(`Error: ${err?.message || err}`);
        if (err?.stack) {
            core.debug(`Stack trace: ${err.stack}`);
        }
        core.error("=".repeat(50));
        core.setFailed(`WireGuard action failed: ${err?.message || err}`);
    }
}

run().then();
