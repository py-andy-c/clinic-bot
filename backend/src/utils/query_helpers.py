"""
Query helper utilities for database operations.

This module provides shared utilities for common database query patterns,
particularly for handling JSON array containment checks with PostgreSQL JSONB.
"""

from typing import TypeVar
from sqlalchemy import cast
from sqlalchemy.orm import Query
from sqlalchemy.dialects.postgresql import JSONB

from models import UserClinicAssociation

# Type variable for Query generic type
T = TypeVar('T')


def filter_by_role(query: Query[T], role: str) -> Query[T]:
    """
    Filter a query to include only users with the specified role.
    
    Uses PostgreSQL's native JSONB containment operator (@>) to check if the
    roles array contains the specified role. This is more efficient than
    iterating through array elements and works correctly for arrays with
    single or multiple values (e.g., ["admin", "practitioner"]).
    
    Args:
        query: SQLAlchemy query object filtering User model
        role: Role string to check for (e.g., 'practitioner', 'admin')
        
    Returns:
        Modified query with role filter applied
        
    Example:
        ```python
        from utils.query_helpers import filter_by_role
        from models import UserClinicAssociation
        
        # Get all practitioners in a clinic
        query = db.query(User).join(UserClinicAssociation).filter(
            UserClinicAssociation.clinic_id == clinic_id,
            UserClinicAssociation.is_active == True
        )
        query = filter_by_role(query, 'practitioner')
        practitioners = query.all()
        ```
    """
    # Use PostgreSQL's JSONB containment operator (@>) to check if array contains role
    # This checks UserClinicAssociation.roles (clinic-specific roles)
    # This is equivalent to: roles @> '["practitioner"]'::jsonb
    # Works for arrays like ["admin", "practitioner"] or ["practitioner"]
    return query.filter(
        cast(UserClinicAssociation.roles, JSONB).op('@>')(cast([role], JSONB))
    )

