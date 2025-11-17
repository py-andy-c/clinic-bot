"""
Unit tests for availability notification service.
"""

import pytest
from datetime import date, datetime, timedelta, time
from unittest.mock import Mock, patch, MagicMock
from sqlalchemy.orm import Session

from models import (
    AvailabilityNotification, LineUser, Patient, AppointmentType,
    Clinic, Appointment, CalendarEvent, User
)
from services.availability_notification_service import (
    AvailabilityNotificationService, TIME_WINDOWS
)
from utils.datetime_utils import taiwan_now, TAIWAN_TZ


class TestCreateNotification:
    """Test notification creation."""

    def test_create_notification_success(self, db_session: Session):
        """Test successful notification creation."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Execute
        notification, was_created = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["morning", "afternoon"],
            practitioner_id=None
        )
        
        # Assert
        assert was_created is True

        # Assert
        assert notification is not None
        assert notification.line_user_id == line_user.id
        assert notification.clinic_id == clinic.id
        assert notification.appointment_type_id == appt_type.id
        assert notification.date == notification_date
        assert notification.time_windows == ["morning", "afternoon"]
        assert notification.practitioner_id is None
        assert notification.status == "active"

    def test_create_notification_merges_time_windows(self, db_session: Session):
        """Test that creating duplicate notification merges time windows."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create first notification
        notification1, was_created1 = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["morning"],
            practitioner_id=None
        )
        assert was_created1 is True

        # Create duplicate with different time windows
        notification2, was_created2 = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["afternoon", "evening"],
            practitioner_id=None
        )
        assert was_created2 is False  # Should be an update

        # Assert - should be same notification, with merged time windows
        assert notification1.id == notification2.id
        # Time windows should be merged and sorted: ["afternoon", "evening", "morning"]
        assert set(notification2.time_windows) == {"morning", "afternoon", "evening"}
        assert notification2.time_windows == ["afternoon", "evening", "morning"]  # Sorted alphabetically

    def test_create_notification_merges_overlapping_time_windows(self, db_session: Session):
        """Test that merging time windows deduplicates overlapping windows."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user_merge", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create first notification with ["morning", "afternoon"]
        notification1, was_created1 = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["morning", "afternoon"],
            practitioner_id=None
        )
        assert was_created1 is True
        assert set(notification1.time_windows) == {"morning", "afternoon"}

        # Create duplicate with overlapping windows: ["afternoon", "evening"]
        notification2, was_created2 = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["afternoon", "evening"],  # "afternoon" overlaps
            practitioner_id=None
        )
        assert was_created2 is False  # Should be an update

        # Assert - should be same notification, with merged and deduplicated time windows
        assert notification1.id == notification2.id
        # Should have all three windows, with "afternoon" only once
        assert set(notification2.time_windows) == {"morning", "afternoon", "evening"}
        assert len(notification2.time_windows) == 3  # No duplicates
        assert notification2.time_windows == ["afternoon", "evening", "morning"]  # Sorted

    def test_create_notification_invalid_time_windows(self, db_session: Session):
        """Test that invalid time windows raise error."""
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Execute & Assert
        with pytest.raises(Exception):  # HTTPException
            AvailabilityNotificationService.create_notification(
                db=db_session,
                line_user_id=line_user.id,
                clinic_id=clinic.id,
                appointment_type_id=appt_type.id,
                date=notification_date,
                time_windows=["invalid"],
                practitioner_id=None
            )


class TestCancelOnAppointmentCreation:
    """Test cancelling notifications when appointment is created."""

    def test_cancel_notifications_on_appointment_creation(self, db_session: Session):
        """Test that notifications are cancelled when appointment is created."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create notification
        notification, was_created = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["morning"],
            practitioner_id=None
        )
        assert was_created is True
        assert notification.status == "active"

        # Execute - cancel notification
        AvailabilityNotificationService.cancel_on_appointment_creation(
            db=db_session,
            line_user_id=line_user.id,
            date=notification_date
        )

        # Assert
        db_session.refresh(notification)
        assert notification.status == "fulfilled"


