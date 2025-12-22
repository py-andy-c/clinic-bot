"""
Message template service for rendering appointment messages with placeholders.

This service handles placeholder replacement in message templates using
Traditional Chinese placeholder names (e.g., {病患姓名}, {預約時間}).
"""

import logging
from datetime import datetime
from typing import Dict, Any, Optional, List

from models import Appointment, Patient, Clinic, AppointmentType
from utils.datetime_utils import format_datetime, ensure_taiwan
from utils.practitioner_helpers import get_practitioner_display_name_with_title

logger = logging.getLogger(__name__)


class MessageTemplateService:
    """Service for rendering message templates with placeholders."""
    
    @staticmethod
    def render_message(
        template: str,
        context: Dict[str, Any]
    ) -> str:
        """
        Render message template with placeholders.
        
        Replaces placeholders in the template with values from context.
        Placeholders use Traditional Chinese names (e.g., {病患姓名}, {預約時間}).
        
        Replacement order: longest placeholders first to avoid substring conflicts
        (e.g., {預約時間} before {預約日期} to prevent partial matches).
        
        Args:
            template: Message template with placeholders (always contains text, never None)
            context: Dictionary with Traditional Chinese keys matching placeholders
            
        Returns:
            Rendered message with placeholders replaced
        """
        message = template
        
        # Replace placeholders in order: longest first to avoid substring conflicts
        sorted_keys = sorted(context.keys(), key=len, reverse=True)
        for key in sorted_keys:
            placeholder = f"{{{key}}}"
            value = str(context.get(key) or "")
            message = message.replace(placeholder, value)
        
        return message
    
    @staticmethod
    def build_confirmation_context(
        appointment: Appointment,
        patient: Patient,
        practitioner_name: str,
        clinic: Clinic
    ) -> Dict[str, Any]:
        """
        Build context dict for confirmation messages.
        
        Returns dict with Traditional Chinese keys matching placeholders:
        - {病患姓名}: Patient's full name
        - {服務項目}: Appointment type name
        - {預約時間}: Formatted datetime (e.g., "12/25 (三) 1:30 PM")
        - {預約日期}: Formatted date (e.g., "2024年11月15日")
        - {預約時段}: Time only (e.g., "14:30")
        - {治療師姓名}: Practitioner name with title (or "不指定" for auto-assigned)
        - {診所名稱}: Clinic display name
        - {診所地址}: Clinic address (if available)
        - {診所電話}: Clinic phone (if available)
        - {病患備註}: Patient's notes (if provided, otherwise empty)
        
        Args:
            appointment: Appointment object
            patient: Patient object
            practitioner_name: Practitioner name (can be "不指定" for auto-assigned)
            clinic: Clinic object
            
        Returns:
            Dictionary with Traditional Chinese keys for placeholder replacement
        """
        # Format datetime
        start_datetime = datetime.combine(
            appointment.calendar_event.date,
            appointment.calendar_event.start_time
        )
        formatted_datetime = format_datetime(start_datetime)
        
        # Format date (e.g., "2024年11月15日")
        date_obj = appointment.calendar_event.date
        formatted_date = f"{date_obj.year}年{date_obj.month}月{date_obj.day}日"
        
        # Format time only (e.g., "14:30")
        time_obj = appointment.calendar_event.start_time
        formatted_time = f"{time_obj.hour:02d}:{time_obj.minute:02d}"
        
        # Get appointment type name
        appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"
        
        # Get practitioner name (already formatted with title or "不指定")
        practitioner_display = practitioner_name
        
        # Get clinic info
        clinic_name = clinic.effective_display_name or ""
        clinic_address = clinic.address or ""
        clinic_phone = clinic.phone_number or ""
        
        # Get patient notes - format with newline and label if notes exist
        if appointment.notes and appointment.notes.strip():
            patient_notes = f"\n\n備註：{appointment.notes}"
        else:
            patient_notes = ""
        
        return {
            "病患姓名": patient.full_name,
            "服務項目": appointment_type_name,
            "預約時間": formatted_datetime,
            "預約日期": formatted_date,
            "預約時段": formatted_time,
            "治療師姓名": practitioner_display,
            "診所名稱": clinic_name,
            "診所地址": clinic_address,
            "診所電話": clinic_phone,
            "病患備註": patient_notes,
        }
    
    @staticmethod
    def build_reminder_context(
        appointment: Appointment,
        patient: Patient,
        practitioner_name: str,
        clinic: Clinic
    ) -> Dict[str, Any]:
        """
        Build context dict for reminder messages.
        
        Uses same placeholders as confirmation messages.
        
        Args:
            appointment: Appointment object
            patient: Patient object
            practitioner_name: Practitioner name (can be "不指定" for auto-assigned)
            clinic: Clinic object
            
        Returns:
            Dictionary with Traditional Chinese keys for placeholder replacement
        """
        # Use same context building as confirmation
        return MessageTemplateService.build_confirmation_context(
            appointment, patient, practitioner_name, clinic
        )
    
    @staticmethod
    def build_preview_context(
        appointment_type: AppointmentType,
        current_user: Optional[Any],
        clinic: Clinic,
        db: Any,
        sample_patient_name: str = "王小明",
        sample_appointment_time: Optional[datetime] = None
    ) -> Dict[str, Any]:
        """
        Build context dict for message preview.
        
        Uses actual context data where possible:
        - Practitioner: current_user's name (if practitioner) or first practitioner at clinic
        - Appointment type: actual service item name
        - Clinic: real clinic data (name, address, phone)
        - Patient: sample name ("王小明")
        - Time: tomorrow at reasonable time (e.g., 14:30) or provided sample time
        
        Args:
            appointment_type: AppointmentType object
            current_user: Current user context (optional)
            clinic: Clinic object
            db: Database session
            sample_patient_name: Sample patient name for preview (default: "王小明")
            sample_appointment_time: Sample appointment time (default: tomorrow at 14:30)
            
        Returns:
            Dictionary with Traditional Chinese keys for placeholder replacement
        """
        from models.user_clinic_association import UserClinicAssociation
        from datetime import timedelta
        
        # Get practitioner name
        practitioner_name = "不指定"
        if current_user and hasattr(current_user, 'user_id'):
            # Check if current user is a practitioner at this clinic
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == current_user.user_id,
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()
            if association:
                practitioner_name = get_practitioner_display_name_with_title(
                    db, current_user.user_id, clinic.id
                )
        
        # If no practitioner from current user, try first available practitioner
        if practitioner_name == "不指定":
            first_association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.clinic_id == clinic.id,
                UserClinicAssociation.is_active == True
            ).first()
            if first_association and first_association.user_id:
                practitioner_name = get_practitioner_display_name_with_title(
                    db, first_association.user_id, clinic.id
                )
        
        # Use sample appointment time or default to tomorrow at 14:30
        if sample_appointment_time is None:
            from utils.datetime_utils import taiwan_now
            from datetime import timedelta
            tomorrow = taiwan_now().date() + timedelta(days=1)
            sample_appointment_time = datetime.combine(tomorrow, datetime.min.time().replace(hour=14, minute=30))
            sample_appointment_time = ensure_taiwan(sample_appointment_time)
        
        # Ensure sample_appointment_time is not None (type narrowing)
        if sample_appointment_time is None:
            raise ValueError("sample_appointment_time cannot be None")
        
        # Format datetime
        formatted_datetime = format_datetime(sample_appointment_time)
        
        # Format date
        date_obj = sample_appointment_time.date()
        formatted_date = f"{date_obj.year}年{date_obj.month}月{date_obj.day}日"
        
        # Format time only
        time_obj = sample_appointment_time.time()
        formatted_time = f"{time_obj.hour:02d}:{time_obj.minute:02d}"
        
        # Get appointment type name
        appointment_type_name = appointment_type.name
        
        # Get clinic info
        clinic_name = clinic.effective_display_name or ""
        clinic_address = clinic.address or ""
        clinic_phone = clinic.phone_number or ""
        
        return {
            "病患姓名": sample_patient_name,
            "服務項目": appointment_type_name,
            "預約時間": formatted_datetime,
            "預約日期": formatted_date,
            "預約時段": formatted_time,
            "治療師姓名": practitioner_name,
            "診所名稱": clinic_name,
            "診所地址": clinic_address,
            "診所電話": clinic_phone,
            "病患備註": "",  # Empty for preview
        }
    
    @staticmethod
    def extract_used_placeholders(template: str, context: Dict[str, Any]) -> Dict[str, str]:
        """
        Extract placeholders used in template and their values from context.
        
        Args:
            template: Message template
            context: Context dictionary with placeholder values
            
        Returns:
            Dictionary mapping placeholder names to their values (as strings)
        """
        used: Dict[str, str] = {}
        for key in context.keys():
            placeholder = f"{{{key}}}"
            if placeholder in template:
                used[key] = str(context.get(key) or "")
        return used
    
    @staticmethod
    def validate_placeholder_completeness(
        template: str,
        context: Dict[str, Any],
        clinic: Clinic
    ) -> List[str]:
        """
        Validate placeholder completeness and return warnings for missing data.
        
        Checks if placeholders in template reference data that's unavailable:
        - {診所地址} but clinic.address is None
        - {診所電話} but clinic.phone_number is None
        
        Args:
            template: Message template
            context: Context dictionary
            clinic: Clinic object
            
        Returns:
            List of warning messages for missing data
        """
        warnings: List[str] = []
        
        if "{診所地址}" in template and not clinic.address:
            warnings.append("{診所地址} 但診所尚未設定地址")
        
        if "{診所電話}" in template and not clinic.phone_number:
            warnings.append("{診所電話} 但診所尚未設定電話")
        
        return warnings

