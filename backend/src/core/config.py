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
    env_path = pathlib.Path(__file__).parent.parent.parent / ".env"
    if env_path.exists():
        load_dotenv(env_path)


# Configuration constants with defaults
# These match the environment variables defined in .env.example
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://user:password@localhost/clinic_bot")
API_BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")
GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
