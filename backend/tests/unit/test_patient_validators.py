"""
Unit tests for patient field validation utilities.
"""

import pytest
from utils.patient_validators import validate_gender_field


class TestValidateGenderField:
    """Test cases for validate_gender_field function."""

    def test_valid_male(self):
        """Test valid 'male' value."""
        assert validate_gender_field('male') == 'male'
        assert validate_gender_field('MALE') == 'male'
        assert validate_gender_field('  male  ') == 'male'

    def test_valid_female(self):
        """Test valid 'female' value."""
        assert validate_gender_field('female') == 'female'
        assert validate_gender_field('FEMALE') == 'female'
        assert validate_gender_field('  female  ') == 'female'

    def test_valid_other(self):
        """Test valid 'other' value."""
        assert validate_gender_field('other') == 'other'
        assert validate_gender_field('OTHER') == 'other'
        assert validate_gender_field('  other  ') == 'other'

    def test_none_value(self):
        """Test None value returns None."""
        assert validate_gender_field(None) is None

    def test_invalid_value(self):
        """Test invalid values raise ValueError."""
        with pytest.raises(ValueError, match='性別值無效'):
            validate_gender_field('invalid')
        
        with pytest.raises(ValueError, match='性別值無效'):
            validate_gender_field('')
        
        with pytest.raises(ValueError, match='性別值無效'):
            validate_gender_field('   ')

    def test_case_insensitive(self):
        """Test that validation is case-insensitive."""
        assert validate_gender_field('Male') == 'male'
        assert validate_gender_field('Female') == 'female'
        assert validate_gender_field('Other') == 'other'
        assert validate_gender_field('MALE') == 'male'
        assert validate_gender_field('FEMALE') == 'female'
        assert validate_gender_field('OTHER') == 'other'

