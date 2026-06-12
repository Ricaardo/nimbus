import type { Address } from "viem";
export interface OrderData {
    oid: number;
    coin: string;
    side: string;
    sz: string;
    limitPx: string;
    timestamp: number;
}
export interface OrdersWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface OrdersWatcherConfig {
    user: Address;
    isTestnet: boolean;
    onUpdate: (orders: OrderData[]) => void;
    onError: (error: Error) => void;
}
/**
 * Creates an orders watcher that subscribes to orderUpdates
 * and polls open orders on each update
 */
export declare function createOrdersWatcher(config: OrdersWatcherConfig): OrdersWatcher;
