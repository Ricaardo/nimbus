import { InfoClient, ExchangeClient } from "@nktkas/hyperliquid";
import type { Config } from "../lib/config.js";
import type { Address } from "viem";
import { ServerClient } from "../client/index.js";
export interface CLIContext {
    config: Config;
    getPublicClient(): InfoClient;
    getWalletClient(): ExchangeClient;
    getWalletAddress(): Address;
    getServerClient(): Promise<ServerClient | null>;
    hasAccount(): boolean;
    requiresAccountSetup(): boolean;
}
export declare function createContext(config: Config): CLIContext;
