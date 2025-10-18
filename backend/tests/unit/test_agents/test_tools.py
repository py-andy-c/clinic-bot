"""
Unit tests for agent tools.

Tests the 7 agent tools that perform database operations and Google Calendar sync.
"""

import json
import pytest
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch, MagicMock, AsyncMock
from sqlalchemy.orm import Session

from src.agents.tools import (
    get_therapist_availability,
    create_appointment,
    get_existing_appointments,
    cancel_appointment,
    reschedule_appointment,
    get_last_appointment_therapist,
    verify_and_link_patient
)
from src.agents.context import ConversationContext
from src.models import Clinic, Patient, Therapist, Appointment, AppointmentType, LineUser
from src.services.google_calendar_service import GoogleCalendarService, GoogleCalendarError


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


class TestCreateAppointment:
    """Test create_appointment tool."""

    @pytest.mark.asyncio
    @patch('src.agents.tools.GoogleCalendarService')
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

        with patch('src.agents.tools.GoogleCalendarService') as mock_gcal_class, \
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
    @patch('src.agents.tools.GoogleCalendarService')
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

        with patch('src.agents.tools.GoogleCalendarService') as mock_gcal_class, \
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


class TestCancelAppointment:
    """Test cancel_appointment tool."""

    @pytest.mark.asyncio
    @patch('src.agents.tools.GoogleCalendarService')
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

        with patch('src.agents.tools.GoogleCalendarService') as mock_gcal_class, \
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

            assert result["success"] is True
            assert "帳號連結成功" in result["message"]
            assert result["patient"]["name"] == "測試病人"

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

            assert result["success"] is False
            assert "找不到" in result["message"]

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

            assert result["success"] is False
            assert "已連結到其他" in result["message"]