class TestListNotifications:
    """Test listing notifications."""

    def test_list_notifications(self, db_session: Session):
        """Test listing notifications for a user."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create notification
        notification, was_created = AvailabilityNotificationService.create_notification(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            date=notification_date,
            time_windows=["morning"],
            practitioner_id=None
        )
        assert was_created is True

        # Execute
        notifications = AvailabilityNotificationService.list_notifications(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            status="active"
        )

        # Assert
        assert len(notifications) == 1
        assert notifications[0].id == notification.id
        assert notifications[0].date == notification_date.isoformat()
        assert notifications[0].status == "active"


class TestRateLimiting:
    """Test rate limiting for notifications."""

    def test_rate_limiting_prevents_multiple_notifications(self, db_session: Session):
        """Test that notifications are rate-limited (1 hour cooldown)."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create notification
        notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date,
            time_windows=["morning"],
            status="active",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ),
            last_notified_at=taiwan_now() - timedelta(minutes=30)  # Notified 30 minutes ago
        )
        db_session.add(notification)
        db_session.commit()

        # Mock slots available
        from shared_types.availability import Slot
        slots = [Slot(
            start_time="09:00",
            end_time="09:30",
            practitioner_id=1,
            practitioner_name="Test Practitioner"
        )]
        slots_by_window = {"morning": slots}

        # Check if should send (should be False due to rate limiting)
        should_send, matching_slots = AvailabilityNotificationService._should_send_notification(
            db_session, notification, notification_date, taiwan_now(), slots_by_window
        )

        assert should_send is False
        assert matching_slots == {}

    def test_rate_limiting_allows_after_cooldown(self, db_session: Session):
        """Test that notifications can be sent after cooldown period."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create notification with last_notified_at > 1 hour ago
        notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date,
            time_windows=["morning"],
            status="active",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ),
            last_notified_at=taiwan_now() - timedelta(hours=2)  # Notified 2 hours ago
        )
        db_session.add(notification)
        db_session.commit()

        # Mock slots available
        from shared_types.availability import Slot
        slots = [Slot(
            start_time="09:00",
            end_time="09:30",
            practitioner_id=1,
            practitioner_name="Test Practitioner"
        )]
        slots_by_window = {"morning": slots}

        # Check if should send (should be True after cooldown)
        should_send, matching_slots = AvailabilityNotificationService._should_send_notification(
            db_session, notification, notification_date, taiwan_now(), slots_by_window
        )

        assert should_send is True
        assert "morning" in matching_slots


class TestAppointmentConflict:
    """Test notification handling when user already has appointment."""

    def test_notification_cancelled_when_user_has_appointment(self, db_session: Session):
        """Test that notification is cancelled if user already has appointment."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create practitioner user
        practitioner = User(
            email="practitioner@test.com",
            google_subject_id="test_google_subject_123"
        )
        db_session.add(practitioner)
        db_session.commit()

        # Create notification
        notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date,
            time_windows=["morning"],
            status="active",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ)
        )
        db_session.add(notification)
        db_session.commit()

        # Create appointment for same date
        calendar_event = CalendarEvent(
            clinic_id=clinic.id,
            user_id=practitioner.id,  # Practitioner ID
            date=notification_date,
            start_time=time(9, 0),
            end_time=time(9, 30),
            event_type="appointment"
        )
        db_session.add(calendar_event)
        db_session.commit()

        appointment = Appointment(
            calendar_event_id=calendar_event.id,
            appointment_type_id=appt_type.id,
            status="confirmed"
        )
        db_session.add(appointment)
        db_session.commit()

        # Mock slots available
        from shared_types.availability import Slot
        slots = [Slot(
            start_time="09:00",
            end_time="09:30",
            practitioner_id=1,
            practitioner_name="Test Practitioner"
        )]
        slots_by_window = {"morning": slots}

        # Check if should send (should be False due to existing appointment)
        should_send, matching_slots = AvailabilityNotificationService._should_send_notification(
            db_session, notification, notification_date, taiwan_now(), slots_by_window
        )

        assert should_send is False
        assert matching_slots == {}
        
        # Verify notification was cancelled (commit happens inside _should_send_notification)
        db_session.refresh(notification)
        # Note: The status change is committed inside _should_send_notification
        # If refresh doesn't show it, we may need to query again
        if notification.status != "fulfilled":
            # Query again to ensure we have the latest state
            notification = db_session.query(AvailabilityNotification).filter(
                AvailabilityNotification.id == notification.id
            ).first()
        assert notification.status == "fulfilled"


