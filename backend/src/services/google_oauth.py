from typing import Any
import urllib.parse
import httpx
from sqlalchemy.orm import Session

from core.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, API_BASE_URL
from core.constants import GOOGLE_OAUTH_SCOPES
from models import User


class GoogleOAuthService:
    """Service for handling Google OAuth2 flow for practitioners"""

    AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"
    USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
    DEFAULT_TOKEN_TYPE = "Bearer"

    SCOPES = GOOGLE_OAUTH_SCOPES

    def __init__(self, redirect_uri: str | None = None) -> None:
        super().__init__()
        self.client_id = GOOGLE_CLIENT_ID
        self.client_secret = GOOGLE_CLIENT_SECRET
        # Use provided redirect URI or default to clinic member callback (fixed URI)
        self.redirect_uri = redirect_uri or f"{API_BASE_URL}/api/clinic/members/gcal/callback"

    def get_authorization_url(self, user_id: int, clinic_id: int) -> str:
        """Generate Google OAuth2 authorization URL"""
        state = self._generate_state(user_id, clinic_id)
        redirect_uri = self.redirect_uri

        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "scope": " ".join(self.SCOPES),
            "response_type": "code",
            "access_type": "offline",  # Request refresh token
            "prompt": "consent",  # Force consent screen to get refresh token
            "state": state
        }

        query_string = urllib.parse.urlencode(params)
        return f"{self.AUTH_URL}?{query_string}"

    async def exchange_code_for_tokens(self, code: str, redirect_uri: str | None = None) -> dict[str, Any]:
        """Exchange authorization code for access and refresh tokens"""
        final_redirect_uri = redirect_uri or self.redirect_uri
        if "{user_id}" in final_redirect_uri:
            # If redirect_uri template contains user_id placeholder, we need it from somewhere
            # For now, assume it's been formatted already when passed in
            pass

        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": final_redirect_uri
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(self.TOKEN_URL, data=data)
            response.raise_for_status()
            return response.json()

    async def refresh_access_token(self, refresh_token: str) -> dict[str, Any]:
        """Refresh an expired access token"""
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token"
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(self.TOKEN_URL, data=data)
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        """Get user information from Google"""
        headers = {"Authorization": f"Bearer {access_token}"}

        async with httpx.AsyncClient() as client:
            response = await client.get(self.USERINFO_URL, headers=headers)
            response.raise_for_status()
            return response.json()

    def _generate_state(self, user_id: int, clinic_id: int) -> str:
        """Generate signed state parameter for OAuth flow"""
        from services.jwt_service import jwt_service
        state_data = {"user_id": user_id, "clinic_id": clinic_id}
        return jwt_service.sign_oauth_state(state_data)

    def _parse_state(self, state: str) -> tuple[int, int]:
        """Parse signed state parameter to extract user and clinic IDs"""
        from services.jwt_service import jwt_service
        state_data = jwt_service.verify_oauth_state(state)
        if not state_data:
            raise ValueError("Invalid or expired OAuth state")
        user_id = state_data.get("user_id")
        clinic_id = state_data.get("clinic_id")
        if not isinstance(user_id, int) or not isinstance(clinic_id, int):
            raise ValueError("Invalid state data")
        return user_id, clinic_id

    async def handle_oauth_callback(self, db: Session, code: str, state: str) -> User:
        """Handle OAuth callback and store tokens"""
        user_id, clinic_id = self._parse_state(state)

        # Use the fixed redirect URI
        redirect_uri = self.redirect_uri

        # Exchange code for tokens
        token_data = await self.exchange_code_for_tokens(code, redirect_uri)

        # Get user info to verify
        user_info = await self.get_user_info(token_data["access_token"])

        # Find and validate user
        user = self._find_user(db, user_id, clinic_id)

        # Store credentials and update sync status
        self._store_oauth_credentials(db, user, token_data, user_info)
        self._enable_calendar_sync(db, user)

        return user

    def _find_user(self, db: Session, user_id: int, clinic_id: int) -> User:
        """Find user by ID and clinic, raising error if not found."""
        user = db.query(User).filter(
            User.id == user_id,
            User.clinic_id == clinic_id
        ).first()

        if not user:
            raise ValueError(f"User {user_id} not found in clinic {clinic_id}")

        return user

    def _store_oauth_credentials(
        self,
        db: Session,
        user: User,
        token_data: dict[str, Any],
        user_info: dict[str, Any]
    ) -> None:
        """Store encrypted OAuth credentials in user record."""
        credentials = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": token_data.get("expires_in"),  # Store as timestamp
            "token_type": token_data.get("token_type", self.DEFAULT_TOKEN_TYPE),
            "scope": token_data.get("scope"),
            "user_email": user_info.get("email"),
            "user_name": user_info.get("name")
        }

        # Encrypt credentials before storing
        from services.encryption_service import get_encryption_service
        encrypted_credentials = get_encryption_service().encrypt_data(credentials)
        user.gcal_credentials = encrypted_credentials
        db.commit()

    def _enable_calendar_sync(self, db: Session, user: User) -> None:
        """
        Enable Google Calendar synchronization for the user.
        
        NOTE: Calendar sync is currently disabled - calendar scopes were removed
        because requiring calendar access would need Google App verification.
        """
        # Calendar sync disabled - scopes removed to avoid Google App verification requirement
        # user.gcal_sync_enabled = True
        user.gcal_sync_enabled = False
        db.commit()
        db.refresh(user)


google_oauth_service = GoogleOAuthService()
