import { WebSocketTransport, SubscriptionClient, HttpTransport, InfoClient } from "@nktkas/hyperliquid";
import WebSocket from "ws";
/**
 * Creates a portfolio watcher that subscribes to perp state updates
 * and polls spot balances on each update
 */
export function createPortfolioWatcher(config) {
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
                const accountValue = clearinghouseState?.marginSummary.accountValue || "0";
                const totalMarginUsed = clearinghouseState?.marginSummary.totalMarginUsed || "0";
                const positions = state.clearinghouseStates
                    .flatMap((c) => c[1].assetPositions)
                    .filter((p) => parseFloat(p.position.szi) !== 0)
                    .map((p) => ({
                    coin: p.position.coin,
                    size: p.position.szi,
                    entryPx: p.position.entryPx,
                    positionValue: p.position.positionValue,
                    unrealizedPnl: p.position.unrealizedPnl,
                    leverage: `${p.position.leverage.value}x ${p.position.leverage.type}`,
                }));
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
                        }));
                    }
                    catch {
                        // Keep previous spot balances on error
                    }
                }
                config.onUpdate({
                    positions,
                    spotBalances: currentSpotBalances,
                    accountValue,
                    totalMarginUsed,
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
