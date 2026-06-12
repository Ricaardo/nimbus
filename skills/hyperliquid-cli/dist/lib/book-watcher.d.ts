export interface BookLevel {
    px: string;
    sz: string;
    n: number;
}
export interface BookData {
    coin: string;
    bids: BookLevel[];
    asks: BookLevel[];
    time: number;
}
export interface BookWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface BookWatcherConfig {
    coin: string;
    isTestnet: boolean;
    onUpdate: (data: BookData) => void;
    onError: (error: Error) => void;
}
/**
 * Creates a book watcher that subscribes to L2 order book updates via WebSocket
 */
export declare function createBookWatcher(config: BookWatcherConfig): BookWatcher;
