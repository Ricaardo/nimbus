import { getDb } from "./index.js";
/**
 * Convert database row to Account object
 */
function rowToAccount(row) {
    return {
        id: row.id,
        alias: row.alias,
        userAddress: row.user_address,
        type: row.type,
        source: row.source,
        apiWalletPrivateKey: row.api_wallet_private_key,
        apiWalletPublicKey: row.api_wallet_public_key,
        isDefault: row.is_default === 1,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}
/**
 * Create a new account
 */
export function createAccount(input) {
    const db = getDb();
    // If this is the first account or setAsDefault is true, make it default
    const accountCount = db.prepare("SELECT COUNT(*) as count FROM accounts").get();
    const shouldBeDefault = accountCount.count === 0 || input.setAsDefault;
    // If setting as default, unset current default first
    if (shouldBeDefault) {
        db.prepare("UPDATE accounts SET is_default = 0 WHERE is_default = 1").run();
    }
    const result = db.prepare(`
    INSERT INTO accounts (
      alias,
      user_address,
      type,
      source,
      api_wallet_private_key,
      api_wallet_public_key,
      is_default
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(input.alias, input.userAddress, input.type, input.source || "cli_import", input.apiWalletPrivateKey || null, input.apiWalletPublicKey || null, shouldBeDefault ? 1 : 0);
    return getAccountById(Number(result.lastInsertRowid));
}
/**
 * Get an account by ID
 */
export function getAccountById(id) {
    const db = getDb();
    const row = db.prepare("SELECT * FROM accounts WHERE id = ?").get(id);
    return row ? rowToAccount(row) : null;
}
/**
 * Get an account by alias
 */
export function getAccountByAlias(alias) {
    const db = getDb();
    const row = db.prepare("SELECT * FROM accounts WHERE alias = ?").get(alias);
    return row ? rowToAccount(row) : null;
}
/**
 * Get the default account
 */
export function getDefaultAccount() {
    const db = getDb();
    const row = db.prepare("SELECT * FROM accounts WHERE is_default = 1").get();
    return row ? rowToAccount(row) : null;
}
/**
 * Get all accounts
 */
export function getAllAccounts() {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM accounts ORDER BY is_default DESC, created_at ASC").all();
    return rows.map(rowToAccount);
}
/**
 * Set an account as default by alias
 */
export function setDefaultAccount(alias) {
    const db = getDb();
    // Check if account exists
    const account = getAccountByAlias(alias);
    if (!account) {
        throw new Error(`Account with alias "${alias}" not found`);
    }
    // Unset current default
    db.prepare("UPDATE accounts SET is_default = 0 WHERE is_default = 1").run();
    // Set new default
    db.prepare("UPDATE accounts SET is_default = 1, updated_at = strftime('%s', 'now') WHERE alias = ?").run(alias);
    return getAccountByAlias(alias);
}
/**
 * Delete an account by alias
 */
export function deleteAccount(alias) {
    const db = getDb();
    const account = getAccountByAlias(alias);
    if (!account) {
        return false;
    }
    const wasDefault = account.isDefault;
    db.prepare("DELETE FROM accounts WHERE alias = ?").run(alias);
    // If deleted account was default, set the first remaining account as default
    if (wasDefault) {
        const firstAccount = db.prepare("SELECT * FROM accounts ORDER BY created_at ASC LIMIT 1").get();
        if (firstAccount) {
            db.prepare("UPDATE accounts SET is_default = 1 WHERE id = ?").run(firstAccount.id);
        }
    }
    return true;
}
/**
 * Check if an alias is already taken
 */
export function isAliasTaken(alias) {
    const db = getDb();
    const row = db.prepare("SELECT 1 FROM accounts WHERE alias = ?").get(alias);
    return row !== undefined;
}
/**
 * Update an account's API wallet credentials
 */
export function updateAccountApiWallet(alias, apiWalletPrivateKey, apiWalletPublicKey) {
    const db = getDb();
    const account = getAccountByAlias(alias);
    if (!account) {
        throw new Error(`Account with alias "${alias}" not found`);
    }
    db.prepare(`
    UPDATE accounts
    SET
      api_wallet_private_key = ?,
      api_wallet_public_key = ?,
      type = 'api_wallet',
      updated_at = strftime('%s', 'now')
    WHERE alias = ?
  `).run(apiWalletPrivateKey, apiWalletPublicKey, alias);
    return getAccountByAlias(alias);
}
/**
 * Get account count
 */
export function getAccountCount() {
    const db = getDb();
    const result = db.prepare("SELECT COUNT(*) as count FROM accounts").get();
    return result.count;
}
