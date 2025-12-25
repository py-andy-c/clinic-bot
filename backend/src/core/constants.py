"""Application constants and configuration values."""

from core.config import FRONTEND_URL

# Database field lengths
MAX_STRING_LENGTH = 255
MAX_EVENT_NAME_LENGTH = 100  # Maximum length for custom calendar event names

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

# Chat conversation history settings
CHAT_MAX_HISTORY_HOURS = 24  # Preferred time window: keep messages from last 24 hours
CHAT_MIN_HISTORY_MESSAGES = 0  # Minimum messages to keep (even if older than MAX_HISTORY_HOURS)
CHAT_MAX_HISTORY_MESSAGES = 35  # Upper bound: never keep more than this many messages
CHAT_SESSION_EXPIRY_HOURS = 168  # Hard cutoff: delete messages older than 7 days (even if below MIN)
CHAT_TEST_SESSION_EXPIRY_HOURS = 12  # Test sessions expire after 12 hour

# LINE AI opt-out settings
OPT_OUT_COMMAND = "人工回覆"  # Command to opt out of AI replies
RE_ENABLE_COMMAND = "重啟AI"  # Command to re-enable AI replies
AI_OPT_OUT_DURATION_HOURS = 24  # Duration in hours that AI replies are disabled when user opts out

# LINE message metadata retention
LINE_MESSAGE_RETENTION_HOURS = 240  # 10 days (longer than CHAT_SESSION_EXPIRY_HOURS for safety)

# Availability Notification Limits
MAX_TIME_WINDOWS_PER_NOTIFICATION = 10
MAX_NOTIFICATIONS_PER_USER = 10
NOTIFICATION_DATE_RANGE_DAYS = 30

# Notification Check Times (Taiwan time)
NOTIFICATION_CHECK_HOURS = [9, 15, 21]  # 9am, 3pm, 9pm
NOTIFICATION_CLEANUP_HOUR = 3  # 3 AM

# Dashboard settings
DASHBOARD_PAST_MONTHS_COUNT = 3  # Number of past months to display (in addition to current month)

# Temporary ID threshold
# Temporary IDs are generated using Date.now() (large timestamps > 1000000000000)
# Real IDs from the backend are small integers, so we use this threshold to distinguish them
TEMPORARY_ID_THRESHOLD = 1000000000000
