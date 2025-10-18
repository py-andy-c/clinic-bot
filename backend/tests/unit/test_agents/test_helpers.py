"""
Unit tests for helper functions.
"""

import pytest
from unittest.mock import Mock, patch
from fastapi import HTTPException, Request

from src.agents.helpers import (
    get_clinic_from_request,
    get_or_create_line_user,
    get_patient_from_line_user,
    ensure_patient_linked
)
from src.models import Clinic, LineUser, Patient


class TestGetClinicFromRequest:
    """Test get_clinic_from_request function."""

    def test_get_clinic_from_header(self, db_session):
        """Test getting clinic from X-Clinic-ID header."""
        mock_request = Mock()
        mock_request.headers = {"x-clinic-id": "123"}

        clinic = Clinic(id=123, name="Test Clinic", line_channel_id="test", line_channel_secret="secret", line_channel_access_token="token")

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.first.return_value = clinic

            result = get_clinic_from_request(mock_request, db_session)
            assert result == clinic

    def test_get_clinic_header_not_found(self, db_session):
        """Test clinic not found with valid header."""
        mock_request = Mock()
        mock_request.headers = {"x-clinic-id": "999"}

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.first.return_value = None

            with pytest.raises(HTTPException) as exc_info:
                get_clinic_from_request(mock_request, db_session)

            assert "Cannot identify clinic" in str(exc_info.value.detail)

    def test_get_clinic_no_header(self, db_session):
        """Test missing X-Clinic-ID header."""
        mock_request = Mock()
        mock_request.headers = {}

        with pytest.raises(HTTPException) as exc_info:
            get_clinic_from_request(mock_request, db_session)

        assert "Cannot identify clinic" in str(exc_info.value.detail)

    def test_get_clinic_invalid_header_value(self, db_session):
        """Test invalid clinic ID in header."""
        mock_request = Mock()
        mock_request.headers = {"x-clinic-id": "invalid"}

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.first.return_value = None

            # Should not raise exception for invalid int conversion, just return None from query
            with pytest.raises(HTTPException) as exc_info:
                get_clinic_from_request(mock_request, db_session)

            assert "Cannot identify clinic" in str(exc_info.value.detail)


class TestGetOrCreateLineUser:
    """Test get_or_create_line_user function."""

    def test_get_existing_line_user(self, db_session):
        """Test getting existing LINE user."""
        clinic_id = 1
        line_user_id = "existing_user_123"

        existing_user = LineUser(
            id=1,
            line_user_id=line_user_id,
            patient_id=None
        )

        with patch.object(db_session, 'query') as mock_query, \
             patch.object(db_session, 'add') as mock_add, \
             patch.object(db_session, 'commit') as mock_commit:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.first.return_value = existing_user

            result = get_or_create_line_user(db_session, line_user_id, clinic_id)

            assert result == existing_user
            mock_add.assert_not_called()
            mock_commit.assert_not_called()

    def test_create_new_line_user(self, db_session):
        """Test creating new LINE user."""
        clinic_id = 1
        line_user_id = "new_user_456"

        with patch.object(db_session, 'query') as mock_query, \
             patch.object(db_session, 'add') as mock_add, \
             patch.object(db_session, 'commit') as mock_commit, \
             patch.object(db_session, 'refresh') as mock_refresh:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.first.return_value = None

            # Mock the refresh operation
            mock_refresh.side_effect = lambda obj: setattr(obj, 'id', 999)

            result = get_or_create_line_user(db_session, line_user_id, clinic_id)

            assert result.line_user_id == line_user_id
            assert result.patient_id is None
            mock_add.assert_called_once()
            mock_commit.assert_called_once()
            mock_refresh.assert_called_once()


class TestGetPatientFromLineUser:
    """Test get_patient_from_line_user function."""

    def test_get_linked_patient(self, db_session):
        """Test getting linked patient."""
        mock_patient = Patient(
            id=1,
            clinic_id=1,
            full_name="Test Patient",
            phone_number="0912345678"
        )

        mock_line_user = Mock()
        mock_line_user.patient_id = 1

        with patch.object(db_session, 'query') as mock_query:
            mock_filter = Mock()
            mock_query.return_value.filter.return_value = mock_filter
            mock_filter.first.return_value = mock_patient

            result = get_patient_from_line_user(db_session, mock_line_user)

            assert result == mock_patient

    def test_get_unlinked_patient(self, db_session):
        """Test getting patient when LINE user is not linked."""
        mock_line_user = Mock()
        mock_line_user.patient_id = None

        with patch.object(db_session, 'query') as mock_query:
            result = get_patient_from_line_user(db_session, mock_line_user)

            assert result is None
            mock_query.assert_not_called()


class TestEnsurePatientLinked:
    """Test ensure_patient_linked function."""

    def test_patient_linked(self):
        """Test when patient is properly linked."""
        from src.agents.context import ConversationContext

        patient = Patient(id=1, clinic_id=1, full_name="Test Patient", phone_number="0912345678")

        context = ConversationContext(
            db_session=Mock(),
            clinic=Mock(),
            patient=patient,
            line_user_id="test_user",
            is_linked=True
        )

        result = ensure_patient_linked(context)
        assert result == patient

    def test_patient_not_linked(self):
        """Test when patient is not linked."""
        from src.agents.context import ConversationContext

        context = ConversationContext(
            db_session=Mock(),
            clinic=Mock(),
            patient=None,
            line_user_id="test_user",
            is_linked=False
        )

        with pytest.raises(ValueError, match="Patient account must be linked"):
            ensure_patient_linked(context)

    def test_patient_none_but_is_linked_true(self):
        """Test inconsistent state: patient is None but is_linked is True."""
        from src.agents.context import ConversationContext

        context = ConversationContext(
            db_session=Mock(),
            clinic=Mock(),
            patient=None,
            line_user_id="test_user",
            is_linked=True  # This is inconsistent
        )

        # Should still raise error because patient is None
        with pytest.raises(ValueError, match="Patient account must be linked"):
            ensure_patient_linked(context)

