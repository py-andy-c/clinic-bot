"""
Patient field validation utilities.

Provides centralized validation logic for patient fields
for consistent validation across the application.
"""

from typing import Optional, Union


def validate_gender_field(v: Union[str, None]) -> Optional[str]:
    """
    Validate gender field value.
    
    Valid values: 'male', 'female', 'other', or None.
    
    Args:
        v: Gender value to validate (string or None)
    
    Returns:
        Normalized gender value ('male', 'female', 'other') or None
    
    Raises:
        ValueError: If the value is not a valid gender value
    """
    if v is None:
        return None
    v = v.strip().lower()
    if v in ('male', 'female', 'other'):
        return v
    raise ValueError('性別值無效，必須為 male、female 或 other')

