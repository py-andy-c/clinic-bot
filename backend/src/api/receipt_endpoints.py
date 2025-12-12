"""
Receipt and billing API endpoints.

Handles checkout, receipt viewing, voiding, and billing scenario management.
"""

import logging
from typing import List, Optional, Dict, Any
from decimal import Decimal
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status, Query
from fastapi import status as http_status
from fastapi.responses import Response, HTMLResponse
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from datetime import date

from core.database import get_db
from auth.dependencies import require_admin_role, UserContext, ensure_clinic_access
from models import Appointment, PractitionerAppointmentTypes, User
from models.receipt import Receipt
from models.user_clinic_association import UserClinicAssociation
from services import ReceiptService, BillingScenarioService, AccountingService
from services.receipt_service import ConcurrentCheckoutError

logger = logging.getLogger(__name__)

router = APIRouter()


# Request/Response Models
class CheckoutItemRequest(BaseModel):
    """Request model for a checkout item."""
    item_type: str = Field(..., description="'service_item' or 'other'")
    service_item_id: Optional[int] = Field(None, description="Required if item_type is 'service_item'")
    practitioner_id: Optional[int] = Field(None, description="Practitioner ID (can be null)")
    billing_scenario_id: Optional[int] = Field(None, description="Required if item_type is 'service_item'")
    item_name: Optional[str] = Field(None, description="Required if item_type is 'other'")
    amount: Decimal = Field(..., gt=0)
    revenue_share: Decimal = Field(..., ge=0)
    display_order: int = Field(0)


class CheckoutRequest(BaseModel):
    """Request model for checkout."""
    items: List[CheckoutItemRequest] = Field(..., min_length=1)
    payment_method: str = Field(..., description="'cash', 'card', 'transfer', or 'other'")


class CheckoutResponse(BaseModel):
    """Response model for checkout."""
    receipt_id: int
    receipt_number: str
    total_amount: Decimal
    total_revenue_share: Decimal
    created_at: datetime


class ReceiptItemResponse(BaseModel):
    """Response model for a receipt item."""
    item_type: str
    service_item: Optional[Dict[str, Any]] = None
    item_name: Optional[str] = None
    practitioner: Optional[Dict[str, Any]] = None
    billing_scenario: Optional[Dict[str, Any]] = None
    amount: Decimal
    revenue_share: Decimal
    display_order: int


class ReceiptResponse(BaseModel):
    """Response model for receipt details."""
    receipt_id: int
    receipt_number: str
    appointment_id: int
    issue_date: datetime
    visit_date: datetime
    total_amount: Decimal
    total_revenue_share: Decimal
    created_at: datetime
    checked_out_by: Dict[str, Any]
    clinic: Dict[str, Any]
    patient: Dict[str, Any]
    items: List[ReceiptItemResponse]
    payment_method: str
    custom_notes: Optional[str] = None
    stamp: Dict[str, Any]
    void_info: Dict[str, Any]


class VoidReceiptRequest(BaseModel):
    """Request model for voiding a receipt."""
    reason: Optional[str] = Field(None, max_length=500)


class VoidReceiptResponse(BaseModel):
    """Response model for voiding a receipt."""
    receipt_id: int
    voided: bool
    voided_at: datetime
    voided_by: Dict[str, Any]
    reason: Optional[str] = None


