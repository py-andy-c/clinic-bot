"""
Test utilities for clinic bot tests.
"""

import jwt
from datetime import datetime, timedelta
from typing import List

from core.config import JWT_SECRET_KEY


def create_jwt_token(user_id: int, clinic_id: int, roles: List[str]) -> str:
    """Create a JWT token for clinic user authentication."""
    payload = {
        "user_id": user_id,
        "clinic_id": clinic_id,
        "roles": roles,
        "exp": datetime.utcnow() + timedelta(hours=1),
        "iat": datetime.utcnow()
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm="HS256")
