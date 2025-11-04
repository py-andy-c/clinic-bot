# pyright: reportUnknownMemberType=false, reportMissingTypeStubs=false
from datetime import datetime, timezone, timedelta
from enum import Enum
from sqlalchemy.orm import Session
import logging
from models import Appointment, User, Clinic
from utils.datetime_utils import TAIWAN_TZ

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
        source: CancellationSource
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

            # Format datetime - combine date and start_time (Taiwan timezone)
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            ).replace(tzinfo=TAIWAN_TZ)
            formatted_datetime = NotificationService._format_appointment_datetime(
                start_datetime
            )

            # Get appointment type name
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else None

            # Generate message based on source
            message = NotificationService._get_cancellation_message(
                formatted_datetime,
                practitioner.full_name,
                appointment_type_name,
                patient.full_name,
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
        """Format datetime for Taiwan timezone (UTC+8).
        
        The datetime is stored as naive but represents Taiwan time.
        Localize it to Taiwan timezone for formatting.
        """
        taiwan_tz = timezone(timedelta(hours=8))
        
        # If datetime is naive, assume it's already in Taiwan time and localize it
        if dt.tzinfo is None:
            local_datetime = dt.replace(tzinfo=taiwan_tz)
        else:
            # If timezone-aware, convert to Taiwan time
            local_datetime = dt.astimezone(taiwan_tz)
        
        # Format weekday in Traditional Chinese
        weekday_map = {
            0: '日', 1: '一', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六'
        }
        weekday_cn = weekday_map[local_datetime.weekday()]
        
        # Format time in AM/PM format
        hour = local_datetime.hour
        minute = local_datetime.minute
        if hour == 0:
            hour_12 = 12
            period = 'AM'
        elif hour < 12:
            hour_12 = hour
            period = 'AM'
        elif hour == 12:
            hour_12 = 12
            period = 'PM'
        else:
            hour_12 = hour - 12
            period = 'PM'
        
        time_str = f"{hour_12}:{minute:02d} {period}"
        
        return f"{local_datetime.strftime('%m/%d')} ({weekday_cn}) {time_str}"

    @staticmethod
    def _get_cancellation_message(
        formatted_datetime: str,
        practitioner_name: str,
        appointment_type_name: str | None,
        patient_name: str,
        source: CancellationSource
    ) -> str:
        """Generate appropriate cancellation message."""
        # Build base message with appointment type if available
        if appointment_type_name:
            base = f"{formatted_datetime} - 【{appointment_type_name}】{practitioner_name}治療師"
        else:
            base = f"{formatted_datetime} - {practitioner_name}治療師"

        if source == CancellationSource.CLINIC:
            return f"{patient_name}，您的預約已被診所取消：{base}。\n\n如有需要，可透過Line重新預約。"
        else:
            return f"{patient_name}，您的預約已取消：{base}。"

    @staticmethod
    def _get_line_service(clinic: Clinic):
        """Get LINE service for clinic."""
        from services.line_service import LINEService
        return LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
