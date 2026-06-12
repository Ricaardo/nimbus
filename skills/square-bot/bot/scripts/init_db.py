#!/usr/bin/env python3
"""Initialize the Binance Square bot SQLite database."""

from __future__ import annotations

from botlib import db_path, init_db, load_config, sync_queue_to_db


def main() -> int:
    config = load_config()
    init_db(config)
    ok_count, invalid_count = sync_queue_to_db(config)
    print(f"db: {db_path(config)}")
    print(f"queue_synced: {ok_count}")
    print(f"queue_invalid: {invalid_count}")
    return 0 if invalid_count == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
