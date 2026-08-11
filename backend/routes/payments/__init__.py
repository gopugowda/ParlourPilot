"""Razorpay payments package. Splits the original 623-line payments.py into
focused sub-modules by concern (config, branch, tenant, hosted checkout page, webhook)."""
from fastapi import APIRouter
from .config import router as _config_router
from .branch import router as _branch_router
from .tenant import router as _tenant_router
from .hosted import router as _hosted_router
from .webhook import router as _webhook_router

router = APIRouter()
for r in (_config_router, _branch_router, _tenant_router, _hosted_router, _webhook_router):
    router.include_router(r)
