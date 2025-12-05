"""
Unit tests for DashboardService.

Tests for dashboard metrics and statistics calculation.
"""

import pytest
from datetime import date, datetime, time, timedelta
from sqlalchemy.orm import Session

from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.appointment_type import AppointmentType
from models.appointment import Appointment
from models.calendar_event import CalendarEvent
from models.user_clinic_association import UserClinicAssociation
from services.dashboard_service import (
    DashboardService, MonthInfo, get_months_for_dashboard
)
from tests.conftest import (
    create_user_with_clinic_association,
    create_calendar_event_with_clinic
)
from utils.datetime_utils import taiwan_now, TAIWAN_TZ


class TestMonthInfo:
    """Test MonthInfo utility class."""
    
    def test_month_info_creation(self):
        """Test MonthInfo creation and properties."""
        month_info = MonthInfo(2024, 1, is_current=True)
        
        assert month_info.year == 2024
        assert month_info.month == 1
        assert month_info.is_current is True
        assert month_info.display_name == "2024年1月"
    
    def test_month_info_to_dict(self):
        """Test MonthInfo to_dict conversion."""
        month_info = MonthInfo(2024, 12, is_current=False)
        result = month_info.to_dict()
        
        assert result == {
            "year": 2024,
            "month": 12,
            "display_name": "2024年12月",
            "is_current": False
        }
    
    def test_month_info_start_end_dates(self):
        """Test MonthInfo start_date and end_date methods."""
        month_info = MonthInfo(2024, 2, is_current=False)  # February 2024 (leap year)
        
        assert month_info.start_date() == date(2024, 2, 1)
        assert month_info.end_date() == date(2024, 2, 29)  # Leap year


class TestGetMonthsForDashboard:
    """Test get_months_for_dashboard function."""
    
    def test_get_months_returns_four_months(self):
        """Test that get_months_for_dashboard returns exactly 4 months."""
        months = get_months_for_dashboard()
        
        assert len(months) == 4
        assert all(isinstance(m, MonthInfo) for m in months)
    
    def test_get_months_current_month_is_last(self):
        """Test that current month is the last in the list."""
        months = get_months_for_dashboard()
        
        assert months[-1].is_current is True
        assert all(not m.is_current for m in months[:-1])
    
    def test_get_months_ordered_oldest_to_newest(self):
        """Test that months are ordered from oldest to newest."""
        months = get_months_for_dashboard()
        
        for i in range(len(months) - 1):
            current = months[i]
            next_month = months[i + 1]
            
            # Check if current month is before next month
            if current.month < 12:
                assert (current.year == next_month.year and current.month < next_month.month) or \
                       (current.year < next_month.year)
            else:
                assert current.year < next_month.year and next_month.month == 1


