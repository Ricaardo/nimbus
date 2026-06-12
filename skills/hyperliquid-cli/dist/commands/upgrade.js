import { createRequire } from "module";
import { getOutputOptions } from "../cli/program.js";
import { output, outputSuccess } from "../cli/output.js";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
async function fetchLatestVersion() {
    const response = await fetch("https://registry.npmjs.org/hyperliquid-cli");
    if (!response.ok) {
        throw new Error(`Failed to fetch package info: ${response.statusText}`);
    }
    const data = (await response.json());
    return data["dist-tags"].latest;
}
function compareVersions(current, latest) {
    const currentParts = current.split(".").map(Number);
    const latestParts = latest.split(".").map(Number);
    for (let i = 0; i < Math.max(currentParts.length, latestParts.length); i++) {
        const currentPart = currentParts[i] ?? 0;
        const latestPart = latestParts[i] ?? 0;
        if (latestPart > currentPart)
            return true;
        if (latestPart < currentPart)
            return false;
    }
    return false;
}
export function registerUpgradeCommand(program) {
    program
        .command("upgrade")
        .description("Check for updates and show upgrade instructions")
        .action(async function () {
        const outputOpts = getOutputOptions(this);
        const current = pkg.version;
        let latest;
        try {
            latest = await fetchLatestVersion();
        }
        catch (err) {
            if (outputOpts.json) {
                output({ error: err instanceof Error ? err.message : String(err) }, outputOpts);
            }
            else {
                console.error("Failed to check for updates:", err instanceof Error ? err.message : String(err));
            }
            process.exit(1);
        }
        const updateAvailable = compareVersions(current, latest);
        const result = {
            current,
            latest,
            updateAvailable,
        };
        if (outputOpts.json) {
            output(result, outputOpts);
        }
        else {
            console.log(`Current version: ${current}`);
            console.log(`Latest version:  ${latest}`);
            if (updateAvailable) {
                console.log(``);
                outputSuccess("Update available!");
                console.log(``);
                console.log(`To upgrade, run:`);
                console.log(`  npm install -g hyperliquid-cli@latest`);
            }
            else {
                console.log(``);
                outputSuccess("You are running the latest version.");
            }
        }
    });
}
