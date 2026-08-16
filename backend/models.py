"""Pydantic request/response models used across route modules."""
from pydantic import BaseModel, EmailStr
from typing import List, Optional, Literal


class TenantSignup(BaseModel):
    business_name: str
    owner_name: str
    email: EmailStr
    password: str
    phone: Optional[str] = ""
    city: Optional[str] = ""
    country: Optional[str] = "India"
    num_branches: Optional[int] = 1
    branch_names: Optional[List[str]] = None


class BranchIn(BaseModel):
    name: str
    address: Optional[str] = ""
    city: Optional[str] = ""
    state: Optional[str] = ""
    country: Optional[str] = "India"
    postal_code: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    logo: Optional[str] = None
    tax_enabled: Optional[bool] = False
    tax_number: Optional[str] = ""
    tax_percentage: Optional[float] = 0.0
    invoice_prefix: Optional[str] = ""
    receipt_header: Optional[str] = ""
    receipt_footer: Optional[str] = ""
    is_head: Optional[bool] = False
    parent_branch_id: Optional[str] = None
    active: Optional[bool] = True


class TenantUpdate(BaseModel):
    business_name: Optional[str] = None
    logo: Optional[str] = None
    owner_name: Optional[str] = None
    email: Optional[EmailStr] = None
    phone: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    postal_code: Optional[str] = None
    currency: Optional[str] = None
    currency_symbol: Optional[str] = None
    brand_color: Optional[str] = None
    timezone: Optional[str] = None
    tax_enabled: Optional[bool] = None
    tax_number: Optional[str] = None
    tax_percentage: Optional[float] = None
    invoice_prefix: Optional[str] = None
    receipt_header: Optional[str] = None
    receipt_footer: Optional[str] = None
    website: Optional[str] = None
    member_discount_pct: Optional[float] = None
    member_min_price: Optional[float] = None
    member_tiers: Optional[list] = None


class UserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["admin", "owner", "staff"] = "staff"
    branch_id: Optional[str] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    email: Optional[EmailStr] = None
    role: Optional[Literal["admin", "owner", "staff"]] = None
    branch_id: Optional[str] = None
    is_active: Optional[bool] = None


class PasswordReset(BaseModel):
    new_password: str


class ForgotPasswordReq(BaseModel):
    email: EmailStr


class ResetPasswordReq(BaseModel):
    # Legacy: token-based reset (still supported for backward compatibility)
    token: Optional[str] = None
    # New: OTP-based reset via email
    email: Optional[EmailStr] = None
    otp: Optional[str] = None
    new_password: str


class LoginReq(BaseModel):
    email: EmailStr
    password: str


class BeauticianIn(BaseModel):
    name: str
    role: Optional[str] = "Stylist"
    phone: Optional[str] = ""
    active: bool = True


class ServiceIn(BaseModel):
    name: str
    price: float
    additional_price: Optional[float] = 0
    gender: Optional[Literal["ladies", "men", "unisex"]] = "unisex"
    category: Optional[str] = "General"
    tax_percentage: Optional[float] = 0
    active: bool = True


class BillItem(BaseModel):
    service_id: Optional[str] = None
    service_name: str
    service_gender: Optional[Literal["ladies", "men", "unisex"]] = None
    price: float
    discount_pct: float = 0
    tax_percentage: float = 0
    beautician_id: Optional[str] = None
    beautician_name: str
    tip_amount: float = 0
    tip_via: Optional[Literal["cash", "qr", "card"]] = None


class BillCreate(BaseModel):
    customer_name: Optional[str] = ""
    customer_phone: Optional[str] = ""
    items: List[BillItem]
    payment_mode: Literal["cash", "qr", "card", "split"]
    cash_amount: float = 0
    qr_amount: float = 0
    card_amount: float = 0
    is_member: bool = False
    tip_amount: float = 0
    tip_via: Optional[Literal["cash", "qr", "card"]] = None
    tip_beautician_id: Optional[str] = None
    tip_beautician_name: Optional[str] = ""
    notes: Optional[str] = ""


class MemberIn(BaseModel):
    name: str
    phone: str
    joined_at: Optional[str] = None
    expires_at: Optional[str] = None
    discount_pct: Optional[float] = None
    tier_id: Optional[str] = None
    notes: Optional[str] = ""
    active: bool = True


class ExpenseIn(BaseModel):
    category: str = "Other"
    description: str
    amount: float
    date: Optional[str] = None
    payment_mode: Optional[Literal["cash", "upi", "card", "bank", "other"]] = "cash"
    notes: Optional[str] = ""


class StockItemIn(BaseModel):
    name: str
    unit: str = "piece"
    current_qty: float = 0
    min_qty: float = 0
    unit_cost: float = 0
    notes: Optional[str] = ""


class StockMovementIn(BaseModel):
    item_id: str
    type: Literal["purchase", "use", "adjust"]
    qty: float
    unit_cost: Optional[float] = None
    notes: Optional[str] = ""


class CashClosingIn(BaseModel):
    date: Optional[str] = None
    opening_balance: float = 0
    cash_expenses: float = 0
    actual_closing: float = 0
    notes: Optional[str] = ""


# ==== Payment models ====
class BranchCheckoutBody(BaseModel):
    plan: Literal["monthly", "yearly"]
    branch: BranchIn
    display_amount: Optional[float] = None
    display_currency: Optional[str] = None


class TenantCheckoutBody(BaseModel):
    plan: Literal["monthly", "yearly"]
    display_amount: Optional[float] = None
    display_currency: Optional[str] = None


class VerifyPaymentBody(BaseModel):
    razorpay_payment_id: str
    razorpay_order_id: str
    razorpay_signature: str


# ==== Appointments ====
class AppointmentIn(BaseModel):
    customer_name: str
    customer_phone: Optional[str] = ""
    member_id: Optional[str] = None
    beautician_id: Optional[str] = None
    beautician_name: Optional[str] = ""
    service_ids: Optional[List[str]] = []
    service_names: Optional[List[str]] = []
    scheduled_start: str  # ISO datetime
    duration_minutes: Optional[int] = 60
    status: Optional[Literal["booked", "in_progress", "completed", "canceled", "no_show"]] = "booked"
    notes: Optional[str] = ""
    price_estimate: Optional[float] = 0


# ==== Platform ====
class PlatformSubscriptionUpdate(BaseModel):
    extend_days: Optional[int] = None
    subscription_status: Optional[Literal["trialing", "active", "expired", "suspended", "cancelled"]] = None
    subscription_plan: Optional[str] = None
    is_active: Optional[bool] = None


class PlatformUserCreate(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: Literal["platform_admin", "platform_staff"] = "platform_staff"


class PlatformUserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[Literal["platform_admin", "platform_staff"]] = None
    is_active: Optional[bool] = None
