"""
Service for managing receipts.

Handles receipt creation, retrieval, voiding, and receipt number generation.
Implements immutable snapshot pattern for legal compliance.
"""

from typing import Dict, Any, Optional, List
from decimal import Decimal
from datetime import datetime
from sqlalchemy.orm import Session
from sqlalchemy import text

from models.receipt import Receipt
from models.appointment import Appointment
from models.clinic import Clinic
from models.patient import Patient
from models.user import User
from models.user_clinic_association import UserClinicAssociation
from models.appointment_type import AppointmentType
from services.billing_scenario_service import BillingScenarioService
from utils.datetime_utils import taiwan_now


class ConcurrentCheckoutError(ValueError):
    """Exception raised when concurrent checkout is detected."""
    pass


class ReceiptService:
    """Service for receipt operations."""

    @staticmethod
    def generate_receipt_number(db: Session, clinic_id: int) -> str:
        """
        Generate next sequential receipt number for a clinic.
        
        Format: {YYYY}-{NNNNN} (5 digits for serial number)
        Uses PostgreSQL sequence for thread-safe atomic generation.
        Year is determined using Taiwan timezone to ensure correct year at year boundaries.
        
        Args:
            db: Database session
            clinic_id: ID of the clinic
            
        Returns:
            Receipt number in format "2024-00001"
            
        Raises:
            ValueError: If receipt number sequence is exhausted (>= 99,999 receipts for the year)
        """
        # Get current year in Taiwan timezone (not UTC)
        # This ensures receipt numbers use the correct year even at year boundaries
        current_year = taiwan_now().year
        
        # Sequence name: receipt_number_seq_clinic_{clinic_id}_{year}
        sequence_name = f"receipt_number_seq_clinic_{clinic_id}_{current_year}"
        
        # Check if sequence exists, create if not
        # Use DO block to handle sequence creation atomically
        db.execute(text(f"""
            DO $$
            BEGIN
                IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE schemaname = 'public' AND sequencename = '{sequence_name}') THEN
                    CREATE SEQUENCE {sequence_name} START 1;
                END IF;
            END $$;
        """))
        db.flush()
        
        # Check sequence value before generating (proactive exhaustion check)
        # This prevents generating a receipt number that would exceed the 5-digit limit (99,999)
        # last_value is the last value returned by nextval(), so if it's >= 99999, the next
        # nextval() would return 100000 (6 digits), which we need to prevent
        current_value_result = db.execute(text(f"SELECT last_value FROM {sequence_name}"))
        current_value = current_value_result.scalar()
        
        # Check if sequence is exhausted (current_value could be None for new sequences, which is fine)
        if current_value is not None and current_value >= 99999:
            raise ValueError(
                f"Receipt number sequence exhausted for clinic {clinic_id} in year {current_year}. "
                f"Maximum of 99,999 receipts per year reached. Please contact administrator."
            )
        
        # Get next value from sequence
        result = db.execute(text(f"SELECT nextval('{sequence_name}')"))
        sequence_value = result.scalar()
        
        # Format as YYYY-NNNNN with zero-padding
        receipt_number = f"{current_year}-{sequence_value:05d}"
        
        return receipt_number

    @staticmethod
    def create_receipt(
        db: Session,
        appointment_id: int,
        clinic_id: int,
        checked_out_by_user_id: int,
        items: List[Dict[str, Any]],
        payment_method: str,
        receipt_settings: Optional[Dict[str, Any]] = None
    ) -> Receipt:
        """
        Create a new receipt with immutable snapshot.
        
        Uses row-level locking to prevent concurrent checkout for the same appointment.
        
        Args:
            db: Database session
            appointment_id: ID of the appointment (calendar_event_id)
            clinic_id: ID of the clinic
            checked_out_by_user_id: ID of the user performing checkout
            items: List of billing items
            payment_method: Payment method ("cash", "card", "transfer", "other")
            receipt_settings: Receipt settings (custom_notes, show_stamp)
            
        Returns:
            Created receipt
            
        Raises:
            ValueError: If validation fails
            IntegrityError: If active receipt already exists
        """
        # Lock appointment row to prevent concurrent checkout
        appointment = db.query(Appointment).filter(
            Appointment.calendar_event_id == appointment_id
        ).with_for_update().first()
        
        if not appointment:
            raise ValueError("Appointment not found")
        
        if appointment.status != "confirmed":
            raise ValueError("Appointment must be confirmed to checkout")
        
        # Check if active receipt already exists
        existing_receipt = db.query(Receipt).filter(
            Receipt.appointment_id == appointment_id,
            Receipt.is_voided == False
        ).first()
        
        if existing_receipt:
            raise ConcurrentCheckoutError("此預約已有收據，無法重複結帳")
        
        # Get clinic
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise ValueError("Clinic not found")
        
        # Get patient
        patient = db.query(Patient).filter(Patient.id == appointment.patient_id).first()
        if not patient:
            raise ValueError("Patient not found")
        
        # Get checked out by user
        checked_out_by_user = db.query(User).filter(User.id == checked_out_by_user_id).first()
        if not checked_out_by_user:
            raise ValueError("User not found")
        
        # Get user's clinic association for name
        association = db.query(UserClinicAssociation).filter(
            UserClinicAssociation.user_id == checked_out_by_user_id,
            UserClinicAssociation.clinic_id == clinic_id
        ).first()
        checked_out_by_name = association.full_name if association else checked_out_by_user.email
        
        # Calculate totals (accounting for quantity)
        total_amount = sum(
            Decimal(str(item["amount"])) * Decimal(str(item.get("quantity", 1)))
            for item in items
        )
        total_revenue_share = sum(
            Decimal(str(item.get("revenue_share", 0))) * Decimal(str(item.get("quantity", 1)))
            for item in items
        )
        
        # Validate totals (allow zero for free services)
        if total_amount < 0:
            raise ValueError("Total amount must be >= 0")
        
        # Validate revenue_share <= amount for each item
        for item in items:
            item_amount = Decimal(str(item["amount"]))
            item_revenue_share = Decimal(str(item.get("revenue_share", 0)))
            if item_revenue_share > item_amount:
                raise ValueError(f"revenue_share ({item_revenue_share}) must be <= amount ({item_amount})")
        
        # Build items snapshot with names
        snapshot_items: List[Dict[str, Any]] = []
        for item in items:
            snapshot_item: Dict[str, Any] = {
                "item_type": item["item_type"],
                "amount": float(item["amount"]),
                "revenue_share": float(item.get("revenue_share", 0)),
                "display_order": item.get("display_order", 0),
                "quantity": item.get("quantity", 1)  # Default to 1 for backward compatibility
            }
            
            if item["item_type"] == "service_item":
                # Fetch service item (exclude soft-deleted items)
                # This prevents checkout with deleted service items, maintaining data integrity
                service_item = db.query(AppointmentType).filter(
                    AppointmentType.id == item["service_item_id"],
                    AppointmentType.clinic_id == clinic_id,
                    AppointmentType.is_deleted == False
                ).first()
                if not service_item:
                    raise ValueError(f"Service item {item['service_item_id']} not found or has been deleted")
                
                snapshot_item["service_item"] = {
                    "id": service_item.id,
                    "name": service_item.name,
                    "receipt_name": service_item.receipt_name or service_item.name
                }
                
                # Fetch practitioner if provided
                if item.get("practitioner_id"):
                    practitioner_user = db.query(User).filter(User.id == item["practitioner_id"]).first()
                    if practitioner_user:
                        association = db.query(UserClinicAssociation).filter(
                            UserClinicAssociation.user_id == item["practitioner_id"],
                            UserClinicAssociation.clinic_id == clinic_id
                        ).first()
                        practitioner_name = association.full_name if association else practitioner_user.email
                        practitioner_title = association.title if association else ""
                        snapshot_item["practitioner"] = {
                            "id": practitioner_user.id,
                            "name": practitioner_name,
                            "title": practitioner_title
                        }
                else:
                    snapshot_item["practitioner"] = None
                
                # Fetch billing scenario if provided
                if item.get("billing_scenario_id"):
                    scenario = BillingScenarioService.get_billing_scenario_by_id(db, item["billing_scenario_id"])
                    if scenario:
                        snapshot_item["billing_scenario"] = {
                            "id": scenario.id,
                            "name": scenario.name
                        }
                    else:
                        snapshot_item["billing_scenario"] = None
                else:
                    snapshot_item["billing_scenario"] = None
                    
            elif item["item_type"] == "other":
                snapshot_item["item_name"] = item.get("item_name", "")
                
                # Fetch practitioner if provided
                if item.get("practitioner_id"):
                    practitioner_user = db.query(User).filter(User.id == item["practitioner_id"]).first()
                    if practitioner_user:
                        association = db.query(UserClinicAssociation).filter(
                            UserClinicAssociation.user_id == item["practitioner_id"],
                            UserClinicAssociation.clinic_id == clinic_id
                        ).first()
                        practitioner_name = association.full_name if association else practitioner_user.email
                        practitioner_title = association.title if association else ""
                        snapshot_item["practitioner"] = {
                            "id": practitioner_user.id,
                            "name": practitioner_name,
                            "title": practitioner_title
                        }
                else:
                    snapshot_item["practitioner"] = None
                
                # Other items always use "其他" billing scenario
                snapshot_item["billing_scenario"] = {
                    "id": None,
                    "name": "其他"
                }
            
            snapshot_items.append(snapshot_item)
        
        # Get receipt settings
        if receipt_settings is None:
            validated_settings = clinic.get_validated_settings()
            receipt_settings = validated_settings.receipt_settings.model_dump() if hasattr(validated_settings, 'receipt_settings') else {}
        
        custom_notes = receipt_settings.get("custom_notes")
        show_stamp = receipt_settings.get("show_stamp", False)
        
        # Generate receipt number
        receipt_number = ReceiptService.generate_receipt_number(db, clinic_id)
        
        # Get visit date (appointment date/time)
        visit_date = appointment.calendar_event.date
        visit_datetime = datetime.combine(visit_date, appointment.calendar_event.start_time)
        visit_datetime = visit_datetime.replace(tzinfo=taiwan_now().tzinfo)
        
        # Create immutable snapshot
        issue_datetime = taiwan_now()
        
        receipt_data: Dict[str, Any] = {
            "receipt_number": receipt_number,
            "issue_date": issue_datetime.isoformat(),
            "visit_date": visit_datetime.isoformat(),
            "clinic": {
                "id": clinic.id,
                "display_name": clinic.get_validated_settings().clinic_info_settings.display_name or clinic.name
            },
            "patient": {
                "id": patient.id,
                "name": patient.full_name
            },
            "checked_out_by": {
                "id": checked_out_by_user.id,
                "name": checked_out_by_name,
                "email": checked_out_by_user.email
            },
            "items": snapshot_items,
            "totals": {
                "total_amount": float(total_amount),
                "total_revenue_share": float(total_revenue_share)
            },
            "payment_method": payment_method,
            "custom_notes": custom_notes,
            "stamp": {
                "enabled": show_stamp
            }
        }
        
        # Create receipt
        receipt = Receipt(
            appointment_id=appointment_id,
            clinic_id=clinic_id,
            receipt_number=receipt_number,
            issue_date=issue_datetime,
            total_amount=total_amount,
            total_revenue_share=total_revenue_share,
            receipt_data=receipt_data
        )
        
        db.add(receipt)
        db.flush()
        
        return receipt

    @staticmethod
    def get_receipt_for_appointment(
        db: Session,
        appointment_id: int
    ) -> Optional[Receipt]:
        """
        Get the active (non-voided) receipt for an appointment.
        If no active receipt exists, returns the most recent voided receipt.
        
        Args:
            db: Database session
            appointment_id: ID of the appointment
            
        Returns:
            Receipt or None if no receipt exists
        """
        # Try to get active receipt first
        receipt = db.query(Receipt).filter(
            Receipt.appointment_id == appointment_id,
            Receipt.is_voided == False
        ).first()
        
        if receipt:
            return receipt
        
        # If no active receipt, get most recent voided receipt
        receipt = db.query(Receipt).filter(
            Receipt.appointment_id == appointment_id,
            Receipt.is_voided == True
        ).order_by(Receipt.voided_at.desc()).first()
        
        return receipt

    @staticmethod
    def get_receipts_for_appointments(
        db: Session,
        appointment_ids: List[int]
    ) -> Dict[int, Optional[Receipt]]:
        """
        Get receipts for multiple appointments in a single query (optimized for bulk loading).
        Returns a mapping from appointment_id to receipt (or None if no receipt exists).
        
        For each appointment:
        - Returns active (non-voided) receipt if exists
        - Otherwise returns most recent voided receipt if exists
        - Otherwise returns None
        
        Args:
            db: Database session
            appointment_ids: List of appointment IDs
            
        Returns:
            Dict mapping appointment_id to Receipt or None
        """
        if not appointment_ids:
            return {}
        
        # Get all active receipts for these appointments
        active_receipts = db.query(Receipt).filter(
            Receipt.appointment_id.in_(appointment_ids),
            Receipt.is_voided == False
        ).all()
        
        # Create mapping of appointment_id -> active receipt
        receipt_map: Dict[int, Optional[Receipt]] = {}
        for receipt in active_receipts:
            receipt_map[receipt.appointment_id] = receipt
        
        # Find appointments that don't have active receipts
        appointments_without_active = [
            appt_id for appt_id in appointment_ids 
            if appt_id not in receipt_map
        ]
        
        if appointments_without_active:
            # Get all voided receipts for appointments without active receipts
            voided_receipts = db.query(Receipt).filter(
                Receipt.appointment_id.in_(appointments_without_active),
                Receipt.is_voided == True
            ).order_by(Receipt.appointment_id, Receipt.voided_at.desc()).all()
            
            # Group by appointment_id and take the first (most recent) for each
            voided_receipts_by_appointment: Dict[int, Receipt] = {}
            for receipt in voided_receipts:
                if receipt.appointment_id not in voided_receipts_by_appointment:
                    voided_receipts_by_appointment[receipt.appointment_id] = receipt
            
            # Add to receipt_map
            receipt_map.update(voided_receipts_by_appointment)
        
        # Ensure all appointment_ids are in the map (with None for those without receipts)
        result: Dict[int, Optional[Receipt]] = {}
        for appt_id in appointment_ids:
            result[appt_id] = receipt_map.get(appt_id)
        
        return result

    @staticmethod
    def get_all_receipts_for_appointments(
        db: Session,
        appointment_ids: List[int]
    ) -> Dict[int, List[Receipt]]:
        """
        Get all receipts (active and voided) for multiple appointments.
        Returns a mapping from appointment_id to list of all receipts.
        
        Args:
            db: Database session
            appointment_ids: List of appointment IDs
            
        Returns:
            Dict mapping appointment_id to list of Receipts (empty list if none)
        """
        if not appointment_ids:
            return {}
        
        # Get all receipts for these appointments
        # Order by issue_date DESC (newest first) - more meaningful to users than creation date
        all_receipts = db.query(Receipt).filter(
            Receipt.appointment_id.in_(appointment_ids)
        ).order_by(Receipt.issue_date.desc()).all()
        
        # Group by appointment_id
        result: Dict[int, List[Receipt]] = {}
        for appt_id in appointment_ids:
            result[appt_id] = []
        
        for receipt in all_receipts:
            if receipt.appointment_id in result:
                result[receipt.appointment_id].append(receipt)
        
        return result

    @staticmethod
    def compute_receipt_fields(
        receipts: List[Receipt]
    ) -> Dict[str, Any]:
        """
        Compute receipt status fields from a list of receipts.
        
        This helper function centralizes the logic for determining receipt status:
        - has_active_receipt: True if appointment has at least one non-voided receipt
        - has_any_receipt: True if appointment has any receipt (active or voided)
        - receipt_id: ID of the active receipt (null if no active receipt)
        - receipt_ids: List of all receipt IDs (always included, empty if none)
        
        Args:
            receipts: List of receipts for an appointment (can be empty)
            
        Returns:
            Dict with has_active_receipt, has_any_receipt, receipt_id, receipt_ids
        """
        has_any_receipt = len(receipts) > 0
        active_receipt = next((r for r in receipts if not r.is_voided), None)
        has_active_receipt = active_receipt is not None
        receipt_id = active_receipt.id if active_receipt else None
        receipt_ids = [r.id for r in receipts]
        
        return {
            "has_active_receipt": has_active_receipt,
            "has_any_receipt": has_any_receipt,
            "receipt_id": receipt_id,
            "receipt_ids": receipt_ids
        }

    @staticmethod
    def get_receipt_by_id(
        db: Session,
        receipt_id: int
    ) -> Optional[Receipt]:
        """
        Get a receipt by ID.
        
        Args:
            db: Database session
            receipt_id: ID of the receipt
            
        Returns:
            Receipt or None if not found
        """
        return db.query(Receipt).filter(Receipt.id == receipt_id).first()

    @staticmethod
    def void_receipt(
        db: Session,
        receipt_id: int,
        voided_by_user_id: int,
        reason: Optional[str] = None
    ) -> Receipt:
        """
        Void a receipt.
        
        Args:
            db: Database session
            receipt_id: ID of the receipt to void
            voided_by_user_id: ID of the user voiding the receipt
            reason: Optional reason for voiding
            
        Returns:
            Voided receipt
            
        Raises:
            ValueError: If receipt not found or already voided
        """
        receipt = ReceiptService.get_receipt_by_id(db, receipt_id)
        if not receipt:
            raise ValueError("Receipt not found")
        
        if receipt.is_voided:
            raise ValueError("Receipt is already voided")
        
        # Update receipt
        receipt.is_voided = True
        receipt.voided_at = taiwan_now()
        receipt.voided_by_user_id = voided_by_user_id
        receipt.void_reason = reason  # Store void reason in column
        
        # Note: receipt_data is immutable (enforced by database trigger)
        # Void information is tracked in database columns (is_voided, voided_at, voided_by_user_id, void_reason)
        # Void information is NOT stored in receipt_data JSONB - it's merged from columns when generating responses
        
        db.flush()
        return receipt


