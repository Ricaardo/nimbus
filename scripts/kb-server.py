#!/usr/bin/env python3
"""
kb-server.py — Nimbus 知识层 sidecar (RAG).

一个常驻本地服务,持有:
  • fastembed 多语言 embedding 模型 (中英混排)
  • data/knowledge.db (sqlite-vec 向量库) —— 研究报告/thesis/复盘/filing 的 chunk + 向量

为什么放 Python 而不是 Bun:bun:sqlite 默认禁用动态扩展加载,而 sqlite-vec 在 Python
里零摩擦;embedding 模型本就只能在 Python 跑。Bun 侧 (src/core/knowledge.ts) 只是 HTTP 客户端,
sidecar 挂了 recall 优雅返回空 —— 符合"弱依赖降级不崩"。

接口:
  GET  /health                      → {"ok":true,"model":...,"dim":...,"artifacts":N,"chunks":N}
  POST /ingest  {kind,ticker?,title?,source_path?,meta?,body}  → {"artifact_id":id,"chunks":n}
                 同一 source_path 重复 ingest = 覆盖 (先删旧 artifact+chunks)
  POST /search  {query,limit?,kind?,ticker?}  → {"results":[{artifact_id,kind,ticker,title,
                 created_at,source_path,score,snippet}]}
  GET  /stats                       → 同 /health

env:
  KB_DB_PATH   default <repo>/data/knowledge.db
  KB_MODEL     default sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2
  KB_PORT      default 6901
  KB_HOST      default 127.0.0.1
"""
from __future__ import annotations

import json
import os
import sqlite3
import time
from pathlib import Path
from typing import Any

import numpy as np
import sqlite_vec
from fastapi import FastAPI
from fastembed import TextEmbedding
from pydantic import BaseModel

REPO = Path(__file__).resolve().parent.parent
DB_PATH = os.environ.get("KB_DB_PATH", str(REPO / "data" / "knowledge.db"))
MODEL_NAME = os.environ.get(
    "KB_MODEL", "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2"
)
PORT = int(os.environ.get("KB_PORT", "6901"))
HOST = os.environ.get("KB_HOST", "127.0.0.1")

# ── embedding model (dim probed at runtime — fastembed metadata is unreliable) ──
_model = TextEmbedding(
    model_name=MODEL_NAME,
    cache_dir=os.environ.get("KB_FASTEMBED_CACHE", str(REPO / ".cache" / "fastembed")),
)
DIM = int(np.array(next(_model.embed(["probe"]))).shape[0])


def embed_one(text: str) -> np.ndarray:
    return np.array(next(_model.embed([text])), dtype=np.float32)


def embed_many(texts: list[str]) -> list[np.ndarray]:
    return [np.array(v, dtype=np.float32) for v in _model.embed(texts)]


# ── db ──────────────────────────────────────────────────────────────────────
def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH)
    db.enable_load_extension(True)
    sqlite_vec.load(db)
    db.enable_load_extension(False)
    return db


def init_db() -> None:
    Path(DB_PATH).parent.mkdir(parents=True, exist_ok=True)
    db = connect()
    db.execute(
        """CREATE TABLE IF NOT EXISTS artifacts (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            kind        TEXT NOT NULL,
            ticker      TEXT,
            title       TEXT,
            created_at  INTEGER NOT NULL,
            source_path TEXT,
            meta        TEXT,
            body        TEXT NOT NULL
        )"""
    )
    db.execute(
        "CREATE INDEX IF NOT EXISTS idx_artifacts_src ON artifacts(source_path)"
    )
    db.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_ticker ON artifacts(ticker)")
    # ResearchArtifact v1 migration: add columns in-place on the live DB if absent.
    have = {r[1] for r in db.execute("PRAGMA table_info(artifacts)").fetchall()}
    for col in ("symbols", "tags", "source_id", "provenance"):
        if col not in have:
            db.execute(f"ALTER TABLE artifacts ADD COLUMN {col} TEXT")
    db.execute("CREATE INDEX IF NOT EXISTS idx_artifacts_source_id ON artifacts(source_id)")
    # vec0 虚拟表;维度随模型。已存在但维度不符 → 重建(开发期模型换了会触发)。
    row = db.execute(
        "SELECT sql FROM sqlite_master WHERE name='chunks'"
    ).fetchone()
    if row and (f"FLOAT[{DIM}]" not in row[0] or "distance_metric=cosine" not in row[0]):
        db.execute("DROP TABLE chunks")
        row = None
    if not row:
        db.execute(
            f"""CREATE VIRTUAL TABLE chunks USING vec0(
                embedding   FLOAT[{DIM}] distance_metric=cosine,
                +artifact_id INTEGER,
                +chunk_idx   INTEGER,
                +text        TEXT
            )"""
        )
    db.commit()
    db.close()


