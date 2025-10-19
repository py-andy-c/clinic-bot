"""
Unit tests for agent tools.

Tests the 7 agent tools that perform database operations and Google Calendar sync.
"""

import json
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch, MagicMock, AsyncMock
from sqlalchemy.orm import Session

from clinic_agents.tools import (
    get_therapist_availability,
    create_appointment,
    get_existing_appointments,
    cancel_appointment,
    reschedule_appointment,
    get_last_appointment_therapist,
    verify_and_link_patient
)
from clinic_agents.context import ConversationContext
from models.clinic import Clinic
from models.patient import Patient
from models.therapist import Therapist
from models.appointment import Appointment
from models.appointment_type import AppointmentType
from models.line_user import LineUser
from services.google_calendar_service import GoogleCalendarService, GoogleCalendarError


def create_mock_query_chain(return_value, method='first'):
    """Helper to create SQLAlchemy-style mock query chains."""
    mock_query = Mock()
    mock_filter = Mock()
    if method == 'first':
        mock_filter.first.return_value = return_value
    elif method == 'get':
        mock_query.get.return_value = return_value
    elif method == 'all':
        mock_filter.all.return_value = return_value
    else:
        setattr(mock_filter, method, Mock(return_value=return_value))
    mock_query.filter.return_value = mock_filter
    return mock_query


async def call_tool_function(tool, wrapper, **kwargs):
    """Helper to call a FunctionTool with the proper interface."""
    input_json = json.dumps(kwargs)
    return await tool.on_invoke_tool(wrapper, input_json)


