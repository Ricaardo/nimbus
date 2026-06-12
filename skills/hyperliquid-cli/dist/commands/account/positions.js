import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { validateAddress } from "../../lib/validation.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { createPositionWatcher } from "../../lib/position-watcher.js";
import { Table, PnL, WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function PositionsDisplay({ positions, accountValue, totalMarginUsed, lastUpdated, isWatch, }) {
    const columns = [
        { key: "coin", header: "Coin" },
        { key: "size", header: "Size", align: "right" },
        { key: "entryPx", header: "Entry", align: "right" },
        { key: "positionValue", header: "Value", align: "right" },
        {
            key: "unrealizedPnl",
            header: "PnL",
            align: "right",
            render: (value) => _jsx(PnL, { value: value }),
        },
        { key: "leverage", header: "Leverage", align: "right" },
        { key: "liquidationPx", header: "Liq. Price", align: "right" },
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: "Positions", lastUpdated: lastUpdated }), positions.length === 0 ? (_jsx(Text, { color: colors.muted, children: "No open positions" })) : (_jsx(Table, { data: positions, columns: columns })), _jsxs(Box, { marginTop: 1, flexDirection: "column", children: [_jsxs(Text, { children: ["Account Value: ", _jsx(Text, { bold: true, children: accountValue })] }), _jsxs(Text, { children: ["Total Margin Used: ", _jsx(Text, { bold: true, children: totalMarginUsed })] })] }), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchPositions({ user, isTestnet, isJson }) {
    const [positions, setPositions] = useState([]);
    const [accountValue, setAccountValue] = useState("0");
    const [totalMarginUsed, setTotalMarginUsed] = useState("0");
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        const watcher = createPositionWatcher({
            user,
            isTestnet,
            onUpdate: (state) => {
                if (isJson) {
                    const formatted = formatPositionsFromState(state);
                    console.log(JSON.stringify({ ...formatted, timestamp: new Date().toISOString() }));
                    return;
                }
                const formatted = formatPositionsFromState(state);
                setPositions(formatted.positions);
                setAccountValue(formatted.accountValue);
                setTotalMarginUsed(formatted.totalMarginUsed);
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
    }, [user, isTestnet, isJson]);
    if (error) {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsxs(Text, { color: colors.loss, children: ["Error: ", error] }), _jsx(Text, { color: colors.muted, children: "Reconnecting..." })] }));
    }
    if (isJson) {
        return _jsx(Text, { color: colors.muted, children: "Streaming JSON..." });
    }
    return (_jsx(PositionsDisplay, { positions: positions, accountValue: accountValue, totalMarginUsed: totalMarginUsed, lastUpdated: lastUpdated, isWatch: true }));
}
function formatPositionsFromState(state) {
    const clearinghouseState = state.clearinghouseStates[0]?.[1];
    const positions = state.clearinghouseStates
        .flatMap((c) => c[1].assetPositions)
        .filter((p) => parseFloat(p.position.szi) !== 0)
        .map((p) => ({
        coin: p.position.coin,
        size: p.position.szi,
        entryPx: p.position.entryPx,
        positionValue: p.position.positionValue,
        unrealizedPnl: p.position.unrealizedPnl,
        leverage: `${p.position.leverage.value}x ${p.position.leverage.type}`,
        liquidationPx: p.position.liquidationPx || "-",
    }));
    return {
        positions,
        accountValue: clearinghouseState?.marginSummary?.accountValue || "0",
        totalMarginUsed: clearinghouseState?.marginSummary?.totalMarginUsed || "0",
    };
}
export function registerPositionsCommand(account) {
    account
        .command("positions")
        .description("Get account positions")
        .option("--user <address>", "User address (defaults to configured wallet)")
        .option("-w, --watch", "Watch mode - stream real-time updates")
        .action(async function (options) {
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
            if (options.watch) {
                if (!outputOpts.json) {
                    hideCursor();
                }
                const { unmount, waitUntilExit } = render(_jsx(WatchPositions, { user: user, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
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
            const state = await client.clearinghouseState({ user });
            const positions = state.assetPositions
                .map((p) => p.position)
                .filter((p) => parseFloat(p.szi) !== 0)
                .map((p) => ({
                coin: p.coin,
                size: p.szi,
                entryPx: p.entryPx,
                positionValue: p.positionValue,
                unrealizedPnl: p.unrealizedPnl,
                leverage: `${p.leverage.value}x ${p.leverage.type}`,
                liquidationPx: p.liquidationPx || "-",
            }));
            if (outputOpts.json) {
                output({
                    positions,
                    marginSummary: state.marginSummary,
                    crossMarginSummary: state.crossMarginSummary,
                }, outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(PositionsDisplay, { positions: positions, accountValue: state.marginSummary.accountValue, totalMarginUsed: state.marginSummary.totalMarginUsed, lastUpdated: new Date(), isWatch: false }));
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