# Endpoints
@router.post("/appointments/{appointment_id}/checkout", response_model=CheckoutResponse)
async def checkout_appointment(
    appointment_id: int,
    request: CheckoutRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Checkout an appointment (create receipt).
    
    Admin-only. Creates a receipt with immutable snapshot of all billing information.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Validate payment method
        valid_payment_methods = ["cash", "card", "transfer", "other"]
        if request.payment_method not in valid_payment_methods:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid payment method. Must be one of: {', '.join(valid_payment_methods)}"
            )
        
        # Convert items to dict format for service
        items: List[Dict[str, Any]] = []
        for idx, item in enumerate(request.items):
            # Validate amount > 0
            if item.amount <= 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Item {idx}: amount must be greater than 0"
                )
            
            # Validate revenue_share <= amount
            if item.revenue_share > item.amount:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Item {idx}: revenue_share ({item.revenue_share}) must be <= amount ({item.amount})"
                )
            
            # Validate revenue_share >= 0
            if item.revenue_share < 0:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Item {idx}: revenue_share must be >= 0"
                )
            
            item_dict: Dict[str, Any] = {
                "item_type": item.item_type,
                "amount": float(item.amount),
                "revenue_share": float(item.revenue_share),
                "display_order": item.display_order
            }
            
            if item.item_type == "service_item":
                if not item.service_item_id:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Item {idx}: service_item_id is required for service_item type"
                    )
                item_dict["service_item_id"] = item.service_item_id
                if item.practitioner_id is not None:
                    item_dict["practitioner_id"] = item.practitioner_id
                if item.billing_scenario_id is not None:
                    item_dict["billing_scenario_id"] = item.billing_scenario_id
            elif item.item_type == "other":
                if not item.item_name:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Item {idx}: item_name is required for other type"
                    )
                item_dict["item_name"] = item.item_name
                if item.practitioner_id is not None:
                    item_dict["practitioner_id"] = item.practitioner_id
            else:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f"Item {idx}: Invalid item_type. Must be 'service_item' or 'other'"
                )
            
            items.append(item_dict)
        
        # Get receipt settings from clinic
        from models import Clinic
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Clinic not found"
            )
        
        validated_settings = clinic.get_validated_settings()
        receipt_settings = validated_settings.receipt_settings.model_dump() if hasattr(validated_settings, 'receipt_settings') else {}
        
        # Create receipt
        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User ID not found"
            )
        
        receipt = ReceiptService.create_receipt(
            db=db,
            appointment_id=appointment_id,
            clinic_id=clinic_id,
            checked_out_by_user_id=current_user.user_id,
            items=items,
            payment_method=request.payment_method,
            receipt_settings=receipt_settings
        )
        
        db.commit()
        
        return CheckoutResponse(
            receipt_id=receipt.id,
            receipt_number=receipt.receipt_number,
            total_amount=receipt.total_amount,
            total_revenue_share=receipt.total_revenue_share,
            created_at=receipt.created_at
        )
        
    except ConcurrentCheckoutError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(e)
        )
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error checking out appointment {appointment_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="結帳失敗"
        )