class TestTherapistAvailability:
    """Test get_therapist_availability tool."""

    @pytest.mark.asyncio
    async def test_get_therapist_availability_success(self, db_session):
        """Test successful therapist availability lookup."""
        # Setup test data
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        apt_type = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)

        def query_side_effect(model):
            if model == Therapist:
                return create_mock_query_chain(therapist)
            elif model == AppointmentType:
                return create_mock_query_chain(apt_type)
            elif model == Appointment:
                return create_mock_query_chain([], 'all')
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_therapist_availability,
                wrapper,
                therapist_name="王大明",
                date="2024-01-15",
                appointment_type="初診評估"
            )

            assert "therapist_id" in result
            assert "available_slots" in result
            assert result["therapist_name"] == "王大明"
            assert result["appointment_type"] == "初診評估"
            assert isinstance(result["available_slots"], list)

    @pytest.mark.asyncio
    async def test_get_therapist_availability_therapist_not_found(self, db_session):
        """Test therapist availability when therapist doesn't exist."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', return_value=create_mock_query_chain(None)):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_therapist_availability,
                wrapper,
                therapist_name="不存在的治療師",
                date="2024-01-15",
                appointment_type="初診評估"
            )

            assert "error" in result
            assert "找不到治療師" in result["error"]

    @pytest.mark.asyncio
    async def test_get_therapist_availability_with_conflicts(self, db_session):
        """Test availability calculation with existing appointments."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        apt_type = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)

        # Existing appointment at 10:00-11:00
        existing_apt = Appointment(
            id=1,
            therapist_id=1,
            patient_id=1,
            appointment_type_id=1,
            start_time=datetime(2024, 1, 15, 10, 0),
            end_time=datetime(2024, 1, 15, 11, 0),
            status="confirmed"
        )

        def query_side_effect(model):
            if model == Therapist:
                return create_mock_query_chain(therapist)
            elif model == AppointmentType:
                return create_mock_query_chain(apt_type)
            elif model == Appointment:
                return create_mock_query_chain([existing_apt], 'all')
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_therapist_availability,
                wrapper,
                therapist_name="王大明",
                date="2024-01-15",
                appointment_type="初診評估"
            )

            # Should not include 10:00 slot due to conflict
            assert "10:00" not in result["available_slots"]

    @pytest.mark.asyncio
    async def test_get_therapist_availability_appointment_type_not_found(self, db_session):
        """Test therapist availability when appointment type doesn't exist."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")

        def query_side_effect(model):
            if model == Therapist:
                return create_mock_query_chain(therapist)
            elif model == AppointmentType:
                return create_mock_query_chain(None)
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_therapist_availability,
                wrapper,
                therapist_name="王大明",
                date="2024-01-15",
                appointment_type="不存在的類型"
            )

            assert "error" in result
            assert "找不到預約類型" in result["error"]

    @pytest.mark.asyncio
    async def test_get_therapist_availability_date_format_error(self, db_session):
        """Test therapist availability with invalid date format."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_user"
        )

        wrapper = Mock()
        wrapper.context = context

        result = await call_tool_function(
            get_therapist_availability,
            wrapper,
            therapist_name="王大明",
            date="invalid-date",
            appointment_type="初診評估"
        )

        assert "error" in result
        assert "日期格式錯誤" in result["error"]

    @pytest.mark.asyncio
    async def test_get_therapist_availability_general_error(self, db_session):
        """Test therapist availability with general exception."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Make query raise an exception
        with patch.object(db_session, 'query', side_effect=Exception("Database error")):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_therapist_availability,
                wrapper,
                therapist_name="王大明",
                date="2024-01-15",
                appointment_type="初診評估"
            )

            assert "error" in result
            assert "查詢可用時段時發生錯誤" in result["error"]


class TestCreateAppointment:
    """Test create_appointment tool."""

    @pytest.mark.asyncio
    @patch('clinic_agents.tools.GoogleCalendarService')
    async def test_create_appointment_success(self, mock_gcal_class, db_session):
        """Test successful appointment creation with Google Calendar sync."""
        # Setup mocks
        mock_gcal = Mock()
        mock_gcal.create_event.return_value = {'id': 'gcal_event_123'}
        mock_gcal_class.return_value = mock_gcal

        # Setup test data
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        therapist.gcal_credentials = '{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")
        apt_type = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)

        # Create proper mocks for query.get() calls
        mock_therapist_query = Mock()
        mock_therapist_query.get.return_value = therapist

        mock_patient_query = Mock()
        mock_patient_query.get.return_value = patient

        mock_apt_type_query = Mock()
        mock_apt_type_query.get.return_value = apt_type

        def query_side_effect(model):
            if model == Therapist:
                return mock_therapist_query
            elif model == Patient:
                return mock_patient_query
            elif model == AppointmentType:
                return mock_apt_type_query
            return Mock()

        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'add') as mock_add, \
             patch.object(db_session, 'commit') as mock_commit, \
             patch.object(db_session, 'refresh') as mock_refresh:

            # Setup Google Calendar service mock
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(return_value={'id': 'gcal_event_123'})
            mock_gcal.update_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                patient=patient,
                line_user_id="test_user",
                is_linked=True
            )

            wrapper = Mock()
            wrapper.context = context

            start_time = datetime(2024, 1, 15, 14, 0, tzinfo=timezone.utc)

            # Create a mock appointment that gets added
            mock_appointment = Mock()
            mock_appointment.id = 123
            mock_add.side_effect = lambda obj: setattr(obj, 'id', 123)

            result = await call_tool_function(
                create_appointment,
                wrapper,
                therapist_id=1,
                appointment_type_id=1,
                start_time=start_time.isoformat(),
                patient_id=1
            )

            assert result["success"] is True
            assert result["appointment_id"] == 123
            assert "gcal_event_id" in result
            assert "預約成功" in result["message"]
            assert "王大明" in result["message"]  # therapist name
            assert "初診評估" in result["message"]  # appointment type

            # Verify database operations
            mock_add.assert_called_once()
            mock_commit.assert_called_once()

            # Verify Google Calendar was called
            mock_gcal.create_event.assert_called_once()
            mock_gcal.update_event.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_appointment_therapist_not_found(self, db_session):
        """Test appointment creation when therapist doesn't exist."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', return_value=create_mock_query_chain(None, 'get')):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            start_time = datetime(2024, 1, 15, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                create_appointment,
                wrapper,
                therapist_id=999,
                appointment_type_id=1,
                start_time=start_time.isoformat(),
                patient_id=1
            )

            assert "error" in result
            assert "找不到" in result["error"]

    @pytest.mark.asyncio
    @patch('clinic_agents.tools.GoogleCalendarService')
    async def test_create_appointment_gcal_failure(self, mock_gcal_class, db_session):
        """Test appointment creation when Google Calendar fails."""
        # Setup mock to raise exception
        mock_gcal = Mock()
        mock_gcal.create_event = AsyncMock(side_effect=Exception("GCal API error"))
        mock_gcal_class.return_value = mock_gcal

        # Setup test data
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        therapist.gcal_credentials = '{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")
        apt_type = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)

        # Create proper mocks for query.get() calls
        mock_therapist_query = Mock()
        mock_therapist_query.get.return_value = therapist

        mock_patient_query = Mock()
        mock_patient_query.get.return_value = patient

        mock_apt_type_query = Mock()
        mock_apt_type_query.get.return_value = apt_type

        def query_side_effect(model):
            if model == Therapist:
                return mock_therapist_query
            elif model == Patient:
                return mock_patient_query
            elif model == AppointmentType:
                return mock_apt_type_query
            return Mock()

        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'rollback') as mock_rollback:

            # The service constructor itself might be async or have async operations
            # Make sure the service instance is properly mocked
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(side_effect=GoogleCalendarError("GCal API error"))
            mock_gcal_class.return_value = mock_gcal

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            start_time = datetime(2024, 1, 15, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                create_appointment,
                wrapper,
                therapist_id=1,
                appointment_type_id=1,
                start_time=start_time.isoformat(),
                patient_id=1
            )

            assert "error" in result
            assert "日曆同步失敗" in result["error"]

            # Verify database transaction was rolled back
            mock_rollback.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_appointment_integrity_error(self, db_session):
        """Test appointment creation when there's an integrity constraint violation."""
        from sqlalchemy.exc import IntegrityError

        # Setup test data
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        therapist.gcal_credentials = '{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")
        apt_type = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)

        # Create proper mocks for query.get() calls
        mock_therapist_query = Mock()
        mock_therapist_query.get.return_value = therapist

        mock_patient_query = Mock()
        mock_patient_query.get.return_value = patient

        mock_apt_type_query = Mock()
        mock_apt_type_query.get.return_value = apt_type

        def query_side_effect(model):
            if model == Therapist:
                return mock_therapist_query
            elif model == Patient:
                return mock_patient_query
            elif model == AppointmentType:
                return mock_apt_type_query
            return Mock()

        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'add') as mock_add, \
             patch.object(db_session, 'rollback') as mock_rollback:

            # Setup Google Calendar service mock
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(return_value={'id': 'gcal_event_123'})
            mock_gcal_class.return_value = mock_gcal

            # Make commit raise IntegrityError
            mock_commit = Mock(side_effect=IntegrityError("Duplicate key", None, None))
            db_session.commit = mock_commit

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            start_time = datetime(2024, 1, 15, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                create_appointment,
                wrapper,
                therapist_id=1,
                appointment_type_id=1,
                start_time=start_time.isoformat(),
                patient_id=1
            )

            assert "error" in result
            assert "預約時間衝突" in result["error"]

            # Verify database transaction was rolled back
            mock_rollback.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_appointment_general_error(self, db_session):
        """Test appointment creation with general exception."""
        # Setup test data
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', side_effect=Exception("Unexpected error")), \
             patch.object(db_session, 'rollback') as mock_rollback:

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            start_time = datetime(2024, 1, 15, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                create_appointment,
                wrapper,
                therapist_id=1,
                appointment_type_id=1,
                start_time=start_time.isoformat(),
                patient_id=1
            )

            assert "error" in result
            assert "建立預約時發生錯誤" in result["error"]

            # Verify database transaction was rolled back
            mock_rollback.assert_called_once()


