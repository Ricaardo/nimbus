import type { Hex, Address } from "viem";
export interface Config {
    privateKey?: Hex;
    walletAddress?: Address;
    testnet: boolean;
    account?: {
        alias: string;
        type: "readonly" | "api_wallet";
    };
}
export declare function loadConfig(testnet: boolean): Config;