@router.get("/appointments/{appointment_id}/receipt", response_model=ReceiptResponse)
async def get_appointment_receipt(
    appointment_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Get receipt for an appointment.
    
    Admin-only. Returns active receipt if exists, otherwise most recent voided receipt.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify appointment belongs to clinic
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).first()
        
        if not appointment:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Appointment not found"
            )
        
        # Get receipt
        receipt = ReceiptService.get_receipt_for_appointment(db, appointment_id)
        
        if not receipt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Receipt not found"
            )
        
        # Verify receipt belongs to clinic
        if receipt.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Receipt does not belong to your clinic"
            )
        
        # Extract data from receipt_data snapshot
        receipt_data = receipt.receipt_data
        
        # Merge void info from database columns
        void_info = receipt_data.get("void_info", {})
        if receipt.is_voided:
            void_info["voided"] = True
            void_info["voided_at"] = receipt.voided_at.isoformat() if receipt.voided_at else None
            if receipt.voided_by_user_id:
                voided_by_user = db.query(User).filter(User.id == receipt.voided_by_user_id).first()
                if voided_by_user:
                    from models import UserClinicAssociation
                    association = db.query(UserClinicAssociation).filter(
                        UserClinicAssociation.user_id == receipt.voided_by_user_id,
                        UserClinicAssociation.clinic_id == clinic_id
                    ).first()
                    void_info["voided_by"] = {
                        "id": voided_by_user.id,
                        "name": association.full_name if association else voided_by_user.email,
                        "email": voided_by_user.email
                    }
        
        # Convert items
        items: List[ReceiptItemResponse] = []
        for item_data in receipt_data.get("items", []):
            items.append(ReceiptItemResponse(**item_data))
        
        return ReceiptResponse(
            receipt_id=receipt.id,
            receipt_number=receipt.receipt_number,
            appointment_id=receipt.appointment_id,
            issue_date=receipt.issue_date,
            visit_date=datetime.fromisoformat(receipt_data["visit_date"].replace('Z', '+00:00')),
            total_amount=receipt.total_amount,
            total_revenue_share=receipt.total_revenue_share,
            created_at=receipt.created_at,
            checked_out_by=receipt_data["checked_out_by"],
            clinic=receipt_data["clinic"],
            patient=receipt_data["patient"],
            items=items,
            payment_method=receipt_data["payment_method"],
            custom_notes=receipt_data.get("custom_notes"),
            stamp=receipt_data.get("stamp", {"enabled": False}),
            void_info=void_info
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error getting receipt for appointment {appointment_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得收據"
        )


@router.post("/receipts/{receipt_id}/void", response_model=VoidReceiptResponse)
async def void_receipt(
    receipt_id: int,
    request: VoidReceiptRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Void a receipt.
    
    Admin-only. Voids a receipt for corrections while maintaining audit trail.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get receipt and verify it belongs to clinic
        receipt = ReceiptService.get_receipt_by_id(db, receipt_id)
        
        if not receipt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Receipt not found"
            )
        
        if receipt.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Receipt does not belong to your clinic"
            )
        
        # Void receipt
        if current_user.user_id is None:
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="User ID not found"
            )
        
        receipt = ReceiptService.void_receipt(
            db=db,
            receipt_id=receipt_id,
            voided_by_user_id=current_user.user_id,
            reason=request.reason
        )
        
        db.commit()
        
        # Get voided by user info
        voided_by_user = db.query(User).filter(User.id == current_user.user_id).first()
        if not voided_by_user:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found"
            )
        
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == current_user.user_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        
        voided_by_info = {
            "id": voided_by_user.id,
            "name": association.full_name if association else voided_by_user.email,
            "email": voided_by_user.email
        }
        
        if not receipt.voided_at:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Receipt voided_at is not set"
            )
        
        return VoidReceiptResponse(
            receipt_id=receipt.id,
            voided=True,
            voided_at=receipt.voided_at,
            voided_by=voided_by_info,
            reason=request.reason
        )
        
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error voiding receipt {receipt_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="作廢收據失敗"
        )


# Billing Scenario Endpoints
class BillingScenarioResponse(BaseModel):
    """Response model for billing scenario."""
    id: int
    practitioner_appointment_type_id: int
    name: str
    amount: Decimal
    revenue_share: Decimal
    is_default: bool


class BillingScenarioListResponse(BaseModel):
    """Response model for listing billing scenarios."""
    billing_scenarios: List[BillingScenarioResponse]


class BillingScenarioCreateRequest(BaseModel):
    """Request model for creating a billing scenario."""
    name: str = Field(..., max_length=255)
    amount: Decimal = Field(..., gt=0)
    revenue_share: Decimal = Field(..., ge=0)
    is_default: bool = Field(False)


class BillingScenarioUpdateRequest(BaseModel):
    """Request model for updating a billing scenario."""
    name: Optional[str] = Field(None, max_length=255)
    amount: Optional[Decimal] = Field(None, gt=0)
    revenue_share: Optional[Decimal] = Field(None, ge=0)
    is_default: Optional[bool] = None


@router.get("/clinic/service-items/{service_item_id}/practitioners/{practitioner_id}/billing-scenarios", response_model=BillingScenarioListResponse)
async def list_billing_scenarios(
    service_item_id: int,
    practitioner_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    List billing scenarios for a practitioner-service combination.
    
    Admin-only. Non-admin users cannot see billing scenarios.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify practitioner-service combination exists
        pat = db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.user_id == practitioner_id,
            PractitionerAppointmentTypes.appointment_type_id == service_item_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id
        ).first()
        
        if not pat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Practitioner-service combination not found"
            )
        
        # Get billing scenarios
        scenarios = BillingScenarioService.get_billing_scenarios_for_practitioner_service(
            db=db,
            practitioner_appointment_type_id=pat.id
        )
        
        return BillingScenarioListResponse(
            billing_scenarios=[
                BillingScenarioResponse(
                    id=s.id,
                    practitioner_appointment_type_id=s.practitioner_appointment_type_id,
                    name=s.name,
                    amount=s.amount,
                    revenue_share=s.revenue_share,
                    is_default=s.is_default
                )
                for s in scenarios
            ]
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error listing billing scenarios: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法取得計費方案"
        )


