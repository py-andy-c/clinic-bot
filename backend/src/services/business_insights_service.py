"""
Service for business insights and revenue distribution dashboard.

Handles aggregation queries on receipt data for business insights and revenue distribution pages.
"""

import logging
from typing import Dict, Any, Optional, Union
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy import func, or_, and_, cast
from sqlalchemy.dialects import postgresql

from models.receipt import Receipt
from services.dashboard_engine import BusinessInsightsEngine, RevenueDistributionEngine
from services.dashboard_types import DashboardFilters

logger = logging.getLogger(__name__)

# Constant for null practitioner filter value
PRACTITIONER_NULL_FILTER = 'null'


class BusinessInsightsService:
    """Service for business insights operations."""

    @staticmethod
    def get_business_insights(
        db: Session,
        clinic_id: int,
        start_date: date,
        end_date: date,
        practitioner_id: Optional[Union[int, str]] = None,
        service_item_id: Optional[Union[int, str]] = None,
        service_type_group_id: Optional[Union[int, str]] = None
    ) -> Dict[str, Any]:
        """
        Get business insights data for a date range.
        
        Uses the new calculation engine for improved maintainability and type safety.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            start_date: Start date for the range
            end_date: End date for the range
            practitioner_id: Optional practitioner ID to filter by, or 'null' for no practitioner
            service_item_id: Optional service item ID or 'custom:name' to filter by
            
        Returns:
            Dictionary with summary, revenue trend, and breakdowns
        """
        # Query receipts directly by visit_date column (efficient with index)
        # Convert to Taiwan timezone before extracting date to ensure correct date comparison
        # Also include receipts with NULL visit_date (edge cases) - extractor will handle fallback
        receipts_query = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            or_(
                # Normal case: visit_date within range (convert to Taiwan timezone first)
                and_(
                    cast(
                        func.timezone('Asia/Taipei', Receipt.visit_date),
                        postgresql.DATE
                    ) >= start_date,
                    cast(
                        func.timezone('Asia/Taipei', Receipt.visit_date),
                        postgresql.DATE
                    ) <= end_date
                ),
                # Edge case: NULL visit_date (extractor will handle fallback)
                Receipt.visit_date.is_(None)
            )
        )
        
        receipts = receipts_query.all()
        logger.debug(
            f"Found {len(receipts)} receipts for clinic {clinic_id} "
            f"in visit_date range {start_date} to {end_date}"
        )
        # Note: The extractor will do final filtering by visit_date and handle NULL cases
        
        # Build filters for the engine
        filters: DashboardFilters = {
            'clinic_id': clinic_id,
            'start_date': start_date,
            'end_date': end_date,
            'service_item_id': None,
            'service_item_custom_name': None,
            'show_overwritten_only': False
        }
        
        # Parse practitioner_id - only set if explicitly provided
        if practitioner_id is not None:
            if practitioner_id == PRACTITIONER_NULL_FILTER:
                filters['practitioner_id'] = None  # None means "no practitioner"
            else:
                # Convert to int if it's a string
                filters['practitioner_id'] = int(practitioner_id) if isinstance(practitioner_id, str) else practitioner_id
        # else: don't set practitioner_id in filters (no filter)
        
        # Parse service_item_id
        if service_item_id is not None:
            if isinstance(service_item_id, str) and service_item_id.startswith('custom:'):
                filters['service_item_custom_name'] = service_item_id[7:]
            else:
                filters['service_item_id'] = int(service_item_id) if isinstance(service_item_id, str) else service_item_id
        # else: filters['service_item_id'] remains None (no filter)
        
        # Parse service_type_group_id
        if service_type_group_id is not None:
            # -1 means "ungrouped" (None in filters)
            if isinstance(service_type_group_id, str) and service_type_group_id == '-1':
                filters['service_type_group_id'] = None  # None means "ungrouped"
            elif service_type_group_id == -1:
                filters['service_type_group_id'] = None  # None means "ungrouped"
            else:
                filters['service_type_group_id'] = int(service_type_group_id) if isinstance(service_type_group_id, str) else service_type_group_id
        
        # Use the new calculation engine (pass db for group lookups)
        engine = BusinessInsightsEngine(db=db)
        return engine.compute(receipts, filters)


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
        service_type_group_id: Optional[Union[int, str]] = None,
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
            service_type_group_id: Optional service type group ID to filter by, or '-1' for ungrouped
            show_overwritten_only: If True, only show items with billing_scenario = "其他"
            page: Page number (1-indexed)
            page_size: Items per page
            sort_by: Column to sort by
            sort_order: 'asc' or 'desc'
            
        Returns:
            Dictionary with summary, items, and pagination info
        """
        # Query receipts directly by visit_date column (efficient with index)
        # Convert to Taiwan timezone before extracting date to ensure correct date comparison
        # Also include receipts with NULL visit_date (edge cases) - extractor will handle fallback
        receipts_query = db.query(Receipt).filter(
            Receipt.clinic_id == clinic_id,
            Receipt.is_voided == False,
            or_(
                # Normal case: visit_date within range (convert to Taiwan timezone first)
                and_(
                    cast(
                        func.timezone('Asia/Taipei', Receipt.visit_date),
                        postgresql.DATE
                    ) >= start_date,
                    cast(
                        func.timezone('Asia/Taipei', Receipt.visit_date),
                        postgresql.DATE
                    ) <= end_date
                ),
                # Edge case: NULL visit_date (extractor will handle fallback)
                Receipt.visit_date.is_(None)
            )
        )
        
        receipts = receipts_query.all()
        
        # Build filters for the engine
        filters: DashboardFilters = {
            'clinic_id': clinic_id,
            'start_date': start_date,
            'end_date': end_date,
            'show_overwritten_only': show_overwritten_only
        }
        
        # Parse practitioner_id - only set if explicitly provided
        if practitioner_id is not None:
            if practitioner_id == PRACTITIONER_NULL_FILTER:
                filters['practitioner_id'] = None  # None means "no practitioner"
            else:
                # Convert to int if it's a string
                filters['practitioner_id'] = int(practitioner_id) if isinstance(practitioner_id, str) else practitioner_id
        
        # Parse service_item_id
        if service_item_id is not None:
            if isinstance(service_item_id, str) and service_item_id.startswith('custom:'):
                filters['service_item_custom_name'] = service_item_id[7:]
            else:
                filters['service_item_id'] = int(service_item_id) if isinstance(service_item_id, str) else service_item_id
        
        # Parse service_type_group_id
        if service_type_group_id is not None:
            # -1 means "ungrouped" (None in filters)
            if isinstance(service_type_group_id, str) and service_type_group_id == '-1':
                filters['service_type_group_id'] = None  # None means "ungrouped"
            elif service_type_group_id == -1:
                filters['service_type_group_id'] = None  # None means "ungrouped"
            else:
                filters['service_type_group_id'] = int(service_type_group_id) if isinstance(service_type_group_id, str) else service_type_group_id
        
        # Use the revenue distribution engine (pass db for group filtering)
        engine = RevenueDistributionEngine(db=db)
        return engine.compute(receipts, filters, page, page_size, sort_by, sort_order)
