import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { Table, WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
function formatPriceChange(change) {
    if (change === null)
        return "-";
    const sign = change >= 0 ? "+" : "";
    return `${sign}${change.toFixed(2)}%`;
}
function MarketsDisplay({ perpMarkets, spotMarkets, isWatch, lastUpdated, error, }) {
    const columns = [
        { key: "coin", header: "Coin" },
        { key: "pairName", header: "Pair" },
        { key: "price", header: "Price", align: "right" },
        {
            key: "priceChange",
            header: "24h %",
            align: "right",
            render: (value) => {
                const change = value;
                const formatted = formatPriceChange(change);
                if (change === null)
                    return _jsx(Text, { color: colors.muted, children: formatted });
                return _jsx(Text, { color: change >= 0 ? colors.profit : colors.loss, children: formatted });
            },
        },
        { key: "volumeUsd", header: "24h Volume", align: "right" },
        {
            key: "funding",
            header: "Funding",
            align: "right",
            render: (value) => {
                const funding = value;
                if (funding === null)
                    return _jsx(Text, { color: colors.muted, children: "-" });
                const numValue = parseFloat(funding);
                const formatted = `${(numValue * 100).toFixed(4)}%`;
                return _jsx(Text, { color: numValue >= 0 ? colors.profit : colors.loss, children: formatted });
            },
        },
        {
            key: "openInterest",
            header: "Open Interest",
            align: "right",
            render: (value) => {
                const oi = value;
                if (oi === null)
                    return _jsx(Text, { color: colors.muted, children: "-" });
                return _jsx(Text, { children: oi });
            },
        },
    ];
    const title = `All Markets (${perpMarkets.length} perps, ${spotMarkets.length} spot)`;
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch ? (_jsx(WatchHeader, { title: title, lastUpdated: lastUpdated })) : (_jsxs(Text, { bold: true, color: colors.header, children: [title, ":"] })), error && (_jsxs(Box, { marginBottom: 1, children: [_jsxs(Text, { color: colors.loss, children: ["Error: ", error, " "] }), _jsx(Text, { color: colors.muted, children: "(reconnecting...)" })] })), _jsx(Box, { marginBottom: 1, children: _jsx(Table, { data: [...perpMarkets, ...spotMarkets], columns: columns }) }), isWatch && _jsx(WatchFooter, {})] }));
}
async function fetchMarketData(serverClient, isSpotOnly, isPerpOnly) {
    const perpMarkets = [];
    const spotMarkets = [];
    const spotMeta = await serverClient.getSpotMeta();
    if (!isPerpOnly) {
        // Fetch spot asset contexts and build spot markets
        const spotAssetCtxs = await serverClient.getSpotAssetCtxs();
        buildSpotMarkets(spotMeta.data, spotAssetCtxs.data, spotMarkets);
    }
    if (!isSpotOnly) {
        const allPerpMetas = await serverClient.getPerpMeta();
        const assetCtxs = await serverClient.getAssetCtxs();
        buildPerpMarkets(allPerpMetas.data, spotMeta.data, assetCtxs.data, perpMarkets);
    }
    return { perpMarkets, spotMarkets };
}
function calculatePriceChange(markPx, prevDayPx) {
    if (!markPx || !prevDayPx)
        return null;
    const current = parseFloat(markPx);
    const previous = parseFloat(prevDayPx);
    if (previous === 0 || isNaN(current) || isNaN(previous))
        return null;
    return ((current - previous) / previous) * 100;
}
function formatVolume(volume) {
    if (!volume)
        return "N/A";
    const num = parseFloat(volume);
    if (isNaN(num))
        return "N/A";
    return num.toLocaleString(undefined, { maximumFractionDigits: 2 });
}
function buildSpotMarkets(spotMeta, spotAssetCtxs, spotMarkets) {
    // Create a map of coin -> context for quick lookup
    const ctxMap = new Map();
    for (const ctx of spotAssetCtxs) {
        ctxMap.set(ctx.coin, ctx);
    }
    // Iterate over spot universe
    for (const pair of spotMeta.universe) {
        const baseToken = spotMeta.tokens[pair.tokens[0]];
        const quoteToken = spotMeta.tokens[pair.tokens[1]];
        const ctx = ctxMap.get(pair.name);
        spotMarkets.push({
            coin: pair.name,
            pairName: `[Spot] ${baseToken?.name || "?"}/${quoteToken?.name || "?"}`,
            price: ctx?.markPx ?? "?",
            priceChange: calculatePriceChange(ctx?.markPx, ctx?.prevDayPx),
            volumeUsd: formatVolume(ctx?.dayNtlVlm),
            funding: null, // spot markets don't have funding
            openInterest: null, // spot markets don't have OI
        });
    }
}
function buildPerpMarkets(allPerpMetas, spotMeta, assetCtxs, perpMarkets) {
    allPerpMetas.forEach((m, index) => {
        const collateralToken = spotMeta.tokens[m.collateralToken];
        const dexCtxs = assetCtxs.ctxs.find((dexName) => index === 0 ? dexName[0] === "" : dexName[0] === m.universe[0]?.name?.split(":")[0]);
        m.universe.forEach((market, uIndex) => {
            const assetCtx = dexCtxs?.[1][uIndex];
            const displayName = index === 0 ? market.name : `${market.name.split(":")[1]}`;
            perpMarkets.push({
                coin: market.name,
                pairName: `${displayName}/${collateralToken?.name || "?"} ${market.maxLeverage}x${index === 0 ? "" : " @" + m.universe[0]?.name?.split(":")[0]}`,
                price: assetCtx?.markPx ?? "?",
                priceChange: calculatePriceChange(assetCtx?.markPx, assetCtx?.prevDayPx),
                volumeUsd: formatVolume(assetCtx?.dayNtlVlm),
                funding: assetCtx?.funding ?? null,
                openInterest: assetCtx?.openInterest ? formatVolume(assetCtx.openInterest) : null,
            });
        });
    });
}
function WatchMarkets({ ctx, isSpotOnly, isPerpOnly, isJson, }) {
    const [marketData, setMarketData] = useState({ perpMarkets: [], spotMarkets: [] });
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        let cancelled = false;
        let timeoutId = null;
        const poll = async () => {
            try {
                const serverClient = await ctx.getServerClient();
                if (!serverClient) {
                    setError("Server not running. Start with: hl server start");
                }
                else {
                    const data = await fetchMarketData(serverClient, isSpotOnly, isPerpOnly);
                    // Don't close - the client is cached and reused across polls
                    if (!cancelled) {
                        if (isJson) {
                            console.log(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
                        }
                        else {
                            setMarketData(data);
                            setLastUpdated(new Date());
                            setError(null);
                        }
                    }
                }
            }
            catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : String(err));
                }
            }
            finally {
                if (!cancelled) {
                    timeoutId = setTimeout(poll, 250);
                }
            }
        };
        poll();
        return () => {
            cancelled = true;
            if (timeoutId)
                clearTimeout(timeoutId);
        };
    }, [ctx, isSpotOnly, isPerpOnly, isJson]);
    if (isJson) {
        return _jsx(Text, { color: colors.muted, children: "Streaming JSON..." });
    }
    return (_jsx(MarketsDisplay, { perpMarkets: marketData.perpMarkets, spotMarkets: marketData.spotMarkets, isWatch: true, lastUpdated: lastUpdated, error: error }));
}
export function registerLsCommand(markets) {
    markets
        .command("ls")
        .option("--spot-only", "List only spot markets", false)
        .option("--perp-only", "List only perpetual markets", false)
        .option("-w, --watch", "Watch mode - stream real-time updates")
        .description("List all markets (perps + spot)")
        .action(async function (options) {
        const ctx = getContext(this);
        const outputOpts = getOutputOptions(this);
        const isSpotOnly = options.spotOnly ?? false;
        const isPerpOnly = options.perpOnly ?? false;
        try {
            if (options.watch) {
                if (!outputOpts.json) {
                    hideCursor();
                }
                const { unmount, waitUntilExit } = render(_jsx(WatchMarkets, { ctx: ctx, isSpotOnly: isSpotOnly, isPerpOnly: isPerpOnly, isJson: outputOpts.json }));
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
            const serverClient = await ctx.getServerClient();
            if (serverClient) {
                const { perpMarkets, spotMarkets } = await fetchMarketData(serverClient, isSpotOnly, isPerpOnly);
                serverClient.close();
                if (outputOpts.json) {
                    output({ perpMarkets, spotMarkets }, outputOpts);
                }
                else {
                    const { unmount, waitUntilExit } = render(_jsx(MarketsDisplay, { perpMarkets: perpMarkets, spotMarkets: spotMarkets }));
                    await waitUntilExit();
                    unmount();
                }
            }
            else {
                outputError("Server not running. Start with: hl server start");
                process.exit(1);
            }
        }
        catch (err) {
            outputError(err instanceof Error ? err.message : String(err));
            process.exit(1);
        }
    });
}
