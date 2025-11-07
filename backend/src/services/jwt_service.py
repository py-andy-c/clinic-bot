"""
JWT Service for access and refresh token management.

Provides secure token creation, validation, and refresh functionality
for authentication and session management.
"""

import bcrypt
import jwt
import hashlib
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any
from pydantic import BaseModel

from core.config import JWT_SECRET_KEY, JWT_ACCESS_TOKEN_EXPIRE_MINUTES, JWT_REFRESH_TOKEN_EXPIRE_DAYS


class TokenPayload(BaseModel):
    """Payload structure for JWT tokens."""
    sub: str  # Google subject ID
    email: str
    user_type: str  # "system_admin" or "clinic_user"
    roles: list[str]  # For clinic users: ["admin"], ["practitioner"], ["admin", "practitioner"]
    clinic_id: Optional[int] = None  # null for system admins
    name: str
    iat: Optional[int] = None  # Set by JWT service
    exp: Optional[int] = None  # Set by JWT service


class JWTService:
    """Service for JWT token operations."""

    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = JWT_ACCESS_TOKEN_EXPIRE_MINUTES
    REFRESH_TOKEN_EXPIRE_DAYS = JWT_REFRESH_TOKEN_EXPIRE_DAYS

    @classmethod
    def create_access_token(cls, payload: TokenPayload) -> str:
        """Create a JWT access token."""
        to_encode = payload.model_dump()
        expire = datetime.now(timezone.utc) + timedelta(minutes=cls.ACCESS_TOKEN_EXPIRE_MINUTES)
        to_encode.update({"exp": expire, "iat": datetime.now(timezone.utc)})
        encoded_jwt = jwt.encode(to_encode, JWT_SECRET_KEY, algorithm=cls.ALGORITHM)
        return encoded_jwt

    @classmethod
    def verify_token(cls, token: str) -> Optional[TokenPayload]:
        """Verify and decode a JWT token."""
        try:
            payload = jwt.decode(token, JWT_SECRET_KEY, algorithms=[cls.ALGORITHM])
            return TokenPayload(**payload)
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None

    @classmethod
    def create_refresh_token_hash(cls, token: str) -> tuple[str, str]:
        """
        Create a bcrypt hash of a refresh token.
        
        Returns:
            tuple: (bcrypt_hash, sha256_hash_hex)
            - bcrypt_hash: Full bcrypt hash for verification
            - sha256_hash_hex: SHA-256 hash in hex format for O(1) lookup
        """
        # First hash with SHA-256 to ensure input is within bcrypt's 72-byte limit
        token_hash_digest = hashlib.sha256(token.encode('utf-8')).digest()
        token_hash_sha256_hex = hashlib.sha256(token.encode('utf-8')).hexdigest()  # For lookup
        salt = bcrypt.gensalt()
        hashed = bcrypt.hashpw(token_hash_digest, salt)
        return (hashed.decode('utf-8'), token_hash_sha256_hex)

    @classmethod
    def verify_refresh_token_hash(cls, token: str, hashed_token: str) -> bool:
        """Verify a refresh token against its hash."""
        try:
            # First hash with SHA-256 to ensure input is within bcrypt's 72-byte limit
            token_hash = hashlib.sha256(token.encode('utf-8')).digest()
            return bcrypt.checkpw(token_hash, hashed_token.encode('utf-8'))
        except Exception:
            return False
    
    @classmethod
    def get_refresh_token_sha256_hash(cls, token: str) -> str:
        """
        Get SHA-256 hash of a refresh token for O(1) lookup.
        
        Returns:
            str: SHA-256 hash in hex format
        """
        return hashlib.sha256(token.encode('utf-8')).hexdigest()


    @classmethod
    def get_token_expiry(cls, token_type: str) -> datetime:
        """Get expiry datetime for a token type."""
        now = datetime.now(timezone.utc)
        if token_type == "access":
            return now + timedelta(minutes=cls.ACCESS_TOKEN_EXPIRE_MINUTES)
        elif token_type == "refresh":
            return now + timedelta(days=cls.REFRESH_TOKEN_EXPIRE_DAYS)
        else:
            raise ValueError(f"Unknown token type: {token_type}")

    @classmethod
    def is_token_expired(cls, expiry_time: datetime) -> bool:
        """Check if a token expiry time has passed."""
        return datetime.now(timezone.utc) >= expiry_time

    @classmethod
    def sign_oauth_state(cls, state_data: Dict[str, Any]) -> str:
        """Sign OAuth state parameter to prevent tampering."""
        payload = {
            **state_data,
            "iat": datetime.now(timezone.utc),
            "exp": datetime.now(timezone.utc) + timedelta(minutes=10)  # 10 minute expiry
        }
        return jwt.encode(payload, cls._get_secret_key(), algorithm=cls.ALGORITHM)

    @classmethod
    def verify_oauth_state(cls, signed_state: str) -> Optional[Dict[str, Any]]:
        """Verify and decode signed OAuth state parameter."""
        try:
            payload = jwt.decode(signed_state, cls._get_secret_key(), algorithms=[cls.ALGORITHM])
            # Remove JWT claims, return only the state data
            state_data = {k: v for k, v in payload.items() if k not in ['iat', 'exp']}
            return state_data
        except jwt.ExpiredSignatureError:
            return None
        except jwt.InvalidTokenError:
            return None

    @classmethod
    def _get_secret_key(cls) -> str:
        """Get the JWT secret key."""
        from core.config import JWT_SECRET_KEY
        return JWT_SECRET_KEY

    @classmethod
    def create_token_pair(cls, payload: TokenPayload) -> Dict[str, Any]:
        """Create both access and refresh tokens."""
        access_token = cls.create_access_token(payload)

        # Create refresh token (random string)
        import secrets
        refresh_token = secrets.token_urlsafe(64)
        refresh_token_hash, refresh_token_hash_sha256 = cls.create_refresh_token_hash(refresh_token)

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "refresh_token_hash": refresh_token_hash,
            "refresh_token_hash_sha256": refresh_token_hash_sha256,  # SHA-256 hash for O(1) lookup
            "token_type": "bearer",
            "expires_in": cls.ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # seconds
            "expires_at": int(cls.get_token_expiry("access").timestamp()),
        }


# Global instance
jwt_service = JWTService()
