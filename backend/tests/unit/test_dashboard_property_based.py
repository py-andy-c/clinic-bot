"""
Property-based tests for dashboard calculations.

These tests verify accounting invariants that must always hold true,
regardless of input data. Uses Hypothesis for property-based testing.
"""
import pytest
from typing import List
from datetime import date, timedelta
from decimal import Decimal

# Try to import hypothesis, skip tests if not available
try:
    from hypothesis import given, strategies as st
    HAS_HYPOTHESIS = True
except ImportError:
    HAS_HYPOTHESIS = False
    # Create dummy decorator and strategies for when hypothesis is not available
    def given(*args, **kwargs):
        def decorator(func):
            return func
        return decorator
    class strategies:
        @staticmethod
        def lists(*args, **kwargs):
            return []
        @staticmethod
        def fixed_dictionaries(*args, **kwargs):
            return {}
        @staticmethod
        def sampled_from(*args, **kwargs):
            return None
        @staticmethod
        def decimals(*args, **kwargs):
            return None
        @staticmethod
        def integers(*args, **kwargs):
            return None
        @staticmethod
        def text(*args, **kwargs):
            return None
        @staticmethod
        def dates(*args, **kwargs):
            return None
        @staticmethod
        def one_of(*args, **kwargs):
            return None
        @staticmethod
        def none():
            return None
    st = strategies

from services.dashboard_calculators import (
    SummaryMetricsCalculator,
    ServiceItemBreakdownCalculator,
    PractitionerBreakdownCalculator
)
from services.dashboard_types import ReceiptItem, DashboardFilters


# Strategy for generating ReceiptItem test data
def receipt_item_strategy():
    """Generate a ReceiptItem for testing."""
    if not HAS_HYPOTHESIS:
        # Return a dummy strategy that will be skipped
        return {}
    return st.fixed_dictionaries({
        'item_type': st.sampled_from(['service_item', 'other']),
        'amount': st.decimals(min_value=Decimal('0'), max_value=Decimal('10000'), places=2),
        'revenue_share': st.decimals(min_value=Decimal('0'), max_value=Decimal('10000'), places=2),
        'quantity': st.integers(min_value=1, max_value=10),
        'receipt_id': st.integers(min_value=1, max_value=1000),
        'receipt_number': st.text(min_size=1, max_size=20),
        'visit_date': st.dates(min_value=date(2020, 1, 1), max_value=date(2030, 12, 31)),
        'patient_id': st.one_of(st.none(), st.integers(min_value=1, max_value=1000)),
        'patient_name': st.text(min_size=1, max_size=50),
        'display_order': st.integers(min_value=0, max_value=10),
        'service_item_id': st.one_of(st.none(), st.integers(min_value=1, max_value=100)),
        'service_item_name': st.one_of(st.none(), st.text(min_size=1, max_size=50)),
        'item_name': st.one_of(st.none(), st.text(min_size=1, max_size=50)),
        'practitioner_id': st.one_of(st.none(), st.integers(min_value=1, max_value=100)),
        'practitioner_name': st.one_of(st.none(), st.text(min_size=1, max_size=50)),
        'billing_scenario_id': st.one_of(st.none(), st.integers(min_value=1, max_value=10)),
        'billing_scenario_name': st.one_of(st.none(), st.text(min_size=1, max_size=20))
    })


