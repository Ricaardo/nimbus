import type { ServerCache } from "./cache.js";
import type { SubscriptionManager } from "./subscriptions.js";
export declare class IPCServer {
    private server;
    private cache;
    private subscriptions;
    private isTestnet;
    private startedAt;
    private log;
    private onShutdown;
    constructor(cache: ServerCache, subscriptions: SubscriptionManager, isTestnet: boolean, startedAt: number, log: (msg: string) => void, onShutdown: () => void);
    start(): Promise<void>;
    private handleConnection;
    private handleMessage;
    private handleRequest;
    private sendResponse;
    stop(): Promise<void>;
}
