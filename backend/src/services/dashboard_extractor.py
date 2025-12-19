"""
Receipt item extractor for dashboard calculations.

Extracts structured ReceiptItem objects from Receipt entities,
handling edge cases and malformed data gracefully.
"""
from typing import List, Optional, Dict, Any
from datetime import date
from decimal import Decimal
import logging

from models.receipt import Receipt
from services.dashboard_types import ReceiptItem
from utils.datetime_utils import parse_datetime_string_to_taiwan

logger = logging.getLogger(__name__)


class ReceiptItemExtractor:
    """
    Extracts receipt items from Receipt entities.
    
    Handles:
    - Missing or malformed receipt_data
    - Missing visit_date (falls back to issue_date)
    - Missing item fields (uses defaults)
    - Quantity handling (defaults to 1 for backward compatibility)
    """
    
    @staticmethod
    def extract_items(
        receipts: List[Receipt],
        start_date: date,
        end_date: date
    ) -> List[ReceiptItem]:
        """
        Extract all receipt items from receipts, filtering by visit_date.
        
        Args:
            receipts: List of Receipt entities
            start_date: Start date for filtering (inclusive)
            end_date: End date for filtering (inclusive)
            
        Returns:
            List of ReceiptItem objects, one per item in each receipt
        """
        items: List[ReceiptItem] = []
        
        logger.debug(f"Extracting items from {len(receipts)} receipts for date range {start_date} to {end_date}")
        
        for receipt in receipts:
            try:
                receipt_items = ReceiptItemExtractor._extract_items_from_receipt(
                    receipt, start_date, end_date
                )
                if receipt_items:
                    logger.debug(f"Extracted {len(receipt_items)} items from receipt {receipt.id}")
                    items.extend(receipt_items)
                else:
                    logger.debug(f"No items extracted from receipt {receipt.id} (likely filtered by date)")
            except Exception as e:
                # Log error but continue processing other receipts
                logger.warning(
                    f"Error extracting items from receipt {receipt.id}: {e}",
                    exc_info=True
                )
                continue
        
        logger.debug(f"Total items extracted: {len(items)}")
        return items
    
    @staticmethod
    def _extract_items_from_receipt(
        receipt: Receipt,
        start_date: date,
        end_date: date
    ) -> List[ReceiptItem]:
        """
        Extract items from a single receipt.
        
        Returns empty list if receipt doesn't match date range or has errors.
        """
        receipt_data = receipt.receipt_data or {}
        
        # Get visit_date - prefer column, fallback to receipt_data, then issue_date
        visit_date_obj = receipt.visit_date
        # Check if visit_date is None (NULL column) - need explicit None check
        if visit_date_obj is None:
            visit_date_str = receipt_data.get('visit_date')
            if visit_date_str:
                try:
                    visit_date_obj = parse_datetime_string_to_taiwan(visit_date_str)
                except (ValueError, AttributeError) as e:
                    logger.warning(
                        f"Invalid visit_date in receipt {receipt.id}: {visit_date_str}, error: {e}"
                    )
                    # Fallback to issue_date if visit_date is invalid
                    visit_date_obj = receipt.issue_date
            else:
                # No visit_date in receipt_data, use issue_date
                visit_date_obj = receipt.issue_date
        
        # Final fallback: use issue_date if visit_date_obj is still None (shouldn't happen, but defensive)
        if visit_date_obj is None:  # type: ignore[unreachable]
            visit_date_obj = receipt.issue_date
        
        # Convert to date and filter by date range
        # visit_date_obj should be a datetime or date at this point
        try:
            # Try to get date() method (for datetime objects)
            if hasattr(visit_date_obj, 'date'):
                # For timezone-aware datetimes, convert to Taiwan timezone first
                # to ensure we get the correct date regardless of the datetime's timezone
                if hasattr(visit_date_obj, 'tzinfo') and visit_date_obj.tzinfo is not None:
                    from utils.datetime_utils import taiwan_now
                    # Convert to Taiwan timezone before extracting date
                    taiwan_tz = taiwan_now().tzinfo
                    visit_date_obj_taiwan = visit_date_obj.astimezone(taiwan_tz)
                    visit_date = visit_date_obj_taiwan.date()
                else:
                    visit_date = visit_date_obj.date()  # type: ignore
            else:
                # It's already a date object
                visit_date = visit_date_obj  # type: ignore
        except (AttributeError, TypeError):
            # Fallback: use issue_date
            logger.warning(f"Unexpected visit_date type in receipt {receipt.id}: {type(visit_date_obj)}")
            if hasattr(receipt.issue_date, 'date'):
                visit_date = receipt.issue_date.date()
            else:
                visit_date = receipt.issue_date  # type: ignore
        
        # Filter by date range
        if visit_date < start_date or visit_date > end_date:
            logger.debug(
                f"Receipt {receipt.id} filtered out by date: visit_date={visit_date}, "
                f"start_date={start_date}, end_date={end_date}, "
                f"receipt.visit_date column={receipt.visit_date}"
            )
            return []  # Receipt outside date range
        
        # Get receipt metadata
        receipt_id = receipt.id
        receipt_number = receipt_data.get('receipt_number', '')
        patient_data = receipt_data.get('patient', {})
        patient_id = patient_data.get('id')
        patient_name = patient_data.get('name', '')
        
        # Extract items
        items_data = receipt_data.get('items', [])
        if not isinstance(items_data, list):
            logger.warning(f"Invalid items format in receipt {receipt.id}")
            return []
        
        receipt_items: List[ReceiptItem] = []
        
        for item_data_raw in items_data:  # type: ignore[assignment]
            # Cast from JSONB data (type is unknown at compile time)
            item_data: Dict[str, Any] = item_data_raw  # type: ignore[assignment]
            try:
                item = ReceiptItemExtractor._extract_single_item(
                    item_data,  # type: ignore[arg-type]
                    receipt_id,
                    receipt_number,
                    visit_date,
                    patient_id,
                    patient_name
                )
                if item:
                    receipt_items.append(item)
            except Exception as e:
                logger.warning(
                    f"Error extracting item from receipt {receipt.id}: {e}",
                    exc_info=True
                )
                continue
        
        return receipt_items
    
    @staticmethod
    def _extract_single_item(
        item_data: Dict[str, Any],
        receipt_id: int,
        receipt_number: str,
        visit_date: date,
        patient_id: Optional[int],
        patient_name: str
    ) -> Optional[ReceiptItem]:
        """
        Extract a single receipt item from item_data dict.
        
        Returns None if item is invalid or missing required fields.
        """
        # Type check for dict (JSONB data is dynamic)
        if not isinstance(item_data, dict):  # type: ignore
            return None
        
        # Get item_type (required)
        item_type = item_data.get('item_type')  # type: ignore
        if item_type not in ['service_item', 'other']:
            logger.warning(f"Invalid item_type: {item_type}")
            return None
        
        # Extract financial data with defaults
        try:
            amount = Decimal(str(item_data.get('amount', 0)))  # type: ignore
            revenue_share = Decimal(str(item_data.get('revenue_share', 0)))  # type: ignore
            quantity = int(item_data.get('quantity', 1))  # type: ignore  # Default to 1 for backward compatibility
            if quantity < 1:
                quantity = 1  # Ensure quantity is at least 1
        except (ValueError, TypeError) as e:
            logger.warning(f"Invalid financial data in item: {e}")
            return None
        
        # Extract service item info if applicable
        service_item_id: Optional[int] = None
        service_item_name: Optional[str] = None
        receipt_name: Optional[str] = None
        item_name: Optional[str] = None
        
        if item_type == 'service_item':
            service_item_data = item_data.get('service_item')  # type: ignore
            if isinstance(service_item_data, dict):
                service_item_id = service_item_data.get('id')  # type: ignore
                # Extract name (historical name from receipt snapshot)
                service_item_name = service_item_data.get('name')  # type: ignore
                # Extract receipt_name (receipt display name, fallback to name if not set)
                receipt_name = service_item_data.get('receipt_name') or service_item_data.get('name')  # type: ignore
        elif item_type == 'other':
            item_name = item_data.get('item_name', '')  # type: ignore
            # For custom items, receipt_name is the same as item_name
            receipt_name = item_name
        
        # Extract practitioner info
        practitioner_id: Optional[int] = None
        practitioner_name: Optional[str] = None
        practitioner_data = item_data.get('practitioner')  # type: ignore
        if isinstance(practitioner_data, dict):
            practitioner_id = practitioner_data.get('id')  # type: ignore
            practitioner_name = practitioner_data.get('name')  # type: ignore
        
        # Extract billing scenario info
        billing_scenario_id: Optional[int] = None
        billing_scenario_name: Optional[str] = None
        billing_scenario_data = item_data.get('billing_scenario')  # type: ignore
        if isinstance(billing_scenario_data, dict):
            billing_scenario_id = billing_scenario_data.get('id')  # type: ignore
            billing_scenario_name = billing_scenario_data.get('name', '其他')  # type: ignore
        else:
            # Default to "其他" if no billing scenario
            billing_scenario_name = '其他'
        
        # Extract display order
        display_order = int(item_data.get('display_order', 0))  # type: ignore
        
        # Build ReceiptItem
        item: ReceiptItem = {
            'item_type': item_type,
            'service_item_id': service_item_id,
            'service_item_name': service_item_name,
            'receipt_name': receipt_name,
            'item_name': item_name,
            'amount': amount,
            'revenue_share': revenue_share,
            'quantity': quantity,
            'practitioner_id': practitioner_id,
            'practitioner_name': practitioner_name,
            'billing_scenario_id': billing_scenario_id,
            'billing_scenario_name': billing_scenario_name,
            'display_order': display_order,
            'receipt_id': receipt_id,
            'receipt_number': receipt_number,
            'visit_date': visit_date,
            'patient_id': patient_id,
            'patient_name': patient_name
        }
        
        return item

