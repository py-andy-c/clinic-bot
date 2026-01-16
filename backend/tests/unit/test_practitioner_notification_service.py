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
    appointment.pending_time_confirmation = False  # Default to confirmed appointment

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


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_practitioner_notification_success(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test successful notification sending using unified method."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Mock recipient collection
    mock_collect_recipients.return_value = [mock_association]
    
    # Mock practitioner
    mock_practitioner = Mock(spec=User)
    mock_practitioner.id = 1
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
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
    assert "01/20 (一) 14:30" in call_args[0][1]
    assert "物理治療" in call_args[0][1]


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_practitioner_notification_no_line_account(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_clinic,
    mock_db
):
    """Test notification skipped when practitioner has no LINE account."""
    # Setup
    mock_practitioner = Mock(spec=User)
    mock_practitioner.id = 1
    mock_collect_recipients.return_value = []  # No recipients (no LINE account)
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is False
    mock_line_service_class.assert_not_called()


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_practitioner_notification_no_clinic_credentials(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification skipped when clinic has no LINE credentials."""
    # Setup
    mock_clinic.line_channel_secret = None
    mock_clinic.line_channel_access_token = None
    mock_practitioner = Mock(spec=User)
    mock_practitioner.id = 1
    mock_collect_recipients.return_value = [mock_association]
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is False
    mock_line_service_class.assert_not_called()


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_practitioner_notification_with_notes(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification includes notes when present."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_appointment.notes = "請準備X光片"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    mock_practitioner = Mock(spec=User)
    mock_practitioner.id = 1
    mock_collect_recipients.return_value = [mock_association]
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is True
    call_args = mock_line_service.send_text_message.call_args
    assert "備註：請準備X光片" in call_args[0][1]


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_practitioner_notification_no_patient(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification handles missing patient gracefully."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_appointment.patient = None
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    mock_practitioner = Mock(spec=User)
    mock_practitioner.id = 1
    mock_collect_recipients.return_value = [mock_association]
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is True
    call_args = mock_line_service.send_text_message.call_args
    assert "未知病患" in call_args[0][1]


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_practitioner_notification_line_service_error(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_association,
    mock_clinic,
    mock_db
):
    """Test notification handles LINE service errors gracefully."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_line_service = Mock()
    mock_line_service.send_text_message.side_effect = Exception("LINE API error")
    mock_line_service_class.return_value = mock_line_service
    mock_practitioner = Mock(spec=User)
    mock_practitioner.id = 1
    mock_collect_recipients.return_value = [mock_association]
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is False


@patch('services.message_template_service.get_practitioner_display_name_with_title')
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
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_display_name_with_title.return_value = "王小明治療師"
    
    # Mock patient with LINE user
    mock_patient = Mock()
    mock_patient.full_name = "病患"
    mock_patient.id = 1
    mock_line_user = Mock()
    mock_line_user.line_user_id = "U1234567890"
    mock_patient.line_user = mock_line_user
    mock_appointment.patient = mock_patient
    
    # Mock calendar event with user_id
    mock_calendar_event = Mock()
    mock_calendar_event.user_id = 1
    mock_calendar_event.date = date(2025, 1, 20)
    mock_calendar_event.start_time = time(14, 30)
    mock_appointment.calendar_event = mock_calendar_event
    
    # Mock appointment type with message settings
    mock_appointment_type = Mock()
    mock_appointment_type.send_clinic_confirmation = True
    mock_appointment_type.clinic_confirmation_message = "{病患姓名}，您的預約已建立：\n\n{預約時間} - 【{服務項目}】{治療師姓名}\n\n期待為您服務！"
    mock_appointment_type.name = "物理治療"
    mock_appointment_type.duration_minutes = 30  # Required for end time calculation
    mock_appointment.appointment_type = mock_appointment_type
    
    # Mock clinic properties needed for context
    mock_clinic.effective_display_name = "測試診所"
    mock_clinic.address = None
    mock_clinic.phone_number = None
    
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Execute
    result = NotificationService.send_appointment_confirmation(
        mock_db,
        mock_appointment,
        "王小明治療師",  # practitioner_name parameter (already includes title)
        mock_clinic,
        trigger_source='clinic_triggered'
    )
    
    # Assert
    assert result is True
    call_args = mock_line_service.send_text_message.call_args
    assert call_args[0][0] == "U1234567890"
    message = call_args[0][1]
    assert "病患" in message
    assert "王小明治療師" in message  # Should include title
    assert "物理治療" in message
    assert "01/20 (一) 14:30" in message


# Tests for unified notification methods

@pytest.fixture
def mock_practitioner():
    """Create a mock practitioner user."""
    practitioner = Mock(spec=User)
    practitioner.id = 1
    practitioner.full_name = "王醫師"
    return practitioner


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_unified_appointment_notification_success(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_practitioner,
    mock_clinic,
    mock_db
):
    """Test unified appointment notification sent successfully."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Mock recipient collection
    mock_association = Mock(spec=UserClinicAssociation)
    mock_association.user_id = 1
    mock_association.line_user_id = "U1234567890abcdef"
    mock_collect_recipients.return_value = [mock_association]
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is True
    mock_collect_recipients.assert_called_once()
    mock_line_service.send_text_message.assert_called_once()
    call_args = mock_line_service.send_text_message.call_args
    assert call_args[0][0] == "U1234567890abcdef"
    message = call_args[0][1]
    assert "新預約通知" in message
    assert "王醫師" in message
    assert "王小明" in message
    assert "01/20 (一) 14:30" in message
    assert "物理治療" in message


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_unified_cancellation_notification_success(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_practitioner,
    mock_clinic,
    mock_db
):
    """Test unified cancellation notification sent successfully."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Mock recipient collection
    mock_association = Mock(spec=UserClinicAssociation)
    mock_association.user_id = 1
    mock_association.line_user_id = "U1234567890abcdef"
    mock_collect_recipients.return_value = [mock_association]
    
    # Execute
    result = NotificationService.send_unified_cancellation_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner, cancelled_by='patient',
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is True
    mock_line_service.send_text_message.assert_called_once()
    call_args = mock_line_service.send_text_message.call_args
    message = call_args[0][1]
    assert "預約取消通知" in message
    assert "取消者：病患" in message


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
@patch('services.notification_service.User')
def test_send_unified_edit_notification_practitioner_changed(
    mock_user_class,
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_clinic,
    mock_db
):
    """Test unified edit notification when practitioner changed."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    # get_practitioner_display_name_with_title is called in this order:
    # 1. For current_practitioner (new_practitioner) -> "陳醫師"
    # 2. For old_practitioner (if changed) -> "王醫師"
    # So the message should be: "王醫師 → 陳醫師" (old → new)
    mock_get_practitioner_name.side_effect = ["陳醫師", "王醫師"]  # current (new), old
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Mock recipient collection
    mock_association = Mock(spec=UserClinicAssociation)
    mock_association.user_id = 1
    mock_association.line_user_id = "U1234567890abcdef"
    mock_collect_recipients.return_value = [mock_association]
    
    # Mock practitioners
    old_practitioner = Mock(spec=User)
    old_practitioner.id = 1
    new_practitioner = Mock(spec=User)
    new_practitioner.id = 2
    
    # Mock calendar event user_id lookup
    mock_appointment.calendar_event.user_id = 2
    mock_query = Mock()
    mock_query.filter.return_value.first.return_value = new_practitioner
    mock_db.query.return_value = mock_query
    
    # Execute
    result = NotificationService.send_unified_edit_notification(
        mock_db, mock_appointment, mock_clinic, old_practitioner, new_practitioner,
        old_start_time=None, include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is True
    mock_line_service.send_text_message.assert_called_once()
    call_args = mock_line_service.send_text_message.call_args
    message = call_args[0][1]
    assert "預約調整通知" in message
    assert "王醫師 → 陳醫師" in message


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
@patch('services.notification_service.User')
def test_send_unified_edit_notification_time_changed(
    mock_user_class,
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_practitioner,
    mock_clinic,
    mock_db
):
    """Test unified edit notification when time changed."""
    # Setup
    # format_datetime is called twice: once for current time, once for old time
    # First call is for current time (14:30), second is for old time (10:00)
    mock_format_datetime.side_effect = ["01/20 (一) 14:30", "01/20 (一) 10:00"]  # current, old
    mock_get_practitioner_name.return_value = "王醫師"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Mock recipient collection
    mock_association = Mock(spec=UserClinicAssociation)
    mock_association.user_id = 1
    mock_association.line_user_id = "U1234567890abcdef"
    mock_collect_recipients.return_value = [mock_association]
    
    # Mock calendar event user_id lookup
    mock_appointment.calendar_event.user_id = 1
    mock_query = Mock()
    mock_query.filter.return_value.first.return_value = mock_practitioner
    mock_db.query.return_value = mock_query
    
    # Mock old start time (10:00)
    from datetime import datetime as dt
    old_start_time = dt(2025, 1, 20, 10, 0)
    
    # Execute
    result = NotificationService.send_unified_edit_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner, mock_practitioner,
        old_start_time, include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is True
    mock_line_service.send_text_message.assert_called_once()
    call_args = mock_line_service.send_text_message.call_args
    message = call_args[0][1]
    assert "預約調整通知" in message
    # Message should show old → new: "10:00 → 14:30"
    assert "10:00 → 14:30" in message or "01/20 (一) 10:00 → 01/20 (一) 14:30" in message


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_unified_notification_deduplication(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_practitioner,
    mock_clinic,
    mock_db
):
    """Test that admin who is also practitioner receives only one message."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_line_service = Mock()
    mock_line_service_class.return_value = mock_line_service
    
    # Mock recipient collection - should return only one association (deduplicated)
    mock_association = Mock(spec=UserClinicAssociation)
    mock_association.user_id = 1
    mock_association.line_user_id = "U1234567890abcdef"
    mock_collect_recipients.return_value = [mock_association]  # Only one, not two
    
    # Execute - include both practitioner and admins
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=True
    )
    
    # Assert - should send only once (deduplicated)
    assert result is True
    assert mock_line_service.send_text_message.call_count == 1


@patch('utils.practitioner_helpers.get_practitioner_display_name_with_title')
@patch('services.notification_service.format_datetime')
@patch('services.line_service.LINEService')
@patch('services.notification_service.NotificationService._collect_notification_recipients')
def test_send_unified_notification_no_recipients(
    mock_collect_recipients,
    mock_line_service_class,
    mock_format_datetime,
    mock_get_practitioner_name,
    mock_appointment,
    mock_practitioner,
    mock_clinic,
    mock_db
):
    """Test unified notification returns False when no recipients."""
    # Setup
    mock_format_datetime.return_value = "01/20 (一) 14:30"
    mock_get_practitioner_name.return_value = "王醫師"
    mock_collect_recipients.return_value = []  # No recipients
    
    # Execute
    result = NotificationService.send_unified_appointment_notification(
        mock_db, mock_appointment, mock_clinic, mock_practitioner,
        include_practitioner=True, include_admins=False
    )
    
    # Assert
    assert result is False
    mock_line_service_class.assert_not_called()

