# pyright: reportUnknownMemberType=false, reportMissingTypeStubs=false
from datetime import datetime
from enum import Enum
from sqlalchemy.orm import Session
import logging
from typing import TYPE_CHECKING, Optional, Dict, Any
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
    def get_action_preview(
        db: Session,
        appointment: Appointment,
        action_type: str,  # 'create', 'edit', 'cancel'
        **kwargs: Any
    ) -> Optional[Dict[str, Any]]:
        """
        Generate a patient-facing notification preview for an action.
        
        Returns None if no notification is recommended or possible (e.g. no LINE user).
        """
        patient = appointment.patient
        if not patient:
            logger.info(f"get_action_preview: No patient found for appointment {appointment.calendar_event_id}")
            return None
        if not patient.line_user:
            logger.info(f"get_action_preview: Patient {patient.id} has no LINE user, skipping notification preview")
            return None

        clinic = patient.clinic
        logger.info(f"get_action_preview: Generating preview for appointment {appointment.calendar_event_id}, action_type={action_type}, patient_id={patient.id}")
        from utils.practitioner_helpers import get_practitioner_display_name_with_title, AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME

        if action_type == 'create':
            # Format appointment time
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"
            
            practitioner_display_name = AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
            if not appointment.is_auto_assigned and appointment.calendar_event.user_id:
                practitioner_display_name = get_practitioner_display_name_with_title(
                    db, appointment.calendar_event.user_id, clinic.id
                )

            message = f"{patient.full_name}，您的預約已建立：\n\n"
            message += f"{formatted_datetime} - 【{appointment_type_name}】{practitioner_display_name}"
            if appointment.notes:
                message += f"\n\n備註：{appointment.notes}"
            message += "\n\n期待為您服務！"
            
            return {
                "message": message,
                "patient_id": patient.id,
                "event_type": "appointment_confirmation"
            }

        elif action_type == 'edit':
            old_practitioner: Optional[User] = kwargs.get('old_practitioner')
            new_practitioner: Optional[User] = kwargs.get('new_practitioner')
            old_start_time: Optional[datetime] = kwargs.get('old_start_time')
            new_start_time: Optional[datetime] = kwargs.get('new_start_time')
            note: Optional[str] = kwargs.get('note')
            
            if old_start_time is None or new_start_time is None:
                return None

            # Privacy Rule: if originally auto-assigned, mask old practitioner
            old_practitioner_name = AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
            if not appointment.originally_auto_assigned and old_practitioner:
                old_practitioner_name = get_practitioner_display_name_with_title(
                    db, old_practitioner.id, clinic.id
                )
            
            new_practitioner_name = AUTO_ASSIGNED_PRACTITIONER_DISPLAY_NAME
            if not appointment.is_auto_assigned and new_practitioner:
                new_practitioner_name = get_practitioner_display_name_with_title(
                    db, new_practitioner.id, clinic.id
                )

            old_formatted = format_datetime(old_start_time)
            new_formatted = format_datetime(new_start_time)
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"

            message = NotificationService.generate_edit_notification(
                old_datetime=old_formatted,
                old_practitioner=old_practitioner_name,
                new_datetime=new_formatted,
                new_practitioner=new_practitioner_name,
                appointment_type=appointment_type_name,
                patient_name=patient.full_name,
                note=note
            )
            
            return {
                "message": message,
                "patient_id": patient.id,
                "event_type": "appointment_edit"
            }

        elif action_type == 'cancel':
            practitioner: Optional[User] = kwargs.get('practitioner')
            note: Optional[str] = kwargs.get('note')
            
            if not practitioner:
                return None

            practitioner_name = get_practitioner_display_name_with_title(
                db, practitioner.id, clinic.id
            )
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)
            appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else None

            message = NotificationService._get_cancellation_message(
                formatted_datetime,
                practitioner_name,
                appointment_type_name,
                patient.full_name,
                CancellationSource.CLINIC,
                note
            )
            
            return {
                "message": message,
                "patient_id": patient.id,
                "event_type": "appointment_cancellation"
            }

        return None

    @staticmethod
    def send_appointment_confirmation(
        db: Session, 
        appointment: Appointment, 
        practitioner_name: str,
        clinic: Clinic,
        trigger_source: str = 'clinic_triggered'
    ) -> bool:
        """
        Send appointment confirmation notification to patient via LINE.
        
        This is used for immediate notifications, e.g. when patient books via LIFF.
        """
        preview = NotificationService.get_action_preview(db, appointment, 'create')
        if preview:
            return NotificationService.send_custom_notification(
                db, 
                preview['patient_id'], 
                preview['message'], 
                preview['event_type'], 
                clinic.id
            )
        return False

    @staticmethod
    def send_appointment_edit_notification(
        db: Session,
        appointment: Appointment,
        practitioner_name: str,
        clinic: Clinic,
        old_practitioner: Optional[User] = None,
        new_practitioner: Optional[User] = None,
        old_start_time: Optional[datetime] = None,
        new_start_time: Optional[datetime] = None,
        note: Optional[str] = None
    ) -> bool:
        """
        Send appointment edit notification to patient via LINE.
        
        This is used for immediate notifications.
        """
        # Ensure times are provided (required for get_action_preview)
        # If not provided, we can't send notification using new logic
        if old_start_time is None or new_start_time is None:
            logger.warning("Missing times for appointment edit notification, skipping")
            return False

        preview = NotificationService.get_action_preview(
            db=db,
            appointment=appointment,
            action_type='edit',
            old_practitioner=old_practitioner,
            new_practitioner=new_practitioner,
            old_start_time=old_start_time,
            new_start_time=new_start_time,
            note=note
        )
        if preview:
            return NotificationService.send_custom_notification(
                db, 
                preview['patient_id'], 
                preview['message'], 
                preview['event_type'], 
                clinic.id
            )
        return False

    @staticmethod
    def send_appointment_cancellation(
        db: Session,
        appointment: Appointment,
        practitioner_name: str,
        clinic: Clinic,
        practitioner: User,
        note: Optional[str] = None
    ) -> bool:
        """
        Send appointment cancellation notification to patient via LINE.
        
        This is used for immediate notifications.
        """
        preview = NotificationService.get_action_preview(
            db=db,
            appointment=appointment,
            action_type='cancel',
            practitioner=practitioner,
            note=note
        )
        if preview:
            return NotificationService.send_custom_notification(
                db, 
                preview['patient_id'], 
                preview['message'], 
                preview['event_type'], 
                clinic.id
            )
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
    def send_custom_notification(
        db: Session,
        patient_id: int,
        message: str,
        event_type: str,
        clinic_id: int
    ) -> bool:
        """
        Send a custom LINE notification to a patient.

        Args:
            db: Database session
            patient_id: ID of the patient to send the message to.
            message: The custom message content.
            event_type: The event type for tracking (e.g., 'appointment_confirmation').
            clinic_id: The ID of the clinic.

        Returns:
            True if notification sent successfully, False otherwise.
        """
        try:
            from models import Patient
            patient = db.query(Patient).filter(Patient.id == patient_id, Patient.clinic_id == clinic_id).first()
            if not patient or not patient.line_user:
                logger.info(f"Patient {patient_id} has no LINE user or not found in clinic {clinic_id}, skipping custom notification")
                return False

            clinic = db.query(Clinic).get(clinic_id)
            if not clinic or not clinic.line_channel_secret or not clinic.line_channel_access_token:
                logger.warning(f"Clinic {clinic_id} has no LINE credentials, skipping custom notification")
                return False

            line_service = NotificationService._get_line_service(clinic)
            labels = {
                'recipient_type': 'patient',
                'event_type': event_type,
                'trigger_source': 'clinic_triggered'
            }
            line_service.send_text_message(
                patient.line_user.line_user_id,
                message,
                db=db,
                clinic_id=clinic.id,
                labels=labels
            )
            logger.info(f"Sent custom notification to patient {patient_id} for event type {event_type}")
            return True
        except Exception as e:
            logger.exception(f"Failed to send custom notification to patient {patient_id}: {e}")
            return False

    @staticmethod
    def _get_line_service(clinic: Clinic):
        """Get LINE service for clinic."""
        from services.line_service import LINEService
        return LINEService(
            channel_secret=clinic.line_channel_secret,
            channel_access_token=clinic.line_channel_access_token
        )
