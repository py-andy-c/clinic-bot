"""
Message template service for rendering appointment messages with placeholders.

This service handles placeholder replacement in message templates using
Traditional Chinese placeholder names (e.g., {病患姓名}, {預約時間}).
"""

import logging
from datetime import datetime, date
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
        - {預約結束時間}: Formatted end datetime (e.g., "12/25 (三) 2:30 PM")
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
        # Check if this is a multiple time slot appointment pending confirmation
        is_pending_time_confirmation = getattr(appointment, 'pending_time_confirmation', False)

        if is_pending_time_confirmation:
            # For pending multiple time slot appointments, show "時間待安排" instead of actual time
            formatted_datetime = "時間待安排"
            formatted_end_datetime = "時間待安排"
            formatted_date = "時間待安排"
            formatted_time = "時間待安排"
        else:
            # Format datetime normally for confirmed appointments
            start_datetime = datetime.combine(
                appointment.calendar_event.date,
                appointment.calendar_event.start_time
            )
            formatted_datetime = format_datetime(start_datetime)

            # Calculate and format end datetime
            from datetime import timedelta
            appointment_type = appointment.appointment_type
            duration_minutes = appointment_type.duration_minutes if appointment_type else 30
            end_datetime = start_datetime + timedelta(minutes=duration_minutes)
            formatted_end_datetime = format_datetime(end_datetime)

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
        
        # Patient notes removed from available placeholders - no longer included in context
        # (keeping for backward compatibility if templates still reference it, but it will be empty)
        patient_notes = ""
        
        return {
            "病患姓名": patient.full_name,
            "服務項目": appointment_type_name,
            "預約時間": formatted_datetime,
            "預約結束時間": formatted_end_datetime,
            "預約日期": formatted_date,
            "預約時段": formatted_time,
            "治療師姓名": practitioner_display,
            "診所名稱": clinic_name,
            "診所地址": clinic_address,
            "診所電話": clinic_phone,
            "病患備註": patient_notes,  # Deprecated - always empty, kept for backward compatibility
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
        appointment_type: Optional[AppointmentType],
        current_user: Optional[Any],
        clinic: Clinic,
        db: Any,
        sample_patient_name: str = "王小明",
        sample_appointment_time: Optional[datetime] = None,
        sample_appointment_type_name: Optional[str] = None
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
        
        # Calculate and format end datetime
        duration_minutes = appointment_type.duration_minutes if appointment_type else 30
        end_datetime = sample_appointment_time + timedelta(minutes=duration_minutes)
        formatted_end_datetime = format_datetime(end_datetime)
        
        # Format date
        date_obj = sample_appointment_time.date()
        formatted_date = f"{date_obj.year}年{date_obj.month}月{date_obj.day}日"
        
        # Format time only
        time_obj = sample_appointment_time.time()
        formatted_time = f"{time_obj.hour:02d}:{time_obj.minute:02d}"
        
        # Get appointment type name
        if appointment_type:
            appointment_type_name = appointment_type.name
        elif sample_appointment_type_name:
            appointment_type_name = sample_appointment_type_name
        else:
            appointment_type_name = "服務項目"
        
        # Get clinic info
        clinic_name = clinic.effective_display_name or ""
        clinic_address = clinic.address or ""
        clinic_phone = clinic.phone_number or ""
        
        return {
            "病患姓名": sample_patient_name,
            "服務項目": appointment_type_name,
            "預約時間": formatted_datetime,
            "預約結束時間": formatted_end_datetime,
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
            warnings.append("使用了 {診所地址} 但診所尚未設定地址")
        
        if "{診所電話}" in template and not clinic.phone_number:
            warnings.append("使用了 {診所電話} 但診所尚未設定電話")
        
        return warnings

    @staticmethod
    def build_recurring_confirmation_context(
        appointments: List[Appointment],
        patient: Patient,
        practitioner_name: str,
        clinic: Clinic,
        appointment_type_name: str
    ) -> Dict[str, Any]:
        """
        Build context dict for recurring confirmation messages.
        
        Returns dict with Traditional Chinese keys matching placeholders:
        - {病患姓名}: Patient's full name
        - {預約數量}: Number of appointments (e.g., "15")
        - {日期範圍}: Date range with weekdays (single or multiple dates)
        - {預約列表}: Numbered list of appointments
        - {服務項目}: Appointment type name
        - {治療師姓名}: Practitioner name with title
        - {診所名稱}: Clinic display name
        - {診所地址}: Clinic address (if available)
        - {診所電話}: Clinic phone (if available)
        
        Args:
            appointments: List of appointment objects
            patient: Patient object
            practitioner_name: Practitioner name (can be "不指定" for auto-assigned)
            clinic: Clinic object
            appointment_type_name: Appointment type name
            
        Returns:
            Dictionary with Traditional Chinese keys for placeholder replacement
        """
        # Calculate appointment count
        appointment_count = len(appointments)
        
        # Extract dates from appointments
        dates = [appt.calendar_event.date for appt in appointments]
        
        # Build date range with weekdays
        date_range = MessageTemplateService._build_date_range_with_weekdays(dates)
        
        # Build numbered appointment list
        appointment_list = MessageTemplateService._build_numbered_appointment_list(appointments)
        
        # Get clinic info
        clinic_name = clinic.effective_display_name or ""
        clinic_address = clinic.address or ""
        clinic_phone = clinic.phone_number or ""
        
        return {
            "病患姓名": patient.full_name,
            "預約數量": str(appointment_count),
            "日期範圍": date_range,
            "預約列表": appointment_list,
            "服務項目": appointment_type_name,
            "治療師姓名": practitioner_name,
            "診所名稱": clinic_name,
            "診所地址": clinic_address,
            "診所電話": clinic_phone,
        }
    
    @staticmethod
    def _build_date_range_with_weekdays(dates: List[date]) -> str:
        """Build date range string with Traditional Chinese weekdays."""
        WEEKDAY_MAPPING = {
            0: '一',  # Monday
            1: '二',  # Tuesday
            2: '三',  # Wednesday
            3: '四',  # Thursday
            4: '五',  # Friday
            5: '六',  # Saturday
            6: '日'   # Sunday
        }
        
        def format_date_with_weekday(d: date) -> str:
            weekday = WEEKDAY_MAPPING[d.weekday()]
            return f"{d.strftime('%Y-%m-%d')}({weekday})"
        
        unique_dates = sorted(set(dates))
        
        if len(unique_dates) == 1:
            # Single date
            return format_date_with_weekday(unique_dates[0])
        else:
            # Multiple dates
            first_date = unique_dates[0]
            last_date = unique_dates[-1]
            return f"{format_date_with_weekday(first_date)} 至 {format_date_with_weekday(last_date)}"
    
    @staticmethod
    def _build_numbered_appointment_list(appointments: List[Appointment]) -> str:
        """Build numbered list of appointments with limit."""
        from core.message_template_constants import MAX_APPOINTMENTS_IN_LIST
        
        # Sort appointments by date/time
        sorted_appointments = sorted(appointments, 
            key=lambda a: (a.calendar_event.date, a.calendar_event.start_time))
        
        # Limit to MAX_APPOINTMENTS_IN_LIST
        display_appointments = sorted_appointments[:MAX_APPOINTMENTS_IN_LIST]
        
        # Format each appointment
        appointment_lines: List[str] = []
        for i, appt in enumerate(display_appointments, 1):
            # Format datetime with weekday
            start_datetime = datetime.combine(
                appt.calendar_event.date,
                appt.calendar_event.start_time
            )
            formatted_datetime = MessageTemplateService._format_datetime_with_weekday(start_datetime)
            appointment_lines.append(f"{i}. {formatted_datetime}")
        
        # Add overflow indicator if needed
        if len(appointments) > MAX_APPOINTMENTS_IN_LIST:
            remaining = len(appointments) - MAX_APPOINTMENTS_IN_LIST
            appointment_lines.append(f"... 還有 {remaining} 個")
        
        return "\n".join(appointment_lines)
    
    @staticmethod
    def _format_datetime_with_weekday(dt: datetime) -> str:
        """Format datetime with Traditional Chinese weekday."""
        WEEKDAY_MAPPING = {
            0: '一', 1: '二', 2: '三', 3: '四', 
            4: '五', 5: '六', 6: '日'
        }
        
        weekday = WEEKDAY_MAPPING[dt.weekday()]
        date_str = dt.strftime('%Y-%m-%d')
        time_str = dt.strftime('%I:%M %p')
        return f"{date_str}({weekday}) {time_str}"

