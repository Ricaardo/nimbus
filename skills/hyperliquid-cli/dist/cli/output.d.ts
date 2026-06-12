export interface OutputOptions {
    json: boolean;
}
export declare function output(data: unknown, options: OutputOptions): void;
export declare function outputError(message: string): void;
export declare function outputSuccess(message: string): void;
/**
 * Format an array of objects as a table string (for watch mode display)
 * Returns the formatted string instead of printing to console
 */
export declare function formatArrayAsTable(arr: unknown[]): string;
