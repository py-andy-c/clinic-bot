"""
Unit tests for LINE user service.

Tests the service functions for proactive LINE user management,
including creating users from webhook events and fetching profiles.
"""

import pytest
from unittest.mock import Mock, patch
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from models import LineUser, Clinic
from services.line_user_service import LineUserService
from services.line_service import LINEService


class TestGetOrCreateLineUser:
    """Test getting or creating LINE users."""
    
    def test_creates_new_user_when_not_exists(self, db_session: Session, sample_clinic_data):
        """Test that a new LineUser is created when it doesn't exist."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        
        # Mock LINEService - when display_name is provided, profile won't be fetched
        # But we still need to mock it in case picture_url is missing
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.return_value = None
        
        # Create user
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name
        )
        
        assert line_user is not None
        assert line_user.line_user_id == line_user_id
        assert line_user.clinic_id == clinic.id
        assert line_user.display_name == display_name
        
        # Verify it's in database
        db_user = db_session.query(LineUser).filter_by(
            line_user_id=line_user_id,
            clinic_id=clinic.id
        ).first()
        assert db_user is not None
        assert db_user.id == line_user.id
    
    def test_returns_existing_user_when_exists(self, db_session: Session, sample_clinic_data):
        """Test that existing LineUser is returned when it already exists."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        
        # Create existing user
        existing_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=display_name
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Mock LINEService
        mock_line_service = Mock(spec=LINEService)
        
        # Get or create (should return existing)
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name
        )
        
        assert line_user.id == existing_user.id
        assert line_user.line_user_id == line_user_id
        assert line_user.display_name == display_name
    
    def test_updates_display_name_when_different(self, db_session: Session, sample_clinic_data):
        """Test that display name is updated when provided and different."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        old_display_name = "Old Name"
        new_display_name = "New Name"
        
        # Create existing user with old name (and no picture_url to trigger lazy update)
        existing_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=old_display_name,
            picture_url=None
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Mock LINEService - return None for profile fetch (no picture_url available)
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.return_value = None
        
        # Get or create with new name
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=new_display_name
        )
        
        assert line_user.id == existing_user.id
        assert line_user.display_name == new_display_name
        
        # Verify update in database
        db_session.refresh(line_user)
        assert line_user.display_name == new_display_name
    
    def test_stores_picture_url_when_provided(self, db_session: Session, sample_clinic_data):
        """Test that picture_url is stored when provided."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        picture_url = "https://example.com/pic.jpg"
        
        # Mock LINEService
        mock_line_service = Mock(spec=LINEService)
        
        # Create user with picture_url
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name,
            picture_url=picture_url
        )
        
        assert line_user.picture_url == picture_url
        db_session.refresh(line_user)
        assert line_user.picture_url == picture_url
    
    def test_lazy_updates_picture_url_when_missing(self, db_session: Session, sample_clinic_data):
        """Test that picture_url is fetched for existing users when missing (lazy update)."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        picture_url = "https://example.com/pic.jpg"
        
        # Create existing user without picture_url
        existing_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=display_name,
            picture_url=None
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Mock LINEService with profile response
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.return_value = {
            "displayName": display_name,
            "userId": line_user_id,
            "pictureUrl": picture_url
        }
        
        # Get or create (should trigger lazy update)
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name
        )
        
        assert line_user.id == existing_user.id
        assert line_user.picture_url == picture_url
        mock_line_service.get_user_profile.assert_called_once_with(line_user_id)
    
    def test_fetches_profile_when_display_name_not_provided(self, db_session: Session, sample_clinic_data):
        """Test that user profile is fetched when display_name is not provided."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        fetched_display_name = "Fetched Name"
        picture_url = "https://example.com/pic.jpg"
        
        # Mock LINEService with profile response
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.return_value = {
            "displayName": fetched_display_name,
            "userId": line_user_id,
            "pictureUrl": picture_url
        }
        
        # Create user without display name
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=None
        )
        
        assert line_user.display_name == fetched_display_name
        assert line_user.picture_url == picture_url
        mock_line_service.get_user_profile.assert_called_once_with(line_user_id)
    
    def test_fetches_profile_when_display_name_provided_but_picture_url_not(self, db_session: Session, sample_clinic_data):
        """Test that profile is fetched when display_name is provided but picture_url is not."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        picture_url = "https://example.com/pic.jpg"
        
        # Mock LINEService with profile response
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.return_value = {
            "displayName": display_name,
            "userId": line_user_id,
            "pictureUrl": picture_url
        }
        
        # Create user with display_name but without picture_url
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name,
            picture_url=None
        )
        
        assert line_user.display_name == display_name
        assert line_user.picture_url == picture_url
        mock_line_service.get_user_profile.assert_called_once_with(line_user_id)
    
    def test_does_not_fetch_profile_when_both_provided(self, db_session: Session, sample_clinic_data):
        """Test that profile is NOT fetched when both display_name and picture_url are provided."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        picture_url = "https://example.com/pic.jpg"
        
        # Mock LINEService
        mock_line_service = Mock(spec=LINEService)
        
        # Create user with both display_name and picture_url
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name,
            picture_url=picture_url
        )
        
        assert line_user.display_name == display_name
        assert line_user.picture_url == picture_url
        # Should not fetch profile when both are provided
        mock_line_service.get_user_profile.assert_not_called()
    
    def test_updates_picture_url_when_different_value_provided(self, db_session: Session, sample_clinic_data):
        """Test that picture_url is updated when a different value is provided to existing user."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        old_picture_url = "https://example.com/old.jpg"
        new_picture_url = "https://example.com/new.jpg"
        
        # Create existing user with old picture_url
        existing_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=display_name,
            picture_url=old_picture_url
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Mock LINEService
        mock_line_service = Mock(spec=LINEService)
        
        # Get or create with new picture_url
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name,
            picture_url=new_picture_url
        )
        
        assert line_user.id == existing_user.id
        assert line_user.picture_url == new_picture_url
        
        # Verify update in database
        db_session.refresh(line_user)
        assert line_user.picture_url == new_picture_url
    
    def test_creates_user_without_display_name_when_profile_fetch_fails(self, db_session: Session, sample_clinic_data):
        """Test that user is created without display name when profile fetch fails."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Mock LINEService with failed profile fetch
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.return_value = None
        
        # Create user without display name
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=None
        )
        
        assert line_user.line_user_id == line_user_id
        assert line_user.display_name is None
    
    def test_handles_race_condition_gracefully(self, db_session: Session, sample_clinic_data):
        """Test that race condition (duplicate creation) is handled gracefully."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        
        # Create existing user (simulating another request creating it)
        existing_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=display_name
        )
        db_session.add(existing_user)
        db_session.commit()
        
        # Mock LINEService
        mock_line_service = Mock(spec=LINEService)
        
        # Simulate IntegrityError (race condition)
        with patch.object(db_session, 'add') as mock_add:
            with patch.object(db_session, 'commit', side_effect=IntegrityError("", "", "")):
                # Should handle the error and fetch existing user
                line_user = LineUserService.get_or_create_line_user(
                    db=db_session,
                    line_user_id=line_user_id,
                    clinic_id=clinic.id,
                    line_service=mock_line_service,
                    display_name=display_name
                )
                
                # Should rollback and return existing user
                assert line_user.id == existing_user.id
    
    def test_handles_profile_fetch_exception_gracefully(self, db_session: Session, sample_clinic_data):
        """Test that exceptions during profile fetch don't prevent user creation."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Mock LINEService with exception
        mock_line_service = Mock(spec=LINEService)
        mock_line_service.get_user_profile.side_effect = Exception("API Error")
        
        # Should still create user without display name
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=None
        )
        
        assert line_user.line_user_id == line_user_id
        assert line_user.display_name is None
    
    def test_does_not_update_display_name_when_same(self, db_session: Session, sample_clinic_data):
        """Test that display name is not updated when it's the same."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        display_name = "Test User"
        
        # Create existing user
        existing_user = LineUser(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            display_name=display_name
        )
        db_session.add(existing_user)
        db_session.commit()
        original_updated_at = existing_user.updated_at if hasattr(existing_user, 'updated_at') else None
        
        # Mock LINEService
        mock_line_service = Mock(spec=LINEService)
        
        # Get or create with same name
        line_user = LineUserService.get_or_create_line_user(
            db=db_session,
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            line_service=mock_line_service,
            display_name=display_name
        )
        
        assert line_user.id == existing_user.id
        assert line_user.display_name == display_name


