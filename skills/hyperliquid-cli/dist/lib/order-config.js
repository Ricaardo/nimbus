import { homedir } from "os";
import { join } from "path";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
const DEFAULT_CONFIG = {
    slippage: 1.0,
};
function getConfigPath() {
    return join(homedir(), ".hl", "order-config.json");
}
export function getOrderConfig() {
    const configPath = getConfigPath();
    try {
        if (!existsSync(configPath)) {
            return { ...DEFAULT_CONFIG };
        }
        const content = readFileSync(configPath, "utf-8");
        const parsed = JSON.parse(content);
        return {
            ...DEFAULT_CONFIG,
            ...parsed,
        };
    }
    catch {
        return { ...DEFAULT_CONFIG };
    }
}
export function updateOrderConfig(updates) {
    const configPath = getConfigPath();
    const configDir = join(homedir(), ".hl");
    // Ensure directory exists
    if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
    }
    const current = getOrderConfig();
    const updated = {
        ...current,
        ...updates,
    };
    writeFileSync(configPath, JSON.stringify(updated, null, 2));
    return updated;
}
