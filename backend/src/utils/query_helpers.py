"""
Query helper utilities for database operations.

This module provides shared utilities for common database query patterns,
particularly for handling JSON array containment checks that work correctly
across different database backends (SQLite, PostgreSQL).
"""

from sqlalchemy import text
from sqlalchemy.orm import Query

from models import User


def filter_by_role(query: Query, role: str) -> Query:
    """
    Filter a query to include only users with the specified role.
    
    This function properly handles JSON array containment checks in SQLite,
    which is necessary because SQLAlchemy's contains() method doesn't work
    correctly for checking if a value exists in a JSON array when the array
    contains multiple values (e.g., ["admin", "practitioner"]).
    
    The function uses SQLite's json_each() function with an EXISTS subquery
    to properly check if a value exists in a JSON array. This approach works
    correctly for arrays with single or multiple values.
    
    Args:
        query: SQLAlchemy query object filtering User model
        role: Role string to check for (e.g., 'practitioner', 'admin')
        
    Returns:
        Modified query with role filter applied
        
    Example:
        ```python
        from utils.query_helpers import filter_by_role
        
        # Get all practitioners in a clinic
        query = db.query(User).filter(
            User.clinic_id == clinic_id,
            User.is_active == True
        )
        query = filter_by_role(query, 'practitioner')
        practitioners = query.all()
        ```
    """
    # Use json_each() for SQLite to properly check if value exists in JSON array
    # This works for arrays like ["admin", "practitioner"] or ["practitioner"]
    # Using EXISTS with json_each ensures proper array element checking
    return query.filter(
        text(f"""
        EXISTS (
            SELECT 1 FROM json_each({User.__tablename__}.roles) 
            WHERE json_each.value = :role
        )
        """).bindparams(role=role)
    )