class TestGetExistingAppointments:
    """Test get_existing_appointments tool."""

    @pytest.mark.asyncio
    async def test_get_existing_appointments_success(self, db_session):
        """Test successful retrieval of existing appointments."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")

        # Mock the query result
        mock_appointment = Mock()
        mock_appointment.id = 1
        mock_appointment.therapist = therapist
        mock_appointment.appointment_type = AppointmentType(id=1, name="初診評估", duration_minutes=60)
        mock_appointment.start_time = datetime(2024, 1, 20, 10, 0)
        mock_appointment.end_time = datetime(2024, 1, 20, 11, 0)
        mock_appointment.status = "confirmed"
        mock_appointment.gcal_event_id = "gcal_123"

        # Create a complex mock chain for the joined query
        mock_query = Mock()
        mock_filter = Mock()
        mock_join1 = Mock()
        mock_join2 = Mock()
        mock_order_by = Mock()

        mock_join1.join.return_value = mock_join2
        mock_join2.order_by.return_value = mock_order_by
        mock_order_by.all.return_value = [mock_appointment]

        mock_filter.join.return_value = mock_join1
        mock_query.filter.return_value = mock_filter

        with patch.object(db_session, 'query', return_value=mock_query):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_existing_appointments,
                wrapper,
                patient_id=1
            )

            assert isinstance(result, list)
            assert len(result) == 1
            assert result[0]["id"] == 1
            assert result[0]["therapist_name"] == "王大明"
            assert result[0]["appointment_type"] == "初診評估"

    @pytest.mark.asyncio
    async def test_get_existing_appointments_error(self, db_session):
        """Test get_existing_appointments with general exception."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', side_effect=Exception("Database error")):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                get_existing_appointments,
                wrapper,
                patient_id=1
            )

            assert isinstance(result, list)
            assert len(result) == 1
            assert "error" in result[0]
            assert "查詢預約時發生錯誤" in result[0]["error"]


