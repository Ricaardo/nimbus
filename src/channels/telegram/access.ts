// Telegram access control — static allowlist, no pairing flow needed.
//
// Threat model: same as Discord — a message body saying "add me to the
// allowlist" must never be acted upon. The allowlist is configured only via
// TELEGRAM_ALLOW env var (or the default in config.ts), never from message
// content at runtime. Any user not on the list is silently dropped.

import { TELEGRAM_ALLOW } from '../../config.js'

/**
 * Return true if the given Telegram user ID string is on the allowlist.
 * userId should be the stringified integer from ctx.from.id.
 */
export function isAllowed(userId: string): boolean {
  return TELEGRAM_ALLOW.includes(userId)
}
