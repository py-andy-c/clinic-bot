"""
Service for business insights and revenue distribution dashboard.

Handles aggregation queries on receipt data for business insights and revenue distribution pages.
"""

import logging
from typing import Dict, Any, List, Optional, Set, Union
from decimal import Decimal
from datetime import date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func
from collections import defaultdict

from models.receipt import Receipt
from utils.datetime_utils import parse_datetime_string_to_taiwan

logger = logging.getLogger(__name__)

# Date expansion window for performance optimization
# We use issue_date (checkout date) as a first-pass SQL filter, then filter by visit_date (service date) in Python.
# Since checkout typically happens on the same day or within 1-2 days of service, we expand the range by 2 days
# to ensure we don't miss any receipts while still reducing the dataset size significantly.
DATE_FILTER_EXPANSION_DAYS = 2

# Constant for null practitioner filter value
PRACTITIONER_NULL_FILTER = 'null'


def _filter_receipts_by_visit_date(
    receipts: List[Receipt],
    start_date: date,
    end_date: date
) -> List[Receipt]:
    """
    Filter receipts by visit_date (service time) in Taiwan timezone.
    
    This helper function extracts the common logic for filtering receipts by visit_date
    from receipt_data JSONB, converting to Taiwan timezone, and checking against date range.
    
    Args:
        receipts: List of Receipt objects to filter
        start_date: Start date for the range
        end_date: End date for the range
        
    Returns:
        Filtered list of receipts where visit_date falls within the date range
    """
    filtered_receipts: List[Receipt] = []
    for receipt in receipts:
        receipt_data: Dict[str, Any] = receipt.receipt_data
        visit_date_str = receipt_data.get('visit_date')
        if not visit_date_str:
            continue  # Skip receipts without visit_date (shouldn't happen, but defensive)
        
        try:
            # Parse visit_date and convert to Taiwan timezone
            visit_datetime = parse_datetime_string_to_taiwan(visit_date_str)
            visit_date_taiwan = visit_datetime.date()
            
            # Filter by date range using Taiwan timezone
            if visit_date_taiwan < start_date or visit_date_taiwan > end_date:
                continue
        except (ValueError, AttributeError) as e:
            # Skip receipts with invalid visit_date
            logger.warning(f"Invalid visit_date in receipt {receipt.id}: {visit_date_str}, error: {e}")
            continue
        
        filtered_receipts.append(receipt)
    
    return filtered_receipts


