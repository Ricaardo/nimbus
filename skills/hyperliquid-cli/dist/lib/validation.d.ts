import type { Address, Hex } from "viem";
export declare function validateAddress(value: string): Address;
export declare function validatePrivateKey(value: string): Hex;
export declare function validatePositiveNumber(value: string, name: string): number;
export declare function validatePositiveInteger(value: string, name: string): number;
export declare function validateSide(value: string): "buy" | "sell";
export declare function validateTif(value: string): "Gtc" | "Ioc" | "Alo";
