"""
Unit tests for Google OAuth service.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from services.google_oauth import GoogleOAuthService


class TestGoogleOAuthService:
    """Test cases for GoogleOAuthService."""

    @pytest.fixture
    def oauth_service(self):
        """Create a GoogleOAuthService instance for testing."""
        with patch('services.google_oauth.GOOGLE_CLIENT_ID', "test_client_id"), \
             patch('services.google_oauth.GOOGLE_CLIENT_SECRET', "test_client_secret"), \
             patch('services.google_oauth.API_BASE_URL', "http://localhost:8000"):

            service = GoogleOAuthService()
            return service

    def test_init(self, oauth_service):
        """Test service initialization."""
        assert oauth_service.client_id == "test_client_id"
        assert oauth_service.client_secret == "test_client_secret"
        assert oauth_service.redirect_uri == "http://localhost:8000/api/clinic/members/{user_id}/gcal/callback"

    def test_get_authorization_url(self, oauth_service):
        """Test authorization URL generation."""
        url = oauth_service.get_authorization_url(user_id=1, clinic_id=2)

        assert "https://accounts.google.com/o/oauth2/auth" in url
        assert "client_id=test_client_id" in url
        assert "redirect_uri=http%3A%2F%2Flocalhost%3A8000%2Fapi%2Fclinic%2Fmembers%2F1%2Fgcal%2Fcallback" in url
        assert "scope=" in url
        assert "response_type=code" in url
        assert "access_type=offline" in url
        assert "prompt=consent" in url

        # Check that state parameter is a JWT (signed)
        import re
        state_match = re.search(r'state=([^&]+)', url)
        assert state_match is not None
        state = state_match.group(1)

        # Verify the JWT state can be parsed
        from services.jwt_service import jwt_service
        state_data = jwt_service.verify_oauth_state(state)
        assert state_data is not None
        assert state_data["user_id"] == 1
        assert state_data["clinic_id"] == 2

    def test_generate_state(self, oauth_service):
        """Test state parameter generation."""
        state = oauth_service._generate_state(user_id=123, clinic_id=456)

        # Verify it's a JWT
        from services.jwt_service import jwt_service
        state_data = jwt_service.verify_oauth_state(state)
        assert state_data is not None
        assert state_data["user_id"] == 123
        assert state_data["clinic_id"] == 456

    def test_parse_state(self, oauth_service):
        """Test state parameter parsing."""
        # Create a signed state first
        from services.jwt_service import jwt_service
        signed_state = jwt_service.sign_oauth_state({"user_id": 123, "clinic_id": 456})

        # Now parse it
        user_id, clinic_id = oauth_service._parse_state(signed_state)
        assert user_id == 123
        assert clinic_id == 456

    @pytest.mark.asyncio
    @patch('services.google_oauth.httpx.AsyncClient')
    async def test_exchange_code_for_tokens_success(self, mock_client_class, oauth_service):
        """Test successful token exchange."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "test_access_token",
            "refresh_token": "test_refresh_token",
            "expires_in": 3600,
            "token_type": "Bearer"
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client_class.return_value.__aenter__.return_value = mock_client

        result = await oauth_service.exchange_code_for_tokens("test_code")

        assert result["access_token"] == "test_access_token"
        assert result["refresh_token"] == "test_refresh_token"
        assert result["expires_in"] == 3600

        mock_client.post.assert_called_once()
        call_args = mock_client.post.call_args
        assert call_args[0][0] == "https://oauth2.googleapis.com/token"

    @pytest.mark.asyncio
    @patch('services.google_oauth.httpx.AsyncClient')
    async def test_exchange_code_for_tokens_failure(self, mock_client_class, oauth_service):
        """Test token exchange failure."""
        mock_response = MagicMock()
        mock_response.raise_for_status.side_effect = Exception("HTTP Error")
        mock_response.status_code = 400

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client_class.return_value.__aenter__.return_value = mock_client

        with pytest.raises(Exception):
            await oauth_service.exchange_code_for_tokens("invalid_code")

    @pytest.mark.asyncio
    @patch('services.google_oauth.httpx.AsyncClient')
    async def test_refresh_access_token(self, mock_client_class, oauth_service):
        """Test access token refresh."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "access_token": "new_access_token",
            "expires_in": 3600,
            "token_type": "Bearer"
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.post.return_value = mock_response
        mock_client_class.return_value.__aenter__.return_value = mock_client

        result = await oauth_service.refresh_access_token("refresh_token_123")

        assert result["access_token"] == "new_access_token"
        assert result["expires_in"] == 3600

    @pytest.mark.asyncio
    @patch('services.google_oauth.httpx.AsyncClient')
    async def test_get_user_info(self, mock_client_class, oauth_service):
        """Test user info retrieval."""
        mock_response = MagicMock()
        mock_response.json.return_value = {
            "id": "12345",
            "email": "user@example.com",
            "name": "Test User",
            "verified_email": True
        }
        mock_response.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.get.return_value = mock_response
        mock_client_class.return_value.__aenter__.return_value = mock_client

        result = await oauth_service.get_user_info("access_token_123")

        assert result["email"] == "user@example.com"
        assert result["name"] == "Test User"

        mock_client.get.assert_called_once_with(
            "https://www.googleapis.com/oauth2/v2/userinfo",
            headers={"Authorization": "Bearer access_token_123"}
        )

    @pytest.mark.asyncio
    async def test_handle_oauth_callback_success(self, oauth_service):
        """Test successful OAuth callback handling."""
        mock_db = MagicMock()
        mock_therapist = MagicMock()
        mock_therapist.id = 1
        mock_therapist.name = "Dr. Test"

        # Mock database query
        mock_db.query.return_value.filter.return_value.first.return_value = mock_therapist

        # Mock token exchange
        with patch.object(oauth_service, 'exchange_code_for_tokens', new_callable=AsyncMock) as mock_exchange:
            mock_exchange.return_value = {
                "access_token": "test_access_token",
                "refresh_token": "test_refresh_token",
                "expires_in": 3600
            }

            # Mock user info retrieval
            with patch.object(oauth_service, 'get_user_info', new_callable=AsyncMock) as mock_user_info:
                mock_user_info.return_value = {
                    "email": "dr.test@example.com",
                    "name": "Dr. Test"
                }

                # Use signed state
                from services.jwt_service import jwt_service
                signed_state = jwt_service.sign_oauth_state({"user_id": 1, "clinic_id": 2})

                result = await oauth_service.handle_oauth_callback(mock_db, "test_code", signed_state)

                assert result == mock_therapist
                assert mock_therapist.gcal_credentials is not None
                assert mock_therapist.gcal_sync_enabled is True

                # Commit is called twice: once for credentials, once for sync status
                assert mock_db.commit.call_count == 2
                mock_db.refresh.assert_called_once_with(mock_therapist)

    @pytest.mark.asyncio
    async def test_handle_oauth_callback_therapist_not_found(self, oauth_service):
        """Test OAuth callback with non-existent therapist."""
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        # Mock all HTTP calls to avoid real network requests
        with patch.object(oauth_service, 'exchange_code_for_tokens', new_callable=AsyncMock) as mock_exchange, \
             patch.object(oauth_service, 'get_user_info', new_callable=AsyncMock) as mock_user_info:

            mock_exchange.return_value = {"access_token": "test_token"}
            mock_user_info.return_value = {"email": "test@example.com"}

            # Use signed state
            from services.jwt_service import jwt_service
            signed_state = jwt_service.sign_oauth_state({"user_id": 999, "clinic_id": 2})

            with pytest.raises(ValueError, match="User 999 not found in clinic 2"):
                await oauth_service.handle_oauth_callback(mock_db, "test_code", signed_state)
