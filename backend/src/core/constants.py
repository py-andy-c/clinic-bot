"""Application constants and configuration values."""

from core.config import FRONTEND_URL

# Database field lengths
MAX_STRING_LENGTH = 255

# OAuth and authentication
GOOGLE_OAUTH_SCOPES = [
    "openid",
    "profile",
    "email"
]

# Database connection settings
DB_POOL_RECYCLE_SECONDS = 300  # 5 minutes

# CORS origins for development and production
# Note: ngrok URLs and production URLs should be added via FRONTEND_URL environment variable
# Railway/Vercel URLs are automatically added via environment variables
_CORS_ORIGINS_RAW = [
    "http://localhost:5173",      # React dev server (Vite) - localhost
    "http://10.0.0.25:5173",     # React dev server - local network IP
    FRONTEND_URL,  # Includes ngrok URL or production URL if FRONTEND_URL is set accordingly
]

# Filter out None values and empty strings to avoid CORS errors
CORS_ORIGINS = [origin for origin in _CORS_ORIGINS_RAW if origin and origin.strip()]

# Appointment reminders
DEFAULT_REMINDER_HOURS_BEFORE = 24  # Send reminders 24 hours before appointment
