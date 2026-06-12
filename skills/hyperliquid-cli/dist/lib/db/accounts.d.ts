import type { Address, Hex } from "viem";
/**
 * Account types
 */
export type AccountType = "readonly" | "api_wallet";
export type AccountSource = "cli_import";
/**
 * Account interface
 */
export interface Account {
    id: number;
    alias: string;
    userAddress: Address;
    type: AccountType;
    source: AccountSource;
    apiWalletPrivateKey: Hex | null;
    apiWalletPublicKey: Address | null;
    isDefault: boolean;
    createdAt: number;
    updatedAt: number;
}
/**
 * Input for creating an account
 */
export interface CreateAccountInput {
    alias: string;
    userAddress: Address;
    type: AccountType;
    source?: AccountSource;
    apiWalletPrivateKey?: Hex;
    apiWalletPublicKey?: Address;
    setAsDefault?: boolean;
}
/**
 * Create a new account
 */
export declare function createAccount(input: CreateAccountInput): Account;
/**
 * Get an account by ID
 */
export declare function getAccountById(id: number): Account | null;
/**
 * Get an account by alias
 */
export declare function getAccountByAlias(alias: string): Account | null;
/**
 * Get the default account
 */
export declare function getDefaultAccount(): Account | null;
/**
 * Get all accounts
 */
export declare function getAllAccounts(): Account[];
/**
 * Set an account as default by alias
 */
export declare function setDefaultAccount(alias: string): Account;
/**
 * Delete an account by alias
 */
export declare function deleteAccount(alias: string): boolean;
/**
 * Check if an alias is already taken
 */
export declare function isAliasTaken(alias: string): boolean;
/**
 * Update an account's API wallet credentials
 */
export declare function updateAccountApiWallet(alias: string, apiWalletPrivateKey: Hex, apiWalletPublicKey: Address): Account;
/**
 * Get account count
 */
export declare function getAccountCount(): number;
