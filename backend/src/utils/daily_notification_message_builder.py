"""
Shared message building utilities for daily notifications.

This module provides common message formatting functions used by both
admin and practitioner daily notification services.
"""

from datetime import date
from typing import List, Optional

from models.appointment import Appointment
from utils.datetime_utils import format_datetime


class DailyNotificationMessageBuilder:
    """Shared message building utilities for daily notifications."""

    @staticmethod
    def format_date(target_date: date) -> str:
        """
        Format date as 'YYYY年MM月DD日'.
        
        Args:
            target_date: Date to format
            
        Returns:
            Formatted date string
        """
        return target_date.strftime("%Y年%m月%d日")

    @staticmethod
    def build_appointment_line(
        appointment: Appointment,
        index: int
    ) -> str:
        """
        Build single appointment line (time, patient, type, notes).
        
        Args:
            appointment: Appointment to format
            index: Index number for the appointment (1-based)
            
        Returns:
            Formatted appointment line string
        """
        from datetime import datetime
        
        # Get patient name
        patient_name = appointment.patient.full_name if appointment.patient else "未知病患"
        
        # Format appointment time
        start_datetime = datetime.combine(
            appointment.calendar_event.date,
            appointment.calendar_event.start_time
        )
        formatted_time = format_datetime(start_datetime)
        
        # Get appointment type name
        appointment_type_name = appointment.appointment_type.name if appointment.appointment_type else "預約"
        
        # Build appointment line
        appointment_line = f"{index}. {formatted_time}\n"
        appointment_line += f"   病患：{patient_name}\n"
        appointment_line += f"   類型：{appointment_type_name}"
        
        if appointment.notes:
            appointment_line += f"\n   備註：{appointment.notes}"
        
        appointment_line += "\n\n"
        
        return appointment_line

    @staticmethod
    def build_practitioner_section(
        practitioner_name: str,
        appointments: List[Appointment],
        is_clinic_wide: bool = False
    ) -> str:
        """
        Build practitioner section header.
        
        Args:
            practitioner_name: Name of the practitioner (or "不指定" for auto-assigned)
            appointments: List of appointments for this practitioner
            is_clinic_wide: If True, use third-person ("共有"), else second-person ("您有")
            
        Returns:
            Practitioner section header string
        """
        count = len(appointments)
        if is_clinic_wide:
            section = f"治療師：{practitioner_name}\n"
            section += f"共有 {count} 個預約：\n\n"
        else:
            section = f"治療師：{practitioner_name}\n"
            if count == 1:
                section += "您有 1 個預約：\n\n"
            else:
                section += f"您有 {count} 個預約：\n\n"
        
        return section

    @staticmethod
    def build_message_header(
        target_date: date,
        is_clinic_wide: bool = False,
        part_number: Optional[int] = None,
        total_parts: Optional[int] = None
    ) -> str:
        """
        Build message header (明日預約提醒 or 明日預約總覽).
        
        Args:
            target_date: Date of the appointments
            is_clinic_wide: If True, use "明日預約總覽", else "明日預約提醒"
            part_number: Part number for multi-part messages (1-based)
            total_parts: Total number of parts
            
        Returns:
            Message header string
        """
        date_str = DailyNotificationMessageBuilder.format_date(target_date)
        
        if is_clinic_wide:
            if part_number and total_parts and total_parts > 1:
                header = f"📅 明日預約總覽 ({date_str}) - 第 {part_number}/{total_parts} 部分\n\n"
            else:
                header = f"📅 明日預約總覽 ({date_str})\n\n"
        else:
            header = f"📅 明日預約提醒 ({date_str})\n\n"
        
        return header

