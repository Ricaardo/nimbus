/**
 * Color theme for CLI output
 */
export const colors = {
    profit: "green",
    loss: "red",
    neutral: "white",
    muted: "gray",
    header: "cyan",
    warning: "yellow",
    info: "blue",
};
/**
 * Get the appropriate color for a PnL value
 */
export function getPnLColor(value) {
    if (value > 0)
        return colors.profit;
    if (value < 0)
        return colors.loss;
    return colors.neutral;
}
/**
 * Get the appropriate color for a percentage change
 */
export function getChangeColor(value) {
    if (value > 0)
        return colors.profit;
    if (value < 0)
        return colors.loss;
    return colors.neutral;
}
/**
 * Theme configuration for @inquirer/prompts
 * Provides consistent styling with the CLI color scheme
 */
export const inquirerTheme = {
    prefix: {
        idle: "\x1b[36m?\x1b[0m",
        done: "\x1b[32m✔\x1b[0m",
    },
    style: {
        answer: (text) => `\x1b[36m${text}\x1b[0m`,
        message: (text) => `\x1b[1m${text}\x1b[0m`,
        error: (text) => `\x1b[31m${text}\x1b[0m`,
        highlight: (text) => `\x1b[36m${text}\x1b[0m`,
        description: (text) => `\x1b[90m${text}\x1b[0m`,
        help: (text) => `\x1b[90m${text}\x1b[0m`,
    },
};
