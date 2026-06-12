import type { ServerCache } from "./cache.js";
export declare class SubscriptionManager {
    private wsTransport;
    private subscriptionClient;
    private infoClient;
    private cache;
    private subscriptions;
    private perpMetaInterval;
    private spotMetaInterval;
    private isTestnet;
    private log;
    constructor(cache: ServerCache, isTestnet: boolean, log: (msg: string) => void);
    start(): Promise<void>;
    private fetchPerpMetas;
    private fetchSpotMeta;
    stop(): Promise<void>;
    isConnected(): boolean;
}
