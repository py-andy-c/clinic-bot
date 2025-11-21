"""
Unit tests for LINE user AI disabled service.

Tests the service functions for managing permanent AI disable status,
including checking, setting, and clearing disable status.
"""

import pytest
from datetime import datetime
from sqlalchemy.orm import Session

from models import Clinic, LineUserAiDisabled, LineUser, Patient
from services.line_user_ai_disabled_service import (
    is_ai_disabled,
    disable_ai_for_line_user,
    enable_ai_for_line_user,
    get_line_users_for_clinic,
    LineUserWithStatus
)
from utils.datetime_utils import taiwan_now


class TestIsAiDisabled:
    """Test checking AI disabled status."""
    
    def test_is_disabled_returns_false_by_default(self, db_session: Session, sample_clinic_data):
        """Test that is_disabled returns False when no disable record exists."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        result = is_ai_disabled(db_session, line_user_id, clinic.id)
        
        assert result is False
    
    def test_is_disabled_returns_true_when_disabled(self, db_session: Session, sample_clinic_data):
        """Test that is_disabled returns True when user is disabled."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Disable AI
        disable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        # Check status
        result = is_ai_disabled(db_session, line_user_id, clinic.id)
        
        assert result is True
    
    def test_is_disabled_per_clinic_isolation(self, db_session: Session, sample_clinic_data):
        """Test that disable status is isolated per clinic."""
        clinic1 = Clinic(**sample_clinic_data)
        clinic2 = Clinic(
            name="Test Clinic 2",
            line_channel_id="test_channel_456",
            line_channel_secret="test_secret_789",
            line_channel_access_token="test_token_789",
            settings={}
        )
        db_session.add(clinic1)
        db_session.add(clinic2)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Disable for clinic1 only
        disable_ai_for_line_user(db_session, line_user_id, clinic1.id)
        
        # Check status for each clinic
        assert is_ai_disabled(db_session, line_user_id, clinic1.id) is True
        assert is_ai_disabled(db_session, line_user_id, clinic2.id) is False


class TestDisableAiForLineUser:
    """Test disabling AI for a LINE user."""
    
    def test_disable_creates_new_record(self, db_session: Session, sample_clinic_data):
        """Test that disabling AI creates a new record."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        # Create a user for the foreign key constraint
        from models import User
        admin_user = User(
            email="admin@test.com",
            google_subject_id="google_test_123"
        )
        db_session.add(admin_user)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        disabled_by_user_id = admin_user.id
        reason = "Test reason"
        
        disabled = disable_ai_for_line_user(
            db_session, line_user_id, clinic.id,
            disabled_by_user_id=disabled_by_user_id,
            reason=reason
        )
        
        assert disabled is not None
        assert disabled.line_user_id == line_user_id
        assert disabled.clinic_id == clinic.id
        assert disabled.disabled_by_user_id == disabled_by_user_id
        assert disabled.reason == reason
        assert disabled.disabled_at is not None
    
    def test_disable_updates_existing_record(self, db_session: Session, sample_clinic_data):
        """Test that disabling when already disabled updates the record."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        # Create users for the foreign key constraints
        from models import User
        admin_user1 = User(
            email="admin1@test.com",
            google_subject_id="google_test_1"
        )
        admin_user2 = User(
            email="admin2@test.com",
            google_subject_id="google_test_2"
        )
        db_session.add(admin_user1)
        db_session.add(admin_user2)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Disable first time
        disabled1 = disable_ai_for_line_user(
            db_session, line_user_id, clinic.id,
            disabled_by_user_id=admin_user1.id,
            reason="First reason"
        )
        first_disabled_at = disabled1.disabled_at
        
        # Wait a moment (simulate time passing)
        import time
        time.sleep(0.1)
        
        # Disable again (should update existing record)
        disabled2 = disable_ai_for_line_user(
            db_session, line_user_id, clinic.id,
            disabled_by_user_id=admin_user2.id,
            reason="Second reason"
        )
        
        # Should be the same record
        assert disabled1.id == disabled2.id
        
        # Timestamp should be updated
        assert disabled2.disabled_at > first_disabled_at
        assert disabled2.disabled_by_user_id == admin_user2.id
        assert disabled2.reason == "Second reason"


