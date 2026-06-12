import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { WebSocketTransport, SubscriptionClient } from "@nktkas/hyperliquid";
import WebSocket from "ws";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { validateAddress } from "../../lib/validation.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function LeverageDisplay({ info, isWatch, lastUpdated, }) {
    const hasPosition = info.position !== null && parseFloat(info.position.size) !== 0;
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: `${info.coin} Leverage`, lastUpdated: lastUpdated }), _jsx(Box, { flexDirection: "column", marginBottom: 1, children: _jsxs(Text, { bold: true, color: colors.header, children: [info.coin, " Leverage Info"] }) }), _jsxs(Box, { flexDirection: "column", children: [_jsxs(Box, { children: [_jsx(Text, { children: "Leverage: " }), _jsxs(Text, { bold: true, children: [info.leverage.value, "x ", info.leverage.type] })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Max Leverage: " }), _jsxs(Text, { bold: true, children: [info.maxLeverage, "x"] })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Mark Price: " }), _jsxs(Text, { bold: true, children: ["$", info.markPx] })] })] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { bold: true, color: colors.header, children: "Position" }), hasPosition ? (_jsxs(_Fragment, { children: [_jsxs(Box, { children: [_jsx(Text, { children: "Size: " }), _jsx(Text, { bold: true, children: info.position.size })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Value: " }), _jsxs(Text, { bold: true, children: ["$", info.position.value] })] })] })) : (_jsx(Text, { color: colors.muted, children: "No position" }))] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { bold: true, color: colors.header, children: "Trading Capacity" }), _jsxs(Box, { children: [_jsx(Text, { children: "Available to Trade: " }), _jsxs(Text, { bold: true, color: colors.profit, children: [info.availableToTrade[0], " / ", info.availableToTrade[1]] })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Max Trade Size: " }), _jsxs(Text, { bold: true, children: [info.maxTradeSzs[0], " / ", info.maxTradeSzs[1]] })] })] }), _jsxs(Box, { flexDirection: "column", marginTop: 1, children: [_jsx(Text, { bold: true, color: colors.header, children: "Margin" }), _jsxs(Box, { children: [_jsx(Text, { children: "Account Value: " }), _jsxs(Text, { bold: true, children: ["$", info.margin.accountValue] })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Total Margin Used: " }), _jsxs(Text, { bold: true, children: ["$", info.margin.totalMarginUsed] })] }), _jsxs(Box, { children: [_jsx(Text, { children: "Available Margin: " }), _jsxs(Text, { bold: true, color: colors.profit, children: ["$", info.margin.availableMargin] })] })] }), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchLeverage({ coin, user, maxLeverage, initialMargin, initialPosition, isTestnet, isJson, }) {
    const [info, setInfo] = useState(null);
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        let wsTransport = null;
        let subscriptionClient = null;
        let subscription = null;
        async function start() {
            try {
                wsTransport = new WebSocketTransport({
                    isTestnet,
                    reconnect: { WebSocket: WebSocket },
                });
                subscriptionClient = new SubscriptionClient({ transport: wsTransport });
                await wsTransport.ready();
                subscription = await subscriptionClient.activeAssetData({ user, coin }, (data) => {
                    const leverageInfo = {
                        coin: data.coin,
                        leverage: data.leverage,
                        maxLeverage,
                        maxTradeSzs: data.maxTradeSzs,
                        availableToTrade: data.availableToTrade,
                        markPx: data.markPx,
                        position: initialPosition,
                        margin: initialMargin,
                    };
                    if (isJson) {
                        console.log(JSON.stringify({
                            ...formatJsonOutput(leverageInfo),
                            timestamp: new Date().toISOString(),
                        }));
                        return;
                    }
                    setInfo(leverageInfo);
                    setLastUpdated(new Date());
                    setError(null);
                });
            }
            catch (err) {
                setError(err instanceof Error ? err.message : String(err));
            }
        }
        start();
        return () => {
            if (subscription) {
                subscription.unsubscribe().catch(() => { });
            }
            if (wsTransport) {
                wsTransport.close().catch(() => { });
            }
        };
    }, [coin, user, maxLeverage, initialMargin, initialPosition, isTestnet, isJson]);
    if (error) {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: colors.loss, children: ["Error: ", error] }), _jsx(Text, { color: colors.muted, children: "Reconnecting..." })] }));
    }
    if (isJson) {
        return _jsx(Text, { color: colors.muted, children: "Streaming JSON..." });
    }
    if (!info) {
        return _jsx(Text, { color: colors.muted, children: "Loading..." });
    }
    return _jsx(LeverageDisplay, { info: info, isWatch: true, lastUpdated: lastUpdated });
}
function formatJsonOutput(info) {
    return {
        coin: info.coin,
        leverage: info.leverage,
        maxLeverage: info.maxLeverage,
        markPx: info.markPx,
        maxTradeSzs: info.maxTradeSzs,
        availableToTrade: info.availableToTrade,
        position: info.position,
        margin: info.margin,
    };
}
async function getMaxLeverage(publicClient, coin) {
    const allPerpMetas = await publicClient.allPerpMetas();
    for (const dex of allPerpMetas) {
        const asset = dex.universe.find((a) => a.name === coin);
        if (asset) {
            return asset.maxLeverage;
        }
    }
    // Default if not found
    return 50;
}
export function registerLeverageCommand(asset) {
    asset
        .command("leverage")
        .description("Get leverage and margin info for a specific asset")
        .argument("<coin>", "Coin symbol (e.g., BTC, ETH, AAPL)")
        .option("--user <address>", "User address (defaults to configured wallet)")
        .option("-w, --watch", "Watch mode - stream real-time updates")
        .action(async function (coin, options) {
        const ctx = getContext(this);
        const outputOpts = getOutputOptions(this);
        try {
            let user;
            if (options.user) {
                user = validateAddress(options.user);
            }
            else {
                user = ctx.getWalletAddress();
            }
            const client = ctx.getPublicClient();
            // Fetch all required data in parallel
            const [activeAssetDataResult, clearinghouseState, maxLeverage] = await Promise.all([
                client.activeAssetData({ user, coin }),
                client.clearinghouseState({ user }),
                getMaxLeverage(client, coin),
            ]);
            const position = clearinghouseState.assetPositions
                .map((p) => p.position)
                .find((p) => p.coin === coin);
            const marginSummary = clearinghouseState.marginSummary;
            const accountValue = parseFloat(marginSummary.accountValue);
            const totalMarginUsed = parseFloat(marginSummary.totalMarginUsed);
            const availableMargin = Math.max(0, accountValue - totalMarginUsed);
            const positionInfo = position && parseFloat(position.szi) !== 0
                ? { size: position.szi, value: position.positionValue }
                : null;
            const marginInfo = {
                accountValue: marginSummary.accountValue,
                totalMarginUsed: marginSummary.totalMarginUsed,
                availableMargin: availableMargin.toFixed(2),
            };
            if (options.watch) {
                if (!outputOpts.json) {
                    hideCursor();
                }
                const { unmount, waitUntilExit } = render(_jsx(WatchLeverage, { coin: coin, user: user, maxLeverage: maxLeverage, initialMargin: marginInfo, initialPosition: positionInfo, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
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
            // Non-watch mode: display the data
            const info = {
                coin,
                leverage: activeAssetDataResult.leverage,
                maxLeverage,
                maxTradeSzs: activeAssetDataResult.maxTradeSzs,
                availableToTrade: activeAssetDataResult.availableToTrade,
                markPx: activeAssetDataResult.markPx,
                position: positionInfo,
                margin: marginInfo,
            };
            if (outputOpts.json) {
                output(formatJsonOutput(info), outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(LeverageDisplay, { info: info }));
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
