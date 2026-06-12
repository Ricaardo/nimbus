import React from "react";
import { type Instance } from "ink";
/**
 * Render a React component to the terminal using Ink
 * Returns the instance for cleanup
 */
export declare function render(element: React.ReactElement): Instance;
/**
 * Render a component once and exit (for static output)
 */
export declare function renderOnce(element: React.ReactElement): void;
/**
 * Render a component for watch mode (persistent)
 * Returns cleanup function
 */
export declare function renderWatch(element: React.ReactElement): () => void;
