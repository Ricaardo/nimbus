import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { createPriceWatcher } from "../../lib/price-watcher.js";
import { WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function PriceDisplay({ coin, price, isWatch, lastUpdated, }) {
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: `${coin} Price`, lastUpdated: lastUpdated }), _jsxs(Box, { children: [_jsx(Text, { bold: true, color: colors.header, children: coin }), _jsx(Text, { children: ": " }), _jsx(Text, { bold: true, children: price })] }), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchPrice({ coin, isTestnet, isJson }) {
    const [price, setPrice] = useState("-");
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        const watcher = createPriceWatcher({
            coin,
            isTestnet,
            onUpdate: (newPrice) => {
                if (isJson) {
                    console.log(JSON.stringify({ coin, price: newPrice, timestamp: new Date().toISOString() }));
                    return;
                }
                setPrice(newPrice);
                setLastUpdated(new Date());
                setError(null);
            },
            onError: (err) => {
                setError(err.message);
            },
        });
        watcher.start();
        return () => {
            watcher.stop();
        };
    }, [coin, isTestnet, isJson]);
    if (error) {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: colors.loss, children: ["Error: ", error] }), _jsx(Text, { color: colors.muted, children: "Reconnecting..." })] }));
    }
    if (isJson) {
        return _jsx(Text, { color: colors.muted, children: "Streaming JSON..." });
    }
    return _jsx(PriceDisplay, { coin: coin, price: price, isWatch: true, lastUpdated: lastUpdated });
}
export function registerPriceCommand(asset) {
    asset
        .command("price")
        .description("Get price of a specific asset")
        .argument("<coin>", "Coin symbol (e.g., BTC, ETH)")
        .option("-w, --watch", "Watch mode - stream real-time updates")
        .action(async function (coin, options) {
        const ctx = getContext(this);
        const outputOpts = getOutputOptions(this);
        const coinUpper = coin;
        try {
            if (options.watch) {
                if (!outputOpts.json) {
                    hideCursor();
                }
                const { unmount, waitUntilExit } = render(_jsx(WatchPrice, { coin: coinUpper, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
                const cleanup = () => {
                    if (!outputOpts.json) {
                        showCursor();
                    }
                    unmount();
                };
                process.on("SIGINT", () => {
                    cleanup();
                    process.exit(0);
                });
                process.on("SIGTERM", () => {
                    cleanup();
                    process.exit(0);
                });
                await waitUntilExit();
                return;
            }
            // Non-watch mode: fetch once
            let mids;
            const serverClient = await ctx.getServerClient();
            if (serverClient) {
                try {
                    const { data } = await serverClient.getPrices();
                    mids = data;
                    serverClient.close();
                }
                catch {
                    serverClient.close();
                    const client = ctx.getPublicClient();
                    mids = await client.allMids();
                }
            }
            else {
                const client = ctx.getPublicClient();
                mids = await client.allMids();
            }
            const price = mids[coinUpper];
            if (price === undefined) {
                outputError(`Coin not found: ${coinUpper}`);
                process.exit(1);
            }
            if (outputOpts.json) {
                output({ coin: coinUpper, price }, outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(PriceDisplay, { coin: coinUpper, price: price }));
                await waitUntilExit();
                unmount();
            }
        }
        catch (err) {
            outputError(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });
}
