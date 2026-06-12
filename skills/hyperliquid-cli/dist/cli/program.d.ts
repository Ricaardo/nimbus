import { Command } from "commander";
import { type CLIContext } from "./context.js";
export interface GlobalOptions {
    json: boolean;
    testnet: boolean;
}
export declare function createProgram(): Command;
export declare function getContext(command: Command): CLIContext;
export declare function getOutputOptions(command: Command): {
    json: boolean;
};
