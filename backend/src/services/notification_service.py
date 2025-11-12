# pyright: reportUnknownMemberType=false, reportMissingTypeStubs=false
from datetime import datetime
from enum import Enum
from sqlalchemy.orm import Session
import logging
from models import Appointment, User, Clinic
from utils.datetime_utils import format_datetime

logger = logging.getLogger(__name__)


class CancellationSource(Enum):
    CLINIC = "clinic"
    PATIENT = "patient"


class NotificationService:
    """Service for sending LINE notifications to patients."""

    @staticmethod
    def send_appointment_cancellation(
        db: Session,
        appointment: Appointment,
        practitioner: User,
        source: CancellationSource,
        note: str | None = None
    ) -> bool:
        """
        Send appointment cancellation notification to patient.

        Args:
            db: Database session
            appointment: Cancelled appointment
            practitioner: Practitioner who had the appointment
            source: Source of cancellation (clinic/patient)

        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            patient = appointment.patient
            if not patient.line_user:
                logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
                return False

            clinic = patient.clinic

            # Get practitioner name from association
            from models.user_clinic_association import UserClinicAssociation
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == practitioner.id,
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()
            practitioner_name = association.full_name if association else practitioner.email

            # Format datetime - combine date and start_time (Taiwan timezone)
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)

            # Get appointment type name
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else None

            # Generate message based on source
            message = NotificationService._get_cancellation_message(
                formatted_datetime,
                practitioner_name,
                appointment_type_name,
                patient.full_name,
                source,
                note
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
    def generate_cancellation_preview(
        appointment_type: str,
        appointment_time: str,
        therapist_name: str,
        patient_name: str,
        source: CancellationSource,
        clinic: "Clinic",
        note: str | None = None
    ) -> str:
        """
        Generate a preview of what a LINE cancellation message would look like.

        This method can be used by API endpoints to show users what their
        cancellation messages will look like before they are sent.

        Args:
            appointment_type: Name of the appointment type
            appointment_time: Formatted appointment time (e.g., "12/25 (三) 1:30 PM")
            therapist_name: Name of the therapist/practitioner
            patient_name: Name of the patient
            source: Source of cancellation (clinic/patient)
            clinic: Clinic object with display information
            note: Optional note to include in the message

        Returns:
            Formatted cancellation message string
        """
        return NotificationService._get_cancellation_message(
            appointment_time,
            therapist_name,
            appointment_type,
            patient_name,
            source,
            note
        )

    @staticmethod
    def _get_cancellation_message(
        formatted_datetime: str,
        practitioner_name: str,
        appointment_type_name: str | None,
        patient_name: str,
        source: CancellationSource,
        note: str | None = None
    ) -> str:
        """Generate appropriate cancellation message."""
        # Build base message with appointment type if available
        if appointment_type_name:
            base = f"{formatted_datetime} - 【{appointment_type_name}】{practitioner_name}治療師"
        else:
            base = f"{formatted_datetime} - {practitioner_name}治療師"

        # Add note if provided
        note_str = ""
        if note and note.strip():
            note_str = f"\n\n備註：{note.strip()}"

        if source == CancellationSource.CLINIC:
            return f"{patient_name}，您的預約已被診所取消：{base}。{note_str}\n\n如有需要，可透過Line重新預約。"
        else:
            return f"{patient_name}，您的預約已取消：{base}。{note_str}"

    @staticmethod
    def _get_line_service(clinic: Clinic):
        """Get LINE service for clinic."""
        from services.line_service import LINEService
        return LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
