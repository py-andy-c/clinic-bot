"""
Integration tests for Business Insights and Revenue Distribution services.

Tests critical accounting logic including revenue calculations, clinic share,
date filtering, and edge cases.
"""

import pytest
from decimal import Decimal
from datetime import date, datetime, time, timedelta, timezone
from sqlalchemy.orm import Session

from models import (
    Clinic, User, Patient, AppointmentType, Appointment, CalendarEvent,
    PractitionerAppointmentTypes, Receipt, BillingScenario
)
from models.user_clinic_association import UserClinicAssociation
from services.receipt_service import ReceiptService
from services.billing_scenario_service import BillingScenarioService
from services.business_insights_service import (
    BusinessInsightsService,
    RevenueDistributionService
)
from utils.datetime_utils import taiwan_now


class TestBusinessInsightsService:
    """Tests for BusinessInsightsService."""

    @pytest.fixture
    def clinic_with_data(self, db_session: Session):
        """Create a clinic with test data for dashboard testing."""
        # Create clinic
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        # Create admin user
        admin_user = User(
            email="admin@test.com",
            google_subject_id="google_admin_123"
        )
        db_session.add(admin_user)
        db_session.flush()

        association = UserClinicAssociation(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            full_name="Admin User",
            roles=["admin"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        # Create practitioner
        practitioner_user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_123"
        )
        db_session.add(practitioner_user)
        db_session.flush()

        practitioner_association = UserClinicAssociation(
            user_id=practitioner_user.id,
            clinic_id=clinic.id,
            full_name="Dr. Smith",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner_association)
        db_session.commit()

        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        # Create appointment types
        apt_type1 = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            receipt_name="初診評估",
            duration_minutes=60
        )
        apt_type2 = AppointmentType(
            clinic_id=clinic.id,
            name="復健治療",
            receipt_name="復健治療",
            duration_minutes=30
        )
        db_session.add(apt_type1)
        db_session.add(apt_type2)
        db_session.commit()

        # Create practitioner-appointment type associations
        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner_user.id,
            appointment_type_id=apt_type1.id,
            clinic_id=clinic.id
        )
        pat2 = PractitionerAppointmentTypes(
            user_id=practitioner_user.id,
            appointment_type_id=apt_type2.id,
            clinic_id=clinic.id
        )
        db_session.add(pat1)
        db_session.add(pat2)
        db_session.flush()

        # Create billing scenarios
        scenario1 = BillingScenarioService.create_billing_scenario(
            db_session,
            pat1.id,
            "原價",
            Decimal("1000.00"),
            Decimal("300.00"),
            is_default=True
        )
        scenario2 = BillingScenarioService.create_billing_scenario(
            db_session,
            pat2.id,
            "原價",
            Decimal("500.00"),
            Decimal("150.00"),
            is_default=True
        )
        db_session.commit()

        return {
            'clinic': clinic,
            'admin_user': admin_user,
            'practitioner_user': practitioner_user,
            'patient': patient,
            'apt_type1': apt_type1,
            'apt_type2': apt_type2,
            'scenario1': scenario1,
            'scenario2': scenario2,
        }

    def test_revenue_calculation_with_quantity(self, db_session: Session, clinic_with_data):
        """Test revenue calculation correctly handles quantity > 1."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        # Create appointment
        visit_date = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create receipt with quantity > 1
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "quantity": 3,  # Quantity > 1
                "display_order": 0
            }
        ]

        receipt = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()

        # Test business insights
        start_date = visit_date
        end_date = visit_date
        insights = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, start_date, end_date
        )

        # Verify revenue calculation: amount * quantity = 1000 * 3 = 3000
        assert insights['summary']['total_revenue'] == 3000.0
        assert insights['summary']['valid_receipt_count'] == 1
        assert insights['summary']['service_item_count'] == 1

        # Verify by_service breakdown
        by_service = insights['by_service']
        assert len(by_service) == 1
        assert by_service[0]['total_revenue'] == 3000.0
        assert by_service[0]['item_count'] == 3  # Quantity, not receipt count

    def test_visit_date_filtering(self, db_session: Session, clinic_with_data):
        """Test that filtering uses visit_date, not issue_date."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        # Create appointment with visit_date = today
        visit_date = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create receipt (issue_date will be today, visit_date is also today)
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]

        receipt = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()

        # Test filtering by visit_date (should include this receipt)
        start_date = visit_date
        end_date = visit_date
        insights = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, start_date, end_date
        )

        assert insights['summary']['total_revenue'] == 1000.0
        assert insights['summary']['valid_receipt_count'] == 1

        # Test filtering by date range that doesn't include visit_date (should exclude)
        past_date = visit_date - timedelta(days=10)
        insights_empty = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, past_date, past_date
        )

        assert insights_empty['summary']['total_revenue'] == 0.0
        assert insights_empty['summary']['valid_receipt_count'] == 0

    def test_practitioner_filtering(self, db_session: Session, clinic_with_data):
        """Test practitioner filtering including null practitioners."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        practitioner_user = data['practitioner_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()

        # Create two appointments
        # Appointment 1: with practitioner
        calendar_event1 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event1)
        db_session.commit()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.commit()

        # Appointment 2: without practitioner (null)
        calendar_event2 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.add(calendar_event2)
        db_session.commit()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment2)
        db_session.commit()

        # Create receipts
        # Receipt 1: with practitioner
        items1 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": practitioner_user.id,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]
        receipt1 = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment1.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items1,
            payment_method="cash"
        )

        # Receipt 2: without practitioner (null)
        items2 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,  # No practitioner
                "billing_scenario_id": None,
                "amount": 800.00,
                "revenue_share": 240.00,
                "display_order": 0
            }
        ]
        receipt2 = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment2.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items2,
            payment_method="cash"
        )
        db_session.commit()

        # Test: Filter by specific practitioner
        insights_with_practitioner = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date,
            practitioner_id=practitioner_user.id
        )
        assert insights_with_practitioner['summary']['total_revenue'] == 1000.0

        # Test: Filter by null practitioner
        insights_null_practitioner = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date,
            practitioner_id='null'
        )
        assert insights_null_practitioner['summary']['total_revenue'] == 800.0

        # Test: No filter (should show both)
        insights_all = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date
        )
        assert insights_all['summary']['total_revenue'] == 1800.0

    def test_custom_service_items(self, db_session: Session, clinic_with_data):
        """Test custom service items are properly identified."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']

        visit_date = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create receipt with custom item
        items = [
            {
                "item_type": "other",
                "item_name": "特殊檢查",
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 500.00,
                "revenue_share": 150.00,
                "display_order": 0
            }
        ]

        receipt = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()

        # Test business insights
        insights = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date
        )

        # Verify custom item appears in by_service
        by_service = insights['by_service']
        assert len(by_service) == 1
        assert by_service[0]['is_custom'] is True
        assert by_service[0]['receipt_name'] == "特殊檢查"
        assert by_service[0]['service_item_id'] is None

    def test_percentage_calculations(self, db_session: Session, clinic_with_data):
        """Test percentage calculations are correct."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        apt_type2 = data['apt_type2']
        scenario1 = data['scenario1']
        scenario2 = data['scenario2']

        visit_date = date.today()

        # Create two receipts with different amounts
        # Receipt 1: 1000
        calendar_event1 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event1)
        db_session.commit()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.commit()

        items1 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]
        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment1.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items1,
            payment_method="cash"
        )

        # Receipt 2: 500
        calendar_event2 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(14, 0),
            end_time=time(14, 30)
        )
        db_session.add(calendar_event2)
        db_session.commit()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=apt_type2.id,
            status="confirmed"
        )
        db_session.add(appointment2)
        db_session.commit()

        items2 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type2.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario2.id,
                "amount": 500.00,
                "revenue_share": 150.00,
                "display_order": 0
            }
        ]
        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment2.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items2,
            payment_method="cash"
        )
        db_session.commit()

        # Test business insights
        insights = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date
        )

        # Total revenue = 1500
        # Service 1: 1000 / 1500 = 66.67% (should round to 67%)
        # Service 2: 500 / 1500 = 33.33% (should round to 33%)
        by_service = insights['by_service']
        assert len(by_service) == 2

        # Find service 1 (1000)
        service1 = next(s for s in by_service if s['total_revenue'] == 1000.0)
        assert service1['percentage'] == 67  # Rounded from 66.67%

        # Find service 2 (500)
        service2 = next(s for s in by_service if s['total_revenue'] == 500.0)
        assert service2['percentage'] == 33  # Rounded from 33.33%

    def test_voided_receipts_excluded(self, db_session: Session, clinic_with_data):
        """Test that voided receipts are excluded from calculations."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]

        receipt = ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()

        # Verify receipt is included
        insights_before = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date
        )
        assert insights_before['summary']['total_revenue'] == 1000.0

        # Void the receipt
        ReceiptService.void_receipt(
            db=db_session,
            receipt_id=receipt.id,
            voided_by_user_id=admin_user.id,
            reason="Test void"
        )
        db_session.commit()

        # Verify receipt is excluded
        insights_after = BusinessInsightsService.get_business_insights(
            db_session, clinic.id, visit_date, visit_date
        )
        assert insights_after['summary']['total_revenue'] == 0.0
        assert insights_after['summary']['valid_receipt_count'] == 0


