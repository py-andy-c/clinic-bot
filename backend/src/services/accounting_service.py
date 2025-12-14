"""
Service for accounting and revenue reporting.

Handles aggregation queries on receipt data for accounting dashboard.
"""

from typing import Dict, Any, List, Optional, cast as type_cast, Set
from decimal import Decimal
from datetime import datetime, date
from sqlalchemy.orm import Session
from sqlalchemy import func

from models.receipt import Receipt
from models.user import User
from models.user_clinic_association import UserClinicAssociation


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
        # Base query for non-voided receipts in date range
        base_query = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            func.date(Receipt.issue_date) >= start_date,
            func.date(Receipt.issue_date) <= end_date
        )
        
        # Filter by practitioner if specified
        if practitioner_id:
            # Filter receipts where at least one item has this practitioner
            # Use JSONB contains check - we'll filter in Python for accuracy
            # This is a simple approach; for better performance, could use JSONB path queries
            pass  # Will filter in Python loop below
        
        receipts = base_query.all()
        
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
        voided_count = db.query(func.count(Receipt.id)).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == True,
            func.date(Receipt.issue_date) >= start_date,
            func.date(Receipt.issue_date) <= end_date
        ).scalar() or 0
        
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
        # Get all receipts in date range, then filter by practitioner in Python
        receipts = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            func.date(Receipt.issue_date) >= start_date,
            func.date(Receipt.issue_date) <= end_date
        ).all()
        
        # Filter to only receipts with items for this practitioner
        filtered_receipts: List[Receipt] = []
        for receipt in receipts:
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
                item_detail: Dict[str, Any] = {
                    'receipt_id': receipt.id,
                    'receipt_number': receipt.receipt_number,
                    'issue_date': receipt.issue_date.isoformat(),
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


