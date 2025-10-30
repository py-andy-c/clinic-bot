"""
Conversation context for LINE chatbot interactions.

This module defines the ConversationContext dataclass that provides all necessary
context to agents and tools during LINE message processing.
"""

from dataclasses import dataclass
from typing import Optional
from datetime import datetime, timezone, timedelta
from sqlalchemy.orm import Session

from models import Clinic, Patient, User, AppointmentType


@dataclass
class ConversationContext:
    """
    Context for a single LINE conversation, containing all needed data for agents and tools.

    This context is automatically injected into all agent tools via RunContextWrapper[T].
    Tools access it via wrapper.context to perform database operations and get clinic data.

    Attributes:
        db_session: Database session for all database operations
        clinic: Clinic information (therapists, appointment types, etc.)
        patient: Patient information (None if not linked yet)
        line_user_id: LINE platform user identifier for linking operations
        is_linked: Read-only flag indicating if account is linked
    """

    # Database access (required for all operations)
    db_session: Session

    # Clinic data (provides therapists, appointment types, etc.)
    clinic: Clinic

    # Patient/User data (None if not linked yet)
    patient: Optional[Patient] = None
    line_user_id: str = ""  # LINE platform user identifier
    is_linked: bool = False  # Read-only linking status
    
    # Current date/time for appointment scheduling
    current_datetime: Optional[datetime] = None  # Will be set to current Taiwan time directly

    @property
    def therapists_list(self) -> str:
        """
        Formatted list of available practitioners with IDs for prompt injection.

        Only includes practitioners who have configured their default availability.

        Returns:
            Comma-separated list of practitioner names with IDs (e.g., "王大明(ID:1), 李小華(ID:2), 陳醫師(ID:3)")
        """
        from models.practitioner_availability import PractitionerAvailability

        # Get all users in the clinic first, then filter in Python
        # This is necessary because SQLite JSON operations don't work reliably with contains()
        all_users_in_clinic = self.db_session.query(User).filter(
            User.clinic_id == self.clinic.id,
            User.is_active == True
        ).all()

        # Filter to only practitioners
        practitioners = [u for u in all_users_in_clinic if 'practitioner' in u.roles]

        # Get practitioners who have configured default availability
        practitioners_with_availability: list[User] = []
        for practitioner in practitioners:
            has_availability = self.db_session.query(PractitionerAvailability).filter(
                PractitionerAvailability.user_id == practitioner.id
            ).first() is not None

            if has_availability:
                practitioners_with_availability.append(practitioner)

        return ", ".join([f"{p.full_name}(ID:{p.id})" for p in practitioners_with_availability])

    @property
    def appointment_types_list(self) -> str:
        """
        Formatted list of appointment types with durations and IDs for prompt injection.

        Returns:
            Comma-separated list with durations and IDs (e.g., "初診評估(60min, ID:1), 一般複診(30min, ID:2)")
        """
        types = self.db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == self.clinic.id
        ).all()
        return ", ".join([f"{t.name}({t.duration_minutes}min, ID:{t.id})" for t in types])

    @property
    def patient_id(self) -> Optional[int]:
        """
        Get the patient ID for the linked patient.

        Returns:
            Patient ID if patient is linked, None otherwise
        """
        return self.patient.id if self.patient else None

    @property
    def current_date_time_info(self) -> str:
        """
        Formatted current date and time information for prompt injection.
        Includes weekday information for dates from today up to 21 days from now.

        Returns:
            Formatted string with current date and time in Taiwan timezone plus weekday calendar
        """
        if self.current_datetime is None:
            # Fallback to current Taiwan time if not set
            taiwan_tz = timezone(timedelta(hours=8))
            taiwan_time = datetime.now(taiwan_tz)
        else:
            # current_datetime is already in Taiwan timezone
            taiwan_time = self.current_datetime

        # Generate weekday information for dates up to 21 days from now
        weekday_names = ["一", "二", "三", "四", "五", "六", "日"]
        today_weekday = weekday_names[taiwan_time.date().weekday()]
        calendar_info: list[str] = []

        # Start from today, go to 21 days from now (22 days total)
        start_date = taiwan_time.date()
        end_date = taiwan_time.date() + timedelta(days=21)

        current = start_date
        while current <= end_date:
            weekday_name = weekday_names[current.weekday()]
            calendar_info.append(f"{current.strftime('%Y年%m月%d日')}({weekday_name})")
            current += timedelta(days=1)

        calendar_text = " | ".join(calendar_info)

        # Format time with AM/PM indicator in Chinese
        hour = taiwan_time.hour
        minute = taiwan_time.minute
        am_pm = "上午" if hour < 12 else "下午"
        hour_12 = hour if hour <= 12 else hour - 12
        if hour_12 == 0:
            hour_12 = 12

        time_str = f"{hour_12}:{minute:02d} {am_pm}"

        return f"""今天日期：{taiwan_time.strftime('%Y年%m月%d日')}（{today_weekday}），現在時間：{time_str}

**日期參考（今天起到21天後）：**
{calendar_text}"""

    def __post_init__(self) -> None:
        """Validate context after initialization."""
        if not self.db_session:
            raise ValueError("db_session is required")
        if not self.clinic:
            raise ValueError("clinic is required")
        if not self.line_user_id:
            raise ValueError("line_user_id is required")