# ── chunking (header-aware + size cap, 中英通用) ───────────────────────────────
CHUNK_CHARS = 800
OVERLAP_CHARS = 150


def chunk_text(body: str) -> list[str]:
    paras = [p.strip() for p in body.split("\n\n") if p.strip()]
    chunks: list[str] = []
    buf = ""
    for p in paras:
        if len(buf) + len(p) + 2 <= CHUNK_CHARS:
            buf = f"{buf}\n\n{p}" if buf else p
        else:
            if buf:
                chunks.append(buf)
            # 超长段落硬切
            if len(p) > CHUNK_CHARS:
                for i in range(0, len(p), CHUNK_CHARS - OVERLAP_CHARS):
                    chunks.append(p[i : i + CHUNK_CHARS])
                buf = ""
            else:
                buf = p
    if buf:
        chunks.append(buf)
    return chunks or [body[:CHUNK_CHARS]]


# ── api ───────────────────────────────────────────────────────────────────────
app = FastAPI(title="nimbus-kb")


class IngestReq(BaseModel):
    kind: str
    body: str
    ticker: str | None = None
    title: str | None = None
    source_path: str | None = None
    meta: dict[str, Any] | None = None
    # ResearchArtifact v1 fields (docs/contracts/research-artifact-v1.md)
    symbols: list[str] | None = None
    tags: list[str] | None = None
    source_id: str | None = None
    provenance: dict[str, Any] | None = None


class SearchReq(BaseModel):
    query: str
    limit: int = 6
    kind: str | None = None
    ticker: str | None = None
    symbol: str | None = None
    tag: str | None = None


def _counts(db: sqlite3.Connection) -> tuple[int, int]:
    a = db.execute("SELECT count(*) FROM artifacts").fetchone()[0]
    c = db.execute("SELECT count(*) FROM chunks").fetchone()[0]
    return a, c


@app.get("/health")
@app.get("/stats")
def health() -> dict[str, Any]:
    db = connect()
    a, c = _counts(db)
    db.close()
    return {"ok": True, "model": MODEL_NAME, "dim": DIM, "artifacts": a, "chunks": c}


@app.get("/coverage")
def coverage() -> dict[str, Any]:
    """Distribution of artifacts by kind / source / tag (P4 coverage report)."""
    db = connect()
    by_kind = dict(db.execute("SELECT kind, count(*) FROM artifacts GROUP BY kind").fetchall())
    rows = db.execute("SELECT tags, source_id, provenance FROM artifacts").fetchall()
    by_tag: dict[str, int] = {}
    with_provenance = 0
    by_source: dict[str, int] = {}
    for tags_j, source_id, prov_j in rows:
        for t in (json.loads(tags_j) if tags_j else []):
            by_tag[t] = by_tag.get(t, 0) + 1
        if prov_j:
            with_provenance += 1
        src = (source_id or "").split(":", 1)[0] if source_id else "(none)"
        by_source[src] = by_source.get(src, 0) + 1
    total, chunks = _counts(db)
    db.close()
    return {
        "artifacts": total,
        "chunks": chunks,
        "by_kind": by_kind,
        "by_tag": dict(sorted(by_tag.items(), key=lambda kv: -kv[1])),
        "by_source": by_source,
        "with_provenance": with_provenance,
    }