class TestEnableAiForLineUser:
    """Test enabling AI for a LINE user."""
    
    def test_enable_removes_record(self, db_session: Session, sample_clinic_data):
        """Test that enabling AI removes the disable record."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Disable first
        disable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        # Verify it exists
        disabled = db_session.query(LineUserAiDisabled).filter(
            LineUserAiDisabled.line_user_id == line_user_id,
            LineUserAiDisabled.clinic_id == clinic.id
        ).first()
        assert disabled is not None
        
        # Enable AI
        result = enable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        assert result is not None
        
        # Verify it's gone
        disabled = db_session.query(LineUserAiDisabled).filter(
            LineUserAiDisabled.line_user_id == line_user_id,
            LineUserAiDisabled.clinic_id == clinic.id
        ).first()
        assert disabled is None
    
    def test_enable_when_not_disabled(self, db_session: Session, sample_clinic_data):
        """Test that enabling when not disabled returns None."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Try to enable when not disabled
        result = enable_ai_for_line_user(db_session, line_user_id, clinic.id)
        
        assert result is None


class TestGetLineUsersForClinic:
    """Test getting LINE users for a clinic with AI status."""
    
    def test_get_line_users_returns_empty_when_no_patients(self, db_session: Session, sample_clinic_data):
        """Test that get_line_users returns empty list when clinic has no patients."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        result = get_line_users_for_clinic(db_session, clinic.id)
        
        assert result == []
    
    def test_get_line_users_includes_users_with_patients(self, db_session: Session, sample_clinic_data):
        """Test that get_line_users includes LINE users who have patients."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        # Create LineUser
        line_user = LineUser(
            line_user_id="U_test_user_123",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()
        
        # Create Patient linked to LineUser
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id,
            is_deleted=False
        )
        db_session.add(patient)
        db_session.commit()
        
        # Get line users
        result = get_line_users_for_clinic(db_session, clinic.id)
        
        assert len(result) == 1
        assert result[0].line_user_id == "U_test_user_123"
        assert result[0].display_name == "Test User"
        assert result[0].patient_count == 1
        assert result[0].patient_names == ["Test Patient"]
        assert result[0].ai_disabled is False
    
    def test_get_line_users_excludes_soft_deleted_patients(self, db_session: Session, sample_clinic_data):
        """Test that get_line_users excludes LINE users with only soft-deleted patients."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        # Create LineUser
        line_user = LineUser(
            line_user_id="U_test_user_123",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()
        
        # Create soft-deleted Patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id,
            is_deleted=True
        )
        db_session.add(patient)
        db_session.commit()
        
        # Get line users (should be empty)
        result = get_line_users_for_clinic(db_session, clinic.id)
        
        assert result == []
    
    def test_get_line_users_shows_ai_status(self, db_session: Session, sample_clinic_data):
        """Test that get_line_users includes AI disabled status."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        # Create LineUser
        line_user = LineUser(
            line_user_id="U_test_user_123",
            display_name="Test User"
        )
        db_session.add(line_user)
        db_session.flush()
        
        # Create Patient
        patient = Patient(
            clinic_id=clinic.id,
            full_name="Test Patient",
            phone_number="0912345678",
            line_user_id=line_user.id,
            is_deleted=False
        )
        db_session.add(patient)
        db_session.commit()
        
        # Disable AI
        disable_ai_for_line_user(db_session, "U_test_user_123", clinic.id)
        
        # Get line users
        result = get_line_users_for_clinic(db_session, clinic.id)
        
        assert len(result) == 1
        assert result[0].ai_disabled is True
        assert result[0].disabled_at is not None
    
    def test_get_line_users_pagination(self, db_session: Session, sample_clinic_data):
        """Test that get_line_users supports pagination."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        # Create multiple LineUsers with patients
        for i in range(5):
            line_user = LineUser(
                line_user_id=f"U_test_user_{i}",
                display_name=f"Test User {i}"
            )
            db_session.add(line_user)
            db_session.flush()
            
            patient = Patient(
                clinic_id=clinic.id,
                full_name=f"Test Patient {i}",
                phone_number=f"091234567{i}",
                line_user_id=line_user.id,
                is_deleted=False
            )
            db_session.add(patient)
        
        db_session.commit()
        
        # Get first 2
        result = get_line_users_for_clinic(db_session, clinic.id, offset=0, limit=2)
        assert len(result) == 2
        
        # Get next 2
        result = get_line_users_for_clinic(db_session, clinic.id, offset=2, limit=2)
        assert len(result) == 2
        
        # Get remaining
        result = get_line_users_for_clinic(db_session, clinic.id, offset=4, limit=2)
        assert len(result) == 1

