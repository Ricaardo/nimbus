import type { Address, Hex } from "viem";
/**
 * Result of validating an API key
 */
export type ValidateApiKeyResult = {
    valid: true;
    masterAddress: Address;
    apiWalletAddress: Address;
} | {
    valid: false;
    error: string;
};
/**
 * Validate an API private key by checking if it's registered as an agent wallet
 * Returns the master address if valid, or an error message if not
 */
export declare function validateApiKey(apiPrivateKey: Hex, isTestnet?: boolean): Promise<ValidateApiKeyResult>;
/**
 * API wallet credentials
 */
export interface ApiWalletCredentials {
    privateKey: Hex;
    publicKey: Address;
}
/**
 * Generate a new API wallet (random private key)
 */
export declare function generateApiWallet(): ApiWalletCredentials;
/**
 * User role response types from Hyperliquid API
 */
export type UserRoleResponse = {
    role: "missing" | "user" | "vault";
} | {
    role: "agent";
    data: {
        user: Address;
    };
} | {
    role: "subAccount";
    data: {
        master: Address;
    };
};
/**
 * Check if an API wallet is approved as an agent for a user
 */
export declare function checkApiWalletApproval(apiWalletAddress: Address, userAddress: Address, isTestnet?: boolean): Promise<{
    approved: boolean;
    masterAddress?: Address;
}>;
/**
 * Get the Hyperliquid API approval URL
 */
export declare function getApprovalUrl(isTestnet?: boolean): string;
/**
 * Poll for API wallet approval with timeout
 * Returns true if approved, false if timed out
 */
export declare function waitForApproval(apiWalletAddress: Address, userAddress: Address, isTestnet?: boolean, pollIntervalMs?: number, maxAttempts?: number): Promise<boolean>;
/**
 * Get all extra agents (API wallets) for a user address
 */
export interface ExtraAgent {
    address: Address;
    name: string;
    validUntil: number;
}
export declare function getExtraAgents(userAddress: Address, isTestnet?: boolean): Promise<ExtraAgent[]>;
