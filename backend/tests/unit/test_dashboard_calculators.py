"""
Unit tests for dashboard calculators.
"""
import pytest
from typing import List
from datetime import date
from decimal import Decimal

from services.dashboard_calculators import (
    SummaryMetricsCalculator,
    RevenueTrendCalculator,
    ServiceItemBreakdownCalculator,
    PractitionerBreakdownCalculator
)
from services.dashboard_types import ReceiptItem, DashboardFilters


class TestSummaryMetricsCalculator:
    """Test summary metrics calculation."""
    
    def test_calculate_empty_items(self):
        """Test calculation with no items."""
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date.today(),
            'end_date': date.today()
        }
        
        result = SummaryMetricsCalculator.calculate([], filters)
        
        assert result['total_revenue'] == Decimal('0')
        assert result['valid_receipt_count'] == 0
        assert result['service_item_count'] == 0
        assert result['active_patients'] == 0
        assert result['average_transaction_amount'] == Decimal('0')
    
    def test_calculate_basic(self):
        """Test basic calculation."""
        items: List[ReceiptItem] = [
            {
                'item_type': 'service_item',
                'service_item_id': 1,
                'service_item_name': 'Test Service',
                'amount': Decimal('100.00'),
                'revenue_share': Decimal('80.00'),
                'quantity': 1,
                'practitioner_id': 1,
                'practitioner_name': 'Test Practitioner',
                'receipt_id': 1,
                'receipt_number': '2024-00001',
                'visit_date': date.today(),
                'patient_id': 1,
                'patient_name': 'Test Patient',
                'display_order': 0
            },
            {
                'item_type': 'service_item',
                'service_item_id': 1,
                'service_item_name': 'Test Service',
                'amount': Decimal('50.00'),
                'revenue_share': Decimal('40.00'),
                'quantity': 2,  # Quantity = 2
                'practitioner_id': 1,
                'practitioner_name': 'Test Practitioner',
                'receipt_id': 2,
                'receipt_number': '2024-00002',
                'visit_date': date.today(),
                'patient_id': 2,
                'patient_name': 'Test Patient 2',
                'display_order': 0
            }
        ]
        
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date.today(),
            'end_date': date.today()
        }
        
        result = SummaryMetricsCalculator.calculate(items, filters)
        
        # Total revenue = 100 + (50 * 2) = 200
        assert result['total_revenue'] == Decimal('200.00')
        # 2 unique receipts
        assert result['valid_receipt_count'] == 2
        # 1 unique service item
        assert result['service_item_count'] == 1
        # 2 unique patients
        assert result['active_patients'] == 2
        # Average = 200 / 2 = 100
        assert result['average_transaction_amount'] == Decimal('100.00')
        # Total clinic share = 80 + (40 * 2) = 160
        assert result['total_clinic_share'] == Decimal('160.00')
        # Receipt item count = 1 + 2 = 3
        assert result['receipt_item_count'] == 3
    
    def test_calculate_includes_zero_revenue_items_in_count(self):
        """Test that zero-revenue items are included in service_item_count."""
        items: List[ReceiptItem] = [
            {
                'item_type': 'service_item',
                'service_item_id': 1,
                'service_item_name': 'Free Service',
                'amount': Decimal('0.00'),
                'revenue_share': Decimal('0.00'),
                'quantity': 1,
                'receipt_id': 1,
                'receipt_number': '2024-00001',
                'visit_date': date.today(),
                'patient_id': 1,
                'patient_name': 'Test Patient',
                'display_order': 0
            }
        ]
        
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date.today(),
            'end_date': date.today()
        }
        
        result = SummaryMetricsCalculator.calculate(items, filters)
        
        # Should count zero-revenue items
        assert result['service_item_count'] == 1
        assert result['total_revenue'] == Decimal('0.00')


class TestRevenueTrendCalculator:
    """Test revenue trend calculation."""
    
    def test_calculate_daily_granularity(self):
        """Test daily granularity."""
        items: List[ReceiptItem] = [
            {
                'item_type': 'service_item',
                'service_item_id': 1,
                'service_item_name': 'Test Service',
                'amount': Decimal('100.00'),
                'revenue_share': Decimal('80.00'),
                'quantity': 1,
                'receipt_id': 1,
                'receipt_number': '2024-00001',
                'visit_date': date(2024, 1, 1),
                'patient_id': 1,
                'patient_name': 'Test Patient',
                'display_order': 0
            },
            {
                'item_type': 'service_item',
                'service_item_id': 1,
                'service_item_name': 'Test Service',
                'amount': Decimal('50.00'),
                'revenue_share': Decimal('40.00'),
                'quantity': 1,
                'receipt_id': 2,
                'receipt_number': '2024-00002',
                'visit_date': date(2024, 1, 2),
                'patient_id': 1,
                'patient_name': 'Test Patient',
                'display_order': 0
            }
        ]
        
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2024, 1, 1),
            'end_date': date(2024, 1, 2)
        }
        
        result = RevenueTrendCalculator.calculate(items, filters, "daily")
        
        assert len(result) == 2
        assert result[0]['date'] == '2024-01-01'
        assert result[0]['revenue'] == Decimal('100.00')
        assert result[1]['date'] == '2024-01-02'
        assert result[1]['revenue'] == Decimal('50.00')


class TestServiceItemBreakdownCalculator:
    """Test service item breakdown calculation."""
    
    def test_calculate_filters_zero_revenue(self):
        """Test that zero-revenue items are filtered out of breakdown."""
        items: List[ReceiptItem] = [
            {
                'item_type': 'service_item',
                'service_item_id': 1,
                'service_item_name': 'Paid Service',
                'amount': Decimal('100.00'),
                'revenue_share': Decimal('80.00'),
                'quantity': 1,
                'receipt_id': 1,
                'receipt_number': '2024-00001',
                'visit_date': date.today(),
                'patient_id': 1,
                'patient_name': 'Test Patient',
                'display_order': 0
            },
            {
                'item_type': 'service_item',
                'service_item_id': 2,
                'service_item_name': 'Free Service',
                'amount': Decimal('0.00'),
                'revenue_share': Decimal('0.00'),
                'quantity': 1,
                'receipt_id': 2,
                'receipt_number': '2024-00002',
                'visit_date': date.today(),
                'patient_id': 1,
                'patient_name': 'Test Patient',
                'display_order': 0
            }
        ]
        
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date.today(),
            'end_date': date.today()
        }
        
        result = ServiceItemBreakdownCalculator.calculate(items, filters)
        
        # Should only include paid service
        assert len(result) == 1
        assert result[0]['service_item_id'] == 1
        assert result[0]['total_revenue'] == Decimal('100.00')

