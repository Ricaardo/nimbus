export interface PriceWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface PriceWatcherConfig {
    coin: string;
    isTestnet: boolean;
    onUpdate: (price: string) => void;
    onError: (error: Error) => void;
}
/**
 * Creates a price watcher that uses server cache polling if available,
 * otherwise falls back to direct WebSocket subscription
 */
export declare function createPriceWatcher(config: PriceWatcherConfig): PriceWatcher;
