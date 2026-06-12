import { WebSocketTransport, SubscriptionClient } from "@nktkas/hyperliquid";
import WebSocket from "ws";
/**
 * Creates a book watcher that subscribes to L2 order book updates via WebSocket
 */
export function createBookWatcher(config) {
    let wsTransport = null;
    let subscription = null;
    return {
        async start() {
            wsTransport = new WebSocketTransport({
                isTestnet: config.isTestnet,
                reconnect: { WebSocket: WebSocket },
            });
            const subscriptionClient = new SubscriptionClient({ transport: wsTransport });
            await wsTransport.ready();
            subscription = await subscriptionClient.l2Book({ coin: config.coin }, (event) => {
                const levels = event.levels;
                config.onUpdate({
                    coin: config.coin,
                    bids: levels[0] || [],
                    asks: levels[1] || [],
                    time: event.time,
                });
            });
        },
        async stop() {
            if (subscription) {
                try {
                    await subscription.unsubscribe();
                }
                catch {
                    // Ignore errors during unsubscribe
                }
                subscription = null;
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
        },
    };
}
