# pyright: reportMissingTypeStubs=false
"""
Message Preview API endpoints.
"""

import logging
from datetime import datetime
from typing import Dict, List, Optional, Any, Literal

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi import status as http_status
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.database import get_db
from auth.dependencies import require_authenticated, UserContext, ensure_clinic_access
from models import Clinic, AppointmentType
from services import ReminderService
from services.notification_service import NotificationService, CancellationSource
from services.message_template_service import MessageTemplateService
from services.pdf_service import PDFService
from utils.datetime_utils import taiwan_now

logger = logging.getLogger(__name__)

router = APIRouter()


# ===== Request/Response Models =====

class ReminderPreviewRequest(BaseModel):
    """Request model for generating reminder message preview."""
    appointment_type: str
    appointment_time: str
    therapist_name: str


class CancellationPreviewRequest(BaseModel):
    """Request model for generating cancellation message preview."""
    appointment_type: str
    appointment_time: str
    therapist_name: str
    patient_name: str
    note: str | None = None


class MessagePreviewRequest(BaseModel):
    """Request model for appointment message preview."""
    appointment_type_id: Optional[int] = Field(None, description="Appointment type ID (optional for new items)")
    message_type: Literal["patient_confirmation", "clinic_confirmation", "reminder"] = Field(..., description="Message type")
    template: str = Field(..., description="Template to preview")
    appointment_type_name: Optional[str] = Field(None, description="Appointment type name (required if appointment_type_id is not provided)")


class ReceiptPreviewRequest(BaseModel):
    """Request model for receipt preview."""
    custom_notes: Optional[str] = None
    show_stamp: bool = False


# ===== API Endpoints =====

@router.post("/reminder-preview", summary="Generate reminder message preview")
async def generate_reminder_preview(
    request: ReminderPreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Generate a preview of what a LINE reminder message would look like.

    This endpoint allows clinic admins to see exactly how their reminder
    messages will appear to patients before they are sent.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).get(clinic_id)
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Generate preview using ReminderService.format_reminder_message()
        # Note: ReminderService is only used for preview functionality here.
        # Actual reminders are sent via ReminderSchedulingService + ScheduledMessageScheduler.
        reminder_service = ReminderService()
        preview_message = reminder_service.format_reminder_message(
            appointment_type=request.appointment_type,
            appointment_time=request.appointment_time,
            therapist_name=request.therapist_name,
            clinic=clinic
        )

        return {"preview_message": preview_message}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating reminder preview: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生預覽訊息"
        )


@router.post("/cancellation-preview", summary="Generate cancellation message preview")
async def generate_cancellation_preview(
    request: CancellationPreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, str]:
    """
    Generate a preview of what a LINE cancellation message would look like.

    This endpoint allows clinic admins to see exactly how their cancellation
    messages will appear to patients before they are sent.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).get(clinic_id)
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Generate preview using the same service that sends actual cancellations
        preview_message = NotificationService.generate_cancellation_preview(
            appointment_type=request.appointment_type,
            appointment_time=request.appointment_time,
            therapist_name=request.therapist_name,
            patient_name=request.patient_name,
            source=CancellationSource.CLINIC,  # Always clinic-initiated for preview
            clinic=clinic,
            note=request.note
        )

        return {"preview_message": preview_message}

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating cancellation preview: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生取消預覽訊息"
        )


@router.post("/appointment-message-preview", summary="Preview appointment message")
async def preview_appointment_message(
    request: MessagePreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> Dict[str, Any]:
    """
    Preview appointment message with actual context data.
    
    Uses actual context: current user as practitioner, actual service item name, real clinic data.
    Returns preview message, used placeholders, and completeness warnings.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )
        
        clinic = db.query(Clinic).get(clinic_id)
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )
        
        # Validate template length
        if len(request.template) > 3500:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="訊息模板長度超過限制"
            )
        
        template = request.template
        
        # Get appointment type if ID is provided, otherwise use provided name
        appointment_type = None
        appointment_type_name = None
        if request.appointment_type_id:
            # Validate appointment_type_id belongs to clinic (exclude soft-deleted)
            appointment_type = db.query(AppointmentType).filter(
                AppointmentType.id == request.appointment_type_id,
                AppointmentType.clinic_id == clinic_id,
                AppointmentType.is_deleted == False
            ).first()
            if not appointment_type:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="服務項目不存在"
                )
            appointment_type_name = appointment_type.name
        else:
            # For new items, use provided name or default
            appointment_type_name = request.appointment_type_name or "服務項目"
        
        # Build preview context using actual data
        if appointment_type:
            # Use existing appointment type
            context = MessageTemplateService.build_preview_context(
                appointment_type=appointment_type,
                current_user=current_user,
                clinic=clinic,
                db=db
            )
        else:
            # For new items, build context with provided name
            context = MessageTemplateService.build_preview_context(
                appointment_type=None,
                current_user=current_user,
                clinic=clinic,
                db=db,
                sample_appointment_type_name=appointment_type_name
            )
        
        # Render message
        preview_message = MessageTemplateService.render_message(template, context)
        
        # Extract used placeholders
        used_placeholders = MessageTemplateService.extract_used_placeholders(template, context)
        
        # Validate placeholder completeness
        completeness_warnings = MessageTemplateService.validate_placeholder_completeness(
            template, context, clinic
        )
        
        # Return clinic info availability for frontend UI
        clinic_info_availability = {
            "has_address": bool(clinic.address),
            "has_phone": bool(clinic.phone_number),
        }
        
        return {
            "preview_message": preview_message,
            "used_placeholders": used_placeholders,
            "completeness_warnings": completeness_warnings,
            "clinic_info_availability": clinic_info_availability
        }
    
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating appointment message preview: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生預覽訊息"
        )


