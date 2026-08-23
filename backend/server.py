"""
ParlourPilot - Multi-Tenant Salon Management SaaS
Backend API (FastAPI + MongoDB) — modular router entrypoint.

Every tenant-owned collection is scoped by `tenant_id`. All authenticated
requests derive the tenant from the JWT — never from the request body.

Route modules live under /app/backend/routes/*.py — this file only wires them.
"""
from fastapi import FastAPI, APIRouter
from starlette.middleware.cors import CORSMiddleware

from core import logger, client  # noqa: F401
from startup import run_startup

# Route modules
from routes.tenants import router as tenants_router
from routes.branches_crud import router as branches_router
from routes.payments import router as payments_router
from routes.appointments import router as appointments_router
from routes.plans import router as plans_router
from routes.auth import router as auth_router
from routes.beauticians import router as beauticians_router
from routes.services import router as services_router
from routes.bills import router as bills_router
from routes.members import router as members_router
from routes.expenses import router as expenses_router
from routes.stock import router as stock_router
from routes.cash_closing import router as cash_closing_router
from routes.reports import router as reports_router
from routes.platform import router as platform_router
from routes.misc import router as misc_router
from routes.billing import router as billing_router
from routes.team import router as team_router
from routes.attendance import router as attendance_router

app = FastAPI(title="ParlourPilot SaaS API")

# Single /api prefix wrapper — all sub-routers register here
api_router = APIRouter(prefix="/api")
for r in (
    tenants_router, branches_router, payments_router, appointments_router,
    plans_router, auth_router, beauticians_router, services_router,
    bills_router, members_router, expenses_router, stock_router,
    cash_closing_router, reports_router, platform_router, misc_router,
    billing_router, team_router, attendance_router,
):
    api_router.include_router(r)

app.include_router(api_router)


# Root health endpoint — silences Kubernetes probe 404s and gives a friendly response
# when someone hits the backend URL directly. Nginx routes `/api/*` to us and `/` to
# the frontend, but health probes can bypass Nginx and hit the pod directly.
@app.get("/", include_in_schema=False)
async def root_health():
    return {"ok": True, "service": "parlourpilot-api", "docs": "/docs"}


# Simple, unauthenticated health endpoint.
# `/health` is reachable direct-to-pod (K8s liveness/readiness probes),
# and `/api/health` is reachable through the Nginx ingress from the public URL.
@app.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok"}


@app.get("/api/health", include_in_schema=False)
async def api_health():
    return {"status": "ok"}


app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def _startup():
    await run_startup()


@app.on_event("shutdown")
async def _shutdown():
    client.close()
