import { registerAccountCommands } from "./account/index.js";
import { registerMarketsCommands } from "./markets/index.js";
import { registerAssetCommands } from "./asset/index.js";
import { registerOrderCommands } from "./order/index.js";
import { registerServerCommands } from "./server.js";
import { registerUpgradeCommand } from "./upgrade.js";
export function registerCommands(program) {
    registerAccountCommands(program);
    registerMarketsCommands(program);
    registerAssetCommands(program);
    registerOrderCommands(program);
    registerServerCommands(program);
    registerUpgradeCommand(program);
}
