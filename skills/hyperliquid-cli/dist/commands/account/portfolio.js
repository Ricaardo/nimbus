import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { validateAddress } from "../../lib/validation.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { createPortfolioWatcher } from "../../lib/portfolio-watcher.js";
import { Table, PnL, WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function PortfolioDisplay({ positions, spotBalances, accountValue, totalMarginUsed, lastUpdated, isWatch, }) {
    const positionColumns = [
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
    ];
    const balanceColumns = [
        { key: "token", header: "Token" },
        { key: "total", header: "Total", align: "right" },
        { key: "hold", header: "Hold", align: "right" },
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: "Portfolio", lastUpdated: lastUpdated }), _jsxs(Box, { marginBottom: 1, flexDirection: "column", children: [_jsx(Text, { bold: true, color: colors.header, children: "Account Summary" }), _jsxs(Text, { children: ["Account Value: ", _jsx(Text, { bold: true, children: accountValue })] }), _jsxs(Text, { children: ["Total Margin Used: ", _jsx(Text, { bold: true, children: totalMarginUsed })] })] }), _jsx(Text, { bold: true, color: colors.header, children: "Perpetual Positions:" }), positions.length === 0 ? (_jsx(Box, { marginBottom: 1, children: _jsx(Text, { color: colors.muted, children: "No open positions" }) })) : (_jsx(Box, { marginBottom: 1, children: _jsx(Table, { data: positions, columns: positionColumns }) })), _jsx(Text, { bold: true, color: colors.header, children: "Spot Balances:" }), spotBalances.length === 0 ? (_jsx(Text, { color: colors.muted, children: "No spot balances" })) : (_jsx(Table, { data: spotBalances, columns: balanceColumns })), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchPortfolio({ user, isTestnet, isJson }) {
    const [positions, setPositions] = useState([]);
    const [spotBalances, setSpotBalances] = useState([]);
    const [accountValue, setAccountValue] = useState("0");
    const [totalMarginUsed, setTotalMarginUsed] = useState("0");
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        const watcher = createPortfolioWatcher({
            user,
            isTestnet,
            onUpdate: (data) => {
                if (isJson) {
                    console.log(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
                    return;
                }
                setPositions(data.positions);
                setSpotBalances(data.spotBalances);
                setAccountValue(data.accountValue);
                setTotalMarginUsed(data.totalMarginUsed);
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
    return (_jsx(PortfolioDisplay, { positions: positions, spotBalances: spotBalances, accountValue: accountValue, totalMarginUsed: totalMarginUsed, lastUpdated: lastUpdated, isWatch: true }));
}
export function registerPortfolioCommand(account) {
    account
        .command("portfolio")
        .description("Get full portfolio (positions + spot balances)")
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
                const { unmount, waitUntilExit } = render(_jsx(WatchPortfolio, { user: user, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
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
            const [clearinghouseState, spotState] = await Promise.all([
                client.clearinghouseState({ user }),
                client.spotClearinghouseState({ user }),
            ]);
            const positions = clearinghouseState.assetPositions
                .map((p) => p.position)
                .filter((p) => parseFloat(p.szi) !== 0)
                .map((p) => ({
                coin: p.coin,
                size: p.szi,
                entryPx: p.entryPx,
                positionValue: p.positionValue,
                unrealizedPnl: p.unrealizedPnl,
                leverage: `${p.leverage.value}x ${p.leverage.type}`,
            }));
            const spotBalances = spotState.balances
                .filter((b) => parseFloat(b.total) !== 0)
                .map((b) => ({
                token: b.coin,
                total: b.total,
                hold: b.hold,
            }));
            const data = {
                positions,
                spotBalances,
                accountValue: clearinghouseState.marginSummary.accountValue,
                totalMarginUsed: clearinghouseState.marginSummary.totalMarginUsed,
            };
            if (outputOpts.json) {
                output(data, outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(PortfolioDisplay, { ...data, lastUpdated: new Date(), isWatch: false }));
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