@app.post("/ingest")
def ingest(req: IngestReq) -> dict[str, Any]:
    db = connect()
    # Bridge single ticker <-> symbols[] so old and new callers interoperate.
    symbols = list(req.symbols) if req.symbols else ([req.ticker] if req.ticker else [])
    ticker = req.ticker or (symbols[0] if symbols else None)
    # 覆盖语义:同 source_id(优先) 或 source_path 先删旧 artifact + 其 chunks
    if req.source_id:
        old = db.execute("SELECT id FROM artifacts WHERE source_id=?", (req.source_id,)).fetchall()
    elif req.source_path:
        old = db.execute("SELECT id FROM artifacts WHERE source_path=?", (req.source_path,)).fetchall()
    else:
        old = []
    for (aid,) in old:
        db.execute("DELETE FROM chunks WHERE artifact_id=?", (aid,))
        db.execute("DELETE FROM artifacts WHERE id=?", (aid,))
    cur = db.execute(
        "INSERT INTO artifacts(kind,ticker,title,created_at,source_path,meta,body,"
        "symbols,tags,source_id,provenance) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        (
            req.kind,
            ticker,
            req.title,
            int(time.time()),
            req.source_path,
            json.dumps(req.meta, ensure_ascii=False) if req.meta else None,
            req.body,
            json.dumps(symbols, ensure_ascii=False) if symbols else None,
            json.dumps(req.tags, ensure_ascii=False) if req.tags else None,
            req.source_id,
            json.dumps(req.provenance, ensure_ascii=False) if req.provenance else None,
        ),
    )
    aid = cur.lastrowid
    chunks = chunk_text(req.body)
    vecs = embed_many(chunks)
    for i, (txt, v) in enumerate(zip(chunks, vecs)):
        db.execute(
            "INSERT INTO chunks(embedding,artifact_id,chunk_idx,text) VALUES(?,?,?,?)",
            (v.tobytes(), aid, i, txt),
        )
    db.commit()
    db.close()
    return {"artifact_id": aid, "chunks": len(chunks)}


# 时效衰减:旧研究温和降权(呼应"研究带 as_of、过期降权")。
# effective = cosine_sim * weight, weight = FLOOR + (1-FLOOR)*0.5**(age/HALFLIFE)
# fresh→1.0 · 半衰期 180d→0.85 · 1yr→0.78 · 很旧→FLOOR。不抹杀旧的,只让新的优先。
RECENCY_HALFLIFE_DAYS = 180.0
RECENCY_FLOOR = 0.7


def recency_weight(created_at: int, now: float) -> float:
    age_days = max(0.0, (now - created_at) / 86400.0)
    return RECENCY_FLOOR + (1.0 - RECENCY_FLOOR) * (0.5 ** (age_days / RECENCY_HALFLIFE_DAYS))


@app.post("/search")
def search(req: SearchReq) -> dict[str, Any]:
    db = connect()
    qv = embed_one(req.query).tobytes()
    # 取较多 chunk 再按 artifact 去重(同一报告多 chunk 命中算一条,取最佳)
    rows = db.execute(
        "SELECT artifact_id, chunk_idx, text, distance FROM chunks "
        "WHERE embedding MATCH ? ORDER BY distance LIMIT ?",
        (qv, max(req.limit * 4, 24)),
    ).fetchall()
    best: dict[int, tuple[float, str]] = {}
    for aid, _idx, text, dist in rows:
        if aid not in best or dist < best[aid][0]:
            best[aid] = (dist, text)
    now = time.time()
    scored = []
    for aid, (dist, snippet) in best.items():
        meta = db.execute(
            "SELECT kind,ticker,title,created_at,source_path,symbols,tags,source_id,provenance "
            "FROM artifacts WHERE id=?",
            (aid,),
        ).fetchone()
        if not meta:
            continue
        kind, ticker, title, created_at, source_path, symbols_j, tags_j, source_id, prov_j = meta
        symbols = json.loads(symbols_j) if symbols_j else ([ticker] if ticker else [])
        tags = json.loads(tags_j) if tags_j else []
        if req.kind and kind != req.kind:
            continue
        if req.ticker and (ticker or "").upper() != req.ticker.upper():
            continue
        if req.symbol and req.symbol.upper() not in {s.upper() for s in symbols}:
            continue
        if req.tag and req.tag.lower() not in {t.lower() for t in tags}:
            continue
        cosine = max(0.0, 1.0 - float(dist))  # 钳到非负(near-orthogonal 可 >1 距离)
        effective = cosine * recency_weight(created_at, now)
        scored.append(
            {
                "artifact_id": aid,
                "kind": kind,
                "ticker": ticker,
                "symbols": symbols,
                "tags": tags,
                "title": title,
                "created_at": created_at,
                "source_path": source_path,
                "source_id": source_id,
                "provenance": json.loads(prov_j) if prov_j else None,
                "score": round(effective, 4),  # cosine × 时效权重(排序与 minScore 用)
                "snippet": snippet[:400],
            }
        )
    # 按时效加权分排序,取前 limit
    scored.sort(key=lambda r: r["score"], reverse=True)
    db.close()
    return {"results": scored[: req.limit]}


if __name__ == "__main__":
    init_db()
    import uvicorn

    uvicorn.run(app, host=HOST, port=PORT, log_level="warning")
