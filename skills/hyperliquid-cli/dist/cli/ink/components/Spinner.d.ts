import React from "react";
export interface SpinnerProps {
    label?: string;
}
export declare function Spinner({ label }: SpinnerProps): React.ReactElement;
export interface ErrorDisplayProps {
    message: string;
}
export declare function ErrorDisplay({ message }: ErrorDisplayProps): React.ReactElement;
export interface SuccessDisplayProps {
    message: string;
}
export declare function SuccessDisplay({ message }: SuccessDisplayProps): React.ReactElement;
