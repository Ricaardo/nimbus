import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { createBookWatcher } from "../../lib/book-watcher.js";
import { WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
const MAX_LEVELS = 10;
const BAR_WIDTH = 20;
const PRICE_WIDTH = 12;
const SIZE_WIDTH = 12;
const ORDERS_WIDTH = 4;
// Unicode block characters for depth bar
const FULL_BLOCK = "█";
function createDepthBar(ratio, width) {
    const filled = Math.max(1, Math.round(ratio * width));
    return FULL_BLOCK.repeat(Math.min(filled, width));
}
function BookDisplay({ coin, bids, asks, isWatch, lastUpdated, }) {
    const displayBids = bids.slice(0, MAX_LEVELS);
    // Calculate cumulative sizes for depth
    // For asks: calculate cumulative from best ask (lowest price) BEFORE reversing for display
    // This ensures depth bars build away from the spread (smallest bar at best ask)
    const asksToProcess = asks.slice(0, MAX_LEVELS);
    let askCumulative = 0;
    const asksWithCumulative = asksToProcess
        .map((level) => {
        askCumulative += parseFloat(level.sz);
        return { ...level, cumulative: askCumulative };
    })
        .reverse(); // Reverse after cumulative calc for display (highest price at top)
    let bidCumulative = 0;
    const bidsWithCumulative = displayBids.map((level) => {
        bidCumulative += parseFloat(level.sz);
        return { ...level, cumulative: bidCumulative };
    });
    // Find max cumulative for scaling (use same scale for both sides)
    // After reversing asks, first element has max cumulative (worst ask at top)
    const maxCumulative = Math.max(asksWithCumulative[0]?.cumulative || 0, bidsWithCumulative[bidsWithCumulative.length - 1]?.cumulative || 0);
    // Best ask is now last element after reversing (closest to spread)
    const spread = asksWithCumulative.length > 0 && displayBids.length > 0
        ? (parseFloat(asksWithCumulative[asksWithCumulative.length - 1].px) -
            parseFloat(displayBids[0].px)).toFixed(2)
        : null;
    const totalWidth = PRICE_WIDTH + SIZE_WIDTH + ORDERS_WIDTH + BAR_WIDTH + 6; // 6 for spacing
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: `${coin} Order Book`, lastUpdated: lastUpdated }), !isWatch && (_jsx(Box, { marginBottom: 1, children: _jsxs(Text, { bold: true, color: colors.header, children: [coin, " Order Book"] }) })), _jsxs(Box, { children: [_jsx(Box, { width: PRICE_WIDTH, children: _jsx(Text, { color: colors.muted, children: "price".padEnd(PRICE_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: SIZE_WIDTH, children: _jsx(Text, { color: colors.muted, children: "size".padEnd(SIZE_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: ORDERS_WIDTH, children: _jsx(Text, { color: colors.muted, children: "#".padEnd(ORDERS_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: BAR_WIDTH, children: _jsx(Text, { color: colors.muted, children: "depth".padEnd(BAR_WIDTH) }) })] }), asksWithCumulative.length > 0 ? (asksWithCumulative.map((level, i) => (_jsxs(Box, { children: [_jsx(Box, { width: PRICE_WIDTH, children: _jsx(Text, { color: colors.loss, children: level.px.padEnd(PRICE_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: SIZE_WIDTH, children: _jsx(Text, { children: level.sz.padEnd(SIZE_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: ORDERS_WIDTH, children: _jsx(Text, { color: colors.muted, children: String(level.n).padEnd(ORDERS_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: BAR_WIDTH, children: _jsx(Text, { color: colors.loss, children: createDepthBar(level.cumulative / maxCumulative, BAR_WIDTH) }) })] }, `ask-${i}`)))) : (_jsx(Text, { color: colors.muted, children: "No asks" })), spread && (_jsx(Box, { children: _jsxs(Text, { color: colors.warning, children: ["─".repeat(totalWidth / 2), " spread: ", spread, " ", "─".repeat(totalWidth / 2)] }) })), bidsWithCumulative.length > 0 ? (bidsWithCumulative.map((level, i) => (_jsxs(Box, { children: [_jsx(Box, { width: PRICE_WIDTH, children: _jsx(Text, { color: colors.profit, children: level.px.padEnd(PRICE_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: SIZE_WIDTH, children: _jsx(Text, { children: level.sz.padEnd(SIZE_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: ORDERS_WIDTH, children: _jsx(Text, { color: colors.muted, children: String(level.n).padEnd(ORDERS_WIDTH) }) }), _jsx(Text, { children: " " }), _jsx(Box, { width: BAR_WIDTH, children: _jsx(Text, { color: colors.profit, children: createDepthBar(level.cumulative / maxCumulative, BAR_WIDTH) }) })] }, `bid-${i}`)))) : (_jsx(Text, { color: colors.muted, children: "No bids" })), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchBook({ coin, isTestnet, isJson }) {
    const [bids, setBids] = useState([]);
    const [asks, setAsks] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        const watcher = createBookWatcher({
            coin,
            isTestnet,
            onUpdate: (data) => {
                if (isJson) {
                    console.log(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
                    return;
                }
                setBids(data.bids);
                setAsks(data.asks);
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
    return (_jsx(BookDisplay, { coin: coin, bids: bids, asks: asks, isWatch: true, lastUpdated: lastUpdated }));
}
export function registerBookCommand(asset) {
    asset
        .command("book")
        .description("Get order book for a coin")
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
                const { unmount, waitUntilExit } = render(_jsx(WatchBook, { coin: coinUpper, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
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
            const client = ctx.getPublicClient();
            const book = await client.l2Book({ coin: coinUpper });
            if (!book) {
                outputError(`No order book data for ${coinUpper}`);
                process.exit(1);
            }
            const levels = book.levels;
            const bookBids = levels[0] || [];
            const bookAsks = levels[1] || [];
            if (outputOpts.json) {
                output(book, outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(BookDisplay, { coin: coinUpper, bids: bookBids, asks: bookAsks }));
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
