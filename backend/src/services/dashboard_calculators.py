"""
Metric calculators for dashboard calculations.

Each calculator is responsible for computing a specific metric or breakdown,
following the single responsibility principle for better testability and maintainability.
"""
from typing import List, Dict, Set, Optional, Any
from datetime import date
from decimal import Decimal
from collections import defaultdict

from services.dashboard_types import (
    ReceiptItem,
    DashboardFilters,
    SummaryMetrics,
    TrendDataPoint,
    ServiceItemBreakdown,
    PractitionerBreakdown,
    Granularity
)


class SummaryMetricsCalculator:
    """Calculates summary metrics for business insights."""
    
    @staticmethod
    def calculate(
        items: List[ReceiptItem],
        filters: DashboardFilters
    ) -> SummaryMetrics:
        """
        Calculate all summary metrics from receipt items.
        
        Args:
            items: List of filtered receipt items
            filters: Filter criteria (used for context, not filtering)
            
        Returns:
            SummaryMetrics with all calculated values
        """
        if not items:
            return SummaryMetrics(
                total_revenue=Decimal('0'),
                valid_receipt_count=0,
                service_item_count=0,
                active_patients=0,
                average_transaction_amount=Decimal('0'),
                total_clinic_share=Decimal('0'),
                receipt_item_count=0
            )
        
        # Calculate totals
        total_revenue = Decimal('0')
        total_clinic_share = Decimal('0')
        receipt_item_count = 0
        
        # Track unique receipts, patients, and service items
        receipt_ids: Set[int] = set()
        patient_ids: Set[int] = set()
        service_item_ids: Set[int] = set()
        service_item_custom_names: Set[str] = set()
        
        for item in items:
            # Sum revenue and clinic share (required fields - use direct access)
            amount = item['amount']
            quantity = item['quantity']
            item_total = amount * Decimal(str(quantity))
            total_revenue += item_total
            
            item_revenue_share = item['revenue_share']
            item_clinic_share_total = item_revenue_share * Decimal(str(quantity))
            total_clinic_share += item_clinic_share_total
            
            # Count items
            receipt_item_count += quantity
            
            # Track unique receipts (required field)
            receipt_id = item['receipt_id']
            receipt_ids.add(receipt_id)
            
            # Track unique patients (optional field)
            patient_id = item.get('patient_id')
            if patient_id is not None:
                patient_ids.add(patient_id)
            
            # Track unique service items (including zero-revenue items)
            if item['item_type'] == 'service_item':
                service_item_id = item.get('service_item_id')
                if service_item_id is not None:
                    service_item_ids.add(service_item_id)
            elif item['item_type'] == 'other':
                item_name = item.get('item_name')
                if item_name:
                    service_item_custom_names.add(item_name)
        
        # Service item count includes both standard and custom items
        service_item_count = len(service_item_ids) + len(service_item_custom_names)
        
        # Calculate average transaction amount
        valid_receipt_count = len(receipt_ids)
        if valid_receipt_count > 0:
            average_transaction_amount = total_revenue / Decimal(str(valid_receipt_count))
        else:
            average_transaction_amount = Decimal('0')
        
        return SummaryMetrics(
            total_revenue=total_revenue,
            valid_receipt_count=valid_receipt_count,
            service_item_count=service_item_count,
            active_patients=len(patient_ids),
            average_transaction_amount=average_transaction_amount,
            total_clinic_share=total_clinic_share,
            receipt_item_count=receipt_item_count
        )


class RevenueTrendCalculator:
    """Calculates revenue trend over time."""
    
    @staticmethod
    def calculate(
        items: List[ReceiptItem],
        filters: DashboardFilters,
        granularity: Granularity = "daily"
    ) -> List[TrendDataPoint]:
        """
        Calculate revenue trend grouped by time period.
        
        Args:
            items: List of filtered receipt items
            filters: Filter criteria (for date range)
            granularity: Time granularity ("daily", "weekly", "monthly")
            
        Returns:
            List of TrendDataPoint objects, sorted by date
        """
        if not items:
            return []
        
        # Aggregate by date
        revenue_by_date: Dict[str, Decimal] = defaultdict(Decimal)
        receipt_count_by_date: Dict[str, Set[int]] = defaultdict(set)
        
        for item in items:
            # visit_date is required, but check for defensive programming
            visit_date = item['visit_date']
            if not visit_date:
                continue
            
            # Determine date key based on granularity
            if granularity == "daily":
                date_key = visit_date.isoformat()
            elif granularity == "weekly":
                date_key = RevenueTrendCalculator._get_week_key(visit_date)
            else:  # monthly
                date_key = RevenueTrendCalculator._get_month_key(visit_date)
            
            # Required fields - use direct access
            amount = item['amount']
            quantity = item['quantity']
            item_total = amount * Decimal(str(quantity))
            revenue_by_date[date_key] += item_total
            
            # Required field - use direct access
            receipt_id = item['receipt_id']
            receipt_count_by_date[date_key].add(receipt_id)
        
        # Build result list
        result: List[TrendDataPoint] = []
        for date_key in sorted(revenue_by_date.keys()):
            result.append(TrendDataPoint(
                date=date_key,
                revenue=revenue_by_date[date_key],
                receipt_count=len(receipt_count_by_date[date_key])
            ))
        
        return result
    
    @staticmethod
    def _get_week_key(d: date) -> str:
        """Get week key in format YYYY-WW."""
        # ISO week number
        year, week, _ = d.isocalendar()
        return f"{year}-W{week:02d}"
    
    @staticmethod
    def _get_month_key(d: date) -> str:
        """Get month key in format YYYY-MM."""
        return f"{d.year}-{d.month:02d}"


