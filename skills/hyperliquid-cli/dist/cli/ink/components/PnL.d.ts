import React from "react";
export interface PnLProps {
    value: number | string;
    showSign?: boolean;
    decimals?: number;
}
export declare function PnL({ value, showSign, decimals }: PnLProps): React.ReactElement;
export interface PnLPercentProps {
    value: number | string;
    decimals?: number;
}
export declare function PnLPercent({ value, decimals }: PnLPercentProps): React.ReactElement;
