"""Shared utilities for the Binance Square operations bot."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
CONFIG_PATH = ROOT / "config.json"
RISK_ORDER = {"S0": 0, "S1": 1, "S2": 2, "S3": 3}
VALID_STATUSES = {"draft", "needs_asset", "needs_review", "approved", "published", "skip"}
VALID_POST_TYPES = {"text", "image", "article", "video"}


@dataclass
class DraftResult:
    path: Path
    ok: bool
    errors: list[str]
    draft: dict[str, Any]


def load_config() -> dict[str, Any]:
    return json.loads(CONFIG_PATH.read_text(encoding="utf-8"))


def db_path(config: dict[str, Any] | None = None) -> Path:
    cfg = config or load_config()
    return Path(cfg.get("db_path", ROOT / "posts.db"))


def connect_db(config: dict[str, Any] | None = None) -> sqlite3.Connection:
    conn = sqlite3.connect(db_path(config))
    conn.row_factory = sqlite3.Row
    return conn


def init_db(config: dict[str, Any] | None = None) -> None:
    cfg = config or load_config()
    conn = connect_db(cfg)
    try:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS events (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source TEXT NOT NULL,
              severity TEXT NOT NULL,
              title TEXT NOT NULL,
              url TEXT,
              observed_at TEXT NOT NULL,
              summary TEXT,
              raw_json TEXT
            );

            CREATE TABLE IF NOT EXISTS market_snapshots (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              source TEXT NOT NULL,
              symbol TEXT NOT NULL,
              observed_at TEXT NOT NULL,
              price REAL,
              change_pct REAL,
              high_24h REAL,
              low_24h REAL,
              volume REAL,
              raw_json TEXT
            );

            CREATE TABLE IF NOT EXISTS content_queue (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              queue_file TEXT UNIQUE,
              slot_time TEXT,
              slot TEXT,
              status TEXT NOT NULL,
              risk_level TEXT NOT NULL,
              post_type TEXT NOT NULL,
              title TEXT,
              body TEXT NOT NULL,
              media_paths TEXT,
              image_prompt TEXT,
              body_hash TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              raw_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS posts (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              queue_id INTEGER,
              queue_file TEXT,
              square_id TEXT,
              link TEXT,
              body_hash TEXT,
              published_at TEXT NOT NULL,
              metrics_json TEXT,
              raw_output TEXT,
              FOREIGN KEY(queue_id) REFERENCES content_queue(id)
            );

            CREATE TABLE IF NOT EXISTS post_metrics (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              post_id INTEGER,
              collected_at TEXT NOT NULL,
              views INTEGER,
              likes INTEGER,
              comments INTEGER,
              shares INTEGER,
              followers_delta INTEGER,
              raw_json TEXT,
              FOREIGN KEY(post_id) REFERENCES posts(id)
            );
            """
        )
        conn.commit()
    finally:
        conn.close()


def now_iso() -> str:
    return datetime.now().isoformat(timespec="seconds")


def now_stamp() -> str:
    return datetime.now().strftime("%Y%m%d-%H%M%S-%f")[:-3]


def slugify(value: str) -> str:
    value = re.sub(r"[^A-Za-z0-9._-]+", "-", value.strip())
    return value.strip("-") or "draft"


def body_hash(body: str) -> str:
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def has_healthy_market_data(draft: dict[str, Any]) -> bool:
    data_health = draft.get("data_health")
    if not data_health:
        return True
    if isinstance(data_health, str):
        return data_health == "ok"
    if isinstance(data_health, dict):
        return data_health.get("status") == "ok"
    return False


def has_human_approval(draft: dict[str, Any]) -> bool:
    approval = draft.get("approval")
    if not isinstance(approval, dict):
        return False
    approved_by = str(approval.get("approved_by", "")).strip().lower()
    source = str(approval.get("source", "")).strip().lower()
    if source != "human":
        return False
    if not approved_by or approved_by in {"ai", "bot", "codex", "automation"}:
        return False
    return bool(approval.get("approved_at"))


def queue_files(config: dict[str, Any]) -> list[Path]:
    queue_dir = Path(config["queue_dir"])
    return sorted(queue_dir.glob("*.json"))


def slot_for(config: dict[str, Any], slot_name: str) -> dict[str, Any] | None:
    for slot in config["daily_slots"]:
        if slot["slot"] == slot_name:
            return slot
    return None


def slot_allows_autopublish(draft: dict[str, Any], config: dict[str, Any]) -> bool:
    slot_config = slot_for(config, draft.get("slot", ""))
    risk_level = draft.get("risk_level", "S3")
    if not slot_config or risk_level not in RISK_ORDER:
        return False
    max_risk = slot_config.get("max_risk_level", "S1")
    return bool(slot_config.get("autopublish")) and RISK_ORDER[risk_level] <= RISK_ORDER[max_risk]


