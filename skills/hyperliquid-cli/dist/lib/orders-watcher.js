import { WebSocketTransport, SubscriptionClient, HttpTransport, InfoClient, } from "@nktkas/hyperliquid";
import WebSocket from "ws";
/**
 * Creates an orders watcher that subscribes to orderUpdates
 * and polls open orders on each update
 */
export function createOrdersWatcher(config) {
    let wsTransport = null;
    let subscriptionClient = null;
    let subscription = null;
    let httpClient = null;
    const fetchOrders = async () => {
        if (!httpClient)
            return [];
        const orders = await httpClient.openOrders({ user: config.user, dex: "ALL_DEXS" });
        return orders.map((o) => ({
            oid: o.oid,
            coin: o.coin,
            side: o.side,
            sz: o.sz,
            limitPx: o.limitPx,
            timestamp: o.timestamp,
        }));
    };
    return {
        async start() {
            // Create HTTP client for polling open orders
            const httpTransport = new HttpTransport({ isTestnet: config.isTestnet });
            httpClient = new InfoClient({ transport: httpTransport });
            // Fetch initial orders
            const initialOrders = await fetchOrders();
            config.onUpdate(initialOrders);
            wsTransport = new WebSocketTransport({
                isTestnet: config.isTestnet,
                reconnect: { WebSocket: WebSocket },
            });
            subscriptionClient = new SubscriptionClient({ transport: wsTransport });
            await wsTransport.ready();
            // Subscribe to order updates
            subscription = await subscriptionClient.orderUpdates({ user: config.user }, async () => {
                // Re-fetch orders on any update
                try {
                    const orders = await fetchOrders();
                    config.onUpdate(orders);
                }
                catch (err) {
                    config.onError(err instanceof Error ? err : new Error(String(err)));
                }
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
            httpClient = null;
        },
    };
}
