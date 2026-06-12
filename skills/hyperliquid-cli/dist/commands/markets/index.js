import { registerLsCommand } from "./ls.js";
export function registerMarketsCommands(program) {
    const markets = program.command("markets").description("Market information");
    registerLsCommand(markets);
}