class TestCancelAppointment:
    """Test cancel_appointment tool."""

    @pytest.mark.asyncio
    @patch('clinic_agents.tools.GoogleCalendarService')
    async def test_cancel_appointment_success(self, mock_gcal_class, db_session):
        """Test successful appointment cancellation."""
        # Setup Google Calendar mock
        mock_gcal = Mock()
        mock_gcal_class.return_value = mock_gcal

        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        therapist = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        therapist.gcal_credentials = '{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'
        apt_type = AppointmentType(id=1, name="初診評估", duration_minutes=60)

        # Create mock appointment with all required attributes
        mock_appointment = Mock()
        mock_appointment.id = 1
        mock_appointment.patient_id = 1
        mock_appointment.therapist = therapist
        mock_appointment.appointment_type = apt_type
        mock_appointment.start_time = datetime(2024, 1, 20, 10, 0)
        mock_appointment.gcal_event_id = "gcal_123"
        mock_appointment.status = "confirmed"

        # Mock the query.filter().first() chain
        mock_query = Mock()
        mock_filter = Mock()
        mock_filter.first.return_value = mock_appointment
        mock_query.filter.return_value = mock_filter

        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch.object(db_session, 'query', return_value=mock_query), \
             patch.object(db_session, 'commit') as mock_commit:

            # Setup Google Calendar service mock
            mock_gcal = Mock()
            mock_gcal.delete_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                cancel_appointment,
                wrapper,
                appointment_id=1,
                patient_id=1
            )

            assert result["success"] is True
            assert "預約已取消" in result["message"]

            # Verify database commit was called
            mock_commit.assert_called_once()

            # Verify Google Calendar was called
            mock_gcal.delete_event.assert_called_once_with("gcal_123")