def validate_draft(path: Path, config: dict[str, Any]) -> DraftResult:
    errors: list[str] = []
    try:
        draft = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return DraftResult(path=path, ok=False, errors=[f"invalid json: {exc}"], draft={})

    required = ["status", "risk_level", "slot", "post_type", "body"]
    for key in required:
        if key not in draft:
            errors.append(f"missing required field: {key}")

    body = str(draft.get("body", "")).strip()
    if not body:
        errors.append("body is empty")

    status = draft.get("status")
    if status not in VALID_STATUSES:
        errors.append(f"status must be one of: {', '.join(sorted(VALID_STATUSES))}")

    risk_level = draft.get("risk_level")
    if risk_level not in RISK_ORDER:
        errors.append("risk_level must be S0, S1, S2, or S3")

    post_type = draft.get("post_type")
    if post_type not in VALID_POST_TYPES:
        errors.append(f"post_type must be one of: {', '.join(sorted(VALID_POST_TYPES))}")

    blocked = config["compliance"]["blocked_phrases"]
    for phrase in blocked:
        if phrase in body:
            errors.append(f"blocked phrase found: {phrase}")

    for semantic in config["compliance"]["required_semantics"]:
        if semantic not in body and semantic not in str(draft.get("invalidation", "")):
            errors.append(f"required semantic missing: {semantic}")

    media_paths = draft.get("media_paths", [])
    if media_paths and not isinstance(media_paths, list):
        errors.append("media_paths must be a list")
    media_list = media_paths if isinstance(media_paths, list) else []
    for media_path in media_list:
        if not Path(str(media_path)).exists():
            errors.append(f"media path not found: {media_path}")

    if post_type == "image" and not media_list and status != "needs_asset":
        errors.append("image post requires at least one media path unless status=needs_asset")

    if post_type == "video":
        if not media_list and status != "needs_asset":
            errors.append("video post requires one media path unless status=needs_asset")
        if not draft.get("duration_seconds") and status != "needs_asset":
            errors.append("video post requires duration_seconds unless status=needs_asset")

    if risk_level in {"S2", "S3"} and status == "approved":
        errors.append(f"{risk_level} content cannot be approved for autopublish")

    if status == "approved" and not has_human_approval(draft):
        errors.append("approved drafts require approval.source=human, approved_by, and approved_at")

    if status in {"draft", "approved"} and not has_healthy_market_data(draft):
        errors.append("unhealthy market data drafts must be needs_review or skip")

    return DraftResult(path=path, ok=not errors, errors=errors, draft=draft)


def write_queue_draft(draft: dict[str, Any], config: dict[str, Any], prefix: str) -> Path:
    queue_dir = Path(config["queue_dir"])
    queue_dir.mkdir(parents=True, exist_ok=True)
    base_name = f"{now_stamp()}-{slugify(prefix)}"
    path = queue_dir / f"{base_name}.json"
    counter = 1
    while path.exists():
        path = queue_dir / f"{base_name}-{counter}.json"
        counter += 1
    path.write_text(json.dumps(draft, ensure_ascii=False, indent=2), encoding="utf-8")
    upsert_queue_file(path, draft, config)
    return path


def upsert_queue_file(path: Path, draft: dict[str, Any], config: dict[str, Any]) -> None:
    init_db(config)
    conn = connect_db(config)
    raw = json.dumps(draft, ensure_ascii=False)
    media_paths = json.dumps(draft.get("media_paths", []), ensure_ascii=False)
    body = draft.get("body", "")
    timestamp = now_iso()
    try:
        conn.execute(
            """
            INSERT INTO content_queue
              (queue_file, slot_time, slot, status, risk_level, post_type, title, body,
               media_paths, image_prompt, body_hash, created_at, updated_at, raw_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(queue_file) DO UPDATE SET
              slot_time=excluded.slot_time,
              slot=excluded.slot,
              status=excluded.status,
              risk_level=excluded.risk_level,
              post_type=excluded.post_type,
              title=excluded.title,
              body=excluded.body,
              media_paths=excluded.media_paths,
              image_prompt=excluded.image_prompt,
              body_hash=excluded.body_hash,
              updated_at=excluded.updated_at,
              raw_json=excluded.raw_json
            """,
            (
                str(path),
                draft.get("slot_time"),
                draft.get("slot"),
                draft.get("status"),
                draft.get("risk_level"),
                draft.get("post_type"),
                draft.get("title"),
                body,
                media_paths,
                draft.get("image_prompt"),
                body_hash(body),
                timestamp,
                timestamp,
                raw,
            ),
        )
        conn.commit()
    finally:
        conn.close()


def sync_queue_to_db(config: dict[str, Any]) -> tuple[int, int]:
    ok_count = 0
    invalid_count = 0
    for path in queue_files(config):
        result = validate_draft(path, config)
        if result.ok:
            upsert_queue_file(path, result.draft, config)
            ok_count += 1
        else:
            invalid_count += 1
    return ok_count, invalid_count


def latest_snapshot(config: dict[str, Any], symbol: str) -> sqlite3.Row | None:
    conn = connect_db(config)
    try:
        return conn.execute(
            "SELECT * FROM market_snapshots WHERE symbol = ? ORDER BY observed_at DESC, id DESC LIMIT 1",
            (symbol,),
        ).fetchone()
    finally:
        conn.close()


def latest_events(config: dict[str, Any], limit: int = 5) -> list[sqlite3.Row]:
    conn = connect_db(config)
    try:
        return conn.execute(
            "SELECT * FROM events ORDER BY observed_at DESC, id DESC LIMIT ?",
            (limit,),
        ).fetchall()
    finally:
        conn.close()


def next_slot_time(config: dict[str, Any], slot_name: str) -> str:
    slot = slot_for(config, slot_name)
    if not slot:
        return now_iso()
    hour, minute = [int(part) for part in slot["time"].split(":", 1)]
    target = datetime.now().replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target < datetime.now():
        target += timedelta(days=1)
    return target.isoformat(timespec="seconds")
