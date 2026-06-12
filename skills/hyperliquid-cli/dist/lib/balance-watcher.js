import { WebSocketTransport, SubscriptionClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import WebSocket from "ws";
/**
 * Creates a balance watcher that subscribes to clearinghouse state updates
 * and polls spot balances on each update
 */
export function createBalanceWatcher(config) {
    let wsTransport = null;
    let subscriptionClient = null;
    let perpSubscription = null;
    let httpClient = null;
    return {
        async start() {
            // Create HTTP client for spot balance polling
            const httpTransport = new HttpTransport({ isTestnet: config.isTestnet });
            httpClient = new InfoClient({ transport: httpTransport });
            // Fetch initial spot state
            const spotState = await httpClient.spotClearinghouseState({ user: config.user });
            let currentSpotBalances = spotState.balances
                .filter((b) => parseFloat(b.total) !== 0)
                .map((b) => ({
                token: b.coin,
                total: b.total,
                hold: b.hold,
                available: (parseFloat(b.total) - parseFloat(b.hold)).toString(),
            }));
            wsTransport = new WebSocketTransport({
                isTestnet: config.isTestnet,
                reconnect: { WebSocket: WebSocket },
            });
            subscriptionClient = new SubscriptionClient({ transport: wsTransport });
            await wsTransport.ready();
            // Subscribe to perp clearinghouse state
            perpSubscription = await subscriptionClient.allDexsClearinghouseState({ user: config.user }, async (state) => {
                const clearinghouseState = state.clearinghouseStates[0]?.[1];
                const perpBalance = clearinghouseState?.marginSummary.accountValue || "0";
                // Refresh spot balances on each perp update
                if (httpClient) {
                    try {
                        const freshSpotState = await httpClient.spotClearinghouseState({ user: config.user });
                        currentSpotBalances = freshSpotState.balances
                            .filter((b) => parseFloat(b.total) !== 0)
                            .map((b) => ({
                            token: b.coin,
                            total: b.total,
                            hold: b.hold,
                            available: (parseFloat(b.total) - parseFloat(b.hold)).toString(),
                        }));
                    }
                    catch {
                        // Keep previous spot balances on error
                    }
                }
                config.onUpdate({
                    spotBalances: currentSpotBalances,
                    perpBalance,
                });
            });
        },
        async stop() {
            if (perpSubscription) {
                try {
                    await perpSubscription.unsubscribe();
                }
                catch {
                    // Ignore errors during unsubscribe
                }
                perpSubscription = null;
            }
            if (wsTransport) {
                try {
                    await wsTransport.close();
                }
                catch {
                    // Ignore errors during close
                }
                wsTransport = null;
            }
            subscriptionClient = null;
            httpClient = null;
        },
    };
}
