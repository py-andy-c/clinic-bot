from typing import Any
import urllib.parse
import httpx
from sqlalchemy.orm import Session

from core.config import GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, API_BASE_URL
from core.constants import GOOGLE_OAUTH_SCOPES
from models.therapist import Therapist


class GoogleOAuthService:
    """Service for handling Google OAuth2 flow for therapists"""

    AUTH_URL = "https://accounts.google.com/o/oauth2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"
    USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo"
    DEFAULT_TOKEN_TYPE = "Bearer"

    SCOPES = GOOGLE_OAUTH_SCOPES

    def __init__(self) -> None:
        super().__init__()
        self.client_id = GOOGLE_CLIENT_ID
        self.client_secret = GOOGLE_CLIENT_SECRET
        self.redirect_uri = f"{API_BASE_URL}/api/admin/auth/google/callback"

    def get_authorization_url(self, therapist_id: int, clinic_id: int) -> str:
        """Generate Google OAuth2 authorization URL"""
        state = self._generate_state(therapist_id, clinic_id)

        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": " ".join(self.SCOPES),
            "response_type": "code",
            "access_type": "offline",  # Request refresh token
            "prompt": "consent",  # Force consent screen to get refresh token
            "state": state
        }

        query_string = urllib.parse.urlencode(params)
        return f"{self.AUTH_URL}?{query_string}"

    async def exchange_code_for_tokens(self, code: str) -> dict[str, Any]:
        """Exchange authorization code for access and refresh tokens"""
        data = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": self.redirect_uri
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

    def _generate_state(self, therapist_id: int, clinic_id: int) -> str:
        """Generate state parameter for OAuth flow"""
        # In production, this should be encrypted/signed
        return f"{therapist_id}:{clinic_id}"

    def _parse_state(self, state: str) -> tuple[int, int]:
        """Parse state parameter to extract therapist and clinic IDs"""
        therapist_id, clinic_id = state.split(":")
        return int(therapist_id), int(clinic_id)

    async def handle_oauth_callback(self, db: Session, code: str, state: str) -> Therapist:
        """Handle OAuth callback and store tokens"""
        therapist_id, clinic_id = self._parse_state(state)

        # Exchange code for tokens
        token_data = await self.exchange_code_for_tokens(code)

        # Get user info to verify
        user_info = await self.get_user_info(token_data["access_token"])

        # Find and validate therapist
        therapist = self._find_therapist(db, therapist_id, clinic_id)

        # Store credentials and update sync status
        self._store_oauth_credentials(db, therapist, token_data, user_info)
        self._enable_calendar_sync(db, therapist)

        return therapist

    def _find_therapist(self, db: Session, therapist_id: int, clinic_id: int) -> Therapist:
        """Find therapist by ID and clinic, raising error if not found."""
        therapist = db.query(Therapist).filter(
            Therapist.id == therapist_id,
            Therapist.clinic_id == clinic_id
        ).first()

        if not therapist:
            raise ValueError(f"Therapist {therapist_id} not found in clinic {clinic_id}")

        return therapist

    def _store_oauth_credentials(
        self,
        db: Session,
        therapist: Therapist,
        token_data: dict[str, Any],
        user_info: dict[str, Any]
    ) -> None:
        """Store OAuth credentials in therapist record."""
        credentials = {
            "access_token": token_data["access_token"],
            "refresh_token": token_data.get("refresh_token"),
            "expires_at": token_data.get("expires_in"),  # Store as timestamp
            "token_type": token_data.get("token_type", self.DEFAULT_TOKEN_TYPE),
            "scope": token_data.get("scope"),
            "user_email": user_info.get("email"),
            "user_name": user_info.get("name")
        }

        therapist.gcal_credentials = credentials  # type: ignore[assignment]
        db.commit()

    def _enable_calendar_sync(self, db: Session, therapist: Therapist) -> None:
        """Enable Google Calendar synchronization for the therapist."""
        therapist.gcal_sync_enabled = True  # type: ignore[assignment]
        db.commit()
        db.refresh(therapist)


google_oauth_service = GoogleOAuthService()
