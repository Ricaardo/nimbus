import type { Address } from "viem";
export interface PortfolioData {
    positions: Array<{
        coin: string;
        size: string;
        entryPx: string;
        positionValue: string;
        unrealizedPnl: string;
        leverage: string;
    }>;
    spotBalances: Array<{
        token: string;
        total: string;
        hold: string;
    }>;
    accountValue: string;
    totalMarginUsed: string;
}
export interface PortfolioWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface PortfolioWatcherConfig {
    user: Address;
    isTestnet: boolean;
    onUpdate: (data: PortfolioData) => void;
    onError: (error: Error) => void;
}
/**
 * Creates a portfolio watcher that subscribes to perp state updates
 * and polls spot balances on each update
 */
export declare function createPortfolioWatcher(config: PortfolioWatcherConfig): PortfolioWatcher;
