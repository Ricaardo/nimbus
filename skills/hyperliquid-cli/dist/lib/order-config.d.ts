export interface OrderConfig {
    slippage: number;
}
export declare function getOrderConfig(): OrderConfig;
export declare function updateOrderConfig(updates: Partial<OrderConfig>): OrderConfig;
