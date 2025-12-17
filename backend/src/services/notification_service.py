# pyright: reportUnknownMemberType=false, reportMissingTypeStubs=false
from datetime import datetime
from enum import Enum
from sqlalchemy.orm import Session
import logging
from typing import TYPE_CHECKING
from models import Appointment, User, Clinic
from utils.datetime_utils import format_datetime

if TYPE_CHECKING:
    from models.user_clinic_association import UserClinicAssociation

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
            from utils.practitioner_helpers import get_practitioner_display_name_with_title
            practitioner_name = get_practitioner_display_name_with_title(
                db, practitioner.id, clinic.id
            )

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

            # Send notification with labels for tracking
            line_service = NotificationService._get_line_service(clinic)
            trigger_source = 'clinic_triggered' if source == CancellationSource.CLINIC else 'patient_triggered'
            labels = {
                'recipient_type': 'patient',
                'event_type': 'appointment_cancellation',
                'trigger_source': trigger_source,
                'appointment_context': 'cancellation'
            }
            line_service.send_text_message(
                patient.line_user.line_user_id, 
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )

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
        # practitioner_name already includes title from get_practitioner_display_name_with_title
        if appointment_type_name:
            base = f"{formatted_datetime} - 【{appointment_type_name}】{practitioner_name}"
        else:
            base = f"{formatted_datetime} - {practitioner_name}"

        # Add note if provided
        note_str = ""
        if note and note.strip():
            note_str = f"\n\n備註：{note.strip()}"

        if source == CancellationSource.CLINIC:
            return f"{patient_name}，您的預約已被診所取消：{base}。{note_str}\n\n如有需要，可透過Line重新預約。"
        else:
            return f"{patient_name}，您的預約已取消：{base}。{note_str}"

    @staticmethod
    def generate_edit_notification(
        old_datetime: str,
        old_practitioner: str | None,  # None or "不指定" if auto-assigned
        new_datetime: str,
        new_practitioner: str | None,  # None or "不指定" if auto-assigned
        appointment_type: str,
        patient_name: str,
        note: str | None = None
    ) -> str:
        """
        Generate edit notification message.

        Args:
            old_datetime: Old appointment datetime (formatted)
            old_practitioner: Old practitioner name or None/"不指定" if auto-assigned
            new_datetime: New appointment datetime (formatted)
            new_practitioner: New practitioner name or None/"不指定" if auto-assigned
            appointment_type: Appointment type name
            patient_name: Patient name
            note: Optional custom note

        Returns:
            Formatted edit notification message
        """
        # Format practitioner names (show "不指定" if None or empty)
        old_practitioner_display = old_practitioner if old_practitioner else "不指定"
        new_practitioner_display = new_practitioner if new_practitioner else "不指定"

        message = f"{patient_name}，您的預約已調整：\n\n"
        # old_practitioner_display and new_practitioner_display already include title
        message += f"原預約：{old_datetime} - 【{appointment_type}】{old_practitioner_display}\n"
        message += f"新預約：{new_datetime} - 【{appointment_type}】{new_practitioner_display}\n"
        if note:
            message += f"\n備註：{note}\n"
        message += "\n如有疑問，請聯繫診所。"
        return message

    @staticmethod
    def send_appointment_edit_notification(
        db: Session,
        appointment: Appointment,
        old_practitioner: User | None,
        new_practitioner: User | None,
        old_start_time: datetime,
        new_start_time: datetime,
        note: str | None = None,
        trigger_source: str = "clinic_triggered"
    ) -> bool:
        """
        Send appointment edit notification to patient.

        Args:
            db: Database session
            appointment: Edited appointment
            old_practitioner: Old practitioner (None if was auto-assigned)
            new_practitioner: New practitioner (None if now auto-assigned)
            old_start_time: Old appointment start time
            new_start_time: New appointment start time
            note: Optional custom note
            trigger_source: 'clinic_triggered' or 'patient_triggered' (default: 'clinic_triggered')

        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            patient = appointment.patient
            if not patient.line_user:
                logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
                return False

            clinic = patient.clinic

            # Get practitioner names from associations

            from utils.practitioner_helpers import get_practitioner_display_name_with_title

            old_practitioner_name: str | None = None
            if old_practitioner:
                old_practitioner_name = get_practitioner_display_name_with_title(
                    db, old_practitioner.id, clinic.id
                )

            new_practitioner_name: str | None = None
            if new_practitioner:
                new_practitioner_name = get_practitioner_display_name_with_title(
                    db, new_practitioner.id, clinic.id
                )

            # Format datetimes
            old_formatted = format_datetime(old_start_time)
            new_formatted = format_datetime(new_start_time)

            # Get appointment type name
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

            # Generate message
            message = NotificationService.generate_edit_notification(
                old_datetime=old_formatted,
                old_practitioner=old_practitioner_name,
                new_datetime=new_formatted,
                new_practitioner=new_practitioner_name,
                appointment_type=appointment_type_name,
                patient_name=patient.full_name,
                note=note
            )

            # Send notification with labels for tracking
            line_service = NotificationService._get_line_service(clinic)
            logger.debug(
                f"Sending edit notification to LINE user {patient.line_user.line_user_id} "
                f"for patient {patient.id} ({patient.full_name}), appointment {appointment.calendar_event_id}"
            )
            labels = {
                'recipient_type': 'patient',
                'event_type': 'appointment_edit',
                'trigger_source': trigger_source,
                'appointment_context': 'reschedule'
            }
            line_service.send_text_message(
                patient.line_user.line_user_id, 
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )

            logger.info(
                f"Sent edit notification to patient {patient.id} ({patient.full_name}) "
                f"for appointment {appointment.calendar_event_id}"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to send edit notification: {e}")
            return False

    @staticmethod
    def generate_edit_preview(
        db: Session,
        appointment: Appointment,
        old_practitioner: User | None,
        new_practitioner: User | None,
        old_start_time: datetime,
        new_start_time: datetime,
        note: str | None = None
    ) -> str:
        """
        Generate preview of edit notification message.

        Args:
            db: Database session
            appointment: Appointment being edited
            old_practitioner: Old practitioner (None if was auto-assigned)
            new_practitioner: New practitioner (None if now auto-assigned)
            old_start_time: Old appointment start time
            new_start_time: New appointment start time
            note: Optional custom note

        Returns:
            Preview message string
        """
        clinic = appointment.patient.clinic

        # Get practitioner names from associations
        from models.user_clinic_association import UserClinicAssociation

        old_practitioner_name: str | None = None
        if old_practitioner:
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == old_practitioner.id,
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()
            old_practitioner_name = association.full_name if association else old_practitioner.email

        new_practitioner_name: str | None = None
        if new_practitioner:
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == new_practitioner.id,
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()
            new_practitioner_name = association.full_name if association else new_practitioner.email

        # Format datetimes
        old_formatted = format_datetime(old_start_time)
        new_formatted = format_datetime(new_start_time)

        # Get appointment type name
        appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

        return NotificationService.generate_edit_notification(
            old_datetime=old_formatted,
            old_practitioner=old_practitioner_name,
            new_datetime=new_formatted,
            new_practitioner=new_practitioner_name,
            appointment_type=appointment_type_name,
            patient_name=appointment.patient.full_name,
            note=note
        )

    @staticmethod
    def send_appointment_confirmation(
        db: Session,
        appointment: Appointment,
        practitioner_name: str,
        clinic: Clinic,
        trigger_source: str = "clinic_triggered"
    ) -> bool:
        """
        Send appointment confirmation notification to patient.

        Args:
            db: Database session
            appointment: New appointment
            practitioner_name: Practitioner name to display (can be "不指定" for auto-assigned)
            clinic: Clinic object
            trigger_source: 'clinic_triggered' or 'patient_triggered' (default: 'clinic_triggered')

        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            patient = appointment.patient
            if not patient.line_user:
                logger.info(f"Patient {patient.id} has no LINE user, skipping notification")
                return False

            # Format appointment time
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)

            # Get appointment type name
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

            # Build message
            # Get practitioner name with title for external display
            # If practitioner_name is "不指定", use it as-is (for auto-assigned appointments)
            from utils.practitioner_helpers import get_practitioner_display_name_with_title, AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
            if practitioner_name == AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME:
                practitioner_display_name = practitioner_name
            elif appointment.calendar_event and appointment.calendar_event.user_id:
                practitioner_display_name = get_practitioner_display_name_with_title(
                    db, appointment.calendar_event.user_id, clinic.id
                )
            else:
                practitioner_display_name = practitioner_name
            
            message = f"{patient.full_name}，您的預約已建立：\n\n"
            message += f"{formatted_datetime} - 【{appointment_type_name}】{practitioner_display_name}"
            
            if appointment.notes:
                message += f"\n\n備註：{appointment.notes}"
            
            message += "\n\n期待為您服務！"

            # Send notification with labels for tracking
            line_service = NotificationService._get_line_service(clinic)
            labels = {
                'recipient_type': 'patient',
                'event_type': 'appointment_confirmation',
                'trigger_source': trigger_source,
                'appointment_context': 'new_appointment'
            }
            line_service.send_text_message(
                patient.line_user.line_user_id, 
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )

            logger.info(
                f"Sent appointment confirmation to patient {patient.id} ({patient.full_name}) "
                f"for appointment {appointment.calendar_event_id}"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to send appointment confirmation: {e}")
            return False

    @staticmethod
    def send_practitioner_appointment_notification(
        db: Session,
        association: "UserClinicAssociation",
        appointment: Appointment,
        clinic: Clinic
    ) -> bool:
        """
        Send appointment notification to practitioner via LINE.

        Args:
            db: Database session
            association: UserClinicAssociation for the practitioner at this clinic
            appointment: New appointment
            clinic: Clinic object

        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            # Check if practitioner has LINE account linked for this clinic
            if not association.line_user_id:
                logger.info(f"Practitioner {association.user_id} has no LINE account linked for clinic {clinic.id}, skipping notification")
                return False

            # Check if clinic has LINE credentials
            if not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.warning(f"Clinic {clinic.id} has no LINE credentials, skipping notification")
                return False

            # Get patient name
            patient_name = appointment.patient.full_name if appointment.patient else "未知病患"

            # Format appointment time
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)

            # Get appointment type name
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

            # Build message
            message = f"📅 新預約通知\n\n"
            message += f"病患：{patient_name}\n"
            message += f"時間：{formatted_datetime}\n"
            message += f"類型：{appointment_type_name}"

            if appointment.notes:
                message += f"\n備註：{appointment.notes}"

            # Send notification with labels for tracking
            line_service = NotificationService._get_line_service(clinic)
            # Practitioner notifications are always clinic_triggered (sent by system when clinic actions happen)
            labels = {
                'recipient_type': 'practitioner',
                'event_type': 'new_appointment_notification',
                'trigger_source': 'clinic_triggered',  # Practitioner notifications are always from clinic actions
                'appointment_context': 'new_appointment'
            }
            line_service.send_text_message(
                association.line_user_id, 
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )

            logger.info(
                f"Sent appointment notification to practitioner {association.user_id} "
                f"for appointment {appointment.calendar_event_id} at clinic {clinic.id}"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to send practitioner appointment notification: {e}")
            return False

    @staticmethod
    def send_practitioner_cancellation_notification(
        db: Session,
        association: "UserClinicAssociation",
        appointment: Appointment,
        clinic: Clinic,
        cancelled_by: str
    ) -> bool:
        """
        Send appointment cancellation notification to practitioner via LINE.

        Args:
            db: Database session
            association: UserClinicAssociation for the practitioner at this clinic
            appointment: Cancelled appointment
            clinic: Clinic object
            cancelled_by: Who cancelled - 'patient' or 'clinic'

        Returns:
            True if notification sent successfully, False otherwise
        """
        try:
            # Check if practitioner has LINE account linked for this clinic
            if not association.line_user_id:
                logger.info(f"Practitioner {association.user_id} has no LINE account linked for clinic {clinic.id}, skipping cancellation notification")
                return False

            # Check if clinic has LINE credentials
            if not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.warning(f"Clinic {clinic.id} has no LINE credentials, skipping cancellation notification")
                return False

            # Get patient name
            patient_name = appointment.patient.full_name if appointment.patient else "未知病患"

            # Format appointment time
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)

            # Get appointment type name
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

            # Determine who cancelled
            cancelled_by_text = "病患" if cancelled_by == "patient" else "診所"

            # Build message
            message = f"❌ 預約取消通知\n\n"
            message += f"病患：{patient_name}\n"
            message += f"時間：{formatted_datetime}\n"
            message += f"類型：{appointment_type_name}\n"
            message += f"取消者：{cancelled_by_text}"

            # Send notification with labels for tracking
            line_service = NotificationService._get_line_service(clinic)
            # Practitioner notifications are always clinic_triggered (sent by system when clinic actions happen)
            trigger_source = 'clinic_triggered' if cancelled_by == 'clinic' else 'patient_triggered'
            labels = {
                'recipient_type': 'practitioner',
                'event_type': 'appointment_cancellation_notification',
                'trigger_source': trigger_source,
                'appointment_context': 'cancellation'
            }
            line_service.send_text_message(
                association.line_user_id, 
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )

            logger.info(
                f"Sent cancellation notification to practitioner {association.user_id} "
                f"for appointment {appointment.calendar_event_id} at clinic {clinic.id}"
            )
            return True

        except Exception as e:
            logger.exception(f"Failed to send practitioner cancellation notification: {e}")
            return False

    @staticmethod
    def send_practitioner_edit_notification(
        db: Session,
        old_practitioner: User | None,
        new_practitioner: User,
        appointment: Appointment,
        clinic: Clinic
    ) -> bool:
        """
        Send appointment edit notification to practitioners via LINE.

        Notifies both the old practitioner (if exists and different from new) and the new practitioner.

        Args:
            db: Database session
            old_practitioner: Previous practitioner (None if was auto-assigned)
            new_practitioner: New practitioner
            appointment: Edited appointment
            clinic: Clinic object

        Returns:
            True if at least one notification sent successfully, False otherwise
        """
        success = False

        # Notify old practitioner (if exists and different from new)
        if old_practitioner and old_practitioner.id != new_practitioner.id:
            try:
                # Get association for old practitioner
                from models.user_clinic_association import UserClinicAssociation
                old_association = db.query(UserClinicAssociation).filter(
                    UserClinicAssociation.user_id == old_practitioner.id,
                    UserClinicAssociation.clinic_id == clinic.id,
                    UserClinicAssociation.is_active == True
                ).first()
                
                # Check if old practitioner has LINE account linked for this clinic
                if old_association and old_association.line_user_id:
                    # Check if clinic has LINE credentials
                    if clinic.line_channel_secret and clinic.line_channel_access_token:
                        # Get patient name
                        patient_name = appointment.patient.full_name if appointment.patient else "未知病患"

                        # Format appointment time
                        start_datetime = datetime.combine(
                            appointment.calendar_event.date,
                            appointment.calendar_event.start_time
                        )
                        formatted_datetime = format_datetime(start_datetime)

                        # Get appointment type name
                        appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

                        # Get new practitioner name with title for external display
                        from utils.practitioner_helpers import get_practitioner_display_name_with_title
                        new_practitioner_name = get_practitioner_display_name_with_title(
                            db, new_practitioner.id, clinic.id
                        )

                        # Build message
                        message = f"🔄 預約調整通知\n\n"
                        message += f"病患：{patient_name}\n"
                        message += f"時間：{formatted_datetime}\n"
                        message += f"類型：{appointment_type_name}\n"
                        message += f"已轉移給：{new_practitioner_name}"

                        # Send notification with labels for tracking
                        line_service = NotificationService._get_line_service(clinic)
                        labels = {
                            'recipient_type': 'practitioner',
                            'event_type': 'appointment_edit_notification',
                            'trigger_source': 'clinic_triggered',  # Practitioner notifications are always from clinic actions
                            'appointment_context': 'reschedule'
                        }
                        line_service.send_text_message(
                            old_association.line_user_id, 
                            message,
                            db=db,
                            clinic_id=clinic.id,
                            labels=labels
                        )

                        logger.info(
                            f"Sent reassignment notification to old practitioner {old_practitioner.id} "
                            f"for appointment {appointment.calendar_event_id}"
                        )
                        success = True
            except Exception as e:
                logger.exception(f"Failed to send reassignment notification to old practitioner: {e}")

        # Notify new practitioner
        try:
            # Get association for new practitioner
            from models.user_clinic_association import UserClinicAssociation
            new_association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == new_practitioner.id,
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()
            
            # Check if new practitioner has LINE account linked for this clinic
            if new_association and new_association.line_user_id:
                # Check if clinic has LINE credentials
                if clinic.line_channel_secret and clinic.line_channel_access_token:
                    # Get patient name
                    patient_name = appointment.patient.full_name if appointment.patient else "未知病患"

                    # Format appointment time
                    start_datetime = datetime.combine(
                        appointment.calendar_event.date,
                        appointment.calendar_event.start_time
                    )
                    formatted_datetime = format_datetime(start_datetime)

                    # Get appointment type name
                    appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

                    # Get old practitioner name with title for external display (if exists)
                    old_practitioner_name = None
                    if old_practitioner:
                        from utils.practitioner_helpers import get_practitioner_display_name_with_title
                        old_practitioner_name = get_practitioner_display_name_with_title(
                            db, old_practitioner.id, clinic.id
                        )

                    # Build message
                    message = f"📅 預約調整通知\n\n"
                    message += f"病患：{patient_name}\n"
                    message += f"時間：{formatted_datetime}\n"
                    message += f"類型：{appointment_type_name}"

                    # Only include "從：{old_practitioner_name}" if old and new practitioner are different
                    if old_practitioner_name and old_practitioner and old_practitioner.id != new_practitioner.id:
                        message += f"\n從：{old_practitioner_name}"

                    if appointment.notes:
                        message += f"\n備註：{appointment.notes}"

                    # Send notification
                    line_service = NotificationService._get_line_service(clinic)
                    labels = {
                        'recipient_type': 'practitioner',
                        'event_type': 'appointment_edit_notification',
                        'trigger_source': 'clinic_triggered',  # Practitioner notifications are always from clinic actions
                        'appointment_context': 'reschedule'
                    }
                    line_service.send_text_message(
                        new_association.line_user_id, 
                        message,
                        db=db,
                        clinic_id=clinic.id,
                        labels=labels
                    )

                    logger.info(
                        f"Sent reassignment notification to new practitioner {new_practitioner.id} "
                        f"for appointment {appointment.calendar_event_id}"
                    )
                    success = True
        except Exception as e:
            logger.exception(f"Failed to send reassignment notification to new practitioner: {e}")

        return success

    @staticmethod
    def _get_line_service(clinic: Clinic):
        """Get LINE service for clinic."""
        from services.line_service import LINEService
        return LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
