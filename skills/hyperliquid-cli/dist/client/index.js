import { connect } from "node:net";
import { existsSync } from "node:fs";
import { SERVER_SOCKET_PATH } from "../lib/paths.js";
export class ServerClient {
    socket = null;
    requestId = 0;
    pending = new Map();
    buffer = "";
    async connect() {
        if (this.socket)
            return;
        return new Promise((resolve, reject) => {
            const socket = connect(SERVER_SOCKET_PATH);
            socket.on("connect", () => {
                this.socket = socket;
                resolve();
            });
            socket.on("error", (err) => {
                reject(err);
            });
            socket.on("data", (data) => {
                this.handleData(data.toString());
            });
            socket.on("close", () => {
                this.socket = null;
                // Reject all pending requests
                for (const pending of this.pending.values()) {
                    pending.reject(new Error("Connection closed"));
                }
                this.pending.clear();
            });
        });
    }
    handleData(data) {
        this.buffer += data;
        const lines = this.buffer.split("\n");
        this.buffer = lines.pop() || "";
        for (const line of lines) {
            if (line.trim()) {
                try {
                    const response = JSON.parse(line);
                    const pending = this.pending.get(response.id);
                    if (pending) {
                        this.pending.delete(response.id);
                        pending.resolve(response);
                    }
                }
                catch {
                    // Ignore parse errors
                }
            }
        }
    }
    async request(method, params) {
        if (!this.socket) {
            throw new Error("Not connected");
        }
        const id = String(++this.requestId);
        const request = { id, method, params };
        return new Promise((resolve, reject) => {
            // Timeout after 5 seconds
            const timeoutId = setTimeout(() => {
                if (this.pending.has(id)) {
                    this.pending.delete(id);
                    reject(new Error("Request timeout"));
                }
            }, 5000);
            this.pending.set(id, {
                resolve: (value) => {
                    clearTimeout(timeoutId);
                    resolve(value);
                },
                reject: (err) => {
                    clearTimeout(timeoutId);
                    reject(err);
                },
            });
            this.socket.write(JSON.stringify(request) + "\n");
        });
    }
    async getPrices(coin) {
        const response = await this.request("getPrices", coin ? { coin } : undefined);
        if (response.error) {
            throw new Error(response.error);
        }
        return { data: response.result, cached_at: response.cached_at };
    }
    async getAssetCtxs() {
        const response = await this.request("getAssetCtxs");
        if (response.error) {
            throw new Error(response.error);
        }
        return { data: response.result, cached_at: response.cached_at };
    }
    async getPerpMeta() {
        const response = await this.request("getPerpMeta");
        if (response.error) {
            throw new Error(response.error);
        }
        return { data: response.result, cached_at: response.cached_at };
    }
    async getSpotMeta() {
        const response = await this.request("getSpotMeta");
        if (response.error) {
            throw new Error(response.error);
        }
        return { data: response.result, cached_at: response.cached_at };
    }
    async getSpotAssetCtxs() {
        const response = await this.request("getSpotAssetCtxs");
        if (response.error) {
            throw new Error(response.error);
        }
        return { data: response.result, cached_at: response.cached_at };
    }
    async getStatus() {
        const response = await this.request("getStatus");
        if (response.error) {
            throw new Error(response.error);
        }
        return response.result;
    }
    async shutdown() {
        const response = await this.request("shutdown");
        if (response.error) {
            throw new Error(response.error);
        }
    }
    close() {
        if (this.socket) {
            this.socket.destroy();
            this.socket = null;
        }
    }
}
// Helper to check if server is running
export function isServerRunning() {
    return existsSync(SERVER_SOCKET_PATH);
}
// Helper to try connecting to server
export async function tryConnectToServer() {
    if (!isServerRunning()) {
        return null;
    }
    try {
        const client = new ServerClient();
        await client.connect();
        return client;
    }
    catch {
        return null;
    }
}
