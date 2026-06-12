#!/usr/bin/env python3
"""Regression checks for safety gates in the Binance Square bot."""

from __future__ import annotations

import json
import tempfile
from pathlib import Path

from botlib import validate_draft
from publish_due_posts import can_mark_stale_skip, is_context_stale


def config() -> dict:
    return {
        "queue_dir": "",
        "daily_slots": [{"slot": "morning_map", "autopublish": True, "max_risk_level": "S1"}],
        "compliance": {
            "blocked_phrases": ["稳赚"],
            "required_semantics": ["观察", "风险", "失效条件"],
        },
    }


def base_draft() -> dict:
    return {
        "status": "draft",
        "risk_level": "S1",
        "slot": "morning_map",
        "post_type": "text",
        "body": "BTC 早盘观察：这里只看结构。风险是误判趋势。失效条件：跌破区间。",
        "media_paths": [],
        "invalidation": "跌破区间。",
    }


def write_draft(tmp: Path, draft: dict) -> Path:
    path = tmp / "draft.json"
    path.write_text(json.dumps(draft, ensure_ascii=False), encoding="utf-8")
    return path


def assert_invalid_contains(draft: dict, needle: str) -> None:
    with tempfile.TemporaryDirectory() as dirname:
        result = validate_draft(write_draft(Path(dirname), draft), config())
    # Lightweight regression script.
    assert not result.ok, result.errors  # nosec B101
    assert any(needle in error for error in result.errors), result.errors  # nosec B101


def assert_valid(draft: dict) -> None:
    with tempfile.TemporaryDirectory() as dirname:
        result = validate_draft(write_draft(Path(dirname), draft), config())
    # Lightweight regression script.
    assert result.ok, result.errors  # nosec B101


def test_unhealthy_data_cannot_autopublish() -> None:
    draft = base_draft()
    draft["data_health"] = {"status": "fallback", "reason": "price zero"}
    assert_invalid_contains(draft, "unhealthy market data")


def test_unhealthy_data_can_require_review() -> None:
    draft = base_draft()
    draft["status"] = "needs_review"
    draft["data_health"] = {"status": "fallback", "reason": "price zero"}
    assert_valid(draft)


def test_approved_requires_human_approval() -> None:
    draft = base_draft()
    draft["status"] = "approved"
    assert_invalid_contains(draft, "approval.source=human")


def test_ai_approval_is_rejected() -> None:
    draft = base_draft()
    draft["status"] = "approved"
    draft["approval"] = {"source": "ai", "approved_by": "codex", "approved_at": "2026-05-27T00:00:00"}
    assert_invalid_contains(draft, "approval.source=human")


def test_human_approval_is_valid() -> None:
    draft = base_draft()
    draft["status"] = "approved"
    draft["approval"] = {"source": "human", "approved_by": "operator", "approved_at": "2026-05-27T00:00:00"}
    assert_valid(draft)


def test_review_gated_draft_is_not_stale_skipped() -> None:
    draft = base_draft()
    draft["status"] = "needs_review"
    # Lightweight regression script.
    assert not can_mark_stale_skip(draft, config())  # nosec B101


def test_auto_draft_can_be_stale_skipped() -> None:
    draft = base_draft()
    # Lightweight regression script.
    assert can_mark_stale_skip(draft, config())  # nosec B101


def test_auto_draft_without_generated_at_has_stale_context() -> None:
    draft = base_draft()
    # Lightweight regression script.
    assert is_context_stale(draft, config())  # nosec B101


def test_review_gated_draft_without_generated_at_is_not_auto_skipped() -> None:
    draft = base_draft()
    draft["status"] = "needs_review"
    # Lightweight regression script.
    assert not can_mark_stale_skip(draft, config())  # nosec B101


def main() -> int:
    test_unhealthy_data_cannot_autopublish()
    test_unhealthy_data_can_require_review()
    test_approved_requires_human_approval()
    test_ai_approval_is_rejected()
    test_human_approval_is_valid()
    test_review_gated_draft_is_not_stale_skipped()
    test_auto_draft_can_be_stale_skipped()
    test_auto_draft_without_generated_at_has_stale_context()
    test_review_gated_draft_without_generated_at_is_not_auto_skipped()
    print("regression tests passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
