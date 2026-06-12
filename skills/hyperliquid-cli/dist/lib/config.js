import { privateKeyToAccount } from "viem/accounts";
import { getDefaultAccount } from "./db/index.js";
export function loadConfig(testnet) {
    // First, try to load from default account in database
    let defaultAccount = null;
    try {
        defaultAccount = getDefaultAccount();
    }
    catch {
        // Database may not exist yet or other error - that's fine, fall back to env vars
    }
    if (defaultAccount) {
        return {
            privateKey: defaultAccount.apiWalletPrivateKey || undefined,
            walletAddress: defaultAccount.userAddress,
            testnet,
            account: {
                alias: defaultAccount.alias,
                type: defaultAccount.type,
            },
        };
    }
    // Fall back to environment variables
    const privateKey = process.env.HYPERLIQUID_PRIVATE_KEY;
    let walletAddress = process.env.HYPERLIQUID_WALLET_ADDRESS;
    if (privateKey && !walletAddress) {
        const account = privateKeyToAccount(privateKey);
        walletAddress = account.address;
    }
    return {
        privateKey,
        walletAddress,
        testnet,
    };
}
