"""
Conversation context for LINE chatbot interactions.

This module defines the ConversationContext dataclass that provides all necessary
context to agents and tools during LINE message processing.
"""

from dataclasses import dataclass
from typing import Optional
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

    @property
    def therapists_list(self) -> str:
        """
        Formatted list of available practitioners for prompt injection.
        
        Only includes practitioners who have configured their default availability.

        Returns:
            Comma-separated list of practitioner names (e.g., "王大明, 李小華, 陳醫師")
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
        
        return ", ".join([p.full_name for p in practitioners_with_availability])

    @property
    def appointment_types_list(self) -> str:
        """
        Formatted list of appointment types with durations for prompt injection.

        Returns:
            Comma-separated list with durations (e.g., "初診評估(60min), 一般複診(30min)")
        """
        types = self.db_session.query(AppointmentType).filter(
            AppointmentType.clinic_id == self.clinic.id
        ).all()
        return ", ".join([f"{t.name}({t.duration_minutes}min)" for t in types])

    def __post_init__(self) -> None:
        """Validate context after initialization."""
        if not self.db_session:
            raise ValueError("db_session is required")
        if not self.clinic:
            raise ValueError("clinic is required")
        if not self.line_user_id:
            raise ValueError("line_user_id is required")
