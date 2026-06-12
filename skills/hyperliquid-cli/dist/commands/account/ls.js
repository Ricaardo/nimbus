import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text, render } from "ink";
import { getOutputOptions } from "../../cli/program.js";
import { output } from "../../cli/output.js";
import { getAllAccounts } from "../../lib/db/index.js";
import { Table } from "../../cli/ink/index.js";
import { colors } from "../../cli/ink/theme.js";
function formatAddress(address) {
    return `${address.slice(0, 6)}...${address.slice(-4)}`;
}
function AccountsList({ accounts }) {
    if (accounts.length === 0) {
        return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Text, { color: colors.muted, children: "No accounts found." }), _jsx(Text, { color: colors.muted, children: "Run 'hl account add' to add your first account." })] }));
    }
    const rows = accounts.map((acc) => ({
        alias: acc.alias,
        address: formatAddress(acc.userAddress),
        type: acc.type,
        apiWallet: acc.apiWalletPublicKey
            ? formatAddress(acc.apiWalletPublicKey)
            : "-",
        default: acc.isDefault ? "*" : "",
    }));
    const columns = [
        { key: "default", header: "", width: 2 },
        { key: "alias", header: "Alias" },
        { key: "address", header: "Address" },
        { key: "type", header: "Type" },
        { key: "apiWallet", header: "API Wallet" },
    ];
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Table, { data: rows, columns: columns }), _jsx(Box, { marginTop: 1, children: _jsx(Text, { color: colors.muted, children: "* = default account" }) })] }));
}
export function registerLsCommand(account) {
    account
        .command("ls")
        .description("List all accounts")
        .action(async function () {
        const outputOpts = getOutputOptions(this);
        const accounts = getAllAccounts();
        if (outputOpts.json) {
            // For JSON output, include full addresses but redact private keys
            const jsonAccounts = accounts.map((acc) => ({
                id: acc.id,
                alias: acc.alias,
                userAddress: acc.userAddress,
                type: acc.type,
                source: acc.source,
                apiWalletPublicKey: acc.apiWalletPublicKey,
                isDefault: acc.isDefault,
                createdAt: acc.createdAt,
                updatedAt: acc.updatedAt,
            }));
            output(jsonAccounts, outputOpts);
        }
        else {
            const { unmount, waitUntilExit } = render(_jsx(AccountsList, { accounts: accounts }));
            await waitUntilExit();
            unmount();
        }
    });
}
