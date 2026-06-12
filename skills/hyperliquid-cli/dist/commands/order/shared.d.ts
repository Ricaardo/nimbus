export type Side = "buy" | "sell";
export declare function validateSideWithAliases(value: string): Side;
export declare function getAssetIndex(publicClient: {
    allPerpMetas: () => Promise<Array<{
        universe: Array<{
            name: string;
        }>;
    }>>;
    spotMeta: () => Promise<{
        universe: Array<{
            name: string;
        }>;
    }>;
}, coin: string): Promise<number>;
