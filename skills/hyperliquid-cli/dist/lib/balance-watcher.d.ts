import type { Address } from "viem";
export interface BalanceData {
    spotBalances: Array<{
        token: string;
        total: string;
        hold: string;
        available: string;
    }>;
    perpBalance: string;
}
export interface BalanceWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface BalanceWatcherConfig {
    user: Address;
    isTestnet: boolean;
    onUpdate: (data: BalanceData) => void;
    onError: (error: Error) => void;
}
/**
 * Creates a balance watcher that subscribes to clearinghouse state updates
 * and polls spot balances on each update
 */
export declare function createBalanceWatcher(config: BalanceWatcherConfig): BalanceWatcher;
