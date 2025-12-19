"""
Unit tests for dashboard extractor.
"""
import pytest
from datetime import date, datetime, timezone, timedelta
from decimal import Decimal

from models.receipt import Receipt
from services.dashboard_extractor import ReceiptItemExtractor
from services.dashboard_types import ReceiptItem


class TestReceiptItemExtractor:
    """Test receipt item extraction."""
    
    def test_extract_items_basic(self):
        """Test basic item extraction."""
        # Create a mock receipt
        receipt = Receipt(
            id=1,
            clinic_id=1,
            appointment_id=1,
            receipt_number="2024-00001",
            issue_date=datetime.now(timezone(timedelta(hours=8))),
            visit_date=datetime.now(timezone(timedelta(hours=8))),
            total_amount=Decimal('100.00'),
            total_revenue_share=Decimal('80.00'),
            is_voided=False,
            receipt_data={
                'receipt_number': '2024-00001',
                'issue_date': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'visit_date': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'patient': {'id': 1, 'name': 'Test Patient'},
                'items': [
                    {
                        'item_type': 'service_item',
                        'amount': 100.0,
                        'revenue_share': 80.0,
                        'quantity': 1,
                        'service_item': {'id': 1, 'name': 'Test Service', 'receipt_name': 'Test Service'},
                        'practitioner': {'id': 1, 'name': 'Test Practitioner'},
                        'display_order': 0
                    }
                ]
            }
        )
        
        # Use the same date as the receipt's visit_date to avoid timezone issues
        visit_date_obj = receipt.visit_date or receipt.issue_date
        visit_date = visit_date_obj.date() if hasattr(visit_date_obj, 'date') else visit_date_obj
        start_date = visit_date
        end_date = visit_date
        
        items = ReceiptItemExtractor.extract_items([receipt], start_date, end_date)
        
        assert len(items) == 1
        assert items[0]['item_type'] == 'service_item'
        assert items[0]['service_item_id'] == 1
        assert items[0]['amount'] == Decimal('100.00')
        assert items[0]['quantity'] == 1
    
    def test_extract_items_filters_by_date(self):
        """Test that items are filtered by visit_date."""
        visit_date = date.today() - timedelta(days=10)
        receipt = Receipt(
            id=1,
            clinic_id=1,
            appointment_id=1,
            receipt_number="2024-00001",
            issue_date=datetime.now(timezone(timedelta(hours=8))),
            visit_date=datetime.combine(visit_date, datetime.min.time()).replace(tzinfo=timezone(timedelta(hours=8))),
            total_amount=Decimal('100.00'),
            total_revenue_share=Decimal('80.00'),
            is_voided=False,
            receipt_data={
                'receipt_number': '2024-00001',
                'issue_date': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'visit_date': datetime.combine(visit_date, datetime.min.time()).replace(tzinfo=timezone(timedelta(hours=8))).isoformat(),
                'patient': {'id': 1, 'name': 'Test Patient'},
                'items': [
                    {
                        'item_type': 'service_item',
                        'amount': 100.0,
                        'revenue_share': 80.0,
                        'quantity': 1,
                        'service_item': {'id': 1, 'name': 'Test Service', 'receipt_name': 'Test Service'},
                        'display_order': 0
                    }
                ]
            }
        )
        
        start_date = date.today()
        end_date = date.today()
        
        items = ReceiptItemExtractor.extract_items([receipt], start_date, end_date)
        
        # Should be empty because visit_date is outside range
        assert len(items) == 0
    
    def test_extract_items_handles_missing_visit_date(self):
        """Test that extractor handles missing visit_date gracefully."""
        receipt = Receipt(
            id=1,
            clinic_id=1,
            appointment_id=1,
            receipt_number="2024-00001",
            issue_date=datetime.now(timezone(timedelta(hours=8))),
            visit_date=None,  # Missing visit_date
            total_amount=Decimal('100.00'),
            total_revenue_share=Decimal('80.00'),
            is_voided=False,
            receipt_data={
                'receipt_number': '2024-00001',
                'issue_date': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                # Missing visit_date in receipt_data too
                'patient': {'id': 1, 'name': 'Test Patient'},
                'items': [
                    {
                        'item_type': 'service_item',
                        'amount': 100.0,
                        'revenue_share': 80.0,
                        'quantity': 1,
                        'service_item': {'id': 1, 'name': 'Test Service', 'receipt_name': 'Test Service'},
                        'display_order': 0
                    }
                ]
            }
        )
        
        # Use issue_date since visit_date is missing
        issue_date_obj = receipt.issue_date
        issue_date = issue_date_obj.date() if hasattr(issue_date_obj, 'date') else issue_date_obj
        start_date = issue_date
        end_date = issue_date
        
        # Should fallback to issue_date and still extract items
        items = ReceiptItemExtractor.extract_items([receipt], start_date, end_date)
        
        # Should extract items using issue_date as fallback
        assert len(items) == 1  # Should match since we're using issue_date
    
    def test_extract_items_custom_item(self):
        """Test extraction of custom items."""
        receipt = Receipt(
            id=1,
            clinic_id=1,
            appointment_id=1,
            receipt_number="2024-00001",
            issue_date=datetime.now(timezone(timedelta(hours=8))),
            visit_date=datetime.now(timezone(timedelta(hours=8))),
            total_amount=Decimal('50.00'),
            total_revenue_share=Decimal('40.00'),
            is_voided=False,
            receipt_data={
                'receipt_number': '2024-00001',
                'issue_date': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'visit_date': datetime.now(timezone(timedelta(hours=8))).isoformat(),
                'patient': {'id': 1, 'name': 'Test Patient'},
                'items': [
                    {
                        'item_type': 'other',
                        'amount': 50.0,
                        'revenue_share': 40.0,
                        'quantity': 1,
                        'item_name': 'Custom Item',
                        'display_order': 0
                    }
                ]
            }
        )
        
        # Use the same date as the receipt's visit_date to avoid timezone issues
        visit_date_obj = receipt.visit_date or receipt.issue_date
        visit_date = visit_date_obj.date() if hasattr(visit_date_obj, 'date') else visit_date_obj
        start_date = visit_date
        end_date = visit_date
        
        items = ReceiptItemExtractor.extract_items([receipt], start_date, end_date)
        
        assert len(items) == 1
        assert items[0]['item_type'] == 'other'
        assert items[0]['item_name'] == 'Custom Item'
        assert items[0]['service_item_id'] is None

