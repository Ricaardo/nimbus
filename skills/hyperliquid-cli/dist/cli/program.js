import { Command } from "commander";
import { createRequire } from "module";
import { loadConfig } from "../lib/config.js";
import { createContext } from "./context.js";
import { registerCommands } from "../commands/index.js";
const require = createRequire(import.meta.url);
const pkg = require("../../package.json");
export function createProgram() {
    const program = new Command();
    program
        .name("hl")
        .description("CLI for Hyperliquid DEX")
        .version(pkg.version)
        .option("--json", "Output in JSON format", false)
        .option("--testnet", "Use testnet instead of mainnet", false)
        .hook("preAction", async (thisCommand) => {
        const opts = thisCommand.opts();
        const config = loadConfig(opts.testnet);
        const context = createContext(config);
        // Store context on the command for subcommands to access
        thisCommand.setOptionValue("_context", context);
        thisCommand.setOptionValue("_outputOptions", { json: opts.json });
        // Store start time for timing
        thisCommand.setOptionValue("_startTime", performance.now());
    })
        .hook("postAction", (thisCommand) => {
        const opts = thisCommand.opts();
        const startTime = thisCommand.opts()._startTime;
        // Only show timing for non-JSON output
        if (!opts.json && startTime !== undefined) {
            const duration = (performance.now() - startTime) / 1000;
            console.log(`\nCompleted in ${duration.toFixed(2)}s`);
        }
    });
    registerCommands(program);
    return program;
}
export function getContext(command) {
    let current = command;
    while (current) {
        const ctx = current.opts()._context;
        if (ctx)
            return ctx;
        current = current.parent;
    }
    throw new Error("Context not found");
}
export function getOutputOptions(command) {
    let current = command;
    while (current) {
        const opts = current.opts()._outputOptions;
        if (opts)
            return opts;
        current = current.parent;
    }
    return { json: false };
}
