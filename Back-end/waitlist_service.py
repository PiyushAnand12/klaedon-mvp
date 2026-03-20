# backend/waitlist_service.py

import hashlib
import json
import logging
import os
import re
import sqlite3
from contextlib import closing
from datetime import datetime, timedelta
from typing import Any

DB_PATH = os.environ.get("DB_PATH", "waitlist_history.db")
logger = logging.getLogger(__name__)


def get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


# ── Validation ────────────────────────────────────────────────────────────
EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")
PHONE_RE = re.compile(r"^(\+91)?[6-9]\d{9}$")


def validate_email(v: str) -> bool:
    return isinstance(v, str) and bool(EMAIL_RE.match(v.strip()))


def validate_phone(v: str) -> bool:
    if not isinstance(v, str):
        return False
    cleaned = re.sub(r"[\s\-()]", "", v.strip())
    if not cleaned:
        return True  # optional during validation phase
    return bool(PHONE_RE.match(cleaned))


def validate_name(v: str) -> bool:
    if not isinstance(v, str):
        return False
    trimmed = v.strip()
    if not trimmed:
        return True  # optional during validation phase
    return 2 <= len(trimmed) <= 120


# ── IP Hashing ────────────────────────────────────────────────────────────
def hash_ip(ip: str) -> str:
    salt = (
        os.environ.get("IP_HASH_SALT")
        or os.environ.get("SECRET_KEY")
        or "dev-only-ip-hash-salt"
    )
    if salt == "dev-only-ip-hash-salt":
        logger.warning("IP_HASH_SALT is not set; using a development fallback salt.")
    return hashlib.sha256(f"{ip}{salt}".encode()).hexdigest()[:24]


# ── Rate Limiting ─────────────────────────────────────────────────────────
RATE_LIMIT_MAX = 5
RATE_LIMIT_MINUTES = 10
SQLITE_TS_FORMAT = "%Y-%m-%d %H:%M:%S"


def _sqlite_utc_now() -> str:
    return datetime.utcnow().strftime(SQLITE_TS_FORMAT)


def _sqlite_cutoff(minutes: int) -> str:
    return (datetime.utcnow() - timedelta(minutes=minutes)).strftime(SQLITE_TS_FORMAT)


def is_rate_limited(ip_hash: str) -> bool:
    cutoff = _sqlite_cutoff(RATE_LIMIT_MINUTES)
    try:
        with closing(get_conn()) as conn:
            row = conn.execute(
                "SELECT COUNT(*) as cnt FROM waitlist_rate_limits WHERE ip_hash=? AND created_at>=?",
                (ip_hash, cutoff),
            ).fetchone()
            count = row["cnt"] if row else 0
            return count >= RATE_LIMIT_MAX
    except Exception:
        logger.exception("Rate limit check failed for ip_hash=%s", ip_hash)
        return False  # fail open, but do not fail silently


def log_rate_limit(ip_hash: str) -> None:
    try:
        with closing(get_conn()) as conn:
            conn.execute(
                "INSERT INTO waitlist_rate_limits (ip_hash, created_at) VALUES (?, ?)",
                (ip_hash, _sqlite_utc_now()),
            )
            conn.commit()
    except Exception:
        logger.exception("Rate limit log write failed for ip_hash=%s", ip_hash)


