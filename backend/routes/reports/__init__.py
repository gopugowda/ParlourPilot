"""Reports package — one FastAPI router per concern.

Sub-modules:
    * summary   → /reports/summary, /reports/daily     (legacy dashboard)
    * range     → /reports/range                       (preset+custom daily rollup)
    * analytics → /reports/analytics                   (web-parity KPI payload)
    * gender    → /reports/revenue-by-gender           (Ladies/Men/Unisex split)
    * staff     → /reports/staff-performance           (owner-only staff dashboard)

`server.py` imports this package as before: ``from routes.reports import router``.
Shared helpers live in `_shared.py`.
"""
from fastapi import APIRouter

from .summary import router as _summary
from .range import router as _range
from .analytics import router as _analytics
from .gender import router as _gender
from .staff import router as _staff

router = APIRouter()
router.include_router(_summary)
router.include_router(_range)
router.include_router(_analytics)
router.include_router(_gender)
router.include_router(_staff)

__all__ = ["router"]
