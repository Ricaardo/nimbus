import React from "react";
export interface WatchHeaderProps {
    title: string;
    lastUpdated?: Date;
}
export declare function WatchHeader({ title, lastUpdated }: WatchHeaderProps): React.ReactElement;
export interface WatchFooterProps {
    message?: string;
}
export declare function WatchFooter({ message }: WatchFooterProps): React.ReactElement;
