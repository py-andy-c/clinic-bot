"""
Unit tests for practitioner appointment notification service.
"""
import pytest
from unittest.mock import Mock, patch
from datetime import datetime, date, time

from services.notification_service import NotificationService
from models import Appointment, User, Clinic
from models.user_clinic_association import UserClinicAssociation


@pytest.fixture
def mock_appointment():
    """Create a mock appointment."""
    appointment = Mock(spec=Appointment)
    appointment.calendar_event_id = 1
    appointment.notes = None
    
    # Mock calendar event
    calendar_event = Mock()
    calendar_event.date = date(2025, 1, 20)
    calendar_event.start_time = time(14, 30)
    appointment.calendar_event = calendar_event
    
    # Mock appointment type
    appointment_type = Mock()
    appointment_type.name = "物理治療"
    appointment.appointment_type = appointment_type
    
    # Mock patient
    patient = Mock()
    patient.full_name = "王小明"
    appointment.patient = patient
    
    return appointment


@pytest.fixture
def mock_association():
    """Create a mock user-clinic association."""
    association = Mock(spec=UserClinicAssociation)
    association.user_id = 1
    association.line_user_id = "U1234567890abcdef"
    return association


@pytest.fixture
def mock_clinic():
    """Create a mock clinic."""
    clinic = Mock(spec=Clinic)
    clinic.id = 1
    clinic.line_channel_secret = "test_secret"
    clinic.line_channel_access_token = "test_token"
    return clinic


@pytest.fixture
def mock_db():
    """Create a mock database session."""
    return Mock()


@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_practitioner_notification_success(
    mock_line_service_class,
    mock_format_datetime,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test successful notification sending."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Execute
    result = NotificationService.send_practitioner_appointment_notification(
        mock_db, mock_association, mock_appointment, mock_clinic
    )
    
    # Assert
    assert result is True
    mock_line_service_class.assert_called_once_with(
        channel_secret="test_secret",
        channel_access_token="test_token"
    )
    mock_line_service.send_text_message.assert_called_once()
    call_args = mock_line_service.send_text_message.call_args
    assert call_args[0][0] == "U1234567890abcdef"
    assert "新預約通知" in call_args[0][1]
    assert "王小明" in call_args[0][1]
    assert "01/20 (一) 2:30 PM" in call_args[0][1]
    assert "物理治療" in call_args[0][1]


@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_practitioner_notification_no_line_account(
    mock_line_service_class,
    mock_format_datetime,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification skipped when practitioner has no LINE account."""
    # Setup
    mock_association.line_user_id = None
    
    # Execute
    result = NotificationService.send_practitioner_appointment_notification(
        mock_db, mock_association, mock_appointment, mock_clinic
    )
    
    # Assert
    assert result is False
    mock_line_service_class.assert_not_called()


@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_practitioner_notification_no_clinic_credentials(
    mock_line_service_class,
    mock_format_datetime,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification skipped when clinic has no LINE credentials."""
    # Setup
    mock_clinic.line_channel_secret = None
    mock_clinic.line_channel_access_token = None
    
    # Execute
    result = NotificationService.send_practitioner_appointment_notification(
        mock_db, mock_association, mock_appointment, mock_clinic
    )
    
    # Assert
    assert result is False
    mock_line_service_class.assert_not_called()


@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_practitioner_notification_with_notes(
    mock_line_service_class,
    mock_format_datetime,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification includes notes when present."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
    mock_appointment.notes = "請準備X光片"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Execute
    result = NotificationService.send_practitioner_appointment_notification(
        mock_db, mock_association, mock_appointment, mock_clinic
    )
    
    # Assert
    assert result is True
    call_args = mock_line_service.send_text_message.call_args
    assert "備註：請準備X光片" in call_args[0][1]


@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_practitioner_notification_no_patient(
    mock_line_service_class,
    mock_format_datetime,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification handles missing patient gracefully."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
    mock_appointment.patient = None
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Execute
    result = NotificationService.send_practitioner_appointment_notification(
        mock_db, mock_association, mock_appointment, mock_clinic
    )
    
    # Assert
    assert result is True
    call_args = mock_line_service.send_text_message.call_args
    assert "未知病患" in call_args[0][1]


@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_practitioner_notification_line_service_error(
    mock_line_service_class,
    mock_format_datetime,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification handles LINE service errors gracefully."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
    mock_line_service = Mock()
    mock_line_service.send_text_message.side_effect = Exception("LINE API error")
    mock_line_service_class.return_value = mock_line_service
    
    # Execute
    result = NotificationService.send_practitioner_appointment_notification(
        mock_db, mock_association, mock_appointment, mock_clinic
    )
    
    # Assert
    assert result is False


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
def test_send_appointment_confirmation_with_title(
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_display_name_with_title,
    mock_appointment,
    mock_clinic,
    mock_db
):
    """Test that appointment confirmation includes practitioner title in message."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 2:30 PM"
    mock_get_practitioner_display_name_with_title.return_value = "王小明治療師"
    
    # Mock patient with LINE user
    mock_patient = Mock()
    mock_patient.full_name = "病患"
    mock_patient.id = 1
    mock_line_user = Mock()
    mock_line_user.line_user_id = "U1234567890"
    mock_patient.line_user = mock_line_user
    mock_patient.clinic = mock_clinic
    mock_appointment.patient = mock_patient
    mock_appointment.is_auto_assigned = False
    
    # Mock calendar event with user_id
    mock_calendar_event = Mock()
    mock_calendar_event.user_id = 1
    mock_calendar_event.date = date(2025, 1, 20)
    mock_calendar_event.start_time = time(14, 30)
    mock_appointment.calendar_event = mock_calendar_event
    
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Setup mock DB to return patient
    mock_db.query.return_value.filter.return_value.first.return_value = mock_patient
    mock_db.query.return_value.get.return_value = mock_clinic
    
    # Execute
    result = NotificationService.send_appointment_confirmation(
        mock_db,
        mock_appointment,
        "王小明",  # practitioner_name parameter (not used when calendar_event has user_id)
        mock_clinic,
        trigger_source='clinic_triggered'
    )
    
    # Assert
    assert result is True
    mock_get_practitioner_display_name_with_title.assert_called_once_with(
        mock_db, 1, mock_clinic.id
    )
    call_args = mock_line_service.send_text_message.call_args
    assert call_args[0][0] == "U1234567890"
    message = call_args[0][1]
    assert "病患" in message
    assert "王小明治療師" in message  # Should include title
    assert "物理治療" in message
    # Should not have hardcoded "治療師" appended (title is already in the name)
    assert message.count("治療師") == 1  # Only once in "王小明治療師"

