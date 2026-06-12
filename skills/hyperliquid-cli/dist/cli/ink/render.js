import { render as inkRender } from "ink";
/**
 * Render a React component to the terminal using Ink
 * Returns the instance for cleanup
 */
export function render(element) {
    return inkRender(element);
}
/**
 * Render a component once and exit (for static output)
 */
export function renderOnce(element) {
    const { unmount, waitUntilExit } = inkRender(element);
    waitUntilExit().then(() => {
        unmount();
    });
}
/**
 * Render a component for watch mode (persistent)
 * Returns cleanup function
 */
export function renderWatch(element) {
    const { unmount, clear } = inkRender(element);
    return () => {
        clear();
        unmount();
    };
}
