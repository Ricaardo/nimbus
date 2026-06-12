import { createServer } from "node:net";
import { existsSync, unlinkSync } from "node:fs";
import { SERVER_SOCKET_PATH } from "../lib/paths.js";
export class IPCServer {
    server = null;
    cache;
    subscriptions;
    isTestnet;
    startedAt;
    log;
    onShutdown;
    constructor(cache, subscriptions, isTestnet, startedAt, log, onShutdown) {
        this.cache = cache;
        this.subscriptions = subscriptions;
        this.isTestnet = isTestnet;
        this.startedAt = startedAt;
        this.log = log;
        this.onShutdown = onShutdown;
    }
    async start() {
        // Remove existing socket file if it exists
        if (existsSync(SERVER_SOCKET_PATH)) {
            unlinkSync(SERVER_SOCKET_PATH);
        }
        return new Promise((resolve, reject) => {
            this.server = createServer((socket) => {
                this.handleConnection(socket);
            });
            this.server.on("error", (err) => {
                this.log(`IPC server error: ${err.message}`);
                reject(err);
            });
            this.server.listen(SERVER_SOCKET_PATH, () => {
                this.log(`IPC server listening on ${SERVER_SOCKET_PATH}`);
                resolve();
            });
        });
    }
    handleConnection(socket) {
        let buffer = "";
        socket.on("data", (data) => {
            buffer += data.toString();
            // Process complete messages (newline-delimited)
            const lines = buffer.split("\n");
            buffer = lines.pop() || "";
            for (const line of lines) {
                if (line.trim()) {
                    this.handleMessage(socket, line);
                }
            }
        });
        socket.on("error", (err) => {
            this.log(`Socket error: ${err.message}`);
        });
    }
    handleMessage(socket, message) {
        let request;
        try {
            request = JSON.parse(message);
        }
        catch {
            this.sendResponse(socket, { id: "0", error: "Invalid JSON" });
            return;
        }
        const response = this.handleRequest(request);
        this.sendResponse(socket, response);
    }
    handleRequest(request) {
        const { id, method, params } = request;
        switch (method) {
            case "getPrices": {
                const entry = this.cache.getAllMids();
                if (!entry) {
                    return { id, error: "No data available" };
                }
                const coin = params?.coin;
                if (coin) {
                    const price = entry.data[coin];
                    if (price === undefined) {
                        return { id, error: `Coin not found: ${coin}` };
                    }
                    return { id, result: { [coin]: price }, cached_at: entry.updatedAt };
                }
                return { id, result: entry.data, cached_at: entry.updatedAt };
            }
            case "getAssetCtxs": {
                const entry = this.cache.getAllDexsAssetCtxs();
                if (!entry) {
                    return { id, error: "No data available" };
                }
                return { id, result: entry.data, cached_at: entry.updatedAt };
            }
            case "getPerpMeta": {
                const entry = this.cache.getAllPerpMetas();
                if (!entry) {
                    return { id, error: "No data available" };
                }
                return { id, result: entry.data, cached_at: entry.updatedAt };
            }
            case "getSpotMeta": {
                const entry = this.cache.getSpotMeta();
                if (!entry) {
                    return { id, error: "No data available" };
                }
                return { id, result: entry.data, cached_at: entry.updatedAt };
            }
            case "getSpotAssetCtxs": {
                const entry = this.cache.getSpotAssetCtxs();
                if (!entry) {
                    return { id, error: "No data available" };
                }
                return { id, result: entry.data, cached_at: entry.updatedAt };
            }
            case "getStatus": {
                const cacheStatus = this.cache.getStatus();
                return {
                    id,
                    result: {
                        running: true,
                        testnet: this.isTestnet,
                        connected: this.subscriptions.isConnected(),
                        startedAt: this.startedAt,
                        uptime: Date.now() - this.startedAt,
                        cache: cacheStatus,
                    },
                };
            }
            case "shutdown": {
                // Respond first, then shutdown
                setTimeout(() => this.onShutdown(), 100);
                return { id, result: { ok: true } };
            }
            default:
                return { id, error: `Unknown method: ${method}` };
        }
    }
    sendResponse(socket, response) {
        try {
            socket.write(JSON.stringify(response) + "\n");
        }
        catch {
            // Socket may have closed
        }
    }
    async stop() {
        return new Promise((resolve) => {
            if (this.server) {
                this.server.close(() => {
                    this.log("IPC server stopped");
                    resolve();
                });
            }
            else {
                resolve();
            }
        });
    }
}
