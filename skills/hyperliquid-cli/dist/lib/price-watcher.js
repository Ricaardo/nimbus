import { tryConnectToServer } from "../client/index.js";
import { WebSocketTransport, SubscriptionClient } from "@nktkas/hyperliquid";
import WebSocket from "ws";
/**
 * Creates a price watcher that uses server cache polling if available,
 * otherwise falls back to direct WebSocket subscription
 */
export function createPriceWatcher(config) {
    let serverClient = null;
    let pollInterval = null;
    let wsTransport = null;
    let subscription = null;
    let stopped = false;
    const pollServerPrice = async () => {
        if (stopped || !serverClient)
            return;
        try {
            const { data } = await serverClient.getPrices();
            const price = data[config.coin];
            if (price !== undefined) {
                config.onUpdate(price);
            }
        }
        catch (err) {
            config.onError(err instanceof Error ? err : new Error(String(err)));
        }
    };
    return {
        async start() {
            stopped = false;
            // Try to use server cache first
            serverClient = await tryConnectToServer();
            if (serverClient) {
                // Poll server every 500ms for price updates
                await pollServerPrice();
                pollInterval = setInterval(pollServerPrice, 500);
            }
            else {
                // No server, use direct WebSocket subscription
                wsTransport = new WebSocketTransport({
                    isTestnet: config.isTestnet,
                    reconnect: { WebSocket: WebSocket },
                });
                const subscriptionClient = new SubscriptionClient({ transport: wsTransport });
                await wsTransport.ready();
                subscription = await subscriptionClient.allMids({ dex: "ALL_DEXS" }, (event) => {
                    const price = event.mids[config.coin];
                    if (price !== undefined) {
                        config.onUpdate(price);
                    }
                });
            }
        },
        async stop() {
            stopped = true;
            if (pollInterval) {
                clearInterval(pollInterval);
                pollInterval = null;
            }
            if (serverClient) {
                serverClient.close();
                serverClient = null;
            }
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
