import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import InkSpinner from "ink-spinner";
import { colors } from "../theme.js";
export function Spinner({ label = "Loading..." }) {
    return (_jsxs(Box, { children: [_jsx(Text, { color: colors.info, children: _jsx(InkSpinner, { type: "dots" }) }), _jsxs(Text, { children: [" ", label] })] }));
}
export function ErrorDisplay({ message }) {
    return (_jsx(Box, { children: _jsxs(Text, { color: colors.loss, children: ["Error: ", message] }) }));
}
export function SuccessDisplay({ message }) {
    return (_jsx(Box, { children: _jsx(Text, { color: colors.profit, children: message }) }));
}
