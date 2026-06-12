/**
 * Color theme for CLI output
 */
export declare const colors: {
    readonly profit: "green";
    readonly loss: "red";
    readonly neutral: "white";
    readonly muted: "gray";
    readonly header: "cyan";
    readonly warning: "yellow";
    readonly info: "blue";
};
export type ThemeColor = (typeof colors)[keyof typeof colors];
/**
 * Get the appropriate color for a PnL value
 */
export declare function getPnLColor(value: number): ThemeColor;
/**
 * Get the appropriate color for a percentage change
 */
export declare function getChangeColor(value: number): ThemeColor;
/**
 * Theme configuration for @inquirer/prompts
 * Provides consistent styling with the CLI color scheme
 */
export declare const inquirerTheme: {
    prefix: {
        idle: string;
        done: string;
    };
    style: {
        answer: (text: string) => string;
        message: (text: string) => string;
        error: (text: string) => string;
        highlight: (text: string) => string;
        description: (text: string) => string;
        help: (text: string) => string;
    };
};
