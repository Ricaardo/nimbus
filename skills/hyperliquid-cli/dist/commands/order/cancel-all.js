import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError, outputSuccess } from "../../cli/output.js";
import { confirm } from "../../lib/prompts.js";
import { getAssetIndex } from "./shared.js";
export function registerCancelAllCommand(order) {
    order
        .command("cancel-all")
        .description("Cancel all open orders")
        .option("-y, --yes", "Skip confirmation prompt")
        .option("--coin <coin>", "Only cancel orders for a specific coin")
        .action(async function (options) {
        const ctx = getContext(this);
        const outputOpts = getOutputOptions(this);
        try {
            const client = ctx.getWalletClient();
            const publicClient = ctx.getPublicClient();
            const user = ctx.getWalletAddress();
            // Fetch open orders
            const orders = await publicClient.openOrders({ user, dex: "ALL_DEXS" });
            if (orders.length === 0) {
                outputSuccess("No open orders to cancel");
                return;
            }
            let ordersToCancel = orders;
            if (options.coin) {
                ordersToCancel = orders.filter((o) => o.coin === options.coin);
                if (ordersToCancel.length === 0) {
                    outputSuccess(`No open orders for ${options.coin}`);
                    return;
                }
            }
            // Confirm unless --yes flag
            if (!options.yes) {
                const confirmMsg = options.coin
                    ? `Cancel all ${ordersToCancel.length} orders for ${options.coin}?`
                    : `Cancel all ${ordersToCancel.length} open orders?`;
                const confirmed = await confirm(confirmMsg, false);
                if (!confirmed) {
                    outputSuccess("Cancelled");
                    return;
                }
            }
            // Build cancel requests with asset indices
            const cancels = await Promise.all(ordersToCancel.map(async (o) => {
                const assetIndex = await getAssetIndex(publicClient, o.coin);
                return { a: assetIndex, o: o.oid };
            }));
            const result = await client.cancel({ cancels });
            if (outputOpts.json) {
                output(result, outputOpts);
            }
            else {
                outputSuccess(`Cancelled ${ordersToCancel.length} orders`);
            }
        }
        catch (err) {
            outputError(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });
}
