"""
Service for accounting and revenue reporting.

Handles aggregation queries on receipt data for accounting dashboard.
"""

import logging
from typing import Dict, Any, List, Optional, cast as type_cast, Set
from decimal import Decimal
from datetime import datetime, date, timedelta
from sqlalchemy.orm import Session
from sqlalchemy import func

from models.receipt import Receipt
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from utils.datetime_utils import parse_datetime_string_to_taiwan

logger = logging.getLogger(__name__)

# Date expansion window for performance optimization
# We use issue_date (checkout date) as a first-pass SQL filter, then filter by visit_date (service date) in Python.
# Since checkout typically happens on the same day or within 1-2 days of service, we expand the range by 2 days
# to ensure we don't miss any receipts while still reducing the dataset size significantly.
DATE_FILTER_EXPANSION_DAYS = 2


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
        receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
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


class AccountingService:
    """Service for accounting operations."""

    @staticmethod
    def get_accounting_summary(
        db: Session,
        clinic_id: int,
        start_date: date,
        end_date: date,
        practitioner_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Get aggregated accounting statistics for a date range.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            start_date: Start date for the range
            end_date: End date for the range
            practitioner_id: Optional practitioner ID to filter by
            
        Returns:
            Dictionary with summary statistics and breakdowns
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
        
        # Filter by practitioner in Python if specified (more accurate than SQL JSONB queries)
        if practitioner_id:
            filtered_receipts: List[Receipt] = []
            for receipt in receipts:
                receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
                items: List[Dict[str, Any]] = receipt_data.get('items', [])  # type: ignore
                # Check if any item has this practitioner
                for item in items:
                    item_practitioner: Optional[Dict[str, Any]] = item.get('practitioner')  # type: ignore
                    if item_practitioner and type_cast(int, item_practitioner.get('id')) == practitioner_id:  # type: ignore
                        filtered_receipts.append(receipt)
                        break
            receipts = filtered_receipts
        
        # Aggregate totals
        total_revenue = Decimal('0')
        total_revenue_share = Decimal('0')
        receipt_count = len(receipts)
        
        # Aggregations by practitioner
        practitioner_stats: Dict[int, Dict[str, Any]] = {}
        
        # Aggregations by service item
        service_item_stats: Dict[int, Dict[str, Any]] = {}
        
        for receipt in receipts:
            receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
            items: List[Dict[str, Any]] = receipt_data.get('items', [])  # type: ignore
            
            for item in items:
                amount = Decimal(str(item.get('amount', 0)))  # type: ignore
                revenue_share = Decimal(str(item.get('revenue_share', 0)))  # type: ignore
                quantity = Decimal(str(item.get('quantity', 1)))  # type: ignore
                
                # Calculate totals accounting for quantity
                item_total_amount = amount * quantity
                item_total_revenue_share = revenue_share * quantity
                
                total_revenue += item_total_amount
                total_revenue_share += item_total_revenue_share
                
                # Aggregate by practitioner
                practitioner: Optional[Dict[str, Any]] = type_cast(Optional[Dict[str, Any]], item.get('practitioner'))  # type: ignore
                if practitioner and practitioner.get('id'):  # type: ignore
                    prac_id: int = type_cast(int, practitioner['id'])  # type: ignore
                    if prac_id not in practitioner_stats:
                        practitioner_stats[prac_id] = {
                            'practitioner_id': prac_id,
                            'practitioner_name': type_cast(str, practitioner.get('name', '')),  # type: ignore
                            'total_revenue': Decimal('0'),
                            'total_revenue_share': Decimal('0'),
                            'receipt_count': 0
                        }
                    practitioner_stats[prac_id]['total_revenue'] += item_total_amount
                    practitioner_stats[prac_id]['total_revenue_share'] += item_total_revenue_share
                
                # Aggregate by service item
                service_item: Optional[Dict[str, Any]] = type_cast(Optional[Dict[str, Any]], item.get('service_item'))  # type: ignore
                if service_item and service_item.get('id'):  # type: ignore
                    si_id: int = type_cast(int, service_item['id'])  # type: ignore
                    if si_id not in service_item_stats:
                        service_item_stats[si_id] = {
                            'service_item_id': si_id,
                            'service_item_name': type_cast(str, service_item.get('name', '')),  # type: ignore
                            'receipt_name': type_cast(str, service_item.get('receipt_name', service_item.get('name', ''))),  # type: ignore
                            'total_revenue': Decimal('0'),
                            'total_revenue_share': Decimal('0'),
                            'item_count': 0
                        }
                    service_item_stats[si_id]['total_revenue'] += item_total_amount
                    service_item_stats[si_id]['total_revenue_share'] += item_total_revenue_share
                    service_item_stats[si_id]['item_count'] += int(quantity)
        
        # Count unique receipts per practitioner
        for receipt in receipts:
            receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
            items: List[Dict[str, Any]] = receipt_data.get('items', [])  # type: ignore
            practitioner_ids_in_receipt: Set[int] = set()
            for item in items:
                practitioner: Optional[Dict[str, Any]] = item.get('practitioner')  # type: ignore
                if practitioner and practitioner.get('id'):  # type: ignore
                    prac_id: int = type_cast(int, practitioner['id'])  # type: ignore
                    practitioner_ids_in_receipt.add(prac_id)
            
            for prac_id in practitioner_ids_in_receipt:
                if prac_id in practitioner_stats:
                    practitioner_stats[prac_id]['receipt_count'] += 1
        
        # Count voided receipts
        # Note: For voided receipts, we filter by visit_date (service time) to be consistent
        # with active receipts. Voiding is an administrative action, but we want to count
        # voided receipts based on when the service was provided, not when it was voided.
        # Use issue_date as a first-pass filter for performance (expanded range).
        all_voided_receipts = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == True,
            func.date(Receipt.issue_date) >= expanded_start,
            func.date(Receipt.issue_date) <= expanded_end
        ).all()
        
        filtered_voided_receipts = _filter_receipts_by_visit_date(all_voided_receipts, start_date, end_date)
        voided_count = len(filtered_voided_receipts)
        
        return {
            'date_range': {
                'start_date': start_date.isoformat(),
                'end_date': end_date.isoformat()
            },
            'summary': {
                'total_revenue': float(total_revenue),
                'total_revenue_share': float(total_revenue_share),
                'receipt_count': receipt_count,
                'voided_receipt_count': voided_count
            },
            'by_practitioner': list(practitioner_stats.values()),
            'by_service_item': list(service_item_stats.values())
        }

    @staticmethod
    def get_practitioner_details(
        db: Session,
        clinic_id: int,
        practitioner_id: int,
        start_date: date,
        end_date: date
    ) -> Dict[str, Any]:
        """
        Get detailed accounting items for a specific practitioner.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            practitioner_id: ID of the practitioner
            start_date: Start date for the range
            end_date: End date for the range
            
        Returns:
            Dictionary with detailed items and summary
        """
        # Get practitioner info
        practitioner = db.query(User).filter(
            User.id == practitioner_id
        ).first()
        
        if not practitioner:
            raise ValueError(f"Practitioner {practitioner_id} not found")
        
        # Get receipts with items for this practitioner
        # Note: We filter by visit_date (service time) in Python after loading,
        # since visit_date is stored in JSONB. We use issue_date as a first-pass filter
        # to reduce the dataset (checkout date should be close to service date).
        expanded_start = (start_date - timedelta(days=DATE_FILTER_EXPANSION_DAYS))
        expanded_end = (end_date + timedelta(days=DATE_FILTER_EXPANSION_DAYS))
        
        all_receipts = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            func.date(Receipt.issue_date) >= expanded_start,
            func.date(Receipt.issue_date) <= expanded_end
        ).all()
        
        # Filter by visit_date (service time) in Taiwan timezone
        filtered_by_date = _filter_receipts_by_visit_date(all_receipts, start_date, end_date)
        
        # Filter to only receipts with items for this practitioner
        filtered_receipts: List[Receipt] = []
        for receipt in filtered_by_date:
            receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
            items: List[Dict[str, Any]] = receipt_data.get('items', [])  # type: ignore
            for item in items:
                item_practitioner: Optional[Dict[str, Any]] = type_cast(Optional[Dict[str, Any]], item.get('practitioner'))  # type: ignore
                if item_practitioner and type_cast(int, item_practitioner.get('id')) == practitioner_id:  # type: ignore
                    filtered_receipts.append(receipt)
                    break
        receipts = filtered_receipts
        
        items: List[Dict[str, Any]] = []
        total_revenue = Decimal('0')
        total_revenue_share = Decimal('0')
        receipt_count = len(receipts)
        
        # Service item aggregation
        service_item_stats: Dict[int, Dict[str, Any]] = {}
        
        for receipt in receipts:
            receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
            receipt_items: List[Dict[str, Any]] = receipt_data.get('items', [])  # type: ignore
            
            for item in receipt_items:
                # Only include items for this practitioner
                item_practitioner: Optional[Dict[str, Any]] = type_cast(Optional[Dict[str, Any]], item.get('practitioner'))  # type: ignore
                if not item_practitioner or type_cast(int, item_practitioner.get('id')) != practitioner_id:  # type: ignore
                    continue
                
                amount = Decimal(str(item.get('amount', 0)))  # type: ignore
                revenue_share = Decimal(str(item.get('revenue_share', 0)))  # type: ignore
                quantity = Decimal(str(item.get('quantity', 1)))  # type: ignore
                
                # Calculate totals accounting for quantity
                item_total_amount = amount * quantity
                item_total_revenue_share = revenue_share * quantity
                
                total_revenue += item_total_amount
                total_revenue_share += item_total_revenue_share
                
                # Build item detail
                patient_data: Dict[str, Any] = type_cast(Dict[str, Any], receipt_data.get('patient', {}))  # type: ignore
                # Use visit_date (service time) for consistency with filtering
                visit_date_str = receipt_data.get('visit_date')
                visit_date_iso = None
                if visit_date_str:
                    try:
                        visit_datetime = parse_datetime_string_to_taiwan(visit_date_str)
                        visit_date_iso = visit_datetime.date().isoformat()
                    except (ValueError, AttributeError):
                        # Fallback to issue_date if visit_date is invalid
                        visit_date_iso = receipt.issue_date.date().isoformat()
                else:
                    # Fallback to issue_date if visit_date is missing
                    visit_date_iso = receipt.issue_date.date().isoformat()
                
                item_detail: Dict[str, Any] = {
                    'receipt_id': receipt.id,
                    'receipt_number': receipt.receipt_number,
                    'visit_date': visit_date_iso,  # Use visit_date for consistency
                    'patient_name': type_cast(str, patient_data.get('name', '')),  # type: ignore
                    'amount': float(item_total_amount),
                    'revenue_share': float(item_total_revenue_share),
                    'quantity': int(quantity)
                }
                
                # Add service item info
                service_item: Optional[Dict[str, Any]] = type_cast(Optional[Dict[str, Any]], item.get('service_item'))  # type: ignore
                if service_item:
                    item_detail['service_item'] = {
                        'id': type_cast(int, service_item.get('id')),  # type: ignore
                        'name': type_cast(str, service_item.get('name', '')),  # type: ignore
                        'receipt_name': type_cast(str, service_item.get('receipt_name', service_item.get('name', '')))  # type: ignore
                    }
                    
                    # Aggregate by service item
                    si_id: Optional[int] = type_cast(Optional[int], service_item.get('id'))  # type: ignore
                    if si_id:
                        if si_id not in service_item_stats:
                            service_item_stats[si_id] = {
                                'service_item_id': si_id,
                                'service_item_name': type_cast(str, service_item.get('name', '')),  # type: ignore
                                'receipt_name': type_cast(str, service_item.get('receipt_name', service_item.get('name', ''))),  # type: ignore
                                'total_revenue': Decimal('0'),
                                'total_revenue_share': Decimal('0'),
                                'item_count': 0
                            }
                        service_item_stats[si_id]['total_revenue'] += item_total_amount
                        service_item_stats[si_id]['total_revenue_share'] += item_total_revenue_share
                        service_item_stats[si_id]['item_count'] += int(quantity)
                
                # Add billing scenario info
                billing_scenario: Optional[Dict[str, Any]] = type_cast(Optional[Dict[str, Any]], item.get('billing_scenario'))  # type: ignore
                if billing_scenario:
                    item_detail['billing_scenario'] = {
                        'id': type_cast(int, billing_scenario.get('id')),  # type: ignore
                        'name': type_cast(str, billing_scenario.get('name', ''))  # type: ignore
                    }
                
                items.append(item_detail)
        
        # Convert Decimal to float for service item stats
        for si_stat in service_item_stats.values():
            if isinstance(si_stat['total_revenue'], Decimal):
                si_stat['total_revenue'] = float(si_stat['total_revenue'])
            if isinstance(si_stat['total_revenue_share'], Decimal):
                si_stat['total_revenue_share'] = float(si_stat['total_revenue_share'])
        
        # Get practitioner name from UserClinicAssociation
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == practitioner_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        
        practitioner_name = association.full_name if association else practitioner.email
        
        return {
            'practitioner': {
                'id': practitioner.id,
                'name': practitioner_name
            },
            'date_range': {
                'start_date': start_date.isoformat(),
                'end_date': end_date.isoformat()
            },
            'summary': {
                'total_revenue': float(total_revenue),
                'total_revenue_share': float(total_revenue_share),
                'receipt_count': receipt_count
            },
            'items': items,
            'by_service_item': [
                {
                    'service_item_id': stat['service_item_id'],
                    'service_item_name': stat['service_item_name'],
                    'receipt_name': stat['receipt_name'],
                    'total_revenue': float(stat['total_revenue']) if isinstance(stat['total_revenue'], Decimal) else stat['total_revenue'],
                    'total_revenue_share': float(stat['total_revenue_share']) if isinstance(stat['total_revenue_share'], Decimal) else stat['total_revenue_share'],
                    'item_count': stat['item_count']
                }
                for stat in service_item_stats.values()
            ]
        }

    @staticmethod
    def get_voided_receipts(
        db: Session,
        clinic_id: int,
        start_date: Optional[date] = None,
        end_date: Optional[date] = None
    ) -> List[Dict[str, Any]]:
        """
        Get list of voided receipts.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            start_date: Optional start date filter
            end_date: Optional end date filter
            
        Returns:
            List of voided receipt details
        """
        query = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == True
        )
        
        if start_date:
            query = query.filter(func.date(Receipt.issue_date) >= start_date)
        if end_date:
            query = query.filter(func.date(Receipt.issue_date) <= end_date)
        
        receipts = query.order_by(Receipt.voided_at.desc()).all()
        
        result: List[Dict[str, Any]] = []
        for receipt in receipts:
            receipt_data: Dict[str, Any] = receipt.receipt_data  # type: ignore
            voided_by_user: Optional[User] = None
            if receipt.voided_by_user_id:
                voided_by_user = db.query(User).filter(User.id == receipt.voided_by_user_id).first()
            
            # Get voided_by_user name from UserClinicAssociation
            voided_by_user_name: Optional[str] = None
            if voided_by_user:
                association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == voided_by_user.id,
                    UserClinicAssociation.clinic_id == clinic_id
                ).first()
                voided_by_user_name = association.full_name if association else voided_by_user.email
            
            patient_data: Dict[str, Any] = receipt_data.get('patient', {})  # type: ignore
            
            result.append({
                'receipt_id': receipt.id,
                'receipt_number': receipt.receipt_number,
                'issue_date': receipt.issue_date.isoformat(),
                'voided_at': receipt.voided_at.isoformat() if receipt.voided_at else None,
                'voided_by_user_name': voided_by_user_name,
                'void_reason': receipt.void_reason,  # Read from column
                'patient_name': type_cast(str, patient_data.get('name', '')),  # type: ignore
                'total_amount': float(receipt.total_amount)
            })
        
        return result

    @staticmethod
    def check_receipt_number_limits(
        db: Session,
        clinic_id: int
    ) -> Dict[str, Any]:
        """
        Check receipt number sequence limits and provide warnings.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            Dictionary with current year stats and warnings
        """
        current_year = datetime.now().year
        
        # Count receipts for current year
        current_year_count = db.query(func.count(Receipt.id)).filter(
            Receipt.clinic_id == clinic_id,
            func.extract('year', Receipt.issue_date) == current_year
        ).scalar() or 0
        
        # Check if approaching limit (90,000)
        warning_threshold = 90000
        is_warning = current_year_count >= warning_threshold
        is_critical = current_year_count >= 99000
        
        return {
            'current_year': current_year,
            'current_year_receipt_count': current_year_count,
            'limit': 99999,
            'warning_threshold': warning_threshold,
            'is_warning': is_warning,
            'is_critical': is_critical,
            'remaining_capacity': 99999 - current_year_count
        }