class TestCheckAndNotify:
    """Test check_and_notify functionality."""

    def test_check_and_notify_no_matching_notifications(self, db_session: Session):
        """Test check_and_notify when no notifications match."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Execute - no notifications exist
        result = AvailabilityNotificationService.check_and_notify(
            db=db_session,
            clinic_id=clinic.id,
            date=notification_date,
            practitioner_id=1
        )

        assert result == 0

    def test_check_and_notify_no_line_service(self, db_session: Session):
        """Test check_and_notify when clinic has no LINE credentials."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="",  # Empty credentials (treated as missing)
            line_channel_access_token="",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()
        db_session.refresh(clinic)  # Ensure clinic is properly loaded

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create notification
        notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date,
            time_windows=["morning"],
            status="active",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ)
        )
        db_session.add(notification)
        db_session.commit()

        # Execute
        result = AvailabilityNotificationService.check_and_notify(
            db=db_session,
            clinic_id=clinic.id,
            date=notification_date,
            practitioner_id=1
        )

        assert result == 0  # No notifications sent due to missing LINE credentials

    def test_check_and_notify_no_slots_available(self, db_session: Session):
        """Test check_and_notify when no slots are available."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create notification
        notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date,
            time_windows=["morning"],
            status="active",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ)
        )
        db_session.add(notification)
        db_session.commit()

        # Mock AvailabilityService to return no slots
        with patch('services.availability_notification_service.AvailabilityService.get_available_slots_for_practitioner') as mock_get_slots:
            mock_get_slots.return_value = []  # No slots available

            # Execute
            result = AvailabilityNotificationService.check_and_notify(
                db=db_session,
                clinic_id=clinic.id,
                date=notification_date,
                practitioner_id=1
            )

            assert result == 0  # No notifications sent because no slots available


class TestListNotificationsEdgeCases:
    """Test edge cases for listing notifications."""

    def test_list_notifications_filters_by_status(self, db_session: Session):
        """Test that list_notifications filters by status correctly."""
        # Setup
        clinic = Clinic(
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token",
            settings={}
        )
        db_session.add(clinic)
        db_session.commit()

        line_user = LineUser(line_user_id="test_user", display_name="Test User")
        db_session.add(line_user)
        db_session.commit()

        patient = Patient(
            clinic_id=clinic.id,
            line_user_id=line_user.id,
            full_name="Test Patient",
            phone_number="0912345678"
        )
        db_session.add(patient)
        db_session.commit()

        appt_type = AppointmentType(
            clinic_id=clinic.id,
            name="Test Type",
            duration_minutes=30
        )
        db_session.add(appt_type)
        db_session.commit()

        notification_date = (taiwan_now().date() + timedelta(days=1))

        # Create active notification
        active_notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date,
            time_windows=["morning"],
            status="active",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date, time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ)
        )
        db_session.add(active_notification)

        # Create cancelled notification
        cancelled_notification = AvailabilityNotification(
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            appointment_type_id=appt_type.id,
            practitioner_id=None,
            date=notification_date + timedelta(days=1),
            time_windows=["afternoon"],
            status="cancelled",
            created_at=taiwan_now(),
            expires_at=datetime.combine(notification_date + timedelta(days=1), time(23, 59, 59)).replace(tzinfo=TAIWAN_TZ)
        )
        db_session.add(cancelled_notification)
        db_session.commit()

        # Test filtering by active status
        active_notifications = AvailabilityNotificationService.list_notifications(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            status="active"
        )
        assert len(active_notifications) == 1
        assert active_notifications[0].id == active_notification.id

        # Test filtering by cancelled status
        cancelled_notifications = AvailabilityNotificationService.list_notifications(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            status="cancelled"
        )
        assert len(cancelled_notifications) == 1
        assert cancelled_notifications[0].id == cancelled_notification.id

        # Test no status filter (should return all)
        all_notifications = AvailabilityNotificationService.list_notifications(
            db=db_session,
            line_user_id=line_user.id,
            clinic_id=clinic.id,
            status=None
        )
        assert len(all_notifications) == 2

