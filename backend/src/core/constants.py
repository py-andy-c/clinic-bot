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

# Reminder window settings
REMINDER_WINDOW_SIZE_MINUTES = 35  # ±35 minutes window around reminder time
# This creates overlapping windows between hourly runs to prevent missed reminders:
# - Window width = 2 * REMINDER_WINDOW_SIZE_MINUTES = 70 minutes
# - Time between runs = 60 minutes (hourly scheduler)
# - Overlap = 70 - 60 = 10 minutes
# 
# Example with 24-hour reminder setting:
# - Run at 2:00 PM: checks appointments at 2:00 PM next day ± 35min
#   Window: 1:25 PM - 2:35 PM next day (70 minutes wide)
# - Run at 3:00 PM: checks appointments at 3:00 PM next day ± 35min
#   Window: 2:25 PM - 3:35 PM next day (70 minutes wide)
# - Overlap: 2:25 PM - 2:35 PM next day (10 minutes)
# 
# This 10-minute overlap ensures no appointments are missed at window boundaries,
# even if the scheduler runs slightly late or there are timing edge cases.

# Reminder scheduler settings
REMINDER_SCHEDULER_MAX_INSTANCES = 1  # Prevent overlapping scheduler runs

# Reminder catch-up settings
REMINDER_CATCHUP_WINDOW_HOURS = 48  # Catch-up window for missed reminders (48 hours)
# When the server starts up or reminder_hours_before setting increases, we check for
# future appointments within the next 48 hours that should have been reminded but weren't.
# This prevents missed reminders due to:
# - Server downtime
# - reminder_hours_before setting increases
# Only future appointments within this window will receive catch-up reminders.
