"""
Unit tests for LINE AI opt-out service.

Tests the service functions for managing AI opt-out status,
including message normalization, setting/clearing opt-out, and checking status.
"""

import pytest
from datetime import datetime, timedelta
from sqlalchemy.orm import Session

from models import Clinic, LineUserAiOptOut
from services.line_opt_out_service import (
    normalize_message_text,
    set_ai_opt_out,
    clear_ai_opt_out,
    is_ai_opted_out
)
from core.constants import AI_OPT_OUT_DURATION_HOURS
from utils.datetime_utils import taiwan_now


class TestNormalizeMessageText:
    """Test message text normalization function."""
    
    def test_normalize_removes_whitespace(self):
        """Test that leading/trailing whitespace is removed."""
        assert normalize_message_text("  人工回覆  ") == "人工回覆"
        assert normalize_message_text("\t重啟AI\n") == "重啟ai"
        assert normalize_message_text("  測試訊息  ") == "測試訊息"
    
    def test_normalize_removes_quotes(self):
        """Test that common quote characters are removed."""
        assert normalize_message_text('"人工回覆"') == "人工回覆"
        assert normalize_message_text("'人工回覆'") == "人工回覆"
        assert normalize_message_text("「人工回覆」") == "人工回覆"
        assert normalize_message_text("『人工回覆』") == "人工回覆"
        assert normalize_message_text("《人工回覆》") == "人工回覆"
        assert normalize_message_text("【人工回覆】") == "人工回覆"
    
    def test_normalize_removes_parentheses(self):
        """Test that common parenthesis characters are removed."""
        assert normalize_message_text("(人工回覆)") == "人工回覆"
        assert normalize_message_text("（人工回覆）") == "人工回覆"
        assert normalize_message_text("[人工回覆]") == "人工回覆"
        assert normalize_message_text("【人工回覆】") == "人工回覆"
    
    def test_normalize_removes_multiple_quotes(self):
        """Test that multiple quote/parenthesis characters are all removed."""
        assert normalize_message_text('「"人工回覆"」') == "人工回覆"
        assert normalize_message_text("(「人工回覆」)") == "人工回覆"
        assert normalize_message_text("【（人工回覆）】") == "人工回覆"
    
    def test_normalize_preserves_content(self):
        """Test that actual message content is preserved."""
        assert normalize_message_text("人工回覆") == "人工回覆"
        assert normalize_message_text("重啟AI") == "重啟ai"
        assert normalize_message_text("測試訊息") == "測試訊息"
    
    def test_normalize_case_insensitive(self):
        """Test that normalization converts to lowercase for case-insensitive matching."""
        assert normalize_message_text("重啟AI") == "重啟ai"
        assert normalize_message_text("重啟ai") == "重啟ai"
        assert normalize_message_text("重啟Ai") == "重啟ai"
        assert normalize_message_text("重啟aI") == "重啟ai"
        # Chinese characters are unaffected by case conversion
        assert normalize_message_text("人工回覆") == "人工回覆"
    
    def test_normalize_empty_string(self):
        """Test that empty string is handled correctly."""
        assert normalize_message_text("") == ""
        assert normalize_message_text("   ") == ""
        assert normalize_message_text('""') == ""
        assert normalize_message_text("「」") == ""


