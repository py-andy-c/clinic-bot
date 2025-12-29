"""
Service for managing billing scenarios.

Billing scenarios define pricing options (amount and revenue_share) for
practitioner-service combinations. Only admins can view and manage billing scenarios.
"""

from typing import List, Optional
from decimal import Decimal
from sqlalchemy.orm import Session

from models.billing_scenario import BillingScenario


class BillingScenarioService:
    """Service for billing scenario operations."""

    @staticmethod
    def get_billing_scenarios_for_practitioner_service(
        db: Session,
        practitioner_id: int,
        appointment_type_id: int,
        clinic_id: int,
        include_deleted: bool = False
    ) -> List[BillingScenario]:
        """
        Get all billing scenarios for a practitioner-service combination.
        
        Args:
            db: Database session
            practitioner_id: ID of the practitioner (user)
            appointment_type_id: ID of the appointment type (service item)
            clinic_id: ID of the clinic
            include_deleted: Whether to include soft-deleted scenarios
            
        Returns:
            List of billing scenarios
        """
        query = db.query(BillingScenario).filter(
            BillingScenario.practitioner_id == practitioner_id,
            BillingScenario.appointment_type_id == appointment_type_id,
            BillingScenario.clinic_id == clinic_id
        )
        
        if not include_deleted:
            query = query.filter(BillingScenario.is_deleted == False)
        
        return query.order_by(BillingScenario.is_default.desc(), BillingScenario.id).all()

    @staticmethod
    def get_billing_scenario_by_id(
        db: Session,
        scenario_id: int
    ) -> Optional[BillingScenario]:
        """
        Get a billing scenario by ID.
        
        Args:
            db: Database session
            scenario_id: ID of the billing scenario
            
        Returns:
            Billing scenario or None if not found
        """
        return db.query(BillingScenario).filter(
            BillingScenario.id == scenario_id,
            BillingScenario.is_deleted == False
        ).first()

    @staticmethod
    def create_billing_scenario(
        db: Session,
        practitioner_id: int,
        appointment_type_id: int,
        clinic_id: int,
        name: str,
        amount: Decimal,
        revenue_share: Decimal,
        is_default: bool = False
    ) -> BillingScenario:
        """
        Create a new billing scenario.
        
        Args:
            db: Database session
            practitioner_id: ID of the practitioner (user)
            appointment_type_id: ID of the appointment type (service item)
            clinic_id: ID of the clinic
            name: Scenario name (e.g., "原價", "九折")
            amount: Amount charged to patient
            revenue_share: Revenue share to clinic (must be <= amount)
            is_default: Whether this is the default scenario
            
        Returns:
            Created billing scenario
            
        Raises:
            ValueError: If revenue_share > amount
        """
        # Validate revenue_share <= amount
        if revenue_share > amount:
            raise ValueError("revenue_share must be <= amount")
        
        # If this is set as default, unset other defaults for this practitioner-service
        if is_default:
            db.query(BillingScenario).filter(
                BillingScenario.practitioner_id == practitioner_id,
                BillingScenario.appointment_type_id == appointment_type_id,
                BillingScenario.clinic_id == clinic_id,
                BillingScenario.is_deleted == False,
                BillingScenario.is_default == True
            ).update({"is_default": False})
        
        scenario = BillingScenario(
            practitioner_id=practitioner_id,
            appointment_type_id=appointment_type_id,
            clinic_id=clinic_id,
            name=name,
            amount=amount,
            revenue_share=revenue_share,
            is_default=is_default
        )
        
        db.add(scenario)
        db.flush()
        return scenario

    @staticmethod
    def update_billing_scenario(
        db: Session,
        scenario_id: int,
        name: Optional[str] = None,
        amount: Optional[Decimal] = None,
        revenue_share: Optional[Decimal] = None,
        is_default: Optional[bool] = None
    ) -> BillingScenario:
        """
        Update a billing scenario.
        
        Args:
            db: Database session
            scenario_id: ID of the billing scenario
            name: New scenario name (optional)
            amount: New amount (optional)
            revenue_share: New revenue share (optional)
            is_default: Whether to set as default (optional)
            
        Returns:
            Updated billing scenario
            
        Raises:
            ValueError: If revenue_share > amount or scenario not found
        """
        scenario = BillingScenarioService.get_billing_scenario_by_id(db, scenario_id)
        if not scenario:
            raise ValueError("Billing scenario not found")
        
        # Validate revenue_share <= amount if both are being updated
        if revenue_share is not None and amount is not None:
            if revenue_share > amount:
                raise ValueError("revenue_share must be <= amount")
        elif revenue_share is not None:
            if revenue_share > scenario.amount:
                raise ValueError("revenue_share must be <= amount")
        elif amount is not None:
            if scenario.revenue_share > amount:
                raise ValueError("revenue_share must be <= amount")
        
        # If setting as default, unset other defaults
        if is_default is True:
            db.query(BillingScenario).filter(
                BillingScenario.practitioner_id == scenario.practitioner_id,
                BillingScenario.appointment_type_id == scenario.appointment_type_id,
                BillingScenario.clinic_id == scenario.clinic_id,
                BillingScenario.is_deleted == False,
                BillingScenario.id != scenario_id,
                BillingScenario.is_default == True
            ).update({"is_default": False})
        
        if name is not None:
            scenario.name = name
        if amount is not None:
            scenario.amount = amount
        if revenue_share is not None:
            scenario.revenue_share = revenue_share
        if is_default is not None:
            scenario.is_default = is_default
        
        db.flush()
        return scenario

    @staticmethod
    def delete_billing_scenario(
        db: Session,
        scenario_id: int
    ) -> None:
        """
        Soft delete a billing scenario.
        
        Args:
            db: Database session
            scenario_id: ID of the billing scenario
            
        Raises:
            ValueError: If scenario not found
        """
        scenario = BillingScenarioService.get_billing_scenario_by_id(db, scenario_id)
        if not scenario:
            raise ValueError("Billing scenario not found")
        
        scenario.is_deleted = True
        from datetime import datetime, timezone
        scenario.deleted_at = datetime.now(timezone.utc)
        db.flush()


