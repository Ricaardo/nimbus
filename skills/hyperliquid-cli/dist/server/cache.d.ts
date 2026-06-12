import { AllPerpMetasResponse, SpotMetaResponse } from "@nktkas/hyperliquid";
import { AllDexsAssetCtxsEvent, SpotAssetCtxsEvent } from "@nktkas/hyperliquid/api/subscription";
export interface CacheEntry<T> {
    data: T;
    updatedAt: number;
}
export interface AllMidsData {
    [coin: string]: string;
}
export declare class ServerCache {
    private allMids;
    private allDexsAssetCtxs;
    private allPerpMetas;
    private spotMeta;
    private spotAssetCtxs;
    setAllMids(data: AllMidsData): void;
    setAllDexsAssetCtxs(data: AllDexsAssetCtxsEvent): void;
    setAllPerpMetas(data: AllPerpMetasResponse): void;
    setSpotMeta(data: SpotMetaResponse): void;
    setSpotAssetCtxs(data: SpotAssetCtxsEvent): void;
    getAllMids(): CacheEntry<AllMidsData> | null;
    getAllDexsAssetCtxs(): CacheEntry<AllDexsAssetCtxsEvent> | null;
    getAllPerpMetas(): CacheEntry<AllPerpMetasResponse> | null;
    getSpotMeta(): CacheEntry<SpotMetaResponse> | null;
    getSpotAssetCtxs(): CacheEntry<SpotAssetCtxsEvent> | null;
    getStatus(): {
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
