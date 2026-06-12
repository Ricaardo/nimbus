import { HttpTransport, InfoClient, ExchangeClient, } from "@nktkas/hyperliquid";
import { privateKeyToAccount } from "viem/accounts";
import { tryConnectToServer } from "../client/index.js";
export function createContext(config) {
    let publicClient = null;
    let walletClient = null;
    let serverClient = undefined; // undefined = not checked yet
    const transport = new HttpTransport({
        isTestnet: config.testnet,
    });
    return {
        config,
        getPublicClient() {
            if (!publicClient) {
                publicClient = new InfoClient({ transport });
            }
            return publicClient;
        },
        getWalletClient() {
            if (!walletClient) {
                if (!config.privateKey) {
                    if (config.account?.type === "readonly") {
                        throw new Error(`Account "${config.account.alias}" is read-only and cannot perform trading operations.\n` +
                            "Run 'hl account add' to set up an API wallet for trading.");
                    }
                    throw new Error("No account configured. Run 'hl account add' to set up your account.");
                }
                const account = privateKeyToAccount(config.privateKey);
                walletClient = new ExchangeClient({ transport, wallet: account });
            }
            return walletClient;
        },
        getWalletAddress() {
            if (config.walletAddress) {
                return config.walletAddress;
            }
            if (config.privateKey) {
                const account = privateKeyToAccount(config.privateKey);
                return account.address;
            }
            throw new Error("No account configured. Run 'hl account add' to set up your account.");
        },
        async getServerClient() {
            // Return cached result if already checked
            if (serverClient !== undefined) {
                return serverClient;
            }
            // Try to connect to server
            serverClient = await tryConnectToServer();
            return serverClient;
        },
        hasAccount() {
            return !!(config.walletAddress || config.privateKey);
        },
        requiresAccountSetup() {
            return !config.walletAddress && !config.privateKey;
        },
    };
}