class TestVerifyAndLinkPatient:
    """Test verify_and_link_patient tool."""

    @pytest.mark.asyncio
    async def test_verify_and_link_success(self, db_session):
        """Test successful patient verification and linking."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock patient query
        mock_patient = Mock()
        mock_patient.id = 1
        mock_patient.full_name = "測試病人"
        mock_patient.phone_number = "0912345678"

        # Create proper mocks for query.filter().first() calls
        mock_patient_query = Mock()
        mock_patient_filter = Mock()
        mock_patient_filter.first.return_value = mock_patient
        mock_patient_query.filter.return_value = mock_patient_filter

        mock_line_user_query = Mock()
        mock_line_user_filter = Mock()
        mock_line_user_filter.first.return_value = None  # No existing link
        mock_line_user_query.filter.return_value = mock_line_user_filter

        def query_side_effect(model):
            if model == Patient:
                return mock_patient_query
            elif model == LineUser:
                return mock_line_user_query
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'add') as mock_add, \
             patch.object(db_session, 'commit') as mock_commit:

            # Create mock line user that gets added
            mock_line_user = Mock()
            mock_line_user.id = 1
            mock_add.side_effect = lambda obj: setattr(obj, 'id', 1)

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                verify_and_link_patient,
                wrapper,
                phone_number="0912345678"
            )

            assert result.startswith("SUCCESS:")
            assert "帳號連結成功" in result
            assert "測試病人" in result

            # Verify database operations
            mock_add.assert_called_once()
            mock_commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_verify_and_link_patient_not_found(self, db_session):
        """Test linking when patient is not found."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', return_value=create_mock_query_chain(None)):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                verify_and_link_patient,
                wrapper,
                phone_number="0999999999"
            )

            assert result.startswith("NEEDS_NAME:")
            assert "尚未在系統中註冊" in result

    @pytest.mark.asyncio
    async def test_verify_and_link_already_linked_to_different_account(self, db_session):
        """Test linking when phone number is already linked to different LINE account."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        mock_patient = Mock()
        mock_patient.id = 1

        # Mock existing link to different LINE account
        mock_existing_link = Mock()
        mock_existing_link.patient_id = 1

        def query_side_effect(model):
            if model == Patient:
                return create_mock_query_chain(mock_patient)
            elif model == LineUser:
                return create_mock_query_chain(mock_existing_link)
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="different_line_user"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                verify_and_link_patient,
                wrapper,
                phone_number="0912345678"
            )

            assert result.startswith("ERROR:")
            assert "已連結到其他" in result


class TestRescheduleAppointment:
    """Test reschedule_appointment tool."""

    @pytest.mark.asyncio
    @patch('clinic_agents.tools.GoogleCalendarService')
    async def test_reschedule_appointment_success(self, mock_gcal_class, db_session):
        """Test successful appointment rescheduling."""
        # Setup test data
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock therapists
        old_therapist = Therapist(id=1, clinic_id=1, name="舊治療師", email="old@test.com")
        old_therapist.gcal_credentials = '{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'

        new_therapist = Therapist(id=2, clinic_id=1, name="新治療師", email="new@test.com")
        new_therapist.gcal_credentials = '{"client_id": "test", "client_secret": "test", "refresh_token": "test"}'

        # Mock appointment type and patient
        apt_type = AppointmentType(id=1, name="初診評估", duration_minutes=60)
        patient = Patient(id=1, clinic_id=1, full_name="測試病人", phone_number="0912345678")

        # Mock appointment
        mock_appointment = Mock()
        mock_appointment.id = 1
        mock_appointment.patient_id = 1
        mock_appointment.patient = patient
        mock_appointment.therapist = old_therapist
        mock_appointment.therapist_id = 1
        mock_appointment.appointment_type = apt_type
        mock_appointment.appointment_type_id = 1
        mock_appointment.start_time = datetime(2024, 1, 20, 10, 0)
        mock_appointment.end_time = datetime(2024, 1, 20, 11, 0)
        mock_appointment.gcal_event_id = "gcal_123"
        mock_appointment.status = "confirmed"

        # Create proper mocks for query.get() and query.filter().first() calls
        mock_appointment_query = Mock()
        mock_appointment_filter = Mock()
        mock_appointment_filter.first.return_value = mock_appointment
        mock_appointment_query.filter.return_value = mock_appointment_filter

        mock_therapist_query = Mock()
        def get_side_effect(therapist_id):
            if therapist_id == 2:
                return new_therapist
            return old_therapist
        mock_therapist_query.get.side_effect = get_side_effect

        mock_apt_type_query = Mock()
        mock_apt_type_query.get.return_value = apt_type

        def query_side_effect(model):
            if model == Appointment:
                return mock_appointment_query
            elif model == Therapist:
                return mock_therapist_query
            elif model == AppointmentType:
                return mock_apt_type_query
            return Mock()

        with patch('clinic_agents.tools.GoogleCalendarService') as mock_gcal_class, \
             patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'commit') as mock_commit:

            # Setup Google Calendar service mock
            mock_gcal = Mock()
            mock_gcal.create_event = AsyncMock(return_value={'id': 'new_gcal_event_123'})
            mock_gcal.delete_event = AsyncMock(return_value=None)
            mock_gcal_class.return_value = mock_gcal

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            new_start_time = datetime(2024, 1, 20, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                reschedule_appointment,
                wrapper,
                appointment_id=1,
                patient_id=1,
                new_start_time=new_start_time.isoformat(),
                new_therapist_id=2,
                new_appointment_type_id=1
            )

            assert result["success"] is True
            assert "預約已更改" in result["message"]

            # Verify database commit was called
            mock_commit.assert_called_once()

            # Verify Google Calendar operations
            mock_gcal.delete_event.assert_called_once_with("gcal_123")
            mock_gcal.create_event.assert_called_once()

    @pytest.mark.asyncio
    async def test_reschedule_appointment_not_found(self, db_session):
        """Test rescheduling when appointment doesn't exist."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', return_value=create_mock_query_chain(None)):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            new_start_time = datetime(2024, 1, 20, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                reschedule_appointment,
                wrapper,
                appointment_id=999,
                patient_id=1,
                new_start_time=new_start_time.isoformat()
            )

            assert "error" in result
            assert "找不到該預約" in result["error"]

    @pytest.mark.asyncio
    async def test_reschedule_appointment_therapist_not_found(self, db_session):
        """Test rescheduling when new therapist doesn't exist."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock appointment
        mock_appointment = Mock()
        mock_appointment.id = 1
        mock_appointment.patient_id = 1
        mock_appointment.status = "confirmed"

        def query_side_effect(model):
            mock_query = Mock()
            if model == Appointment:
                mock_filter = Mock()
                mock_filter.first.return_value = mock_appointment
                mock_query.filter.return_value = mock_filter
                return mock_query
            elif model == Therapist:
                mock_therapist_query = Mock()
                mock_therapist_query.get.return_value = None  # Therapist not found
                return mock_therapist_query
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            wrapper = Mock()
            wrapper.context = context

            new_start_time = datetime(2024, 1, 20, 14, 0, tzinfo=timezone.utc)

            result = await call_tool_function(
                reschedule_appointment,
                wrapper,
                appointment_id=1,
                patient_id=1,
                new_start_time=new_start_time.isoformat(),
                new_therapist_id=999
            )

            assert "error" in result
            assert "找不到指定的治療師" in result["error"]


class TestPhoneNumberSanitization:
    """Test phone number sanitization utility."""

    def test_sanitize_phone_number_international_format(self):
        """Test sanitizing international format Taiwanese phone numbers."""
        from clinic_agents.tools import sanitize_phone_number

        assert sanitize_phone_number("886912345678") == "0912345678"
        assert sanitize_phone_number("+886912345678") == "0912345678"

    def test_sanitize_phone_number_local_format(self):
        """Test sanitizing local format Taiwanese phone numbers."""
        from clinic_agents.tools import sanitize_phone_number

        assert sanitize_phone_number("0912345678") == "0912345678"
        assert sanitize_phone_number("912345678") == "0912345678"

    def test_sanitize_phone_number_with_spaces_and_dashes(self):
        """Test sanitizing phone numbers with formatting characters."""
        from clinic_agents.tools import sanitize_phone_number

        assert sanitize_phone_number("0912-345-678") == "0912345678"
        assert sanitize_phone_number("0912 345 678") == "0912345678"
        assert sanitize_phone_number("(0912)345678") == "0912345678"


class TestVerifyAndLinkPatientErrors:
    """Test verify_and_link_patient error handling."""

    @pytest.mark.asyncio
    async def test_verify_and_link_patient_integrity_error(self, db_session):
        """Test verify_and_link_patient with IntegrityError."""
        from sqlalchemy.exc import IntegrityError

        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock patient
        mock_patient = Mock()
        mock_patient.id = 1
        mock_patient.full_name = "測試病人"
        mock_patient.phone_number = "0912345678"

        def query_side_effect(model):
            if model == Patient:
                return create_mock_query_chain(mock_patient)
            elif model == LineUser:
                return create_mock_query_chain(None)
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'add'), \
             patch.object(db_session, 'commit', side_effect=IntegrityError("Constraint violation", None, None)), \
             patch.object(db_session, 'rollback') as mock_rollback:

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                verify_and_link_patient,
                wrapper,
                phone_number="0912345678"
            )

            assert result.startswith("ERROR: 資料庫錯誤")

    @pytest.mark.asyncio
    async def test_verify_and_link_patient_general_error(self, db_session):
        """Test verify_and_link_patient with general exception."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', side_effect=Exception("Unexpected error")), \
             patch.object(db_session, 'rollback') as mock_rollback:

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                verify_and_link_patient,
                wrapper,
                phone_number="0912345678"
            )

            assert result.startswith("ERROR: 連結帳號時發生錯誤")


