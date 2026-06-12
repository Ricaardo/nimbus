import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Box, Text } from "ink";
import { colors } from "../theme.js";
function calculateColumnWidths(data, columns) {
    const widths = new Map();
    for (const col of columns) {
        if (col.width) {
            widths.set(col.key, col.width);
            continue;
        }
        let maxWidth = col.header.length;
        for (const row of data) {
            const value = row[col.key];
            const strValue = value === null || value === undefined ? "" : String(value);
            maxWidth = Math.max(maxWidth, strValue.length);
        }
        widths.set(col.key, maxWidth);
    }
    return widths;
}
function padValue(value, width, align) {
    if (align === "right") {
        return value.padStart(width);
    }
    return value.padEnd(width);
}
export function Table({ data, columns, emptyMessage = "No data", }) {
    if (data.length === 0) {
        return (_jsx(Box, { children: _jsx(Text, { color: colors.muted, children: emptyMessage }) }));
    }
    const widths = calculateColumnWidths(data, columns);
    return (_jsxs(Box, { flexDirection: "column", children: [_jsx(Box, { children: columns.map((col, i) => (_jsx(Box, { marginRight: i < columns.length - 1 ? 2 : 0, children: _jsx(Text, { color: colors.header, bold: true, children: padValue(col.header, widths.get(col.key) || col.header.length, col.align || "left") }) }, String(col.key)))) }), _jsx(Box, { children: columns.map((col, i) => (_jsx(Box, { marginRight: i < columns.length - 1 ? 2 : 0, children: _jsx(Text, { color: colors.muted, children: "-".repeat(widths.get(col.key) || col.header.length) }) }, String(col.key)))) }), data.map((row, rowIndex) => (_jsx(Box, { children: columns.map((col, colIndex) => {
                    const value = row[col.key];
                    const width = widths.get(col.key) || col.header.length;
                    const align = col.align || "left";
                    if (col.render) {
                        return (_jsx(Box, { marginRight: colIndex < columns.length - 1 ? 2 : 0, children: _jsx(Box, { width: width, justifyContent: align === "right" ? "flex-end" : "flex-start", children: col.render(value, row) }) }, String(col.key)));
                    }
                    const strValue = value === null || value === undefined ? "" : String(value);
                    return (_jsx(Box, { marginRight: colIndex < columns.length - 1 ? 2 : 0, children: _jsx(Text, { children: padValue(strValue, width, align) }) }, String(col.key)));
                }) }, rowIndex)))] }));
}
