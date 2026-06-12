import Database from "better-sqlite3";
/**
 * Get or create the database connection
 */
export declare function getDb(): Database.Database;
/**
 * Close the database connection
 */
export declare function closeDb(): void;
export * from "./accounts.js";
