"""
Phone number validation utilities.

Provides centralized phone number cleaning and validation logic
for consistent validation across the application.
"""

import re
from typing import Optional


def clean_phone_number(phone: str) -> str:
    """
    Clean phone number by removing common separators.
    
    Args:
        phone: Phone number string (may contain spaces, dashes, parentheses, etc.)
    
    Returns:
        Cleaned phone number (digits only)
    """
    # Remove common separators: spaces, dashes, parentheses, plus signs
    return re.sub(r'[-\s()+]', '', phone)


def validate_taiwanese_phone(phone: str) -> str:
    """
    Validate and clean Taiwanese phone number format (09xxxxxxxx).
    
    Args:
        phone: Phone number string to validate
    
    Returns:
        Cleaned phone number (09xxxxxxxx format)
    
    Raises:
        ValueError: If phone number is invalid
    """
    if not phone or not phone.strip():
        raise ValueError('Phone number is required')
    
    cleaned = clean_phone_number(phone)
    
    if not cleaned.isdigit():
        raise ValueError('Invalid phone number format')
    
    # Validate Taiwanese phone format: 09xxxxxxxx (10 digits)
    if not (cleaned.startswith('09') and len(cleaned) == 10):
        raise ValueError('Phone number must be 09xxxxxxxx format (10 digits)')
    
    return cleaned


def validate_taiwanese_phone_optional(phone: Optional[str]) -> Optional[str]:
    """
    Validate and clean Taiwanese phone number format (09xxxxxxxx) for optional fields.
    
    Args:
        phone: Optional phone number string to validate (can be None or empty string)
    
    Returns:
        Cleaned phone number (09xxxxxxxx format) or None if phone is None/empty
    
    Raises:
        ValueError: If phone number is invalid (but not empty)
    """
    if phone is None:
        return None
    
    # Treat empty strings as None (for clinic-created patients without phone)
    if not phone or not phone.strip():
        return None
    
    cleaned = clean_phone_number(phone)
    
    if not cleaned.isdigit():
        raise ValueError('Invalid phone number format')
    
    # Validate Taiwanese phone format: 09xxxxxxxx (10 digits)
    if not (cleaned.startswith('09') and len(cleaned) == 10):
        raise ValueError('Phone number must be 09xxxxxxxx format (10 digits)')
    
    return cleaned

