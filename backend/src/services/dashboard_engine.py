"""
Calculation engine for dashboard calculations.

Orchestrates all calculations using the extractor, filters, and calculators.
"""
from typing import List, Dict, Any
from datetime import date, timedelta
from decimal import Decimal
import logging
import os

from core.config import ENVIRONMENT
from models.receipt import Receipt
from services.dashboard_types import (
    ReceiptItem,
    DashboardFilters,
    Granularity,
    SummaryMetrics
)
from services.dashboard_extractor import ReceiptItemExtractor
from services.dashboard_filters import FilterApplicator
from services.dashboard_calculators import (
    SummaryMetricsCalculator,
    RevenueTrendCalculator,
    ServiceItemBreakdownCalculator,
    PractitionerBreakdownCalculator
)

logger = logging.getLogger(__name__)

# Constants for validation and calculations
CALCULATION_TOLERANCE = Decimal('0.01')  # Tolerance for revenue calculations (1 cent)
PERCENTAGE_ROUNDING_TOLERANCE = 1  # Allow 1% rounding tolerance for percentage sums


class CalculationValidationError(Exception):
    """Exception raised when calculation validation fails."""
    pass


class BusinessInsightsEngine:
    """
    Orchestrates business insights calculations.
    
    This engine coordinates:
    1. Item extraction from receipts
    2. Filter application
    3. Metric calculation
    4. Result validation
    """
    
    def __init__(self):
        self.extractor = ReceiptItemExtractor()
        self.filter_applicator = FilterApplicator()
        self.summary_calculator = SummaryMetricsCalculator()
        self.trend_calculator = RevenueTrendCalculator()
        self.service_item_calculator = ServiceItemBreakdownCalculator()
        self.practitioner_calculator = PractitionerBreakdownCalculator()
    
    def compute(
        self,
        receipts: List[Receipt],
        filters: DashboardFilters
    ) -> Dict[str, Any]:
        """
        Compute all business insights.
        
        Args:
            receipts: List of Receipt entities (already filtered by clinic_id and is_voided)
            filters: Filter criteria
            
        Returns:
            Dictionary with summary, revenue_trend, by_service, and by_practitioner
        """
        # Extract items from receipts (filters by visit_date)
        start_date = filters.get('start_date')
        end_date = filters.get('end_date')
        if not start_date or not end_date:
            raise ValueError("start_date and end_date are required in filters")
        
        items = self.extractor.extract_items(
            receipts,
            start_date,
            end_date
        )
        
        logger.debug(f"Extracted {len(items)} items before applying filters")
        
        # Apply filters (practitioner, service item)
        filtered_items = self.filter_applicator.apply_filters(items, filters)
        
        logger.debug(f"After applying filters: {len(filtered_items)} items")
        
        # Calculate summary metrics
        summary = self.summary_calculator.calculate(filtered_items, filters)
        
        # Determine granularity for trend
        date_range_days = (end_date - start_date).days + 1
        granularity: Granularity
        if date_range_days <= 31:
            granularity = "daily"  # type: ignore
        elif date_range_days <= 130:  # Updated threshold from 90 to 130
            granularity = "weekly"  # type: ignore
        else:
            granularity = "monthly"  # type: ignore
        
        # Calculate revenue trend with breakdowns
        revenue_trend = self._calculate_revenue_trend_with_breakdowns(
            filtered_items,
            filters,
            granularity
        )
        
        # Calculate breakdowns
        by_service = self.service_item_calculator.calculate(filtered_items, filters)
        by_practitioner = self.practitioner_calculator.calculate(filtered_items, filters)
        
        # Add percentages and format breakdowns
        total_revenue = summary['total_revenue']
        formatted_by_service: List[Dict[str, Any]] = []
        for stat in by_service:
            percentage = round(float(stat['total_revenue'] / total_revenue * 100)) if total_revenue > 0 else 0
            formatted_by_service.append({
                'service_item_id': stat['service_item_id'],
                'service_item_name': stat['service_item_name'],
                'receipt_name': stat['receipt_name'],  # Use receipt_name from breakdown
                'is_custom': stat['service_item_id'] is None,
                'total_revenue': float(stat['total_revenue'].quantize(Decimal('0.01'))),
                'item_count': stat['item_count'],
                'percentage': percentage
            })
        
        formatted_by_practitioner: List[Dict[str, Any]] = []
        for stat in by_practitioner:
            percentage = round(float(stat['total_revenue'] / total_revenue * 100)) if total_revenue > 0 else 0
            formatted_by_practitioner.append({
                'practitioner_id': stat['practitioner_id'],
                'practitioner_name': stat['practitioner_name'],
                'total_revenue': float(stat['total_revenue'].quantize(Decimal('0.01'))),
                'item_count': stat['item_count'],
                'percentage': percentage
            })
        
        # Validate results for accounting accuracy
        self._validate_results(
            summary,
            formatted_by_service,
            formatted_by_practitioner,
            filtered_items,
            revenue_trend
        )
        
        # Convert Decimal to float for JSON serialization
        return {
            'summary': {
                'total_revenue': float(summary['total_revenue'].quantize(Decimal('0.01'))),
                'valid_receipt_count': summary['valid_receipt_count'],
                'service_item_count': summary['service_item_count'],
                'active_patients': summary['active_patients'],
                'average_transaction_amount': float(summary['average_transaction_amount'].quantize(Decimal('0.01'))),
                'total_clinic_share': float(summary['total_clinic_share'].quantize(Decimal('0.01'))),
                'receipt_item_count': summary['receipt_item_count']
            },
            'revenue_trend': revenue_trend,
            'by_service': formatted_by_service,
            'by_practitioner': formatted_by_practitioner
        }
    
    def _calculate_revenue_trend_with_breakdowns(
        self,
        items: List[ReceiptItem],
        filters: DashboardFilters,
        granularity: Granularity
    ) -> List[Dict[str, Any]]:
        """
        Calculate revenue trend with breakdowns by service and practitioner.
        
        Ensures all periods from start_date to end_date are included,
        even if there's no data for some periods.
        
        This matches the format expected by the frontend.
        """
        from collections import defaultdict
        
        start_date = filters.get('start_date')
        end_date = filters.get('end_date')
        if not start_date or not end_date:
            raise ValueError("start_date and end_date are required in filters")
        
        # Aggregate by date with breakdowns
        revenue_by_date: Dict[str, Decimal] = defaultdict(Decimal)
        revenue_by_date_service: Dict[str, Dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        revenue_by_date_practitioner: Dict[str, Dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        
        for item in items:
            # Required field - use direct access
            visit_date = item['visit_date']
            if not visit_date:
                continue
            
            # Determine date key based on granularity
            if granularity == "daily":
                date_key = visit_date.isoformat()
            elif granularity == "weekly":
                days_since_monday = visit_date.weekday()
                week_start = visit_date - timedelta(days=days_since_monday)
                date_key = week_start.isoformat()
            else:  # monthly
                month_start = date(visit_date.year, visit_date.month, 1)
                date_key = month_start.isoformat()
            
            # Required fields - use direct access
            amount = item['amount']
            quantity = item['quantity']
            item_total = amount * Decimal(str(quantity))
            revenue_by_date[date_key] += item_total
            
            # Service item breakdown
            item_type = item['item_type']
            if item_type == 'service_item':
                service_item_id = item.get('service_item_id')
                if service_item_id is not None:
                    service_key = str(service_item_id)
                    revenue_by_date_service[date_key][service_key] += item_total
            elif item_type == 'other':
                item_name = item.get('item_name', '')
                if item_name:
                    service_key = f"custom:{item_name}"
                    revenue_by_date_service[date_key][service_key] += item_total
            
            # Practitioner breakdown
            practitioner_id = item.get('practitioner_id')
            practitioner_key = str(practitioner_id) if practitioner_id is not None else 'null'
            revenue_by_date_practitioner[date_key][practitioner_key] += item_total
        
        # Generate all periods from start_date to end_date
        all_periods: List[str] = []
        current_date = start_date
        
        while current_date <= end_date:
            if granularity == "daily":
                period_key = current_date.isoformat()
                current_date += timedelta(days=1)
            elif granularity == "weekly":
                days_since_monday = current_date.weekday()
                week_start = current_date - timedelta(days=days_since_monday)
                period_key = week_start.isoformat()
                # Move to next week (start of next Monday)
                current_date = week_start + timedelta(days=7)
                # Only include weeks that overlap with the date range
                week_end = week_start + timedelta(days=6)
                if week_start > end_date:
                    break
                # Include week if it overlaps with date range
                if week_end < start_date:
                    continue
            else:  # monthly
                month_start = date(current_date.year, current_date.month, 1)
                period_key = month_start.isoformat()
                # Move to next month
                if month_start.month == 12:
                    current_date = date(month_start.year + 1, 1, 1)
                else:
                    current_date = date(month_start.year, month_start.month + 1, 1)
                # Only include months that overlap with the date range
                if month_start > end_date:
                    break
                # Calculate month end
                if month_start.month == 12:
                    month_end = date(month_start.year, 12, 31)
                else:
                    month_end = date(month_start.year, month_start.month + 1, 1) - timedelta(days=1)
                # Include month if it overlaps with date range
                if month_end < start_date:
                    continue
            
            if period_key not in all_periods:
                all_periods.append(period_key)
        
        # Build trend points for all periods
        trend_points: List[Dict[str, Any]] = []
        for period_key in sorted(set(all_periods)):
            point: Dict[str, Any] = {
                'date': period_key,
                'total': float(revenue_by_date.get(period_key, Decimal('0')).quantize(Decimal('0.01')))
            }
            
            # Add breakdowns if available
            if revenue_by_date_service.get(period_key):
                point['by_service'] = {
                    k: float(v.quantize(Decimal('0.01')))
                    for k, v in revenue_by_date_service[period_key].items()
                }
            
            if revenue_by_date_practitioner.get(period_key):
                point['by_practitioner'] = {
                    k: float(v.quantize(Decimal('0.01')))
                    for k, v in revenue_by_date_practitioner[period_key].items()
                }
            
            trend_points.append(point)
        
        return trend_points
    
    def _validate_results(
        self,
        summary: SummaryMetrics,
        by_service: List[Dict[str, Any]],
        by_practitioner: List[Dict[str, Any]],
        items: List[ReceiptItem],
        revenue_trend: List[Dict[str, Any]]
    ) -> None:
        """
        Validate calculation results for accounting accuracy.
        
        Checks:
        1. Total revenue matches sum of all items
        2. Breakdown totals match summary totals (within rounding tolerance)
        3. Percentages sum to 100 (within rounding tolerance)
        4. Receipt count matches unique receipt IDs
        
        Fails loudly in development/test environments, logs warnings in production.
        """
        # Determine environment
        # Use explicit ENVIRONMENT setting from config (more reliable than inferring from DATABASE_URL)
        # Also check for pytest environment as a fallback
        is_test = os.getenv("PYTEST_VERSION") is not None
        is_dev_or_test = ENVIRONMENT in ['development', 'test'] or is_test
        
        errors: List[str] = []
        warnings: List[str] = []
        
        # Check 1: Total revenue matches sum of items
        calculated_total = Decimal('0')
        for item in items:
            # Required fields - use direct access
            amount = item['amount']
            quantity = item['quantity']
            calculated_total += amount * Decimal(str(quantity))
        
        if abs(summary['total_revenue'] - calculated_total) > CALCULATION_TOLERANCE:
            error_msg = (
                f"Total revenue mismatch: summary={summary['total_revenue']}, "
                f"calculated={calculated_total}, diff={abs(summary['total_revenue'] - calculated_total)}"
            )
            if is_dev_or_test:
                errors.append(error_msg)
            else:
                warnings.append(error_msg)
        
        # Check 2: Breakdown totals match summary (only for non-zero revenue items)
        service_total = Decimal('0')
        for stat in by_service:
            service_total += Decimal(str(stat['total_revenue']))
        
        if summary['total_revenue'] > 0 and abs(summary['total_revenue'] - service_total) > CALCULATION_TOLERANCE:
            error_msg = (
                f"Service breakdown total mismatch: summary={summary['total_revenue']}, "
                f"breakdown={service_total}, diff={abs(summary['total_revenue'] - service_total)}"
            )
            if is_dev_or_test:
                errors.append(error_msg)
            else:
                warnings.append(error_msg)
        
        practitioner_total = Decimal('0')
        for stat in by_practitioner:
            practitioner_total += Decimal(str(stat['total_revenue']))
        
        if summary['total_revenue'] > 0 and abs(summary['total_revenue'] - practitioner_total) > CALCULATION_TOLERANCE:
            error_msg = (
                f"Practitioner breakdown total mismatch: summary={summary['total_revenue']}, "
                f"breakdown={practitioner_total}, diff={abs(summary['total_revenue'] - practitioner_total)}"
            )
            if is_dev_or_test:
                errors.append(error_msg)
            else:
                warnings.append(error_msg)
        
        # Check 3: Percentages sum to 100 (within rounding tolerance)
        if summary['total_revenue'] > 0:
            service_pct_total = sum(stat['percentage'] for stat in by_service)
            if abs(service_pct_total - 100) > PERCENTAGE_ROUNDING_TOLERANCE:
                error_msg = f"Service percentages sum to {service_pct_total}, expected 100"
                if is_dev_or_test:
                    errors.append(error_msg)
                else:
                    warnings.append(error_msg)
            
            practitioner_pct_total = sum(stat['percentage'] for stat in by_practitioner)
            if abs(practitioner_pct_total - 100) > PERCENTAGE_ROUNDING_TOLERANCE:
                error_msg = f"Practitioner percentages sum to {practitioner_pct_total}, expected 100"
                if is_dev_or_test:
                    errors.append(error_msg)
                else:
                    warnings.append(error_msg)
        
        # Check 4: Receipt count matches unique receipt IDs
        # Required field - use direct access
        unique_receipt_ids = {item['receipt_id'] for item in items}
        unique_count = len(unique_receipt_ids)
        if summary['valid_receipt_count'] != unique_count:
            error_msg = (
                f"Receipt count mismatch: summary={summary['valid_receipt_count']}, "
                f"unique_receipts={unique_count}"
            )
            if is_dev_or_test:
                errors.append(error_msg)
            else:
                warnings.append(error_msg)
        
        # Check 5: Revenue trend totals match summary (optional, for trend validation)
        trend_total = Decimal('0')
        for point in revenue_trend:
            trend_total += Decimal(str(point.get('total', 0)))
        
        if abs(summary['total_revenue'] - trend_total) > CALCULATION_TOLERANCE:
            error_msg = (
                f"Revenue trend total mismatch: summary={summary['total_revenue']}, "
                f"trend={trend_total}, diff={abs(summary['total_revenue'] - trend_total)}"
            )
            if is_dev_or_test:
                errors.append(error_msg)
            else:
                warnings.append(error_msg)
        
        # Log warnings in production
        for warning in warnings:
            logger.warning(warning)
        
        # Raise errors in dev/test
        if errors:
            error_message = "Calculation validation failed:\n" + "\n".join(f"  - {e}" for e in errors)
            raise CalculationValidationError(error_message)


class RevenueDistributionEngine:
    """
    Orchestrates revenue distribution calculations.
    
    This engine coordinates:
    1. Item extraction from receipts
    2. Filter application
    3. Summary calculation
    4. Item formatting, sorting, and pagination
    """
    
    def __init__(self):
        self.extractor = ReceiptItemExtractor()
        self.filter_applicator = FilterApplicator()
        self.summary_calculator = SummaryMetricsCalculator()
    
    def compute(
        self,
        receipts: List[Receipt],
        filters: DashboardFilters,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = 'date',
        sort_order: str = 'desc'
    ) -> Dict[str, Any]:
        """
        Compute revenue distribution with pagination.
        
        Args:
            receipts: List of Receipt entities (already filtered by clinic_id and is_voided)
            filters: Filter criteria
            page: Page number (1-indexed)
            page_size: Items per page
            sort_by: Column to sort by
            sort_order: 'asc' or 'desc'
            
        Returns:
            Dictionary with summary, items, and pagination info
        """
        start_date = filters.get('start_date')
        end_date = filters.get('end_date')
        if not start_date or not end_date:
            raise ValueError("start_date and end_date are required in filters")
        
        # Extract items from receipts (filters by visit_date)
        items = self.extractor.extract_items(
            receipts,
            start_date,
            end_date
        )
        
        logger.debug(f"Extracted {len(items)} items before applying filters")
        
        # Apply filters (practitioner, service item, show_overwritten_only)
        filtered_items = self.filter_applicator.apply_filters(items, filters)
        
        logger.debug(f"After applying filters: {len(filtered_items)} items")
        
        # Calculate summary metrics
        summary = self.summary_calculator.calculate(filtered_items, filters)
        
        # Convert to table format
        table_items = self._convert_to_table_format(filtered_items, receipts)
        
        # Sort items
        sorted_items = self._sort_items(table_items, sort_by, sort_order)
        
        # Paginate
        paginated_items = self._paginate(sorted_items, page, page_size)
        
        return {
            'summary': {
                'total_revenue': float(summary['total_revenue'].quantize(Decimal('0.01'))),
                'total_clinic_share': float(summary['total_clinic_share'].quantize(Decimal('0.01'))),
                'receipt_item_count': summary['receipt_item_count']
            },
            'items': paginated_items,
            'total': len(sorted_items),
            'page': page,
            'page_size': page_size
        }
    
    def _convert_to_table_format(
        self,
        items: List[ReceiptItem],
        receipts: List[Receipt]
    ) -> List[Dict[str, Any]]:
        """
        Convert ReceiptItem objects to table format for API response.
        
        Args:
            items: List of ReceiptItem objects
            receipts: List of Receipt entities (for appointment_id mapping)
            
        Returns:
            List of dictionaries in table format
        """
        # Create mapping from receipt_id to appointment_id
        receipt_to_appointment: Dict[int, int] = {}
        for receipt in receipts:
            receipt_to_appointment[receipt.id] = receipt.appointment_id
        
        table_items: List[Dict[str, Any]] = []
        for item in items:
            # Required fields - use direct access
            receipt_id = item['receipt_id']
            appointment_id = receipt_to_appointment.get(receipt_id)
            
            # Determine service item info
            item_type = item['item_type']
            if item_type == 'service_item':
                si_id = item.get('service_item_id')
                si_name = item.get('service_item_name', '未知')
                receipt_name = item.get('receipt_name') or si_name
                is_custom = False
            else:  # other
                si_id = None
                si_name = item.get('item_name', '')
                receipt_name = item.get('receipt_name') or si_name
                is_custom = True
            
            # Required fields - use direct access
            amount = item['amount']
            revenue_share = item['revenue_share']
            quantity = item['quantity']
            
            table_items.append({
                'receipt_id': receipt_id,
                'receipt_number': item['receipt_number'],
                'date': item['visit_date'].isoformat(),
                'patient_name': item['patient_name'],
                'service_item_id': si_id,
                'service_item_name': si_name,
                'receipt_name': receipt_name,
                'is_custom': is_custom,
                'quantity': quantity,
                'practitioner_id': item.get('practitioner_id'),
                'practitioner_name': item.get('practitioner_name'),
                'billing_scenario': item.get('billing_scenario_name', '其他'),
                'amount': float((amount * Decimal(str(quantity))).quantize(Decimal('0.01'))),
                'revenue_share': float((revenue_share * Decimal(str(quantity))).quantize(Decimal('0.01'))),
                'appointment_id': appointment_id
            })
        
        return table_items
    
    def _sort_items(
        self,
        items: List[Dict[str, Any]],
        sort_by: str,
        sort_order: str
    ) -> List[Dict[str, Any]]:
        """
        Sort items by specified column and order.
        
        Args:
            items: List of item dictionaries
            sort_by: Column to sort by
            sort_order: 'asc' or 'desc'
            
        Returns:
            Sorted list of items
        """
        sort_key_map = {
            'date': 'date',
            'receipt_number': 'receipt_number',
            'patient': 'patient_name',
            'item': 'receipt_name',
            'quantity': 'quantity',
            'practitioner': 'practitioner_name',
            'billing_scenario': 'billing_scenario',
            'amount': 'amount',
            'revenue_share': 'revenue_share'
        }
        
        sort_key = sort_key_map.get(sort_by, 'date')
        reverse = sort_order == 'desc'
        
        return sorted(items, key=lambda x: x.get(sort_key, ''), reverse=reverse)
    
    def _paginate(
        self,
        items: List[Dict[str, Any]],
        page: int,
        page_size: int
    ) -> List[Dict[str, Any]]:
        """
        Paginate items.
        
        Args:
            items: List of item dictionaries
            page: Page number (1-indexed)
            page_size: Items per page
            
        Returns:
            Paginated list of items
        """
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        return items[start_idx:end_idx]