@router.post("/clinic/service-items/{service_item_id}/practitioners/{practitioner_id}/billing-scenarios", response_model=BillingScenarioResponse)
async def create_billing_scenario(
    service_item_id: int,
    practitioner_id: int,
    request: BillingScenarioCreateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Create a new billing scenario.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify practitioner-service combination exists
        pat = db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.user_id == practitioner_id,
            PractitionerAppointmentTypes.appointment_type_id == service_item_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id
        ).first()
        
        if not pat:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Practitioner-service combination not found"
            )
        
        # Validate revenue_share <= amount
        if request.revenue_share > request.amount:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="revenue_share must be <= amount"
            )
        
        # Create billing scenario
        scenario = BillingScenarioService.create_billing_scenario(
            db=db,
            practitioner_appointment_type_id=pat.id,
            name=request.name,
            amount=request.amount,
            revenue_share=request.revenue_share,
            is_default=request.is_default
        )
        
        db.commit()
        
        return BillingScenarioResponse(
            id=scenario.id,
            practitioner_appointment_type_id=scenario.practitioner_appointment_type_id,
            name=scenario.name,
            amount=scenario.amount,
            revenue_share=scenario.revenue_share,
            is_default=scenario.is_default
        )
        
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error creating billing scenario: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="建立計費方案失敗"
        )


@router.put("/clinic/service-items/{service_item_id}/practitioners/{practitioner_id}/billing-scenarios/{scenario_id}", response_model=BillingScenarioResponse)
async def update_billing_scenario(
    service_item_id: int,
    practitioner_id: int,
    scenario_id: int,
    request: BillingScenarioUpdateRequest,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Update a billing scenario.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify scenario exists and belongs to practitioner-service combination
        scenario = BillingScenarioService.get_billing_scenario_by_id(db, scenario_id)
        if not scenario:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Billing scenario not found"
            )
        
        # Verify practitioner-service combination
        pat = db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.id == scenario.practitioner_appointment_type_id,
            PractitionerAppointmentTypes.user_id == practitioner_id,
            PractitionerAppointmentTypes.appointment_type_id == service_item_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id
        ).first()
        
        if not pat:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Billing scenario does not belong to this practitioner-service combination"
            )
        
        # Update billing scenario
        scenario = BillingScenarioService.update_billing_scenario(
            db=db,
            scenario_id=scenario_id,
            name=request.name,
            amount=request.amount,
            revenue_share=request.revenue_share,
            is_default=request.is_default
        )
        
        db.commit()
        
        return BillingScenarioResponse(
            id=scenario.id,
            practitioner_appointment_type_id=scenario.practitioner_appointment_type_id,
            name=scenario.name,
            amount=scenario.amount,
            revenue_share=scenario.revenue_share,
            is_default=scenario.is_default
        )
        
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error updating billing scenario: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="更新計費方案失敗"
        )


@router.delete("/clinic/service-items/{service_item_id}/practitioners/{practitioner_id}/billing-scenarios/{scenario_id}")
async def delete_billing_scenario(
    service_item_id: int,
    practitioner_id: int,
    scenario_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Soft delete a billing scenario.
    
    Admin-only.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Verify scenario exists and belongs to practitioner-service combination
        scenario = BillingScenarioService.get_billing_scenario_by_id(db, scenario_id)
        if not scenario:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Billing scenario not found"
            )
        
        # Verify practitioner-service combination
        pat = db.query(PractitionerAppointmentTypes).filter(
            PractitionerAppointmentTypes.id == scenario.practitioner_appointment_type_id,
            PractitionerAppointmentTypes.user_id == practitioner_id,
            PractitionerAppointmentTypes.appointment_type_id == service_item_id,
            PractitionerAppointmentTypes.clinic_id == clinic_id
        ).first()
        
        if not pat:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Billing scenario does not belong to this practitioner-service combination"
            )
        
        # Delete billing scenario
        BillingScenarioService.delete_billing_scenario(db, scenario_id)
        
        db.commit()
        
        return {"message": "計費方案已刪除"}
        
    except ValueError as e:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except HTTPException:
        db.rollback()
        raise
    except Exception as e:
        db.rollback()
        logger.exception(f"Error deleting billing scenario: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="刪除計費方案失敗"
        )


