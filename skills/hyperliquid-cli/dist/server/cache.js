// In-memory cache for real-time data from WebSocket subscriptions
export class ServerCache {
    allMids = null;
    allDexsAssetCtxs = null;
    allPerpMetas = null;
    spotMeta = null;
    spotAssetCtxs = null;
    // Update methods - called from subscription handlers
    setAllMids(data) {
        this.allMids = { data, updatedAt: Date.now() };
    }
    setAllDexsAssetCtxs(data) {
        this.allDexsAssetCtxs = { data, updatedAt: Date.now() };
    }
    setAllPerpMetas(data) {
        this.allPerpMetas = { data, updatedAt: Date.now() };
    }
    setSpotMeta(data) {
        this.spotMeta = { data, updatedAt: Date.now() };
    }
    setSpotAssetCtxs(data) {
        this.spotAssetCtxs = { data, updatedAt: Date.now() };
    }
    // Get methods - return data with cache timestamp
    getAllMids() {
        return this.allMids;
    }
    getAllDexsAssetCtxs() {
        return this.allDexsAssetCtxs;
    }
    getAllPerpMetas() {
        return this.allPerpMetas;
    }
    getSpotMeta() {
        return this.spotMeta;
    }
    getSpotAssetCtxs() {
        return this.spotAssetCtxs;
    }
    // Get status info
    getStatus() {
        const now = Date.now();
        return {
            hasMids: this.allMids !== null,
            hasAssetCtxs: this.allDexsAssetCtxs !== null,
            hasPerpMetas: this.allPerpMetas !== null,
            hasSpotMeta: this.spotMeta !== null,
            hasSpotAssetCtxs: this.spotAssetCtxs !== null,
            midsAge: this.allMids ? now - this.allMids.updatedAt : undefined,
            assetCtxsAge: this.allDexsAssetCtxs ? now - this.allDexsAssetCtxs.updatedAt : undefined,
            perpMetasAge: this.allPerpMetas ? now - this.allPerpMetas.updatedAt : undefined,
            spotMetaAge: this.spotMeta ? now - this.spotMeta.updatedAt : undefined,
            spotAssetCtxsAge: this.spotAssetCtxs ? now - this.spotAssetCtxs.updatedAt : undefined,
        };
    }
}
