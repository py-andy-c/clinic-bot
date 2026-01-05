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

# Determine if we're running E2E tests
is_e2e = os.getenv("E2E_TEST_MODE") == "true"

# Load .env file into os.environ (only outside of testing)
if not is_testing:
    # For E2E tests, prioritize .env.e2e file
    if is_e2e:
        e2e_env_path = pathlib.Path(__file__).parent.parent.parent.parent / ".env.e2e"
        if e2e_env_path.exists():
            load_dotenv(e2e_env_path)
        else:
            # Fallback to regular .env loading for E2E if .env.e2e doesn't exist
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
    else:
        # Regular .env loading for non-E2E scenarios
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
    """Get the database URL from environment."""
    return os.getenv(
        "DATABASE_URL",
        "postgresql://localhost/clinic_bot_dev"
    )

DATABASE_URL = get_database_url()
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")

# Authentication
JWT_SECRET_KEY = os.getenv("JWT_SECRET_KEY", "dev-secret-key-change-in-production")
SYSTEM_ADMIN_EMAILS = [email.strip() for email in os.getenv("SYSTEM_ADMIN_EMAILS", "").split(",") if email.strip()]
JWT_ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
JWT_REFRESH_TOKEN_EXPIRE_DAYS = int(os.getenv("JWT_REFRESH_TOKEN_EXPIRE_DAYS", "7"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
LIFF_ID = os.getenv("LIFF_ID", "")  # LINE LIFF ID for availability notification URLs

# Environment setting (development, test, production)
# Defaults to 'development' if not set (for local development)
ENVIRONMENT = os.getenv("ENVIRONMENT", "development")

