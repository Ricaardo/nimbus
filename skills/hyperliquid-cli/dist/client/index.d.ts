import { AllPerpMetasResponse, SpotMetaResponse } from "@nktkas/hyperliquid";
import { AllDexsAssetCtxsEvent, SpotAssetCtxsEvent } from "@nktkas/hyperliquid/api/subscription";
export interface ServerStatus {
    running: boolean;
    testnet: boolean;
    connected: boolean;
    startedAt: number;
    uptime: number;
    cache: {
        hasMids: boolean;
        hasAssetCtxs: boolean;
        hasPerpMetas: boolean;
        hasSpotMeta: boolean;
        hasSpotAssetCtxs: boolean;
        midsAge?: number;
        assetCtxsAge?: number;
        perpMetasAge?: number;
        spotMetaAge?: number;
        spotAssetCtxsAge?: number;
    };
}
export declare class ServerClient {
    private socket;
    private requestId;
    private pending;
    private buffer;
    connect(): Promise<void>;
    private handleData;
    private request;
    getPrices(coin?: string): Promise<{
        data: Record<string, string>;
        cached_at: number;
    }>;
    getAssetCtxs(): Promise<{
        data: AllDexsAssetCtxsEvent;
        cached_at: number;
    }>;
    getPerpMeta(): Promise<{
        data: AllPerpMetasResponse;
        cached_at: number;
    }>;
    getSpotMeta(): Promise<{
        data: SpotMetaResponse;
        cached_at: number;
    }>;
    getSpotAssetCtxs(): Promise<{
        data: SpotAssetCtxsEvent;
        cached_at: number;
    }>;
    getStatus(): Promise<ServerStatus>;
    shutdown(): Promise<void>;
    close(): void;
}
export declare function isServerRunning(): boolean;
export declare function tryConnectToServer(): Promise<ServerClient | null>;