class BusinessInsightsService:
    """Service for business insights operations."""

    @staticmethod
    def get_business_insights(
        db: Session,
        clinic_id: int,
        start_date: date,
        end_date: date,
        practitioner_id: Optional[Union[int, str]] = None,
        service_item_id: Optional[Union[int, str]] = None
    ) -> Dict[str, Any]:
        """
        Get business insights data for a date range.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            start_date: Start date for the range
            end_date: End date for the range
            practitioner_id: Optional practitioner ID to filter by
            service_item_id: Optional service item ID or 'custom:name' to filter by
            
        Returns:
            Dictionary with summary, revenue trend, and breakdowns
        """
        # Base query for non-voided receipts
        # Note: We filter by visit_date (service time) in Python after loading,
        # since visit_date is stored in JSONB. We use issue_date as a first-pass filter
        # to reduce the dataset (checkout date should be close to service date).
        # Expand the range by a few days to account for late checkouts (e.g., checkout next day).
        # This is a performance optimization - we'll do exact filtering by visit_date in Python
        expanded_start = (start_date - timedelta(days=DATE_FILTER_EXPANSION_DAYS))
        expanded_end = (end_date + timedelta(days=DATE_FILTER_EXPANSION_DAYS))
        
        base_query = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            func.date(Receipt.issue_date) >= expanded_start,
            func.date(Receipt.issue_date) <= expanded_end
        )
        
        all_receipts = base_query.all()
        
        # Filter by visit_date (service time) in Taiwan timezone
        receipts = _filter_receipts_by_visit_date(all_receipts, start_date, end_date)
        
        # Filter by practitioner if specified
        # NOTE: This receipt-level filtering is a performance optimization to skip receipts with no matching items.
        # We still do item-level filtering in the aggregation loop (lines 205-214) to ensure only matching items
        # contribute to revenue calculations. This two-stage filtering reduces the number of receipts we iterate
        # through while maintaining correct accounting at the item level.
        if practitioner_id is not None:
            filtered_receipts: List[Receipt] = []
            for receipt in receipts:
                receipt_data: Dict[str, Any] = receipt.receipt_data
                items: List[Dict[str, Any]] = receipt_data.get('items', [])
                for item in items:
                    item_practitioner: Optional[Dict[str, Any]] = item.get('practitioner')
                    
                    # Handle null practitioner filter
                    if practitioner_id == PRACTITIONER_NULL_FILTER:
                        # Filter for items with no practitioner
                        if item_practitioner is None:
                            filtered_receipts.append(receipt)
                            break
                    else:
                        # Filter for specific practitioner ID
                        if item_practitioner and item_practitioner.get('id') == practitioner_id:
                            filtered_receipts.append(receipt)
                            break
            receipts = filtered_receipts
        
        # Filter by service item if specified
        if service_item_id:
            filtered_receipts: List[Receipt] = []
            for receipt in receipts:
                receipt_data: Dict[str, Any] = receipt.receipt_data
                items: List[Dict[str, Any]] = receipt_data.get('items', [])
                for item in items:
                    if isinstance(service_item_id, str) and service_item_id.startswith('custom:'):
                        # Custom item: check item_name
                        if item.get('item_type') == 'other' and item.get('item_name') == service_item_id[7:]:
                            filtered_receipts.append(receipt)
                            break
                    else:
                        # Standard service item: check service_item.id
                        service_item: Optional[Dict[str, Any]] = item.get('service_item')
                        if service_item and service_item.get('id') == service_item_id:
                            filtered_receipts.append(receipt)
                            break
            receipts = filtered_receipts
        
        # Aggregate data
        total_revenue = Decimal('0')
        receipt_ids: Set[int] = set()
        service_item_ids_seen: Set[Union[int, str]] = set()
        patient_ids: Set[int] = set()
        
        # For revenue trend (by date)
        revenue_by_date: Dict[str, Decimal] = defaultdict(Decimal)
        revenue_by_date_service: Dict[str, Dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        revenue_by_date_practitioner: Dict[str, Dict[str, Decimal]] = defaultdict(lambda: defaultdict(Decimal))
        
        # For breakdowns
        service_item_stats: Dict[Union[int, str], Dict[str, Any]] = {}
        practitioner_stats: Dict[Optional[int], Dict[str, Any]] = {}
        
        for receipt in receipts:
            receipt_data: Dict[str, Any] = receipt.receipt_data
            # Use visit_date (service time) instead of issue_date (checkout time)
            visit_date_str = receipt_data.get('visit_date')
            if not visit_date_str:
                continue  # Skip receipts without visit_date
            
            try:
                # Parse visit_date and convert to Taiwan timezone, then extract date
                visit_datetime = parse_datetime_string_to_taiwan(visit_date_str)
                receipt_date = visit_datetime.date().isoformat()
            except (ValueError, AttributeError) as e:
                # Skip receipts with invalid visit_date
                logger.warning(f"Invalid visit_date in receipt {receipt.id}: {visit_date_str}, error: {e}")
                continue
            
            receipt_ids.add(receipt.id)
            
            patient_data: Dict[str, Any] = receipt_data.get('patient', {})
            if patient_data.get('id'):
                patient_ids.add(patient_data['id'])
            
            items: List[Dict[str, Any]] = receipt_data.get('items', [])
            
            for item in items:
                # Extract item properties once for reuse
                service_item: Optional[Dict[str, Any]] = item.get('service_item')
                item_type = item.get('item_type', 'service_item')
                item_practitioner: Optional[Dict[str, Any]] = item.get('practitioner')
                
                # If filtering by practitioner_id, only process items that match
                # NOTE: This item-level filtering ensures correct accounting - only matching items contribute
                # to revenue calculations, not all items in receipts that contain matching items.
                if practitioner_id is not None:
                    if practitioner_id == PRACTITIONER_NULL_FILTER:
                        # Filter for items with no practitioner
                        if item_practitioner is not None:
                            continue
                    else:
                        # Filter for specific practitioner ID
                        if not item_practitioner or item_practitioner.get('id') != practitioner_id:
                            continue
                
                # If filtering by service_item_id, only process items that match
                if service_item_id:
                    if isinstance(service_item_id, str) and service_item_id.startswith('custom:'):
                        # Custom item: check item_name
                        if not (item_type == 'other' and item.get('item_name') == service_item_id[7:]):
                            continue
                    else:
                        # Standard service item: check service_item.id
                        if not service_item or service_item.get('id') != service_item_id:
                            continue
                
                amount = Decimal(str(item.get('amount', 0)))
                quantity = Decimal(str(item.get('quantity', 1)))
                item_total = amount * quantity
                
                total_revenue += item_total
                
                # Revenue trend by date
                revenue_by_date[receipt_date] += item_total
                
                # Service item aggregation
                
                if item_type == 'service_item' and service_item:
                    si_id = service_item.get('id')
                    si_name = service_item.get('name', '')
                    receipt_name = service_item.get('receipt_name') or si_name
                    # Standard service items are never custom (item_type='service_item' means it's from appointment_types)
                    # Use ID as key for standard items (si_id should always be present for service_item type)
                    if si_id is None:
                        continue  # Skip if ID is missing
                    key: Union[int, str] = si_id
                    
                    if key not in service_item_stats:
                        service_item_stats[key] = {
                            'service_item_id': si_id,
                            'service_item_name': si_name,
                            'receipt_name': receipt_name,
                            'is_custom': False,
                            'total_revenue': Decimal('0'),
                            'item_count': 0
                        }
                    service_item_stats[key]['total_revenue'] += item_total
                    service_item_stats[key]['item_count'] += int(quantity)
                    service_item_ids_seen.add(key)
                    
                    # Revenue trend by service (use string key for consistency)
                    revenue_by_date_service[receipt_date][str(key)] += item_total
                elif item_type == 'other':
                    item_name = item.get('item_name', '')
                    key = f"custom:{item_name}"
                    
                    if key not in service_item_stats:
                        service_item_stats[key] = {
                            'service_item_id': None,
                            'service_item_name': item_name,
                            'receipt_name': item_name,
                            'is_custom': True,
                            'total_revenue': Decimal('0'),
                            'item_count': 0
                        }
                    service_item_stats[key]['total_revenue'] += item_total
                    service_item_stats[key]['item_count'] += int(quantity)
                    service_item_ids_seen.add(key)
                    
                    # Revenue trend by service
                    revenue_by_date_service[receipt_date][key] += item_total
                
                # Practitioner aggregation (use already extracted item_practitioner)
                prac_id = item_practitioner.get('id') if item_practitioner else None
                prac_name = item_practitioner.get('name', '無') if item_practitioner else '無'
                
                if prac_id not in practitioner_stats:
                    practitioner_stats[prac_id] = {
                        'practitioner_id': prac_id,
                        'practitioner_name': prac_name,
                        'total_revenue': Decimal('0'),
                        'item_count': 0
                    }
                practitioner_stats[prac_id]['total_revenue'] += item_total
                practitioner_stats[prac_id]['item_count'] += int(quantity)
                
                # Revenue trend by practitioner
                prac_key = str(prac_id) if prac_id else 'null'
                revenue_by_date_practitioner[receipt_date][prac_key] += item_total
        
        # Calculate percentages (rounded to whole numbers)
        for stat in service_item_stats.values():
            stat['percentage'] = round(float(stat['total_revenue'] / total_revenue * 100)) if total_revenue > 0 else 0.0
        
        for stat in practitioner_stats.values():
            stat['percentage'] = round(float(stat['total_revenue'] / total_revenue * 100)) if total_revenue > 0 else 0.0
        
        # Build revenue trend (determine granularity)
        date_range_days = (end_date - start_date).days + 1
        if date_range_days <= 31:
            granularity = 'daily'
        elif date_range_days <= 90:
            granularity = 'weekly'
        else:
            granularity = 'monthly'
        
        revenue_trend = BusinessInsightsService._build_revenue_trend(
            start_date, end_date, granularity,
            revenue_by_date, revenue_by_date_service, revenue_by_date_practitioner
        )
        
        # Calculate summary
        valid_receipt_count = len(receipt_ids)
        service_item_count = len(service_item_ids_seen)
        active_patients = len(patient_ids)
        average_transaction = float((total_revenue / valid_receipt_count).quantize(Decimal('0.01'))) if valid_receipt_count > 0 else 0.0
        
        # Sort breakdowns
        by_service = sorted(
            [v for v in service_item_stats.values()],
            key=lambda x: x['total_revenue'],
            reverse=True
        )
        by_practitioner = sorted(
            [v for v in practitioner_stats.values()],
            key=lambda x: x['total_revenue'],
            reverse=True
        )
        
        return {
            'summary': {
                'total_revenue': float(total_revenue.quantize(Decimal('0.01'))),
                'valid_receipt_count': valid_receipt_count,
                'service_item_count': service_item_count,
                'active_patients': active_patients,
                'average_transaction_amount': average_transaction
            },
            'revenue_trend': revenue_trend,
            'by_service': by_service,
            'by_practitioner': by_practitioner
        }
    
    @staticmethod
    def _build_revenue_trend(
        start_date: date,
        end_date: date,
        granularity: str,
        revenue_by_date: Dict[str, Decimal],
        revenue_by_date_service: Dict[str, Dict[str, Decimal]],
        revenue_by_date_practitioner: Dict[str, Dict[str, Decimal]]
    ) -> List[Dict[str, Any]]:
        """Build revenue trend data with appropriate granularity."""
        trend_points: List[Dict[str, Any]] = []
        current_date = start_date
        
        while current_date <= end_date:
            if granularity == 'daily':
                date_key = current_date.isoformat()
                next_date = current_date + timedelta(days=1)
            elif granularity == 'weekly':
                # Start of week (Monday)
                days_since_monday = current_date.weekday()
                week_start = current_date - timedelta(days=days_since_monday)
                date_key = week_start.isoformat()
                next_date = week_start + timedelta(days=7)
            else:  # monthly
                month_start = date(current_date.year, current_date.month, 1)
                date_key = month_start.isoformat()
                # Next month
                if month_start.month == 12:
                    next_date = date(month_start.year + 1, 1, 1)
                else:
                    next_date = date(month_start.year, month_start.month + 1, 1)
            
            # Aggregate revenue for this period
            total = Decimal('0')
            by_service: Dict[str, Decimal] = defaultdict(Decimal)
            by_practitioner: Dict[str, Decimal] = defaultdict(Decimal)
            
            check_date = current_date
            while check_date < next_date and check_date <= end_date:
                date_str = check_date.isoformat()
                total += revenue_by_date.get(date_str, Decimal('0'))
                
                for key, amount in revenue_by_date_service.get(date_str, {}).items():
                    by_service[key] += amount
                
                for key, amount in revenue_by_date_practitioner.get(date_str, {}).items():
                    by_practitioner[key] += amount
                
                check_date += timedelta(days=1)
            
            trend_points.append({
                'date': date_key,
                'total': float(total.quantize(Decimal('0.01'))),
                'by_service': {k: float(v.quantize(Decimal('0.01'))) for k, v in by_service.items()} if by_service else {},
                'by_practitioner': {k: float(v.quantize(Decimal('0.01'))) for k, v in by_practitioner.items()} if by_practitioner else {}
            })
            
            current_date = next_date
        
        return trend_points


class RevenueDistributionService:
    """Service for revenue distribution operations."""
    
    @staticmethod
    def get_revenue_distribution(
        db: Session,
        clinic_id: int,
        start_date: date,
        end_date: date,
        practitioner_id: Optional[Union[int, str]] = None,
        service_item_id: Optional[Union[int, str]] = None,
        show_overwritten_only: bool = False,
        page: int = 1,
        page_size: int = 20,
        sort_by: str = 'date',
        sort_order: str = 'desc'
    ) -> Dict[str, Any]:
        """
        Get revenue distribution data for a date range.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            start_date: Start date for the range
            end_date: End date for the range
            practitioner_id: Optional practitioner ID to filter by
            service_item_id: Optional service item ID or 'custom:name' to filter by
            show_overwritten_only: If True, only show items with billing_scenario = "其他"
            page: Page number (1-indexed)
            page_size: Items per page
            sort_by: Column to sort by
            sort_order: 'asc' or 'desc'
            
        Returns:
            Dictionary with summary, items, and pagination info
        """
        # Base query for non-voided receipts
        # Note: We filter by visit_date (service time) in Python after loading,
        # since visit_date is stored in JSONB. We use issue_date as a first-pass filter
        # to reduce the dataset (checkout date should be close to service date).
        # Expand the range by a few days to account for late checkouts (e.g., checkout next day).
        expanded_start = (start_date - timedelta(days=DATE_FILTER_EXPANSION_DAYS))
        expanded_end = (end_date + timedelta(days=DATE_FILTER_EXPANSION_DAYS))
        
        base_query = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            func.date(Receipt.issue_date) >= expanded_start,
            func.date(Receipt.issue_date) <= expanded_end
        )
        
        all_receipts = base_query.all()
        
        # Filter by visit_date (service time) in Taiwan timezone
        receipts = _filter_receipts_by_visit_date(all_receipts, start_date, end_date)
        
        # Collect all receipt items
        all_items: List[Dict[str, Any]] = []
        total_revenue = Decimal('0')
        total_clinic_share = Decimal('0')
        
        for receipt in receipts:
            receipt_data: Dict[str, Any] = receipt.receipt_data
            receipt_id = receipt.id
            receipt_number = receipt_data.get('receipt_number', '')
            
            # Use visit_date (service time) instead of issue_date (checkout time)
            visit_date_str = receipt_data.get('visit_date')
            if not visit_date_str:
                continue  # Skip receipts without visit_date
            
            try:
                # Parse visit_date and convert to Taiwan timezone, then extract date
                visit_datetime = parse_datetime_string_to_taiwan(visit_date_str)
                receipt_date = visit_datetime.date().isoformat()
            except (ValueError, AttributeError) as e:
                # Skip receipts with invalid visit_date
                logger.warning(f"Invalid visit_date in receipt {receipt.id}: {visit_date_str}, error: {e}")
                continue
            
            patient_data: Dict[str, Any] = receipt_data.get('patient', {})
            patient_name = patient_data.get('name', '')
            appointment_id = receipt.appointment_id
            
            items: List[Dict[str, Any]] = receipt_data.get('items', [])
            
            for item in items:
                # Apply filters
                if practitioner_id is not None:
                    item_practitioner: Optional[Dict[str, Any]] = item.get('practitioner')
                    
                    # Handle null practitioner filter
                    if practitioner_id == PRACTITIONER_NULL_FILTER:
                        # Filter for items with no practitioner
                        if item_practitioner is not None:
                            continue
                    else:
                        # Filter for specific practitioner ID
                        if not item_practitioner or item_practitioner.get('id') != practitioner_id:
                            continue
                
                if service_item_id:
                    if isinstance(service_item_id, str) and service_item_id.startswith('custom:'):
                        if item.get('item_type') != 'other' or item.get('item_name') != service_item_id[7:]:
                            continue
                    else:
                        service_item: Optional[Dict[str, Any]] = item.get('service_item')
                        if not service_item or service_item.get('id') != service_item_id:
                            continue
                
                billing_scenario: Optional[Dict[str, Any]] = item.get('billing_scenario')
                billing_scenario_name = billing_scenario.get('name', '其他') if billing_scenario else '其他'
                
                if show_overwritten_only and billing_scenario_name != '其他':
                    continue
                
                # Extract item data
                item_type = item.get('item_type', 'service_item')
                amount = Decimal(str(item.get('amount', 0)))
                revenue_share = Decimal(str(item.get('revenue_share', 0)))
                quantity = int(item.get('quantity', 1))
                
                total_revenue += amount * quantity
                total_clinic_share += revenue_share * quantity
                
                # Determine service item info
                if item_type == 'service_item':
                    service_item: Optional[Dict[str, Any]] = item.get('service_item')
                    if service_item:
                        si_id = service_item.get('id')
                        si_name = service_item.get('name', '')
                        receipt_name = service_item.get('receipt_name') or si_name
                        is_custom = False  # service_item type is never custom
                    else:
                        si_id = None
                        si_name = '未知'
                        receipt_name = '未知'
                        is_custom = False
                else:  # other
                    si_id = None
                    si_name = item.get('item_name', '')
                    receipt_name = si_name
                    is_custom = True  # other type is always custom
                
                # Practitioner info
                practitioner: Optional[Dict[str, Any]] = item.get('practitioner')
                prac_id = practitioner.get('id') if practitioner else None
                prac_name = practitioner.get('name') if practitioner else None
                
                all_items.append({
                    'receipt_id': receipt_id,
                    'receipt_number': receipt_number,
                    'date': receipt_date,
                    'patient_name': patient_name,
                    'service_item_id': si_id,
                    'service_item_name': si_name,
                    'receipt_name': receipt_name,
                    'is_custom': is_custom,
                    'quantity': quantity,
                    'practitioner_id': prac_id,
                    'practitioner_name': prac_name,
                    'billing_scenario': billing_scenario_name,
                    'amount': float((amount * quantity).quantize(Decimal('0.01'))),
                    'revenue_share': float((revenue_share * quantity).quantize(Decimal('0.01'))),
                    'appointment_id': appointment_id
                })
        
        # Sort items
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
        
        all_items.sort(key=lambda x: x.get(sort_key, ''), reverse=reverse)
        
        # Paginate
        total = len(all_items)
        start_idx = (page - 1) * page_size
        end_idx = start_idx + page_size
        paginated_items = all_items[start_idx:end_idx]
        
        return {
            'summary': {
                'total_revenue': float(total_revenue.quantize(Decimal('0.01'))),
                'total_clinic_share': float(total_clinic_share.quantize(Decimal('0.01'))),
                'receipt_item_count': total
            },
            'items': paginated_items,
            'total': total,
            'page': page,
            'page_size': page_size
        }