@router.post("/settings/receipts/preview", response_class=HTMLResponse, summary="Generate receipt preview")
async def generate_receipt_preview(
    request: ReceiptPreviewRequest,
    current_user: UserContext = Depends(require_authenticated),
    db: Session = Depends(get_db)
) -> HTMLResponse:
    """
    Generate a preview of what a receipt would look like with current settings.
    
    This endpoint allows clinic admins to see exactly how their receipts
    will appear with the current receipt settings (custom_notes, show_stamp).
    Uses dummy data for preview purposes.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        if not clinic_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="使用者不屬於任何診所"
            )

        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="診所不存在"
            )

        # Get clinic display name
        clinic_display_name = clinic.effective_display_name
        
        # Generate dummy receipt data for preview
        now = taiwan_now()
        # Format as ISO string with timezone
        issue_date_str = now.isoformat()
        visit_date_str = now.isoformat()
        
        # Create dummy receipt data structure matching the template requirements
        dummy_receipt_data = {
            "receipt_number": "2024-00001",
            "issue_date": issue_date_str,
            "visit_date": visit_date_str,
            "clinic": {
                "id": clinic.id,
                "display_name": clinic_display_name
            },
            "patient": {
                "id": 1,
                "name": "王小明"
            },
            "checked_out_by": {
                "id": current_user.user_id,
                "name": "管理員",
                "email": "admin@example.com"
            },
            "items": [
                {
                    "item_type": "service_item",
                    "service_item": {
                        "id": 1,
                        "name": "初診評估",
                        "receipt_name": "初診評估"
                    },
                    "practitioner": {
                        "id": 1,
                        "name": "李醫師"
                    },
                    "amount": 1000.0,
                    "revenue_share": 300.0,
                    "display_order": 0,
                    "quantity": 1
                },
                {
                    "item_type": "service_item",
                    "service_item": {
                        "id": 2,
                        "name": "復健治療",
                        "receipt_name": "復健治療"
                    },
                    "practitioner": {
                        "id": 1,
                        "name": "李醫師"
                    },
                    "amount": 800.0,
                    "revenue_share": 240.0,
                    "display_order": 1,
                    "quantity": 1
                }
            ],
            "totals": {
                "total_amount": 1800.0,
                "total_revenue_share": 540.0
            },
            "payment_method": "cash",
            "custom_notes": request.custom_notes,
            "stamp": {
                "enabled": request.show_stamp
            }
        }
        
        # Build void_info (preview receipts are never voided)
        void_info: Dict[str, Any] = {
            "voided": False,
            "voided_at": None,
            "voided_by": None,
            "reason": None
        }
        
        # Generate HTML using same template as actual receipts
        pdf_service = PDFService()
        html_content = pdf_service.generate_receipt_html(
            receipt_data=dummy_receipt_data,
            void_info=void_info
        )
        
        # Add preview watermark (範例) to the HTML
        # Reuse the same styling as voided watermark, only change the text
        watermark_html = """
        <div class="voided-watermark">
            <div class="voided-watermark-text">範例</div>
        </div>
        """
        
        # Insert watermark before closing </body> tag
        html_content = html_content.replace('</body>', watermark_html + '</body>')
        
        return HTMLResponse(content=html_content)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating receipt preview: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法產生收據預覽"
        )

