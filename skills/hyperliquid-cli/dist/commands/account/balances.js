import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { validateAddress } from "../../lib/validation.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { createBalanceWatcher } from "../../lib/balance-watcher.js";
import { Table, WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function BalancesDisplay({ spotBalances, perpBalance, lastUpdated, isWatch, }) {
    const columns = [
        { key: "token", header: "Token" },
        { key: "total", header: "Total", align: "right" },
        { key: "hold", header: "Hold", align: "right" },
        { key: "available", header: "Available", align: "right" },
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: "Balances", lastUpdated: lastUpdated }), _jsxs(Box, { marginBottom: 1, children: [_jsx(Text, { bold: true, children: "Perpetuals Balance: " }), _jsxs(Text, { children: [perpBalance, " USD"] })] }), _jsx(Text, { bold: true, color: colors.header, children: "Spot Balances:" }), spotBalances.length === 0 ? (_jsx(Text, { color: colors.muted, children: "No spot balances" })) : (_jsx(Table, { data: spotBalances, columns: columns })), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchBalances({ user, isTestnet, isJson }) {
    const [spotBalances, setSpotBalances] = useState([]);
    const [perpBalance, setPerpBalance] = useState("0");
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        const watcher = createBalanceWatcher({
            user,
            isTestnet,
            onUpdate: (data) => {
                if (isJson) {
                    console.log(JSON.stringify({ ...data, timestamp: new Date().toISOString() }));
                    return;
                }
                setSpotBalances(data.spotBalances);
                setPerpBalance(data.perpBalance);
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
    return (_jsx(BalancesDisplay, { spotBalances: spotBalances, perpBalance: perpBalance, lastUpdated: lastUpdated, isWatch: true }));
}
export function registerBalancesCommand(account) {
    account
        .command("balances")
        .description("Get spot and perps USD balances")
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
                const { unmount, waitUntilExit } = render(_jsx(WatchBalances, { user: user, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
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
            const spotBalances = spotState.balances
                .filter((b) => parseFloat(b.total) !== 0)
                .map((b) => ({
                token: b.coin,
                total: b.total,
                hold: b.hold,
                available: (parseFloat(b.total) - parseFloat(b.hold)).toString(),
            }));
            const perpBalance = clearinghouseState.marginSummary.accountValue;
            if (outputOpts.json) {
                output({ spotBalances, perpBalance }, outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(BalancesDisplay, { spotBalances: spotBalances, perpBalance: perpBalance, lastUpdated: new Date(), isWatch: false }));
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