class TestDashboardServiceActivePatients:
    """Test DashboardService.get_active_patients_by_month."""
    
    def test_active_patients_empty(self, db_session: Session):
        """Test active patients with no data."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_active_patients_by_month(
            db_session, clinic.id, months
        )
        
        assert len(results) == 4
        assert all(r['count'] == 0 for r in results)
    
    def test_active_patients_with_appointments(self, db_session: Session):
        """Test active patients with appointments in current month."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patients
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=taiwan_now()
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient 2",
            created_at=taiwan_now()
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.commit()
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_sub",
            roles=["practitioner"]
        )
        
        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()
        
        # Create appointments in current month
        now = taiwan_now()
        current_month = now.month
        current_year = now.year
        
        # Create calendar event and appointment for patient1
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            "appointment",
            date(current_year, current_month, 15),
            time(10, 0),
            time(10, 30)
        )
        db_session.flush()  # Flush to get calendar_event1.id
        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient1.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        
        # Create calendar event and appointment for patient2
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            "appointment",
            date(current_year, current_month, 20),
            time(14, 0),
            time(14, 30)
        )
        db_session.flush()  # Flush to get calendar_event2.id
        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient2.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(appointment2)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_active_patients_by_month(
            db_session, clinic.id, months
        )
        
        # Find current month result
        current_month_result = next(
            (r for r in results if r['month']['is_current']), None
        )
        
        assert current_month_result is not None
        assert current_month_result['count'] == 2  # Both patients have appointments
    
    def test_active_patients_excludes_cancelled(self, db_session: Session):
        """Test that cancelled appointments don't count toward active patients."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=taiwan_now()
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_sub",
            roles=["practitioner"]
        )
        
        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()
        
        # Create cancelled appointment in current month
        now = taiwan_now()
        current_month = now.month
        current_year = now.year
        
        calendar_event = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            "appointment",
            date(current_year, current_month, 15),
            time(10, 0),
            time(10, 30)
        )
        db_session.flush()  # Flush to get calendar_event.id
        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="canceled_by_patient"
        )
        db_session.add(appointment)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_active_patients_by_month(
            db_session, clinic.id, months
        )
        
        # Find current month result
        current_month_result = next(
            (r for r in results if r['month']['is_current']), None
        )
        
        assert current_month_result is not None
        assert current_month_result['count'] == 0  # Cancelled appointments don't count


class TestDashboardServiceNewPatients:
    """Test DashboardService.get_new_patients_by_month."""
    
    def test_new_patients_empty(self, db_session: Session):
        """Test new patients with no data."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_new_patients_by_month(
            db_session, clinic.id, months
        )
        
        assert len(results) == 4
        assert all(r['count'] == 0 for r in results)
    
    def test_new_patients_in_current_month(self, db_session: Session):
        """Test new patients created in current month."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patients in current month
        now = taiwan_now()
        patient1 = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=now - timedelta(days=5)
        )
        patient2 = Patient(
            clinic_id=clinic.id,
            full_name="Patient 2",
            created_at=now - timedelta(days=1)
        )
        db_session.add(patient1)
        db_session.add(patient2)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_new_patients_by_month(
            db_session, clinic.id, months
        )
        
        # Find current month result
        current_month_result = next(
            (r for r in results if r['month']['is_current']), None
        )
        
        assert current_month_result is not None
        assert current_month_result['count'] == 2


class TestDashboardServiceAppointments:
    """Test DashboardService.get_appointments_by_month."""
    
    def test_appointments_empty(self, db_session: Session):
        """Test appointments with no data."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_appointments_by_month(
            db_session, clinic.id, months
        )
        
        assert len(results) == 4
        assert all(r['count'] == 0 for r in results)
    
    def test_appointments_counts_confirmed_only(self, db_session: Session):
        """Test that only confirmed appointments are counted."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=taiwan_now()
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_sub",
            roles=["practitioner"]
        )
        
        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()
        
        # Create appointments in current month
        now = taiwan_now()
        current_month = now.month
        current_year = now.year
        
        # Confirmed appointment
        calendar_event1 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            "appointment",
            date(current_year, current_month, 15),
            time(10, 0),
            time(10, 30)
        )
        db_session.flush()  # Flush to get calendar_event1.id
        appointment1 = Appointment(
            calendar_event_id=calendar_event1.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(appointment1)
        
        # Cancelled appointment (should not be counted)
        calendar_event2 = create_calendar_event_with_clinic(
            db_session, practitioner, clinic,
            "appointment",
            date(current_year, current_month, 20),
            time(14, 0),
            time(14, 30)
        )
        db_session.flush()  # Flush to get calendar_event2.id
        appointment2 = Appointment(
            calendar_event_id=calendar_event2.id,
            patient_id=patient.id,
            appointment_type_id=appt_type.id,
            status="canceled_by_patient"
        )
        db_session.add(appointment2)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_appointments_by_month(
            db_session, clinic.id, months
        )
        
        # Find current month result
        current_month_result = next(
            (r for r in results if r['month']['is_current']), None
        )
        
        assert current_month_result is not None
        assert current_month_result['count'] == 1  # Only confirmed appointment


class TestDashboardServiceCancellationRate:
    """Test DashboardService.get_cancellation_rate_by_month."""
    
    def test_cancellation_rate_empty(self, db_session: Session):
        """Test cancellation rate with no data."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_cancellation_rate_by_month(
            db_session, clinic.id, months
        )
        
        assert len(results) == 4
        for r in results:
            assert r['canceled_by_clinic_count'] == 0
            assert r['canceled_by_patient_count'] == 0
            assert r['total_canceled_count'] == 0
            assert r['canceled_by_clinic_percentage'] == 0.0
            assert r['canceled_by_patient_percentage'] == 0.0
            assert r['total_cancellation_rate'] == 0.0
    
    def test_cancellation_rate_calculations(self, db_session: Session):
        """Test cancellation rate calculations."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=taiwan_now()
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_sub",
            roles=["practitioner"]
        )
        
        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()
        
        # Create appointments in current month
        now = taiwan_now()
        current_month = now.month
        current_year = now.year
        
        # 2 confirmed, 1 cancelled by clinic, 1 cancelled by patient
        for i, status in enumerate(["confirmed", "confirmed", "canceled_by_clinic", "canceled_by_patient"]):
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                "appointment",
                date(current_year, current_month, 10 + i),
                time(10 + i, 0),
                time(10 + i, 30)
            )
            db_session.flush()  # Flush to get calendar_event.id
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                status=status
            )
            db_session.add(appointment)
        
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_cancellation_rate_by_month(
            db_session, clinic.id, months
        )
        
        # Find current month result
        current_month_result = next(
            (r for r in results if r['month']['is_current']), None
        )
        
        assert current_month_result is not None
        assert current_month_result['canceled_by_clinic_count'] == 1
        assert current_month_result['canceled_by_patient_count'] == 1
        assert current_month_result['total_canceled_count'] == 2
        # Total: 4 appointments, 2 cancelled = 50%
        assert current_month_result['total_cancellation_rate'] == 50.0
        # 1 cancelled by clinic out of 4 = 25%
        assert current_month_result['canceled_by_clinic_percentage'] == 25.0
        # 1 cancelled by patient out of 4 = 25%
        assert current_month_result['canceled_by_patient_percentage'] == 25.0


class TestDashboardServiceAppointmentTypeStats:
    """Test DashboardService.get_appointment_type_stats_by_month."""
    
    def test_appointment_type_stats_empty(self, db_session: Session):
        """Test appointment type stats with no data."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_appointment_type_stats_by_month(
            db_session, clinic.id, months
        )
        
        assert len(results) == 0  # No appointment types = no results
    
    def test_appointment_type_stats_multiple_types(self, db_session: Session):
        """Test appointment type stats with multiple types."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=taiwan_now()
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create practitioner
        practitioner, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Test Practitioner",
            email="practitioner@test.com",
            google_subject_id="practitioner_sub",
            roles=["practitioner"]
        )
        
        # Create appointment types
        appt_type1 = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        appt_type2 = AppointmentType(
            clinic_id=clinic.id,
            name="Therapy",
            duration_minutes=60
        )
        db_session.add(appt_type1)
        db_session.add(appt_type2)
        db_session.commit()
        
        # Create appointments in current month
        now = taiwan_now()
        current_month = now.month
        current_year = now.year
        
        # 3 consultations, 1 therapy
        for i, appt_type in enumerate([appt_type1, appt_type1, appt_type1, appt_type2]):
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                "appointment",
                date(current_year, current_month, 10 + i),
                time(10 + i, 0),
                time(10 + i, 30)
            )
            db_session.flush()  # Flush to get calendar_event.id
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                status="confirmed"
            )
            db_session.add(appointment)
        
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_appointment_type_stats_by_month(
            db_session, clinic.id, months
        )
        
        # Filter to current month
        current_month_results = [
            r for r in results if r['month']['is_current']
        ]
        
        assert len(current_month_results) == 2
        
        # Check consultation (3 out of 4 = 75%)
        consultation = next(
            (r for r in current_month_results if r['appointment_type_name'] == "Consultation"),
            None
        )
        assert consultation is not None
        assert consultation['count'] == 3
        assert consultation['percentage'] == 75.0
        
        # Check therapy (1 out of 4 = 25%)
        therapy = next(
            (r for r in current_month_results if r['appointment_type_name'] == "Therapy"),
            None
        )
        assert therapy is not None
        assert therapy['count'] == 1
        assert therapy['percentage'] == 25.0


class TestDashboardServicePractitionerStats:
    """Test DashboardService.get_practitioner_stats_by_month."""
    
    def test_practitioner_stats_empty(self, db_session: Session):
        """Test practitioner stats with no data."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_practitioner_stats_by_month(
            db_session, clinic.id, months
        )
        
        assert len(results) == 0  # No practitioners = no results
    
    def test_practitioner_stats_multiple_practitioners(self, db_session: Session):
        """Test practitioner stats with multiple practitioners."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        db_session.add(clinic)
        db_session.commit()
        
        # Create patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Patient 1",
            created_at=taiwan_now()
        )
        db_session.add(patient)
        db_session.commit()
        
        # Create practitioners
        practitioner1, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 1",
            email="practitioner1@test.com",
            google_subject_id="practitioner1_sub",
            roles=["practitioner"]
        )
        practitioner2, _ = create_user_with_clinic_association(
            db_session, clinic,
            full_name="Practitioner 2",
            email="practitioner2@test.com",
            google_subject_id="practitioner2_sub",
            roles=["practitioner"]
        )
        
        # Create appointment type
        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Consultation",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()
        
        # Create appointments in current month
        now = taiwan_now()
        current_month = now.month
        current_year = now.year
        
        # 3 appointments with practitioner1, 1 with practitioner2
        practitioners = [practitioner1, practitioner1, practitioner1, practitioner2]
        for i, practitioner in enumerate(practitioners):
            calendar_event = create_calendar_event_with_clinic(
                db_session, practitioner, clinic,
                "appointment",
                date(current_year, current_month, 10 + i),
                time(10 + i, 0),
                time(10 + i, 30)
            )
            db_session.flush()  # Flush to get calendar_event.id
            appointment = Appointment(
                calendar_event_id=calendar_event.id,
                patient_id=patient.id,
                appointment_type_id=appt_type.id,
                status="confirmed"
            )
            db_session.add(appointment)
        
        db_session.commit()
        
        months = get_months_for_dashboard()
        results = DashboardService.get_practitioner_stats_by_month(
            db_session, clinic.id, months
        )
        
        # Filter to current month
        current_month_results = [
            r for r in results if r['month']['is_current']
        ]
        
        assert len(current_month_results) == 2
        
        # Check practitioner1 (3 out of 4 = 75%)
        p1 = next(
            (r for r in current_month_results if r['practitioner_name'] == "Practitioner 1"),
            None
        )
        assert p1 is not None
        assert p1['count'] == 3
        assert p1['percentage'] == 75.0
        
        # Check practitioner2 (1 out of 4 = 25%)
        p2 = next(
            (r for r in current_month_results if r['practitioner_name'] == "Practitioner 2"),
            None
        )
        assert p2 is not None
        assert p2['count'] == 1
        assert p2['percentage'] == 25.0

