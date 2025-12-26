# pyright: reportMissingTypeStubs=false
"""
Shared models and validators for clinic API endpoints.

This module contains common request/response models and validation logic
that is shared across multiple clinic API domains.
"""

from datetime import date as date_type
from typing import Optional, Union
from pydantic import field_validator
from utils.datetime_utils import parse_date_string, taiwan_now
from utils.phone_validator import validate_taiwanese_phone_optional
from utils.patient_validators import validate_gender_field


# ===== Common Field Validators =====

def validate_patient_name(v: str) -> str:
    """
    Validate patient name field.
    
    - Trims whitespace
    - Ensures non-empty
    - Checks length (max 255)
    - Prevents XSS (rejects angle brackets)
    """
    v = v.strip()
    if not v:
        raise ValueError('姓名不能為空')
    if len(v) > 255:
        raise ValueError('姓名長度過長')
    # Basic XSS prevention: Reject angle brackets to prevent HTML/script injection
    # This is a simple but effective check for patient names, which are displayed
    # in the UI. More comprehensive sanitization is handled at the frontend layer.
    if '<' in v or '>' in v:
        raise ValueError('姓名包含無效字元')
    return v


def validate_patient_name_optional(v: Optional[str]) -> Optional[str]:
    """Validate patient name field (optional version)."""
    if v is None:
        return None
    return validate_patient_name(v)


def validate_birthday(v: Union[str, date_type, None]) -> Optional[date_type]:
    """
    Validate birthday format (YYYY-MM-DD) and reasonable range.
    
    - Accepts date object or string
    - Ensures not in future
    - Ensures not more than 150 years ago
    """
    if v is None:
        return None
    if isinstance(v, date_type):
        # Already a date object, just validate range
        today = taiwan_now().date()
        if v > today:
            raise ValueError('生日不能是未來日期')
        # Approximate 150 years check
        if (today - v).days > 150 * 365:
            raise ValueError('生日日期不合理')
        return v
    # v is str at this point
    try:
        parsed_date = parse_date_string(v)
        today = taiwan_now().date()
        if parsed_date > today:
            raise ValueError('生日不能是未來日期')
        if (today - parsed_date).days > 150 * 365:
            raise ValueError('生日日期不合理')
        return parsed_date
    except ValueError as e:
        # If it's already a birthday-related error, re-raise
        if '生日' in str(e) or 'date' in str(e).lower():
            raise
        # For parsing errors, provide clear message
        raise ValueError('生日格式錯誤，請使用 YYYY-MM-DD 格式') from e


def validate_phone_optional(v: Optional[str]) -> Optional[str]:
    """Validate phone number if provided, allow None or empty string."""
    return validate_taiwanese_phone_optional(v)


def validate_gender(v: Union[str, None]) -> Optional[str]:
    """Validate gender value."""
    return validate_gender_field(v)


# ===== Pydantic Field Validator Decorators =====
# These can be used as @field_validator decorators in Pydantic models

class PatientNameValidator:
    """Reusable field validator for patient names."""
    
    @classmethod
    @field_validator('full_name')
    def validate_name(cls, v: str) -> str:
        return validate_patient_name(v)
    
    @classmethod
    @field_validator('full_name')
    def validate_name_optional(cls, v: Optional[str]) -> Optional[str]:
        return validate_patient_name_optional(v)


class PatientBirthdayValidator:
    """Reusable field validator for patient birthdays."""
    
    @classmethod
    @field_validator('birthday', mode='before')
    def validate_birthday(cls, v: Union[str, date_type, None]) -> Optional[date_type]:
        return validate_birthday(v)


class PatientPhoneValidator:
    """Reusable field validator for patient phone numbers."""
    
    @classmethod
    @field_validator('phone_number')
    def validate_phone(cls, v: Optional[str]) -> Optional[str]:
        return validate_phone_optional(v)


class PatientGenderValidator:
    """Reusable field validator for patient gender."""
    
    @classmethod
    @field_validator('gender', mode='before')
    def validate_gender(cls, v: Union[str, None]) -> Optional[str]:
        return validate_gender(v)

