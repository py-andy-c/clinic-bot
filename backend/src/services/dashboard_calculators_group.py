"""
Group breakdown calculator for dashboard calculations.

This module contains the GroupBreakdownCalculator which calculates
breakdown by service type group.
"""
from typing import List, Dict, Optional, Any
from decimal import Decimal
from sqlalchemy.orm import Session

from services.dashboard_types import (
    ReceiptItem,
    DashboardFilters,
    GroupBreakdown
)


class GroupBreakdownCalculator:
    """Calculates breakdown by service type group."""
    
    @staticmethod
    def calculate(
        items: List[ReceiptItem],
        filters: DashboardFilters,
        db: Optional[Session] = None  # Database session for looking up groups
    ) -> List[GroupBreakdown]:
        """
        Calculate breakdown by service type group.
        
        For service items, looks up the current group assignment from appointment_types.
        Custom items (item_type == "other") are grouped under "未分類" (ungrouped).
        
        Args:
            items: List of filtered receipt items
            filters: Filter criteria (includes clinic_id for lookup)
            db: Optional database session for looking up groups
            
        Returns:
            List of GroupBreakdown objects, sorted by revenue descending
        """
        if not items:
            return []
        
        from models import AppointmentType, ServiceTypeGroup
        
        clinic_id = filters.get('clinic_id')
        if not clinic_id or not db:
            # Can't look up groups without clinic_id and db
            return []
        
        # Build mapping from service_item_id to group_id
        service_item_ids = {
            item.get('service_item_id')
            for item in items
            if item.get('item_type') == 'service_item' and item.get('service_item_id')
        }
        
        group_mapping: Dict[Optional[int], Optional[int]] = {}
        if service_item_ids:
            appointment_types = db.query(AppointmentType).filter(
                AppointmentType.id.in_(service_item_ids),
                AppointmentType.clinic_id == clinic_id
            ).all()
            for at in appointment_types:
                group_mapping[at.id] = at.service_type_group_id
        
        # Build mapping from group_id to group_name
        group_ids = set(group_mapping.values())
        group_names: Dict[Optional[int], str] = {None: "未分類"}
        if group_ids:
            groups = db.query(ServiceTypeGroup).filter(
                ServiceTypeGroup.id.in_([gid for gid in group_ids if gid is not None]),
                ServiceTypeGroup.clinic_id == clinic_id
            ).all()
            for group in groups:
                group_names[group.id] = group.name
        
        # Aggregate by group
        stats: Dict[Optional[int], Dict[str, Any]] = {}  # type: ignore[type-arg]
        
        for item in items:
            # Determine group_id
            if item.get('item_type') == 'service_item':
                service_item_id = item.get('service_item_id')
                group_id = group_mapping.get(service_item_id)
            else:  # item_type == "other"
                group_id = None  # Custom items are ungrouped
            
            # Initialize stat if needed
            if group_id not in stats:
                group_name = group_names.get(group_id, "未分類")
                stats[group_id] = {
                    'service_type_group_id': group_id,
                    'group_name': group_name,
                    'total_revenue': Decimal('0'),
                    'receipt_count': 0,
                    'item_count': 0,
                    '_receipt_ids': set()  # Temporary field for tracking
                }
            
            # Aggregate (required fields - use direct access)
            amount = item['amount']
            quantity = item['quantity']
            item_total = amount * Decimal(str(quantity))
            stats[group_id]['total_revenue'] += item_total
            stats[group_id]['item_count'] += quantity
            
            # Track unique receipts (required field - use direct access)
            receipt_id = item['receipt_id']
            stats[group_id]['_receipt_ids'].add(receipt_id)
        
        # Convert to list and calculate receipt counts
        result: List[GroupBreakdown] = []
        for stat in stats.values():
            stat['receipt_count'] = len(stat['_receipt_ids'])
            del stat['_receipt_ids']  # Remove temporary field
            result.append(GroupBreakdown(
                service_type_group_id=stat['service_type_group_id'],
                group_name=stat['group_name'],
                total_revenue=stat['total_revenue'],
                receipt_count=stat['receipt_count'],
                item_count=stat['item_count']
            ))
        
        # Sort by revenue descending
        result.sort(key=lambda x: x['total_revenue'], reverse=True)
        
        return result

