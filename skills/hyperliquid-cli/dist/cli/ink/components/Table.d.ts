import React from "react";
export interface Column<T> {
    key: keyof T;
    header: string;
    width?: number;
    align?: "left" | "right";
    render?: (value: T[keyof T], row: T) => React.ReactNode;
}
export interface TableProps<T> {
    data: T[];
    columns: Column<T>[];
    emptyMessage?: string;
}
export declare function Table<T extends object>({ data, columns, emptyMessage, }: TableProps<T>): React.ReactElement;