class TestSetAiOptOut:
    """Test setting AI opt-out status."""
    
    def test_set_opt_out_creates_new_record(self, db_session: Session, sample_clinic_data):
        """Test that setting opt-out creates a new record."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        opt_out = set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        assert opt_out is not None
        assert opt_out.line_user_id == line_user_id
        assert opt_out.clinic_id == clinic.id
        assert opt_out.opted_out_until > taiwan_now()
        assert opt_out.opted_out_until <= taiwan_now() + timedelta(hours=AI_OPT_OUT_DURATION_HOURS + 1)
    
    def test_set_opt_out_extends_existing(self, db_session: Session, sample_clinic_data):
        """Test that setting opt-out when already opted out extends the period."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Set initial opt-out
        opt_out1 = set_ai_opt_out(db_session, line_user_id, clinic.id, hours=12)
        first_expiry = opt_out1.opted_out_until
        
        # Wait a moment (simulate time passing)
        import time
        time.sleep(0.1)
        
        # Set opt-out again (should extend from now)
        opt_out2 = set_ai_opt_out(db_session, line_user_id, clinic.id, hours=24)
        
        # Should be the same record
        assert opt_out1.id == opt_out2.id
        
        # Expiry should be extended (new expiry should be later than old expiry)
        assert opt_out2.opted_out_until > first_expiry
        
        # New expiry should be approximately 24 hours from now
        assert opt_out2.opted_out_until <= taiwan_now() + timedelta(hours=24 + 1)
    
    def test_set_opt_out_custom_hours(self, db_session: Session, sample_clinic_data):
        """Test that custom opt-out duration works."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        custom_hours = 48
        
        opt_out = set_ai_opt_out(db_session, line_user_id, clinic.id, hours=custom_hours)
        
        # Expiry should be approximately custom_hours from now
        expected_expiry = taiwan_now() + timedelta(hours=custom_hours)
        assert opt_out.opted_out_until <= expected_expiry + timedelta(minutes=1)
        assert opt_out.opted_out_until >= expected_expiry - timedelta(minutes=1)


class TestClearAiOptOut:
    """Test clearing AI opt-out status."""
    
    def test_clear_opt_out_removes_record(self, db_session: Session, sample_clinic_data):
        """Test that clearing opt-out removes the record."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Set opt-out first
        set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        # Verify it exists
        opt_out = db_session.query(LineUserAiOptOut).filter(
            LineUserAiOptOut.line_user_id == line_user_id,
            LineUserAiOptOut.clinic_id == clinic.id
        ).first()
        assert opt_out is not None
        
        # Clear opt-out
        cleared = clear_ai_opt_out(db_session, line_user_id, clinic.id)
        
        assert cleared is True
        
        # Verify it's gone
        opt_out = db_session.query(LineUserAiOptOut).filter(
            LineUserAiOptOut.line_user_id == line_user_id,
            LineUserAiOptOut.clinic_id == clinic.id
        ).first()
        assert opt_out is None
    
    def test_clear_opt_out_when_not_opted_out(self, db_session: Session, sample_clinic_data):
        """Test that clearing opt-out when not opted out returns False."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Try to clear when not opted out
        cleared = clear_ai_opt_out(db_session, line_user_id, clinic.id)
        
        assert cleared is False


class TestIsAiOptedOut:
    """Test checking AI opt-out status."""
    
    def test_is_opted_out_returns_false_when_not_opted_out(self, db_session: Session, sample_clinic_data):
        """Test that is_opted_out returns False when user is not opted out."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        result = is_ai_opted_out(db_session, line_user_id, clinic.id)
        
        assert result is False
    
    def test_is_opted_out_returns_true_when_opted_out(self, db_session: Session, sample_clinic_data):
        """Test that is_opted_out returns True when user is opted out."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Set opt-out
        set_ai_opt_out(db_session, line_user_id, clinic.id)
        
        # Check status
        result = is_ai_opted_out(db_session, line_user_id, clinic.id)
        
        assert result is True
    
    def test_is_opted_out_auto_expires(self, db_session: Session, sample_clinic_data):
        """Test that expired opt-outs are automatically cleaned up."""
        clinic = Clinic(**sample_clinic_data)
        db_session.add(clinic)
        db_session.commit()
        
        line_user_id = "U_test_user_123"
        
        # Set opt-out with very short duration (1 second)
        opt_out = LineUserAiOptOut(
            line_user_id=line_user_id,
            clinic_id=clinic.id,
            opted_out_until=taiwan_now() - timedelta(seconds=1)  # Already expired
        )
        db_session.add(opt_out)
        db_session.commit()
        
        # Check status (should auto-cleanup expired opt-out)
        result = is_ai_opted_out(db_session, line_user_id, clinic.id)
        
        assert result is False
        
        # Verify record was deleted
        opt_out = db_session.query(LineUserAiOptOut).filter(
            LineUserAiOptOut.line_user_id == line_user_id,
            LineUserAiOptOut.clinic_id == clinic.id
        ).first()
        assert opt_out is None
    
    def test_is_opted_out_per_clinic_isolation(self, db_session: Session, sample_clinic_data):
        """Test that opt-out status is isolated per clinic."""
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
        
        # Opt out from clinic1 only
        set_ai_opt_out(db_session, line_user_id, clinic1.id)
        
        # Check status for each clinic
        assert is_ai_opted_out(db_session, line_user_id, clinic1.id) is True
        assert is_ai_opted_out(db_session, line_user_id, clinic2.id) is False

