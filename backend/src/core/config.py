"""
Application configuration using python-dotenv.

This module loads environment variables from .env file into os.environ
for use throughout the application.
"""

import os
import pathlib
from dotenv import load_dotenv


# Determine if we're running in a test environment
# Don't load .env file during testing to ensure predictable test behavior
is_testing = os.getenv("PYTEST_VERSION") is not None or any("pytest" in str(frame) for frame in __import__('inspect').stack(0))

# Load .env file into os.environ (only outside of testing)
if not is_testing:
    # Try multiple possible locations for .env file
    possible_paths = [
        pathlib.Path(__file__).parent.parent.parent / ".env",  # backend/.env (when run from backend/src)
        pathlib.Path(__file__).parent.parent.parent.parent / ".env",  # .env (when run from src)
        pathlib.Path.cwd() / ".env",  # .env in current directory
        pathlib.Path.cwd().parent / ".env",  # .env in parent directory
    ]

    for env_path in possible_paths:
        if env_path.exists():
            load_dotenv(env_path)
            break


# Configuration constants with defaults
# These match the environment variables defined in .env.example
def get_database_url():
    """Get the resolved database URL with proper path handling."""
    raw_url = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/clinic_bot")

    # Handle SQLite database path resolution
    if raw_url.startswith("sqlite:///") and not raw_url.startswith("sqlite:////"):
        # Relative SQLite path - resolve it relative to the backend directory
        db_path = raw_url[10:]  # Remove "sqlite:///"
        if not os.path.isabs(db_path):
            # Find the backend directory
            backend_dir = pathlib.Path(__file__).parent.parent.parent
            resolved_path = backend_dir / db_path
            return f"sqlite:///{resolved_path}"
        else:
            return raw_url
    else:
        return raw_url

DATABASE_URL = get_database_url()
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# Authentication
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-key-change-in-production")
SYSTEM_ADMIN_EMAILS = [email.strip() for email in os.getenv("SYSTEM_ADMIN_EMAILS", "").split(",") if email.strip()]
ENCRYPTION_KEY = os.getenv("ENCRYPTION_KEY", "")
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")

# Environment
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")  # "development" or "production"
