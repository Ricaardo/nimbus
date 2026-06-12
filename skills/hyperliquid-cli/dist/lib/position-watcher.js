import { WebSocketTransport, SubscriptionClient } from "@nktkas/hyperliquid";
import WebSocket from "ws";
/**
 * Creates a position watcher that subscribes to clearinghouseState updates via WebSocket
 */
export function createPositionWatcher(config) {
    let wsTransport = null;
    let subscriptionClient = null;
    let subscription = null;
    return {
        async start() {
            wsTransport = new WebSocketTransport({
                isTestnet: config.isTestnet,
                reconnect: { WebSocket: WebSocket },
            });
            subscriptionClient = new SubscriptionClient({ transport: wsTransport });
            await wsTransport.ready();
            subscription = await subscriptionClient.allDexsClearinghouseState({ user: config.user }, (state) => {
                config.onUpdate(state);
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
            subscriptionClient = null;
        },
    };
}