class TestCreatePatientAndLink:
    """Test create_patient_and_link tool."""

    @pytest.mark.asyncio
    async def test_create_patient_and_link_success(self, db_session):
        """Test successful patient creation and linking."""
        from clinic_agents.tools import create_patient_and_link

        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        def query_side_effect(model):
            if model == Patient:
                return create_mock_query_chain(None)  # No existing patient
            elif model == LineUser:
                return create_mock_query_chain(None)  # No existing link
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'add') as mock_add, \
             patch.object(db_session, 'flush'), \
             patch.object(db_session, 'commit') as mock_commit:

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                create_patient_and_link,
                wrapper,
                phone_number="0912345678",
                full_name="新病人"
            )

            assert result.startswith("SUCCESS: 歡迎 新病人")
            assert "0912345678" in result
            mock_commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_patient_and_link_phone_exists(self, db_session):
        """Test create_patient_and_link when phone number already exists."""
        from clinic_agents.tools import create_patient_and_link

        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Mock existing patient
        mock_existing_patient = Mock()
        mock_existing_patient.full_name = "現有病人"

        def query_side_effect(model):
            if model == Patient:
                return create_mock_query_chain(mock_existing_patient)
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                create_patient_and_link,
                wrapper,
                phone_number="0912345678",
                full_name="新病人"
            )

            assert result.startswith("ERROR:")
            assert "已存在於系統中" in result
            assert "現有病人" in result

    @pytest.mark.asyncio
    async def test_create_patient_and_link_integrity_error(self, db_session):
        """Test create_patient_and_link with IntegrityError."""
        from clinic_agents.tools import create_patient_and_link
        from sqlalchemy.exc import IntegrityError

        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        def query_side_effect(model):
            if model == Patient:
                return create_mock_query_chain(None)
            elif model == LineUser:
                return create_mock_query_chain(None)
            return Mock()

        with patch.object(db_session, 'query', side_effect=query_side_effect), \
             patch.object(db_session, 'add'), \
             patch.object(db_session, 'flush'), \
             patch.object(db_session, 'commit', side_effect=IntegrityError("Duplicate", None, None)), \
             patch.object(db_session, 'rollback') as mock_rollback:

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                create_patient_and_link,
                wrapper,
                phone_number="0912345678",
                full_name="新病人"
            )

            assert result.startswith("ERROR: 資料庫錯誤")

    @pytest.mark.asyncio
    async def test_create_patient_and_link_general_error(self, db_session):
        """Test create_patient_and_link with general exception."""
        from clinic_agents.tools import create_patient_and_link

        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query', side_effect=Exception("Unexpected error")), \
             patch.object(db_session, 'rollback') as mock_rollback:

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="line_user_123"
            )

            wrapper = Mock()
            wrapper.context = context

            result = await call_tool_function(
                create_patient_and_link,
                wrapper,
                phone_number="0912345678",
                full_name="新病人"
            )

            assert result.startswith("ERROR: 建立病患記錄時發生錯誤")

