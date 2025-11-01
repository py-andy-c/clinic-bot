# pyright: reportUnknownMemberType=false, reportMissingTypeStubs=false
from datetime import datetime, timezone, timedelta
from enum import Enum
from sqlalchemy.orm import Session
import logging
from models import Appointment, User, Clinic

logger = logging.getLogger(__name__)


class CancellationSource(Enum):
    CLINIC = "clinic"
    GCAL = "gcal"
    PATIENT = "patient"


class NotificationService:
    """Service for sending LINE notifications to patients."""

    @staticmethod
    def send_appointment_cancellation(
        db: Session,
        appointment: Appointment,
        practitioner: User,
        source: CancellationSource
    ) -> bool:
        """
        Send appointment cancellation notification to patient.

        Args:
            db: Database session
            appointment: Cancelled appointment
            practitioner: Practitioner who had the appointment
            source: Source of cancellation (clinic/gcal/patient)

        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            patient = appointment.patient
            if not patient.line_user:
                logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
                return False

            clinic = patient.clinic

            # Format datetime
            formatted_datetime = NotificationService._format_appointment_datetime(
                appointment.calendar_event.start_datetime
            )

            # Generate message based on source
            message = NotificationService._get_cancellation_message(
                formatted_datetime,
                practitioner.full_name,
                source
            )

            # Send notification
            line_service = NotificationService._get_line_service(clinic)
            line_service.send_text_message(patient.line_user.line_user_id, message)

            logger.info(
                f"Sent {source.value} cancellation notification to patient {patient.id} "
                f"for appointment {appointment.calendar_event_id}"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to send cancellation notification: {e}")
            return False

    @staticmethod
    def _format_appointment_datetime(dt: datetime) -> str:
        """Format datetime for Taiwan timezone (UTC+8)."""
        local_tz = timezone(timedelta(hours=8))
        local_datetime = dt.astimezone(local_tz)
        return local_datetime.strftime("%m/%d (%a) %H:%M")

    @staticmethod
    def _get_cancellation_message(
        formatted_datetime: str,
        practitioner_name: str,
        source: CancellationSource
    ) -> str:
        """Generate appropriate cancellation message."""
        base = f"{formatted_datetime} - {practitioner_name}治療師"

        if source == CancellationSource.CLINIC:
            return f"您的預約已被診所取消：{base}。如需重新預約，請點選「線上約診」"
        elif source == CancellationSource.GCAL:
            return f"您的預約已被取消：{base}。如需重新預約，請點選「線上約診」"
        else:
            return f"您的預約已取消：{base}"

    @staticmethod
    def _get_line_service(clinic: Clinic):
        """Get LINE service for clinic."""
        from services.line_service import LINEService
        return LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