@router.get("/receipts/{receipt_id}/download")
async def download_receipt_pdf(
    receipt_id: int,
    current_user: UserContext = Depends(require_admin_role),
    db: Session = Depends(get_db)
):
    """
    Download receipt as PDF.
    
    Admin-only. Returns PDF file with receipt information.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get receipt
        receipt = ReceiptService.get_receipt_by_id(db, receipt_id)
        
        if not receipt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Receipt not found"
            )
        
        if receipt.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Receipt does not belong to your clinic"
            )
        
        # Extract data from receipt_data snapshot (immutable)
        receipt_data = receipt.receipt_data
        
        # Generate PDF using WeasyPrint
        from services.pdf_service import PDFService
        
        pdf_service = PDFService()
        pdf_bytes = pdf_service.generate_receipt_pdf(
            receipt_data=receipt_data,
            is_voided=receipt.is_voided
        )
        
        return Response(
            content=pdf_bytes,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="receipt_{receipt.receipt_number}.pdf"'
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating PDF for receipt {receipt_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="生成PDF失敗"
        )


@router.get("/receipts/{receipt_id}/html", response_class=HTMLResponse)
async def get_receipt_html(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_admin_role)
):
    """
    Get receipt as HTML for LIFF display.
    
    Admin-only. Returns HTML page with receipt information.
    Same template as PDF to ensure consistency.
    """
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        # Get receipt
        receipt = ReceiptService.get_receipt_by_id(db, receipt_id)
        
        if not receipt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Receipt not found"
            )
        
        if receipt.clinic_id != clinic_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Receipt does not belong to your clinic"
            )
        
        # Extract data from receipt_data snapshot (immutable)
        receipt_data = receipt.receipt_data
        
        # Generate HTML using same template as PDF
        from services.pdf_service import PDFService
        
        pdf_service = PDFService()
        html_content = pdf_service.generate_receipt_html(
            receipt_data=receipt_data,
            is_voided=receipt.is_voided
        )
        
        return HTMLResponse(content=html_content)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Error generating HTML for receipt {receipt_id}: {e}")
        raise HTTPException(
            status_code=http_status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="生成HTML失敗"
        )


# Accounting endpoints (admin-only)
@router.get("/accounting/summary", response_model=None)
async def get_accounting_summary(
    start_date: date = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: date = Query(..., description="End date (YYYY-MM-DD)"),
    practitioner_id: Optional[int] = Query(None, description="Filter by practitioner ID"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_admin_role)
):
    """Get aggregated accounting statistics for a date range (admin-only)."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        summary = AccountingService.get_accounting_summary(
            db=db,
            clinic_id=clinic_id,
            start_date=start_date,
            end_date=end_date,
            practitioner_id=practitioner_id
        )
        return summary
    except Exception as e:
        logger.error(f"Error getting accounting summary: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法載入會計統計"
        )


@router.get("/accounting/practitioners/{practitioner_id}/details", response_model=None)
async def get_practitioner_accounting_details(
    practitioner_id: int,
    start_date: date = Query(..., description="Start date (YYYY-MM-DD)"),
    end_date: date = Query(..., description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_admin_role)
):
    """Get detailed accounting items for a specific practitioner (admin-only)."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        details = AccountingService.get_practitioner_details(
            db=db,
            clinic_id=clinic_id,
            practitioner_id=practitioner_id,
            start_date=start_date,
            end_date=end_date
        )
        return details
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except Exception as e:
        logger.error(f"Error getting practitioner accounting details: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法載入治療師會計明細"
        )


@router.get("/accounting/voided-receipts", response_model=None)
async def get_voided_receipts(
    start_date: Optional[date] = Query(None, description="Start date (YYYY-MM-DD)"),
    end_date: Optional[date] = Query(None, description="End date (YYYY-MM-DD)"),
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_admin_role)
):
    """Get list of voided receipts (admin-only)."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        voided_receipts = AccountingService.get_voided_receipts(
            db=db,
            clinic_id=clinic_id,
            start_date=start_date,
            end_date=end_date
        )
        return {"voided_receipts": voided_receipts}
    except Exception as e:
        logger.error(f"Error getting voided receipts: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法載入作廢收據列表"
        )


