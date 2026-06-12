import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { HttpTransport, InfoClient } from "@nktkas/hyperliquid";
/**
 * Validate an API private key by checking if it's registered as an agent wallet
 * Returns the master address if valid, or an error message if not
 */
export async function validateApiKey(apiPrivateKey, isTestnet = false) {
    const account = privateKeyToAccount(apiPrivateKey);
    const apiWalletAddress = account.address;
    const transport = new HttpTransport({ isTestnet });
    const client = new InfoClient({ transport });
    try {
        const response = (await client.userRole({ user: apiWalletAddress }));
        if (response.role === "agent") {
            return {
                valid: true,
                masterAddress: response.data.user,
                apiWalletAddress,
            };
        }
        if (response.role === "missing") {
            return { valid: false, error: "This key is not registered as an API wallet on Hyperliquid" };
        }
        return { valid: false, error: `Invalid role: ${response.role}. Expected an agent wallet.` };
    }
    catch (err) {
        return { valid: false, error: `Failed to validate API key: ${err instanceof Error ? err.message : String(err)}` };
    }
}
/**
 * Generate a new API wallet (random private key)
 */
export function generateApiWallet() {
    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    return {
        privateKey,
        publicKey: account.address,
    };
}
/**
 * Check if an API wallet is approved as an agent for a user
 */
export async function checkApiWalletApproval(apiWalletAddress, userAddress, isTestnet = false) {
    const transport = new HttpTransport({ isTestnet });
    const client = new InfoClient({ transport });
    try {
        const response = await client.userRole({ user: apiWalletAddress });
        if (response.role === "agent") {
            // Check if the agent is approved for the specified user
            const isApprovedForUser = response.data.user.toLowerCase() === userAddress.toLowerCase();
            return {
                approved: isApprovedForUser,
                masterAddress: response.data.user,
            };
        }
        return { approved: false };
    }
    catch {
        return { approved: false };
    }
}
/**
 * Get the Hyperliquid API approval URL
 */
export function getApprovalUrl(isTestnet = false) {
    return isTestnet
        ? "https://app.hyperliquid-testnet.xyz/API"
        : "https://app.hyperliquid.xyz/API";
}
/**
 * Poll for API wallet approval with timeout
 * Returns true if approved, false if timed out
 */
export async function waitForApproval(apiWalletAddress, userAddress, isTestnet = false, pollIntervalMs = 3000, maxAttempts = 100 // About 5 minutes with 3s interval
) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await checkApiWalletApproval(apiWalletAddress, userAddress, isTestnet);
        if (result.approved) {
            return true;
        }
        // Wait before next poll
        await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return false;
}
export async function getExtraAgents(userAddress, isTestnet = false) {
    const transport = new HttpTransport({ isTestnet });
    const client = new InfoClient({ transport });
    try {
        const response = await client.extraAgents({ user: userAddress });
        return response.map((agent) => ({
            address: agent.address,
            name: agent.name,
            validUntil: agent.validUntil,
        }));
    }
    catch {
        return [];
    }
}