# ── Main waitlist operations ──────────────────────────────────────────────
def add_lead(data: dict[str, Any]) -> dict[str, Any]:
    """
    Insert a new waitlist lead or return existing one.
    Returns: { "lead_id": str, "existing": bool }
    """
    name = str(data.get("name") or "").strip()[:120]
    email = str(data.get("email") or "").strip().lower()
    phone = str(data.get("phone") or "").strip()

    name_db = name or None
    phone_db = phone or None

    import uuid

    with closing(get_conn()) as conn:
        existing = conn.execute(
            "SELECT id, name, phone FROM waitlist_leads WHERE LOWER(email)=?",
            (email,),
        ).fetchone()

        if existing:
            lead_id = existing["id"]
            updates = {}

            if not existing["name"] and name_db:
                updates["name"] = name_db
            if not existing["phone"] and phone_db:
                updates["phone"] = phone_db

            if updates:
                sets = ", ".join(f"{k}=?" for k in updates)
                conn.execute(
                    f"UPDATE waitlist_leads SET {sets}, updated_at=CURRENT_TIMESTAMP WHERE id=?",
                    (*updates.values(), lead_id),
                )
                conn.commit()

            return {"lead_id": lead_id, "existing": True}

        lead_id = str(uuid.uuid4())
        conn.execute(
            """INSERT INTO waitlist_leads
               (id, name, email, phone, consent,
                utm_source, utm_medium, utm_campaign, utm_term, utm_content,
                referrer, ip_hash, status)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,'new')""",
            (
                lead_id,
                name_db,
                email,
                phone_db,
                1 if data.get("consent") else 0,
                data.get("utm_source") or None,
                data.get("utm_medium") or None,
                data.get("utm_campaign") or None,
                data.get("utm_term") or None,
                data.get("utm_content") or None,
                data.get("referrer") or None,
                data.get("ip_hash") or None,
            ),
        )
        conn.commit()
        return {"lead_id": lead_id, "existing": False}


VALID_NEEDS = {
    "daily_stock_list",
    "entry_exit_levels",
    "risk_position_sizing",
    "market_breadth_regime",
    "alerts_email_telegram",
    "other",
}
VALID_DELIVERY = {"email", "telegram", "whatsapp"}
VALID_PRICE = {"0-199", "200-499", "500-999", "1000+"}


def add_feedback(data: dict[str, Any]) -> bool:
    """
    Store feedback linked to a lead.
    Returns True on success, False if lead not found.
    """
    lead_id = str(data.get("lead_id") or "").strip()
    if not lead_id:
        return False

    raw_top_needs = data.get("top_needs") or []
    if not isinstance(raw_top_needs, list):
        raw_top_needs = []
    top_needs = [n for n in raw_top_needs if n in VALID_NEEDS][:10]

    delivery = str(data.get("delivery_preference") or "")
    if delivery not in VALID_DELIVERY:
        delivery = ""

    price = str(data.get("price_expectation") or "")
    if price not in VALID_PRICE:
        price = ""

    free_text = str(data.get("free_text") or "")[:500]

    import uuid

    with closing(get_conn()) as conn:
        lead = conn.execute(
            "SELECT id FROM waitlist_leads WHERE id=?", (lead_id,)
        ).fetchone()
        if not lead:
            return False

        conn.execute(
            """INSERT INTO waitlist_feedback
               (id, lead_id, top_needs, delivery_preference, price_expectation, free_text)
               VALUES (?,?,?,?,?,?)""",
            (
                str(uuid.uuid4()),
                lead_id,
                json.dumps(top_needs),
                delivery,
                price,
                free_text or None,
            ),
        )
        conn.commit()
        return True


def get_all_leads(
    from_dt: str = "2000-01-01",
    to_dt: str = "2099-01-01",
) -> list[dict[str, Any]]:
    start = f"{from_dt} 00:00:00"
    end = f"{to_dt} 23:59:59"

    query = """
        SELECT l.id, l.name, l.email, l.phone, l.status,
               l.utm_source, l.utm_medium, l.utm_campaign,
               l.referrer, l.created_at,
               f.top_needs, f.delivery_preference, f.price_expectation, f.free_text
        FROM waitlist_leads l
        LEFT JOIN waitlist_feedback f
          ON f.rowid = (
              SELECT MAX(wf.rowid)
              FROM waitlist_feedback wf
              WHERE wf.lead_id = l.id
          )
        WHERE l.created_at >= ? AND l.created_at <= ?
        ORDER BY l.created_at DESC
    """

    with closing(get_conn()) as conn:
        leads = conn.execute(query, (start, end)).fetchall()
        return [dict(r) for r in leads]