class ServiceItemBreakdownCalculator:
    """Calculates breakdown by service item."""
    
    @staticmethod
    def calculate(
        items: List[ReceiptItem],
        filters: DashboardFilters
    ) -> List[ServiceItemBreakdown]:
        """
        Calculate breakdown by service item.
        
        Filters out zero-revenue items for display (but they're included in count).
        
        Args:
            items: List of filtered receipt items
            filters: Filter criteria (not used for filtering, just context)
            
        Returns:
            List of ServiceItemBreakdown objects, sorted by revenue descending
        """
        if not items:
            return []
        
        # Aggregate by service item
        stats: Dict[str, Dict[str, Any]] = {}
        
        for item in items:
            # Required field - use direct access
            item_type = item['item_type']
            
            # Determine key for aggregation
            if item_type == 'service_item':
                service_item_id = item.get('service_item_id')
                if not service_item_id:
                    continue  # Skip items with missing service_item_id
                key = f"service_item:{service_item_id}"
                service_item_name = item.get('service_item_name', 'Unknown')
                receipt_name = item.get('receipt_name') or service_item_name
            elif item_type == 'other':
                item_name = item.get('item_name', '')
                if not item_name:
                    continue  # Skip items with missing name
                key = f"custom:{item_name}"
                service_item_id = None
                service_item_name = item_name
                receipt_name = item_name  # For custom items, receipt_name is the same as item_name
            else:
                continue  # Skip unknown item types
            
            # Initialize stat if needed
            if key not in stats:
                stats[key] = {
                    'service_item_id': service_item_id,
                    'service_item_name': service_item_name or 'Unknown',
                    'receipt_name': receipt_name or 'Unknown',
                    'total_revenue': Decimal('0'),
                    'receipt_count': 0,
                    'item_count': 0,
                    '_receipt_ids': set()  # Temporary field for tracking
                }
            
            # Aggregate (required fields - use direct access)
            amount = item['amount']
            quantity = item['quantity']
            item_total = amount * Decimal(str(quantity))
            stats[key]['total_revenue'] += item_total
            stats[key]['item_count'] += quantity
            
            # Track unique receipts (required field - use direct access)
            receipt_id = item['receipt_id']
            stats[key]['_receipt_ids'].add(receipt_id)
        
        # Convert to list and calculate receipt counts
        result: List[ServiceItemBreakdown] = []
        for stat in stats.values():
            receipt_count = len(stat['_receipt_ids'])
            del stat['_receipt_ids']  # Remove temporary field
            result.append(ServiceItemBreakdown(
                service_item_id=stat['service_item_id'],
                service_item_name=stat['service_item_name'],
                receipt_name=stat['receipt_name'],
                total_revenue=stat['total_revenue'],
                receipt_count=receipt_count,
                item_count=stat['item_count']
            ))
        
        # Filter out zero-revenue items for display
        result = [s for s in result if s['total_revenue'] > 0]
        
        # Sort by revenue descending
        result.sort(key=lambda x: x['total_revenue'], reverse=True)
        
        return result


class PractitionerBreakdownCalculator:
    """Calculates breakdown by practitioner."""
    
    @staticmethod
    def calculate(
        items: List[ReceiptItem],
        filters: DashboardFilters
    ) -> List[PractitionerBreakdown]:
        """
        Calculate breakdown by practitioner.
        
        Args:
            items: List of filtered receipt items
            filters: Filter criteria (not used for filtering, just context)
            
        Returns:
            List of PractitionerBreakdown objects, sorted by revenue descending
        """
        if not items:
            return []
        
        # Aggregate by practitioner
        stats: Dict[Optional[int], Dict[str, Any]] = {}
        
        for item in items:
            practitioner_id = item.get('practitioner_id')
            
            # Initialize stat if needed
            if practitioner_id not in stats:
                # Get practitioner name from item, or use default
                practitioner_name = item.get('practitioner_name')
                if practitioner_name is None:
                    practitioner_name = "無治療師" if practitioner_id is None else "Unknown"
                stats[practitioner_id] = {
                    'practitioner_id': practitioner_id,
                    'practitioner_name': practitioner_name,
                    'total_revenue': Decimal('0'),
                    'receipt_count': 0,
                    'item_count': 0,
                    '_receipt_ids': set()  # Temporary field for tracking
                }
            
            # Aggregate (required fields - use direct access)
            amount = item['amount']
            quantity = item['quantity']
            item_total = amount * Decimal(str(quantity))
            stats[practitioner_id]['total_revenue'] += item_total
            stats[practitioner_id]['item_count'] += quantity
            
            # Track unique receipts (required field - use direct access)
            receipt_id = item['receipt_id']
            stats[practitioner_id]['_receipt_ids'].add(receipt_id)
        
        # Convert to list and calculate receipt counts
        result: List[PractitionerBreakdown] = []
        for stat in stats.values():
            stat['receipt_count'] = len(stat['_receipt_ids'])
            del stat['_receipt_ids']  # Remove temporary field
            result.append(PractitionerBreakdown(
                practitioner_id=stat['practitioner_id'],
                practitioner_name=stat['practitioner_name'],
                total_revenue=stat['total_revenue'],
                receipt_count=stat['receipt_count'],
                item_count=stat['item_count']
            ))
        
        # Sort by revenue descending
        result.sort(key=lambda x: x['total_revenue'], reverse=True)
        
        return result

