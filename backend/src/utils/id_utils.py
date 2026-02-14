from typing import Optional
from fastapi import HTTPException, status
from core.constants import TEMPORARY_ID_THRESHOLD

def is_real_id(id_value: Optional[int]) -> bool:
    """
    Check if an ID is a real database ID (small positive integer).
    - None or 0: New record (False)
    - 1 to TEMPORARY_ID_THRESHOLD: Real ID (True)
    - >= TEMPORARY_ID_THRESHOLD: Invalid/Malicious ID (Raise HTTPException)
    """
    if id_value is None or id_value == 0:
        return False
        
    if id_value >= TEMPORARY_ID_THRESHOLD:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid ID {id_value}: exceeds temporary threshold. Please ensure you are not sending temporary frontend IDs to the backend."
        )
        
    return id_value > 0
