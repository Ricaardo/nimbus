import { registerPriceCommand } from "./price.js";
import { registerBookCommand } from "./book.js";
import { registerLeverageCommand } from "./leverage.js";
export function registerAssetCommands(program) {
    const asset = program.command("asset").description("Asset-specific information");
    registerPriceCommand(asset);
    registerBookCommand(asset);
    registerLeverageCommand(asset);
}
