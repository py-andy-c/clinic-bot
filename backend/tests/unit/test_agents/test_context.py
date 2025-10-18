"""
Unit tests for ConversationContext dataclass.
"""

import pytest
from unittest.mock import Mock, MagicMock, patch
from sqlalchemy.orm import Session

from src.clinic_agents.context import ConversationContext
from src.models import Clinic, Patient, Therapist, AppointmentType


class TestConversationContext:
    """Test ConversationContext dataclass and its properties."""

    def test_init_valid(self, db_session):
        """Test ConversationContext initialization with valid data."""
        clinic = Clinic(
            id=1,
            name="Test Clinic",
            line_channel_id="test_channel",
            line_channel_secret="test_secret",
            line_channel_access_token="test_token"
        )
        patient = Patient(
            id=1,
            clinic_id=1,
            full_name="Test Patient",
            phone_number="0912345678"
        )

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=patient,
            line_user_id="test_user_123",
            is_linked=True
        )

        assert context.db_session == db_session
        assert context.clinic == clinic
        assert context.patient == patient
        assert context.line_user_id == "test_user_123"
        assert context.is_linked is True

    def test_init_missing_required_fields(self):
        """Test ConversationContext initialization with missing required fields."""
        with pytest.raises(ValueError, match="db_session is required"):
            ConversationContext(
                db_session=None,
                clinic=Mock(),
                line_user_id="test"
            )

        with pytest.raises(ValueError, match="clinic is required"):
            ConversationContext(
                db_session=Mock(spec=Session),
                clinic=None,
                line_user_id="test"
            )

        with pytest.raises(ValueError, match="line_user_id is required"):
            ConversationContext(
                db_session=Mock(spec=Session),
                clinic=Mock(),
                line_user_id=""
            )

    def test_post_init_validation(self):
        """Test post-initialization validation."""
        with pytest.raises(ValueError, match="line_user_id is required"):
            context = ConversationContext(
                db_session=Mock(spec=Session),
                clinic=Mock(),
                line_user_id=None
            )

    def test_therapists_list_property(self, db_session):
        """Test therapists_list property returns formatted therapist names."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Create mock therapists
        therapist1 = Therapist(id=1, clinic_id=1, name="王大明", email="wang@test.com")
        therapist2 = Therapist(id=2, clinic_id=1, name="李小華", email="li@test.com")

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.all.return_value = [therapist1, therapist2]

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            result = context.therapists_list
            assert result == "王大明, 李小華"

            # Verify the query was called correctly
            mock_query.assert_called_once_with(Therapist)

    def test_appointment_types_list_property(self, db_session):
        """Test appointment_types_list property returns formatted types with durations."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        # Create mock appointment types
        apt_type1 = AppointmentType(id=1, clinic_id=1, name="初診評估", duration_minutes=60)
        apt_type2 = AppointmentType(id=2, clinic_id=1, name="一般複診", duration_minutes=30)

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.all.return_value = [apt_type1, apt_type2]

            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            result = context.appointment_types_list
            assert result == "初診評估(60min), 一般複診(30min)"

    def test_empty_therapists_and_types(self, db_session):
        """Test behavior when no therapists or appointment types exist."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        def mock_query_side_effect(model):
            mock_query = Mock()
            mock_filter = Mock()
            mock_query.filter.return_value = mock_filter
            mock_filter.all.return_value = []
            return mock_query

        with patch.object(db_session, 'query', side_effect=mock_query_side_effect):
            context = ConversationContext(
                db_session=db_session,
                clinic=clinic,
                line_user_id="test_user"
            )

            assert context.therapists_list == ""
            assert context.appointment_types_list == ""

    def test_with_none_patient(self, db_session):
        """Test context behavior when patient is None (not linked)."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=None,  # Not linked
            line_user_id="test_user",
            is_linked=False
        )

        assert context.patient is None
        assert context.is_linked is False

    def test_with_linked_patient(self, db_session):
        """Test context behavior with linked patient."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        patient = Patient(id=1, clinic_id=1, full_name="Test Patient", phone_number="0912345678")

        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            patient=patient,
            line_user_id="test_user",
            is_linked=True
        )

        assert context.patient == patient
        assert context.is_linked is True

    def test_context_validation_rules(self, db_session):
        """Test that context validation catches invalid data."""
        clinic = Clinic(id=1, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")
        
        # Valid context should work
        context = ConversationContext(
            db_session=db_session,
            clinic=clinic,
            line_user_id="test_user",
            is_linked=False
        )
        assert context.line_user_id == "test_user"
