import type { Address } from "viem";
import { AllDexsClearinghouseStateEvent } from "@nktkas/hyperliquid/api/subscription";
export interface PositionWatcher {
    start(): Promise<void>;
    stop(): Promise<void>;
}
export interface PositionWatcherConfig {
    user: Address;
    isTestnet: boolean;
    onUpdate: (state: AllDexsClearinghouseStateEvent) => void;
    onError: (error: Error) => void;
}
/**
 * Creates a position watcher that subscribes to clearinghouseState updates via WebSocket
 */
export declare function createPositionWatcher(config: PositionWatcherConfig): PositionWatcher;