@pytest.mark.skipif(not HAS_HYPOTHESIS, reason="hypothesis library not installed")
class TestAccountingInvariants:
    """Property-based tests for accounting invariants."""
    
    @given(items=st.lists(receipt_item_strategy(), min_size=0, max_size=100))
    def test_total_revenue_equals_sum_of_items(self, items: List[ReceiptItem]):
        """
        Property: Total revenue must equal sum of all item totals.
        
        This is a fundamental accounting invariant that must always hold.
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        # Calculate using calculator
        summary = SummaryMetricsCalculator.calculate(items, filters)
        calculated_total = summary['total_revenue']
        
        # Calculate manually
        manual_total = Decimal('0')
        for item in items:
            amount = item.get('amount', Decimal('0'))
            quantity = item.get('quantity', 1)
            manual_total += amount * Decimal(str(quantity))
        
        # Allow small rounding tolerance
        tolerance = Decimal('0.01')
        assert abs(calculated_total - manual_total) <= tolerance, (
            f"Total revenue mismatch: calculated={calculated_total}, "
            f"manual={manual_total}, diff={abs(calculated_total - manual_total)}"
        )
    
    @given(items=st.lists(receipt_item_strategy(), min_size=1, max_size=100))
    def test_breakdown_total_matches_summary(self, items: List[ReceiptItem]):
        """
        Property: Breakdown totals must match summary totals (within rounding tolerance).
        
        The sum of all service item breakdowns should equal the total revenue from items
        that have valid identifiers (service_item_id or item_name).
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        summary = SummaryMetricsCalculator.calculate(items, filters)
        by_service = ServiceItemBreakdownCalculator.calculate(items, filters)
        
        # Calculate expected breakdown total from items with valid identifiers
        expected_breakdown_total = Decimal('0')
        for item in items:
            # Only count items that would appear in breakdown
            if item.get('item_type') == 'service_item':
                if item.get('service_item_id') is not None:
                    amount = item.get('amount', Decimal('0'))
                    quantity = item.get('quantity', 1)
                    expected_breakdown_total += amount * Decimal(str(quantity))
            elif item.get('item_type') == 'other':
                if item.get('item_name'):
                    amount = item.get('amount', Decimal('0'))
                    quantity = item.get('quantity', 1)
                    expected_breakdown_total += amount * Decimal(str(quantity))
        
        # Filter to only items with revenue > 0 (breakdowns filter these out)
        expected_breakdown_total = max(Decimal('0'), expected_breakdown_total)
        
        if expected_breakdown_total > 0:
            breakdown_total = sum(stat['total_revenue'] for stat in by_service)
            tolerance = Decimal('0.01')
            
            # Breakdown total should match expected (within tolerance)
            assert abs(expected_breakdown_total - breakdown_total) <= tolerance, (
                f"Breakdown total mismatch: expected={expected_breakdown_total}, "
                f"breakdown={breakdown_total}, diff={abs(expected_breakdown_total - breakdown_total)}"
            )
    
    @given(items=st.lists(receipt_item_strategy(), min_size=1, max_size=100))
    def test_percentages_sum_to_100(self, items: List[ReceiptItem]):
        """
        Property: Percentages in breakdown must sum to 100 (within rounding tolerance).
        
        When calculating percentages, the sum should be 100% (allowing for rounding).
        Only checks items that have valid identifiers and appear in breakdowns.
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        by_service = ServiceItemBreakdownCalculator.calculate(items, filters)
        by_practitioner = PractitionerBreakdownCalculator.calculate(items, filters)
        
        # Only check if there are items in the breakdowns
        if len(by_service) > 0:
            service_breakdown_total = sum(stat['total_revenue'] for stat in by_service)
            if service_breakdown_total > 0:
                service_pct_total = 0
                for stat in by_service:
                    pct = round(float(stat['total_revenue'] / service_breakdown_total * 100))
                    service_pct_total += pct
                
                # Allow 5% rounding tolerance (since we round to whole numbers,
                # with many items rounding errors can accumulate)
                assert abs(service_pct_total - 100) <= 5, (
                    f"Service percentages sum to {service_pct_total}, expected 100"
                )
        
        if len(by_practitioner) > 0:
            practitioner_breakdown_total = sum(stat['total_revenue'] for stat in by_practitioner)
            if practitioner_breakdown_total > 0:
                practitioner_pct_total = 0
                for stat in by_practitioner:
                    pct = round(float(stat['total_revenue'] / practitioner_breakdown_total * 100))
                    practitioner_pct_total += pct
                
                # Allow 5% rounding tolerance (since we round to whole numbers,
                # with many items rounding errors can accumulate)
                assert abs(practitioner_pct_total - 100) <= 5, (
                    f"Practitioner percentages sum to {practitioner_pct_total}, expected 100"
                )
    
    @given(items=st.lists(receipt_item_strategy(), min_size=0, max_size=100))
    def test_receipt_count_matches_unique_receipts(self, items: List[ReceiptItem]):
        """
        Property: Receipt count must equal unique receipt IDs.
        
        The valid_receipt_count should match the number of unique receipt IDs.
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        summary = SummaryMetricsCalculator.calculate(items, filters)
        
        # Count unique receipt IDs
        unique_receipt_ids = {item.get('receipt_id') for item in items if item.get('receipt_id')}
        unique_count = len(unique_receipt_ids)
        
        assert summary['valid_receipt_count'] == unique_count, (
            f"Receipt count mismatch: summary={summary['valid_receipt_count']}, "
            f"unique_receipts={unique_count}"
        )
    
    @given(items=st.lists(receipt_item_strategy(), min_size=0, max_size=100))
    def test_total_clinic_share_equals_sum_of_shares(self, items: List[ReceiptItem]):
        """
        Property: Total clinic share must equal sum of all item revenue shares.
        
        This is a fundamental accounting invariant for revenue distribution.
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        summary = SummaryMetricsCalculator.calculate(items, filters)
        calculated_share = summary['total_clinic_share']
        
        # Calculate manually
        manual_share = Decimal('0')
        for item in items:
            revenue_share = item.get('revenue_share', Decimal('0'))
            quantity = item.get('quantity', 1)
            manual_share += revenue_share * Decimal(str(quantity))
        
        # Allow small rounding tolerance
        tolerance = Decimal('0.01')
        assert abs(calculated_share - manual_share) <= tolerance, (
            f"Total clinic share mismatch: calculated={calculated_share}, "
            f"manual={manual_share}, diff={abs(calculated_share - manual_share)}"
        )
    
    @given(items=st.lists(receipt_item_strategy(), min_size=0, max_size=100))
    def test_receipt_item_count_equals_sum_of_quantities(self, items: List[ReceiptItem]):
        """
        Property: Receipt item count must equal sum of all item quantities.
        
        The receipt_item_count should match the total quantity of all items.
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        summary = SummaryMetricsCalculator.calculate(items, filters)
        calculated_count = summary['receipt_item_count']
        
        # Calculate manually
        manual_count = sum(item.get('quantity', 1) for item in items)
        
        assert calculated_count == manual_count, (
            f"Receipt item count mismatch: calculated={calculated_count}, "
            f"manual={manual_count}"
        )
    
    @given(items=st.lists(receipt_item_strategy(), min_size=0, max_size=100))
    def test_average_transaction_calculation(self, items: List[ReceiptItem]):
        """
        Property: Average transaction amount = total_revenue / valid_receipt_count.
        
        When there are receipts, the average should be calculated correctly.
        """
        filters: DashboardFilters = {
            'clinic_id': 1,
            'start_date': date(2020, 1, 1),
            'end_date': date(2030, 12, 31)
        }
        
        summary = SummaryMetricsCalculator.calculate(items, filters)
        
        if summary['valid_receipt_count'] > 0:
            expected_avg = summary['total_revenue'] / Decimal(str(summary['valid_receipt_count']))
            tolerance = Decimal('0.01')
            
            assert abs(summary['average_transaction_amount'] - expected_avg) <= tolerance, (
                f"Average transaction mismatch: calculated={summary['average_transaction_amount']}, "
                f"expected={expected_avg}, diff={abs(summary['average_transaction_amount'] - expected_avg)}"
            )
        else:
            # When there are no receipts, average should be 0
            assert summary['average_transaction_amount'] == Decimal('0'), (
                f"Average should be 0 when no receipts, got {summary['average_transaction_amount']}"
            )

