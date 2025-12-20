"""
Type definitions for revenue dashboard calculations.

This module provides TypedDict definitions for type-safe receipt item extraction
and dashboard calculations, improving maintainability and bug prevention.
"""
from typing import TypedDict, Optional, Literal
from datetime import date
from decimal import Decimal


class ReceiptItem(TypedDict):
    """
    Typed representation of a receipt item extracted from receipt_data.
    
    Required fields are those that should always be present after extraction.
    Optional fields handle edge cases (missing data, malformed receipts).
    """
    # Item identification (required)
    item_type: Literal["service_item", "other"]
    
    # Financial data (required)
    amount: Decimal  # Unit amount (per item)
    revenue_share: Decimal  # Unit revenue share (per item)
    quantity: int  # Quantity of items (default: 1)
    
    # Metadata (required)
    receipt_id: int
    receipt_number: str
    visit_date: date  # Extracted from receipt visit_date
    patient_name: str
    display_order: int
    
    # Optional fields
    service_item_id: Optional[int]  # Present if item_type == "service_item"
    service_item_name: Optional[str]  # Service item name (historical name from receipt snapshot)
    receipt_name: Optional[str]  # Receipt display name (receipt_name or name from receipt snapshot)
    item_name: Optional[str]  # Present if item_type == "other"
    practitioner_id: Optional[int]  # None if no practitioner assigned
    practitioner_name: Optional[str]  # Practitioner name (for display)
    billing_scenario_id: Optional[int]  # None for "other" type items
    billing_scenario_name: Optional[str]  # Billing scenario name (e.g., "其他" for overwritten)
    patient_id: Optional[int]


class DashboardFilters(TypedDict, total=False):
    """
    Filter criteria for dashboard calculations.
    
    Required fields are clinic_id, start_date, and end_date.
    Other fields are optional - missing fields mean "no filter".
    """
    clinic_id: int
    start_date: date
    end_date: date
    practitioner_id: Optional[int]  # None means "no practitioner", int means specific practitioner
    service_item_id: Optional[int]  # None means all items, int means specific service item
    service_item_custom_name: Optional[str]  # For custom items (item_type == "other")
    service_type_group_id: Optional[int]  # None means all groups, int means specific group, -1 means ungrouped
    show_overwritten_only: bool  # For revenue distribution only


class SummaryMetrics(TypedDict):
    """Summary metrics for business insights."""
    total_revenue: Decimal
    valid_receipt_count: int
    service_item_count: int
    active_patients: int
    average_transaction_amount: Decimal
    total_clinic_share: Decimal
    receipt_item_count: int


class TrendDataPoint(TypedDict):
    """Single data point in a revenue trend."""
    date: str  # ISO format date string
    revenue: Decimal
    receipt_count: int


class ServiceItemBreakdown(TypedDict):
    """Breakdown by service item."""
    service_item_id: Optional[int]  # None for custom items
    service_item_name: str  # Historical name from receipt snapshot
    receipt_name: str  # Receipt display name (receipt_name or name from receipt snapshot)
    total_revenue: Decimal
    receipt_count: int
    item_count: int  # Total quantity of items


class PractitionerBreakdown(TypedDict):
    """Breakdown by practitioner."""
    practitioner_id: Optional[int]  # None for "無治療師"
    practitioner_name: str
    total_revenue: Decimal
    receipt_count: int
    item_count: int  # Total quantity of items


class GroupBreakdown(TypedDict):
    """Breakdown by service type group."""
    service_type_group_id: Optional[int]  # None for "未分類" (ungrouped)
    group_name: str
    total_revenue: Decimal
    receipt_count: int
    item_count: int  # Total quantity of items


class RevenueDistributionItem(TypedDict):
    """Single item in revenue distribution table."""
    receipt_id: int
    receipt_number: str
    visit_date: str  # ISO format date string
    patient_name: str
    appointment_id: int
    service_item_id: Optional[int]
    service_item_name: str
    practitioner_id: Optional[int]
    practitioner_name: str
    amount: Decimal
    revenue_share: Decimal
    quantity: int
    total_amount: Decimal  # amount * quantity
    total_revenue_share: Decimal  # revenue_share * quantity
    is_overwritten: bool  # True if receipt was voided and replaced


# Type alias for granularity
Granularity = Literal["daily", "weekly", "monthly"]

