"""Payments: non-secret config endpoint used by the client to bootstrap the checkout modal."""
from fastapi import APIRouter, Depends
from core import get_current_user, razorpay_enabled, RAZORPAY_KEY_ID

router = APIRouter()


@router.get("/payments/config")
async def payments_config(user=Depends(get_current_user)):
    """Return non-secret Razorpay config so the client can open Checkout."""
    return {
        "enabled": razorpay_enabled(),
        "key_id": RAZORPAY_KEY_ID if razorpay_enabled() else "",
        "provider": "razorpay",
        "currency": "INR",
    }
