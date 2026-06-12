import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState, useEffect } from "react";
import { Box, Text, render } from "ink";
import { getContext, getOutputOptions } from "../../cli/program.js";
import { output, outputError } from "../../cli/output.js";
import { hideCursor, showCursor } from "../../cli/watch.js";
import { validateAddress } from "../../lib/validation.js";
import { createOrdersWatcher } from "../../lib/orders-watcher.js";
import { Table, WatchHeader, WatchFooter } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function OrdersDisplay({ orders, isWatch, lastUpdated }) {
    const columns = [
        { key: "oid", header: "OID", align: "right" },
        { key: "coin", header: "Coin" },
        {
            key: "side",
            header: "Side",
            render: (value) => (_jsx(Text, { color: value === "B" ? colors.profit : colors.loss, children: value === "B" ? "Buy" : "Sell" })),
        },
        { key: "sz", header: "Size", align: "right" },
        { key: "limitPx", header: "Price", align: "right" },
        { key: "timestamp", header: "Time" },
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [isWatch && _jsx(WatchHeader, { title: "Open Orders", lastUpdated: lastUpdated }), orders.length === 0 ? (_jsx(Text, { color: colors.muted, children: "No open orders" })) : (_jsx(Table, { data: orders, columns: columns })), isWatch && _jsx(WatchFooter, {})] }));
}
function WatchOrders({ user, isTestnet, isJson }) {
    const [orders, setOrders] = useState([]);
    const [lastUpdated, setLastUpdated] = useState(new Date());
    const [error, setError] = useState(null);
    useEffect(() => {
        const watcher = createOrdersWatcher({
            user,
            isTestnet,
            onUpdate: (data) => {
                const formatted = data.map((o) => ({
                    oid: o.oid,
                    coin: o.coin,
                    side: o.side,
                    sz: o.sz,
                    limitPx: o.limitPx,
                    timestamp: new Date(o.timestamp).toLocaleString(),
                }));
                if (isJson) {
                    console.log(JSON.stringify({ orders: formatted, timestamp: new Date().toISOString() }));
                    return;
                }
                setOrders(formatted);
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
    return _jsx(OrdersDisplay, { orders: orders, isWatch: true, lastUpdated: lastUpdated });
}
export function registerOrdersCommand(account) {
    account
        .command("orders")
        .description("Get open orders")
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
                const { unmount, waitUntilExit } = render(_jsx(WatchOrders, { user: user, isTestnet: ctx.config.testnet, isJson: outputOpts.json }));
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
            const client = ctx.getPublicClient();
            const orders = await client.openOrders({ user, dex: "ALL_DEXS" });
            const formatted = orders.map((o) => ({
                oid: o.oid,
                coin: o.coin,
                side: o.side,
                sz: o.sz,
                limitPx: o.limitPx,
                timestamp: new Date(o.timestamp).toLocaleString(),
            }));
            if (outputOpts.json) {
                output(formatted, outputOpts);
            }
            else {
                const { unmount, waitUntilExit } = render(_jsx(OrdersDisplay, { orders: formatted }));
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