@router.get("/accounting/receipt-number-status", response_model=None)
async def get_receipt_number_status(
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_admin_role)
):
    """Get receipt number sequence status and warnings (admin-only)."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        status_info = AccountingService.check_receipt_number_limits(
            db=db,
            clinic_id=clinic_id
        )
        return status_info
    except Exception as e:
        logger.error(f"Error checking receipt number status: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法載入收據編號狀態"
        )


@router.get("/receipts/{receipt_id}", response_model=ReceiptResponse)
async def get_receipt_by_id(
    receipt_id: int,
    db: Session = Depends(get_db),
    current_user: UserContext = Depends(require_admin_role)
):
    """Get receipt by ID (admin-only)."""
    try:
        clinic_id = ensure_clinic_access(current_user)
        
        receipt = db.query(Receipt).filter(
            Receipt.id == receipt_id,
            Receipt.clinic_id == clinic_id
        ).first()
        
        if not receipt:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="收據不存在"
            )
        
        # Build response using same logic as get_appointment_receipt for consistency
        receipt_data = receipt.receipt_data
        
        # Get voided by user info
        voided_by_user = None
        if receipt.voided_by_user_id:
            voided_by_user = db.query(User).filter(User.id == receipt.voided_by_user_id).first()
        
        # Get voided_by_user name from UserClinicAssociation
        voided_by_user_name: Optional[str] = None
        if voided_by_user:
            from models.user_clinic_association import UserClinicAssociation
            association = db.query(UserClinicAssociation).filter(
                UserClinicAssociation.user_id == voided_by_user.id,
                UserClinicAssociation.clinic_id == clinic_id
            ).first()
            voided_by_user_name = association.full_name if association else voided_by_user.email
        
        # Convert items (same approach as get_appointment_receipt)
        items: List[ReceiptItemResponse] = []
        for item_data in receipt_data.get("items", []):
            items.append(ReceiptItemResponse(**item_data))
        
        # Merge void info from database columns
        void_info = receipt_data.get("void_info", {})
        if receipt.is_voided:
            void_info["voided"] = True
            void_info["voided_at"] = receipt.voided_at.isoformat() if receipt.voided_at else None
            if voided_by_user:
                void_info["voided_by"] = {
                    "id": voided_by_user.id,
                    "name": voided_by_user_name,
                    "email": voided_by_user.email
                }
            else:
                void_info["voided_by"] = None
            # void_reason is not stored in Receipt model, so keep from receipt_data if exists
            void_info["reason"] = receipt_data.get("void_info", {}).get("reason")
        else:
            void_info["voided"] = False
            void_info["voided_at"] = None
            void_info["voided_by"] = None
            void_info["reason"] = None
        
        return ReceiptResponse(
            receipt_id=receipt.id,
            receipt_number=receipt.receipt_number,
            appointment_id=receipt.appointment_id,
            issue_date=receipt.issue_date,
            visit_date=datetime.fromisoformat(receipt_data["visit_date"].replace('Z', '+00:00')),
            total_amount=receipt.total_amount,
            total_revenue_share=receipt.total_revenue_share,
            created_at=receipt.created_at,
            checked_out_by=receipt_data["checked_out_by"],
            clinic=receipt_data["clinic"],
            patient=receipt_data["patient"],
            items=items,
            payment_method=receipt_data["payment_method"],
            custom_notes=receipt_data.get("custom_notes"),
            stamp=receipt_data.get("stamp", {"enabled": False}),
            void_info=void_info
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error getting receipt {receipt_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="無法載入收據"
        )


