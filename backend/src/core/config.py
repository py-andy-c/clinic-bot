"""
Application configuration using Pydantic settings.

This module defines all configuration variables for the Clinic Bot application,
loaded from environment variables with fallback defaults.
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """
    Application settings loaded from environment variables.

    All settings can be overridden using environment variables.
    See .env.example for available configuration options.
    """

    # Database Configuration
    database_url: str = "postgresql://user:password@localhost/clinic_bot"
    """
    PostgreSQL database connection URL.

    Format: postgresql://username:password@host:port/database
    Should include all connection parameters for production use.
    """

    # API Configuration
    api_base_url: str = "http://localhost:8000"
    """
    Base URL for the API server.

    Used for constructing callback URLs and API documentation.
    Should be the publicly accessible URL in production.
    """

    # LINE API Configuration
    line_channel_secret: str = ""
    """
    LINE Channel Secret for webhook signature verification.

    Obtained from LINE Developers Console when creating a channel.
    Used to verify that webhook requests are authentic.
    """

    line_channel_access_token: str = ""
    """
    LINE Channel Access Token for API calls.

    Obtained from LINE Developers Console after creating a channel.
    Required for sending messages and other LINE API operations.
    """

    # Google OAuth Configuration
    google_client_id: str = ""
    """
    Google OAuth 2.0 Client ID.

    Obtained from Google Cloud Console when setting up OAuth credentials.
    Identifies the application to Google OAuth servers.
    """

    google_client_secret: str = ""
    """
    Google OAuth 2.0 Client Secret.

    Obtained from Google Cloud Console along with the Client ID.
    Used to exchange authorization codes for access tokens.
    Keep this secret and never expose it in client-side code.
    """

    # Gemini LLM Configuration
    gemini_api_key: str = ""
    """
    Google Gemini API key for LLM-powered conversations.

    Required for the chatbot functionality. Obtain from Google AI Studio.
    Used to power the conversational appointment booking system.
    """

    gemini_model: str = "gemini-2.5-flash-lite"
    """
    Gemini model to use for conversations.

    Default is gemini-2.5-flash-lite for fast, efficient responses.
    Optimized for conversational AI and function calling.
    """

    # JWT Configuration (for future use)
    jwt_secret_key: str = "your-secret-key-here"
    """
    Secret key for JWT token signing.

    Should be a long, random string in production.
    Used for encoding and decoding JWT tokens for authentication.
    """

    jwt_algorithm: str = "HS256"
    """
    Algorithm used for JWT token signing.

    HS256 (HMAC SHA-256) is recommended for most use cases.
    """

    jwt_expiration_hours: int = 24
    """
    Default expiration time for JWT tokens in hours.

    Tokens will be invalid after this many hours from issuance.
    """

    # Environment Configuration
    environment: str = "development"
    """
    Current environment (development, staging, production).

    Affects logging levels, database echo settings, and other behaviors.
    """

    class Config:
        """Pydantic configuration for settings loading."""
        env_file = ".env"
        case_sensitive = False


# Global settings instance
settings = Settings()
