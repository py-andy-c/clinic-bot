"""
Tests for template validation utility.
"""
import pytest
from utils.template_validation import validate_record_values


class TestValidateRecordValues:
    """Test suite for validate_record_values function."""

    def test_all_required_fields_filled(self):
        """Test that validation passes when all required fields are filled."""
        template_fields = [
            {'id': 'field1', 'label': 'Name', 'required': True, 'type': 'text'},
            {'id': 'field2', 'label': 'Age', 'required': True, 'type': 'number'},
            {'id': 'field3', 'label': 'Notes', 'required': False, 'type': 'textarea'},
        ]
        values = {
            'field1': 'John Doe',
            'field2': 25,
        }
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_missing_required_text_field(self):
        """Test that validation fails when required text field is missing."""
        template_fields = [
            {'id': 'name', 'label': '姓名', 'required': True, 'type': 'text'},
        ]
        values = {}
        
        errors = validate_record_values(template_fields, values)
        assert len(errors) == 1
        assert '必填欄位未填寫: 姓名' in errors

    def test_empty_string_is_invalid(self):
        """Test that empty strings are treated as missing."""
        template_fields = [
            {'id': 'name', 'label': '姓名', 'required': True, 'type': 'text'},
        ]
        values = {'name': '   '}  # Whitespace only
        
        errors = validate_record_values(template_fields, values)
        assert len(errors) == 1
        assert '必填欄位未填寫: 姓名' in errors

    def test_empty_array_is_invalid(self):
        """Test that empty arrays are treated as missing."""
        template_fields = [
            {'id': 'symptoms', 'label': '症狀', 'required': True, 'type': 'checkbox'},
        ]
        values = {'symptoms': []}
        
        errors = validate_record_values(template_fields, values)
        assert len(errors) == 1
        assert '必填欄位未填寫: 症狀' in errors

    def test_null_value_is_invalid(self):
        """Test that null values are treated as missing."""
        template_fields = [
            {'id': 'diagnosis', 'label': '診斷', 'required': True, 'type': 'text'},
        ]
        values = {'diagnosis': None}
        
        errors = validate_record_values(template_fields, values)
        assert len(errors) == 1
        assert '必填欄位未填寫: 診斷' in errors

    def test_multiple_missing_fields(self):
        """Test that all missing required fields are reported."""
        template_fields = [
            {'id': 'field1', 'label': 'Field 1', 'required': True, 'type': 'text'},
            {'id': 'field2', 'label': 'Field 2', 'required': True, 'type': 'text'},
            {'id': 'field3', 'label': 'Field 3', 'required': False, 'type': 'text'},
        ]
        values = {}
        
        errors = validate_record_values(template_fields, values)
        assert len(errors) == 2
        assert '必填欄位未填寫: Field 1' in errors
        assert '必填欄位未填寫: Field 2' in errors

    def test_optional_fields_can_be_empty(self):
        """Test that optional fields don't cause validation errors."""
        template_fields = [
            {'id': 'required_field', 'label': 'Required', 'required': True, 'type': 'text'},
            {'id': 'optional_field', 'label': 'Optional', 'required': False, 'type': 'text'},
        ]
        values = {'required_field': 'value'}
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_field_without_id_is_skipped(self):
        """Test that fields without IDs are gracefully skipped."""
        template_fields = [
            {'label': 'No ID Field', 'required': True, 'type': 'text'},
        ]
        values = {}
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_field_without_required_flag_defaults_to_false(self):
        """Test that fields without 'required' key are treated as optional."""
        template_fields = [
            {'id': 'field1', 'label': 'Field 1', 'type': 'text'},
        ]
        values = {}
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_non_empty_array_is_valid(self):
        """Test that non-empty arrays pass validation."""
        template_fields = [
            {'id': 'symptoms', 'label': '症狀', 'required': True, 'type': 'checkbox'},
        ]
        values = {'symptoms': ['fever', 'cough']}
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_number_zero_is_valid(self):
        """Test that zero is a valid value for number fields."""
        template_fields = [
            {'id': 'count', 'label': 'Count', 'required': True, 'type': 'number'},
        ]
        values = {'count': 0}
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_boolean_false_is_valid(self):
        """Test that false is a valid value for boolean fields."""
        template_fields = [
            {'id': 'consent', 'label': 'Consent', 'required': True, 'type': 'checkbox'},
        ]
        values = {'consent': False}
        
        errors = validate_record_values(template_fields, values)
        assert errors == []

    def test_field_with_unknown_label_uses_default(self):
        """Test that fields without labels use a default label in error messages."""
        template_fields = [
            {'id': 'field1', 'required': True, 'type': 'text'},
        ]
        values = {}
        
        errors = validate_record_values(template_fields, values)
        assert len(errors) == 1
        assert '必填欄位未填寫: Unknown Field' in errors
