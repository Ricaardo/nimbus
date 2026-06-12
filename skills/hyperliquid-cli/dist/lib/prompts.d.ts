/**
 * Prompt for text input
 */
export declare function prompt(question: string): Promise<string>;
/**
 * Prompt for selection from a list of options with arrow key navigation
 */
export declare function select<T extends string>(question: string, options: {
    value: T;
    label: string;
    description?: string;
}[]): Promise<T>;
/**
 * Prompt for multiple selections with checkboxes
 */
export declare function multiSelect<T extends string>(question: string, options: {
    value: T;
    label: string;
    description?: string;
}[]): Promise<T[]>;
/**
 * Prompt for yes/no confirmation
 */
export declare function confirm(question: string, defaultValue?: boolean): Promise<boolean>;
/**
 * Wait for user to press Enter
 */
export declare function waitForEnter(message?: string): Promise<void>;
/**
 * Wait for user to press Enter (returns true) or Escape (returns false)
 */
export declare function pressEnterOrEsc(message: string): Promise<boolean>;