class TestRevenueDistributionService:
    """Tests for RevenueDistributionService."""

    @pytest.fixture
    def clinic_with_data(self, db_session: Session):
        """Create a clinic with test data for dashboard testing."""
        # Reuse the same fixture from TestBusinessInsightsService
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()

        admin_user = User(
            email="admin@test.com",
            google_subject_id="google_admin_123"
        )
        db_session.add(admin_user)
        db_session.flush()

        association = UserClinicAssociation(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            full_name="Admin User",
            roles=["admin"],
            is_active=True
        )
        db_session.add(association)
        db_session.commit()

        practitioner_user = User(
            email="practitioner@test.com",
            google_subject_id="google_practitioner_123"
        )
        db_session.add(practitioner_user)
        db_session.flush()

        practitioner_association = UserClinicAssociation(
            user_id=practitioner_user.id,
            clinic_id=clinic.id,
            full_name="Dr. Smith",
            roles=["practitioner"],
            is_active=True
        )
        db_session.add(practitioner_association)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        apt_type1 = AppointmentType(
            clinic_id=clinic.id,
            name="初診評估",
            receipt_name="初診評估",
            duration_minutes=60
        )
        db_session.add(apt_type1)
        db_session.commit()

        pat1 = PractitionerAppointmentTypes(
            user_id=practitioner_user.id,
            appointment_type_id=apt_type1.id,
            clinic_id=clinic.id
        )
        db_session.add(pat1)
        db_session.flush()

        scenario1 = BillingScenarioService.create_billing_scenario(
            db_session,
            pat1.id,
            "原價",
            Decimal("1000.00"),
            Decimal("300.00"),
            is_default=True
        )
        scenario_other = BillingScenarioService.create_billing_scenario(
            db_session,
            pat1.id,
            "其他",
            Decimal("800.00"),
            Decimal("240.00"),
            is_default=False
        )
        db_session.commit()

        return {
            'clinic': clinic,
            'admin_user': admin_user,
            'practitioner_user': practitioner_user,
            'patient': patient,
            'apt_type1': apt_type1,
            'scenario1': scenario1,
            'scenario_other': scenario_other,
        }

    def test_summary_totals_match_items(self, db_session: Session, clinic_with_data):
        """Test that summary totals match sum of all items."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create receipt with multiple items
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "quantity": 2,
                "display_order": 0
            },
            {
                "item_type": "other",
                "item_name": "額外服務",
                "practitioner_id": None,
                "billing_scenario_id": None,
                "amount": 500.00,
                "revenue_share": 150.00,
                "quantity": 1,
                "display_order": 1
            }
        ]

        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()

        # Get revenue distribution (no pagination limit to get all items)
        distribution = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            page=1,
            page_size=100  # Large enough to get all items
        )

        # Calculate sum of items
        calculated_revenue = sum(item['amount'] for item in distribution['items'])
        calculated_share = sum(item['revenue_share'] for item in distribution['items'])

        # Verify summary matches
        # Item 1: 1000 * 2 = 2000, revenue_share: 300 * 2 = 600
        # Item 2: 500 * 1 = 500, revenue_share: 150 * 1 = 150
        # Total: 2500, Total share: 750
        assert abs(distribution['summary']['total_revenue'] - calculated_revenue) < 0.01
        assert abs(distribution['summary']['total_clinic_share'] - calculated_share) < 0.01
        assert distribution['summary']['total_revenue'] == 2500.0
        assert distribution['summary']['total_clinic_share'] == 750.0

    def test_show_overwritten_only_filter(self, db_session: Session, clinic_with_data):
        """Test that show_overwritten_only filter works and summary matches."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']
        scenario_other = data['scenario_other']

        visit_date = date.today()

        # Create two receipts: one with overwritten billing, one without
        # Receipt 1: Standard billing (not overwritten)
        calendar_event1 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event1)
        db_session.commit()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.commit()

        items1 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,  # Standard scenario
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]
        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment1.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items1,
            payment_method="cash"
        )

        # Receipt 2: Overwritten billing (billing_scenario = "其他")
        calendar_event2 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.add(calendar_event2)
        db_session.commit()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment2)
        db_session.commit()

        items2 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario_other.id,  # Overwritten scenario
                "amount": 800.00,
                "revenue_share": 240.00,
                "display_order": 0
            }
        ]
        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment2.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items2,
            payment_method="cash"
        )
        db_session.commit()

        # Test: Get all items
        all_items = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            show_overwritten_only=False,
            page_size=100
        )
        assert len(all_items['items']) == 2
        assert all_items['summary']['total_revenue'] == 1800.0

        # Test: Get only overwritten items
        overwritten = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            show_overwritten_only=True,
            page_size=100
        )

        # Verify all items have billing_scenario = '其他'
        assert len(overwritten['items']) == 1
        assert overwritten['items'][0]['billing_scenario'] == '其他'
        assert overwritten['items'][0]['amount'] == 800.0

        # Verify summary totals match filtered items
        overwritten_revenue = sum(item['amount'] for item in overwritten['items'])
        overwritten_share = sum(item['revenue_share'] for item in overwritten['items'])

        assert abs(overwritten['summary']['total_revenue'] - overwritten_revenue) < 0.01
        assert abs(overwritten['summary']['total_clinic_share'] - overwritten_share) < 0.01
        assert overwritten['summary']['total_revenue'] == 800.0
        assert overwritten['summary']['total_clinic_share'] == 240.0

    def test_quantity_handling(self, db_session: Session, clinic_with_data):
        """Test that quantity is properly handled in calculations."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()
        calendar_event = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Create receipt with quantity > 1
        items = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,  # Unit price
                "revenue_share": 300.00,  # Unit revenue share
                "quantity": 3,
                "display_order": 0
            }
        ]

        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items,
            payment_method="cash"
        )
        db_session.commit()

        # Get revenue distribution
        distribution = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            page_size=100
        )

        # Verify quantity is stored correctly
        assert len(distribution['items']) == 1
        item = distribution['items'][0]
        assert item['quantity'] == 3

        # Verify amount and revenue_share are multiplied by quantity
        # amount should be: 1000 * 3 = 3000
        # revenue_share should be: 300 * 3 = 900
        assert item['amount'] == 3000.0
        assert item['revenue_share'] == 900.0

        # Verify summary totals
        assert distribution['summary']['total_revenue'] == 3000.0
        assert distribution['summary']['total_clinic_share'] == 900.0

    def test_null_practitioner_filter(self, db_session: Session, clinic_with_data):
        """Test filtering by null practitioner."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        practitioner_user = data['practitioner_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()

        # Create two receipts: one with practitioner, one without
        # Receipt 1: with practitioner
        calendar_event1 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(10, 0),
            end_time=time(11, 0)
        )
        db_session.add(calendar_event1)
        db_session.commit()

        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        db_session.commit()

        items1 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": practitioner_user.id,
                "billing_scenario_id": scenario1.id,
                "amount": 1000.00,
                "revenue_share": 300.00,
                "display_order": 0
            }
        ]
        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment1.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items1,
            payment_method="cash"
        )

        # Receipt 2: without practitioner
        calendar_event2 = CalendarEvent(
            user_id=admin_user.id,
            clinic_id=clinic.id,
            event_type='appointment',
            date=visit_date,
            start_time=time(14, 0),
            end_time=time(15, 0)
        )
        db_session.add(calendar_event2)
        db_session.commit()

        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=apt_type1.id,
            status="confirmed"
        )
        db_session.add(appointment2)
        db_session.commit()

        items2 = [
            {
                "item_type": "service_item",
                "service_item_id": apt_type1.id,
                "practitioner_id": None,  # No practitioner
                "billing_scenario_id": None,
                "amount": 800.00,
                "revenue_share": 240.00,
                "display_order": 0
            }
        ]
        ReceiptService.create_receipt(
            db=db_session,
            appointment_id=appointment2.calendar_event_id,
            clinic_id=clinic.id,
            checked_out_by_user_id=admin_user.id,
            items=items2,
            payment_method="cash"
        )
        db_session.commit()

        # Test: Filter by null practitioner
        result = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            practitioner_id='null',
            page_size=100
        )

        # Verify all items have null practitioner
        assert len(result['items']) == 1
        assert result['items'][0]['practitioner_id'] is None
        assert result['items'][0]['practitioner_name'] is None or result['items'][0]['practitioner_name'] == '無'
        assert result['summary']['total_revenue'] == 800.0

    def test_pagination(self, db_session: Session, clinic_with_data):
        """Test pagination works correctly."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()

        # Create multiple receipts
        for i in range(5):
            calendar_event = CalendarEvent(
                user_id=admin_user.id,
                clinic_id=clinic.id,
                event_type='appointment',
                date=visit_date,
                start_time=time(10 + i, 0),
                end_time=time(11 + i, 0)
            )
            db_session.add(calendar_event)
            db_session.commit()

            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=apt_type1.id,
                status="confirmed"
            )
            db_session.add(appointment)
            db_session.commit()

            items = [
                {
                    "item_type": "service_item",
                    "service_item_id": apt_type1.id,
                    "practitioner_id": None,
                    "billing_scenario_id": scenario1.id,
                    "amount": 1000.00,
                    "revenue_share": 300.00,
                    "display_order": 0
                }
            ]

            ReceiptService.create_receipt(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                clinic_id=clinic.id,
                checked_out_by_user_id=admin_user.id,
                items=items,
                payment_method="cash"
            )
        db_session.commit()

        # Test pagination
        page1 = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            page=1,
            page_size=2
        )

        assert len(page1['items']) == 2
        assert page1['total'] == 5
        assert page1['page'] == 1
        assert page1['page_size'] == 2

        page2 = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            page=2,
            page_size=2
        )

        assert len(page2['items']) == 2
        assert page2['page'] == 2

        page3 = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            page=3,
            page_size=2
        )

        assert len(page3['items']) == 1
        assert page3['page'] == 3

        # Verify summary totals are consistent across pages
        assert page1['summary']['total_revenue'] == 5000.0  # 5 receipts * 1000
        assert page2['summary']['total_revenue'] == 5000.0
        assert page3['summary']['total_revenue'] == 5000.0

    def test_sorting(self, db_session: Session, clinic_with_data):
        """Test sorting works correctly."""
        data = clinic_with_data
        clinic = data['clinic']
        admin_user = data['admin_user']
        patient = data['patient']
        apt_type1 = data['apt_type1']
        scenario1 = data['scenario1']

        visit_date = date.today()

        # Create receipts with different amounts
        amounts = [3000.0, 1000.0, 2000.0]
        for amount in amounts:
            calendar_event = CalendarEvent(
                user_id=admin_user.id,
                clinic_id=clinic.id,
                event_type='appointment',
                date=visit_date,
                start_time=time(10, 0),
                end_time=time(11, 0)
            )
            db_session.add(calendar_event)
            db_session.commit()

            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=apt_type1.id,
                status="confirmed"
            )
            db_session.add(appointment)
            db_session.commit()

            items = [
                {
                    "item_type": "service_item",
                    "service_item_id": apt_type1.id,
                    "practitioner_id": None,
                    "billing_scenario_id": scenario1.id,
                    "amount": amount,
                    "revenue_share": amount * 0.3,
                    "display_order": 0
                }
            ]

            ReceiptService.create_receipt(
                db=db_session,
                appointment_id=appointment.calendar_event_id,
                clinic_id=clinic.id,
                checked_out_by_user_id=admin_user.id,
                items=items,
                payment_method="cash"
            )
        db_session.commit()

        # Test sorting by amount ascending
        sorted_asc = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            sort_by='amount',
            sort_order='asc',
            page_size=100
        )

        assert len(sorted_asc['items']) == 3
        assert sorted_asc['items'][0]['amount'] == 1000.0
        assert sorted_asc['items'][1]['amount'] == 2000.0
        assert sorted_asc['items'][2]['amount'] == 3000.0

        # Test sorting by amount descending
        sorted_desc = RevenueDistributionService.get_revenue_distribution(
            db_session, clinic.id, visit_date, visit_date,
            sort_by='amount',
            sort_order='desc',
            page_size=100
        )

        assert sorted_desc['items'][0]['amount'] == 3000.0
        assert sorted_desc['items'][1]['amount'] == 2000.0
        assert sorted_desc['items'][2]['amount'] == 1000.0

