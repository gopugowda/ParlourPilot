"""Shared helpers used by every /reports/* sub-router.

Keeping preset resolution and bill aggregation here guarantees that all
endpoints (range, analytics, revenue-by-gender, staff-performance) honour
the same date semantics and payment-split logic.
"""
from datetime import datetime, timezone, timedelta
from typing import Optional, List
from fastapi import HTTPException


def preset_range(preset: Optional[str], from_date: Optional[str], to_date: Optional[str]):
    """Resolve a preset name (or explicit YYYY-MM-DD dates) into a (d_from, d_to) tuple.

    Supported presets: today, yesterday, week, last_week, month, last_month,
    quarter, year, custom (falls back to from_date/to_date).
    """
    today = datetime.now(timezone.utc).date()
    if preset == "today":
        d_from = d_to = today
    elif preset == "yesterday":
        d_from = d_to = today - timedelta(days=1)
    elif preset == "week":
        d_from = today - timedelta(days=6); d_to = today
    elif preset == "last_week":
        # Monday-based last calendar week
        this_mon = today - timedelta(days=today.weekday())
        d_from = this_mon - timedelta(days=7)
        d_to = this_mon - timedelta(days=1)
    elif preset == "month":
        d_from = today.replace(day=1); d_to = today
    elif preset == "last_month":
        first_this = today.replace(day=1)
        last_prev = first_this - timedelta(days=1)
        d_from = last_prev.replace(day=1); d_to = last_prev
    elif preset == "quarter":
        q = (today.month - 1) // 3
        d_from = today.replace(month=q * 3 + 1, day=1); d_to = today
    elif preset == "year":
        d_from = today.replace(month=1, day=1); d_to = today
    else:
        try:
            d_from = datetime.strptime(from_date, "%Y-%m-%d").date() if from_date else today
            d_to = datetime.strptime(to_date, "%Y-%m-%d").date() if to_date else today
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid date format (use YYYY-MM-DD)")
    if d_from > d_to:
        d_from, d_to = d_to, d_from
    return d_from, d_to


def clamp_for_staff(scope, d_from, d_to):
    """Restrict a range to today..yesterday when the caller is a `staff` role."""
    today = datetime.now(timezone.utc).date()
    if scope.user.get("role") == "staff":
        earliest = today - timedelta(days=1)
        if d_from < earliest: d_from = earliest
        if d_to < earliest: d_to = earliest
    return d_from, d_to


def aggregate_bills_metrics(bills: List[dict]) -> dict:
    """Aggregate per-bill metrics used by /reports/analytics + its comparisons.

    Returns:
        Dict with `total_sales, net_sales, total_discount, total_tax,
        total_tips, cash, upi, card, invoices, services, customer_phones` (set).
    """
    total_sales = 0.0    # gross (pre-discount)
    net_sales = 0.0      # post-discount (services_net)
    total_discount = 0.0
    total_tax = 0.0
    total_tips = 0.0
    cash_total = 0.0
    upi_total = 0.0
    card_total = 0.0
    invoice_count = 0
    services_count = 0
    customer_phones: set = set()
    for b in bills:
        invoice_count += 1
        for it in (b.get("items") or []):
            services_count += 1
            price = float(it.get("price") or 0)
            eff_disc = float(it.get("effective_discount_pct") or it.get("discount_pct") or 0) / 100.0
            tax_pct = float(it.get("tax_percentage") or 0) / 100.0
            line_gross = price
            line_disc = line_gross * eff_disc
            line_net = line_gross - line_disc
            line_tax = line_net * tax_pct
            total_sales += line_gross
            total_discount += line_disc
            total_tax += line_tax
        net = float(b.get("services_net", b.get("grand_total", 0) - b.get("tip_amount", 0)) or 0)
        net_sales += net
        total_tips += float(b.get("tip_amount") or 0)
        # Version-aware payment split (cash/upi/card)
        cash_raw = float(b.get("cash_amount") or 0)
        qr_raw = float(b.get("qr_amount") or 0)
        card_raw = float(b.get("card_amount") or 0)
        if b.get("split_v2"):
            tips_owed = float(b.get("tip_owed_total") or 0)
            cash_total += max(0.0, cash_raw - tips_owed)
            upi_total += qr_raw
            card_total += card_raw
        else:
            tip_qr = float(b.get("tip_qr_total") or 0)
            if not tip_qr and b.get("tip_via") == "qr":
                tip_qr = float(b.get("tip_amount") or 0)
            cash_total += max(0.0, cash_raw - tip_qr)
            upi_total += qr_raw + tip_qr
            card_total += card_raw
        phone = (b.get("customer_phone") or "").strip()
        if phone:
            customer_phones.add(phone)
    return {
        "total_sales": round(total_sales, 2),
        "net_sales": round(net_sales, 2),
        "total_discount": round(total_discount, 2),
        "total_tax": round(total_tax, 2),
        "total_tips": round(total_tips, 2),
        "cash": round(cash_total, 2),
        "upi": round(upi_total, 2),
        "card": round(card_total, 2),
        "invoices": invoice_count,
        "services": services_count,
        "customer_phones": customer_phones,
    }
