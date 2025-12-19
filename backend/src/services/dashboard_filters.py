"""
Filter applicator for dashboard calculations.

Applies filters to receipt items based on practitioner, service item, etc.
"""
from typing import List, Set, Optional

from services.dashboard_types import ReceiptItem, DashboardFilters


class FilterApplicator:
    """
    Applies filters to receipt items.
    
    Handles:
    - Practitioner filtering (including "無治療師" / null practitioner)
    - Service item filtering (including custom items by name)
    - Date range filtering (handled in extractor, but validated here)
    """
    
    @staticmethod
    def apply_filters(
        items: List[ReceiptItem],
        filters: DashboardFilters
    ) -> List[ReceiptItem]:
        """
        Apply all filters to receipt items.
        
        Args:
            items: List of receipt items to filter
            filters: Filter criteria
            
        Returns:
            Filtered list of receipt items
        """
        filtered = items
        
        # Filter by practitioner (only if explicitly set in filters)
        if 'practitioner_id' in filters:
            filtered = FilterApplicator._filter_by_practitioner(
                filtered, filters['practitioner_id']
            )
        
        # Filter by service item
        if 'service_item_id' in filters or 'service_item_custom_name' in filters:
            filtered = FilterApplicator._filter_by_service_item(
                filtered,
                filters.get('service_item_id'),
                filters.get('service_item_custom_name')
            )
        
        # Filter by billing scenario (for show_overwritten_only)
        if 'show_overwritten_only' in filters and filters.get('show_overwritten_only'):
            filtered = FilterApplicator._filter_by_billing_scenario(
                filtered, '其他'  # Only show items with billing_scenario_name == "其他"
            )
        
        return filtered
    
    @staticmethod
    def _filter_by_practitioner(
        items: List[ReceiptItem],
        practitioner_id: Optional[int]
    ) -> List[ReceiptItem]:
        """
        Filter items by practitioner.
        
        Args:
            items: List of receipt items
            practitioner_id: Practitioner ID to filter by, or None to filter for items with no practitioner
            
        Returns:
            Filtered list of items
        """
        if practitioner_id is None:
            # Filter for items with no practitioner ("無治療師")
            return [item for item in items if item.get('practitioner_id') is None]
        else:
            # Filter for items with specific practitioner
            return [item for item in items if item.get('practitioner_id') == practitioner_id]
    
    @staticmethod
    def _filter_by_service_item(
        items: List[ReceiptItem],
        service_item_id: Optional[int],
        service_item_custom_name: Optional[str]
    ) -> List[ReceiptItem]:
        """
        Filter items by service item.
        
        Args:
            items: List of receipt items
            service_item_id: Service item ID to filter by (for standard items)
            service_item_custom_name: Custom item name to filter by (for "other" type items)
            
        Returns:
            Filtered list of items
        """
        if service_item_id is not None:
            # Filter by standard service item ID
            return [
                item for item in items
                if item.get('item_type') == 'service_item'
                and item.get('service_item_id') == service_item_id
            ]
        elif service_item_custom_name is not None:
            # Filter by custom item name
            return [
                item for item in items
                if item.get('item_type') == 'other'
                and item.get('item_name') == service_item_custom_name
            ]
        else:
            # No filter
            return items
    
    @staticmethod
    def get_unique_service_item_ids(items: List[ReceiptItem]) -> Set[Optional[int]]:
        """
        Get unique service item IDs from items (for dropdown options).
        
        Returns set of service_item_id values, including None for custom items.
        """
        service_item_ids: Set[Optional[int]] = set()
        for item in items:
            if item.get('item_type') == 'service_item':
                service_item_id = item.get('service_item_id')
                if service_item_id is not None:
                    service_item_ids.add(service_item_id)
        return service_item_ids
    
    @staticmethod
    def get_unique_custom_item_names(items: List[ReceiptItem]) -> Set[str]:
        """
        Get unique custom item names from items (for dropdown options).
        
        Returns set of item_name values for "other" type items.
        """
        custom_names: Set[str] = set()
        for item in items:
            if item.get('item_type') == 'other':
                item_name = item.get('item_name')
                if item_name:
                    custom_names.add(item_name)
        return custom_names
    
    @staticmethod
    def has_null_practitioner(items: List[ReceiptItem]) -> bool:
        """
        Check if any items have no practitioner assigned.
        
        Used to determine if "無治療師" option should be shown in dropdown.
        """
        return any(item.get('practitioner_id') is None for item in items)
    
    @staticmethod
    def _filter_by_billing_scenario(
        items: List[ReceiptItem],
        billing_scenario_name: str
    ) -> List[ReceiptItem]:
        """
        Filter items by billing scenario name.
        
        Args:
            items: List of receipt items
            billing_scenario_name: Billing scenario name to filter by (e.g., "其他")
            
        Returns:
            Filtered list of items
        """
        return [
            item for item in items
            if item.get('billing_scenario_name') == billing_scenario_name
        ]

