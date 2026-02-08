from typing import Dict, Any, List, Optional

def validate_record_values(template_fields: List[Dict[str, Any]], values: Dict[str, Any]) -> List[str]:
    """
    Validate that all required fields in the template are present and non-empty in values.
    
    This function performs server-side validation for patient-submitted forms (LIFF).
    It is NOT used for clinic-side medical record endpoints (which allow incomplete records).
    
    Args:
        template_fields: List of field definitions from the template, each containing:
            - id: Field identifier
            - label: Display name for error messages
            - required: Boolean indicating if field is required
            - type: Field type (text, number, checkbox, etc.)
        values: Dictionary of field values submitted by the user
    
    Returns:
        List of error messages for missing/invalid required fields.
        Empty list if all required fields are valid.
        Format: ["必填欄位未填寫: {field_label}", ...]
    
    Validation Rules:
        - Text fields: Rejects None, empty string, whitespace-only strings
        - Number fields: Rejects None, but accepts 0 (zero is valid)
        - Checkbox fields: Rejects None and empty arrays []
        - Booleans: Not used in our system (checkboxes are arrays), but would be valid if present
    
    Data Type Notes:
        - Checkbox fields are ALWAYS arrays, never booleans
        - Zero (0) is a valid number (e.g., "0 cigarettes per day")
        - Whitespace-only strings are treated as empty
    
    Usage:
        - Called in POST /liff/patient-forms/:accessToken/submit
        - Called in PUT /liff/patient-forms/:accessToken (update)
        - NOT called for clinic-side endpoints (intentionally allows incomplete data)
    
    Example:
        >>> fields = [{'id': 'name', 'label': '姓名', 'required': True}]
        >>> values = {'name': ''}
        >>> validate_record_values(fields, values)
        ['必填欄位未填寫: 姓名']
        
        >>> values = {'name': 'John'}
        >>> validate_record_values(fields, values)
        []
    """
    errors: List[str] = []
    
    for field in template_fields:
        if field.get('required', False):
            field_id: Optional[str] = field.get('id')
            field_label: str = str(field.get('label', 'Unknown Field'))
            
            # Skip fields without IDs (malformed template)
            if not field_id:
                continue
                
            value: Any = values.get(field_id)
            
            # Validation Logic: Check if value is missing or empty
            # 
            # IMPORTANT: This uses a "whitelist" approach - we explicitly check for INVALID cases
            # and let everything else pass. This is defensive programming.
            #
            # Invalid cases:
            # - None: Field not provided or explicitly null
            # - Empty string after trimming: User entered only whitespace
            # - Empty list: Checkbox with no selections
            #
            # Valid cases (by design):
            # - Zero (0): Valid number (e.g., "0 cigarettes per day")
            # - False: Not used in our system (checkboxes are arrays), but would be valid
            # - Non-empty strings: Any text content
            # - Non-empty lists: Any checkbox selections
            # - Any other type: Defensive - don't reject unexpected but potentially valid data
            is_valid = True
            
            if value is None:
                is_valid = False  # Field not provided
            elif isinstance(value, str) and not value.strip():
                is_valid = False  # Empty or whitespace-only string
            elif isinstance(value, list) and not value:
                is_valid = False  # Empty array (checkbox with no selections)
            # All other cases pass validation (numbers including 0, non-empty strings/arrays, etc.)
                
            if not is_valid:
                errors.append(f"必填欄位未填寫: {field_label}")
                
    return errors
