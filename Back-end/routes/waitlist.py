from __future__ import annotations

import csv
import io
import os
from typing import Any

from fastapi import APIRouter, Request, Query
from fastapi.responses import JSONResponse, StreamingResponse

try:
    from ..waitlist_service import (
        validate_name,
        validate_email,
        validate_phone,
        hash_ip,
        is_rate_limited,
        log_rate_limit,
        add_lead,
        add_feedback,
        get_all_leads,
    )
except ImportError:
    from waitlist_service import (
        validate_name,
        validate_email,
        validate_phone,
        hash_ip,
        is_rate_limited,
        log_rate_limit,
        add_lead,
        add_feedback,
        get_all_leads,
    )


router = APIRouter(prefix="/api", tags=["waitlist"])


def _client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "")
    if forwarded:
        return forwarded.split(",")[0].strip()
    return request.client.host if request.client else "unknown"


async def _safe_json(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


@router.post("/waitlist")
async def post_waitlist(request: Request):
    data = await _safe_json(request)

    # Honeypot fields: accept silently so bots do not learn the rule.
    if data.get("honeypot") or data.get("company"):
        return JSONResponse({"success": True, "lead_id": "bot"})

    if not data.get("consent"):
        return JSONResponse(
            {"success": False, "error": "Consent required"},
            status_code=400,
        )

    email = str(data.get("email") or "").strip()
    name = str(data.get("name") or "").strip()
    phone = str(data.get("phone") or "").strip()

    errors: dict[str, str] = {}

    if not validate_email(email):
        errors["email"] = "Invalid email"

    if name and not validate_name(name):
        errors["name"] = "Name must be 2–120 characters"

    if phone and not validate_phone(phone):
        errors["phone"] = "Invalid phone"

    if errors:
        return JSONResponse(
            {"success": False, "error": "Validation failed", "errors": errors},
            status_code=400,
        )

    ip_hash = hash_ip(_client_ip(request))
    if is_rate_limited(ip_hash):
        return JSONResponse(
            {"success": False, "error": "Too many requests"},
            status_code=429,
        )

    log_rate_limit(ip_hash)

    result = add_lead(
        {
            **data,
            "email": email,
            "name": name,
            "phone": phone,
            "ip_hash": ip_hash,
        }
    )

    return JSONResponse(
        {
            "success": True,
            "lead_id": result["lead_id"],
            "existing": result["existing"],
        }
    )


@router.post("/waitlist/feedback")
async def post_waitlist_feedback(request: Request):
    data = await _safe_json(request)
    ok = add_feedback(data)
    if not ok:
        return JSONResponse(
            {"success": False, "error": "Lead not found"},
            status_code=404,
        )
    return JSONResponse({"success": True})


@router.get("/admin/waitlist/export")
async def admin_export_waitlist(
    request: Request,
    token: str = Query(default=""),
    format: str = Query(default="json"),
    from_: str = Query(default="2000-01-01", alias="from"),
    to: str = Query(default="2099-01-01"),
):
    expected = os.environ.get("ADMIN_EXPORT_TOKEN", "")
    header_token = request.headers.get("x-admin-token", "")

    if not expected or (token != expected and header_token != expected):
        return JSONResponse({"error": "Unauthorized"}, status_code=401)

    leads = get_all_leads(from_, to)

    if format == "csv":
        fieldnames = [
            "id",
            "name",
            "email",
            "phone",
            "status",
            "utm_source",
            "utm_medium",
            "utm_campaign",
            "referrer",
            "created_at",
            "top_needs",
            "delivery_preference",
            "price_expectation",
            "free_text",
        ]
        buffer = io.StringIO()
        writer = csv.DictWriter(buffer, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(leads)
        return StreamingResponse(
            io.BytesIO(buffer.getvalue().encode()),
            media_type="text/csv",
            headers={
                "Content-Disposition": "attachment; filename=waitlist_export.csv"
            },
        )

    return JSONResponse({"success": True, "count": len(leads), "leads": leads})