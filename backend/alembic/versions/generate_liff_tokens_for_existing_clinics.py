"""generate_liff_tokens_for_existing_clinics

Revision ID: generate_liff_tokens_existing
Revises: f7bd9e88de5a
Create Date: 2025-11-24 00:00:00.000000

Generate LIFF access tokens for all existing clinics that don't have one.

This is a one-time data migration to backfill tokens for clinics created before
the liff_access_token column was added. Future clinics will have tokens generated
automatically during creation.
"""
from typing import Sequence, Union
import sys
import os

# Add src directory to path to import models and utilities
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'src'))

from alembic import op
import sqlalchemy as sa

# Import models and utilities
from models.clinic import Clinic
from utils.liff_token import generate_liff_access_token

# revision identifiers, used by Alembic.
revision: str = 'generate_liff_tokens_existing'
down_revision: Union[str, None] = 'f7bd9e88de5a'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """
    Generate LIFF access tokens for all clinics that don't have one.
    
    This migration:
    1. Finds all clinics with NULL liff_access_token
    2. Generates unique tokens for each using the same function as clinic creation
    3. Commits tokens to database
    
    Uses the same generate_liff_access_token function to ensure consistency
    with token generation logic and collision detection.
    """
    # Get database connection from Alembic
    bind = op.get_bind()
    
    # Create a session from the connection
    # Note: We use autocommit=False to have control, but generate_liff_access_token
    # will commit internally for each clinic
    from sqlalchemy.orm import sessionmaker
    SessionLocal = sessionmaker(bind=bind, autocommit=False, autoflush=False)
    db = SessionLocal()
    
    try:
        # Find all clinics without tokens
        clinics_without_tokens = db.query(Clinic).filter(
            Clinic.liff_access_token.is_(None)
        ).all()
        
        if not clinics_without_tokens:
            print("No clinics found without liff_access_token. Migration complete.")
            return
        
        print(f"Found {len(clinics_without_tokens)} clinics without tokens. Generating tokens...")
        
        # Generate tokens for each clinic
        for clinic in clinics_without_tokens:
            try:
                # generate_liff_access_token handles locking, collision detection, and commits
                token = generate_liff_access_token(db, clinic.id)
                print(f"Generated token for clinic {clinic.id} (name: {clinic.name})")
            except Exception as e:
                # Log error but continue with other clinics
                print(f"ERROR: Failed to generate token for clinic {clinic.id}: {e}")
                # Rollback this clinic's transaction if it failed
                db.rollback()
                continue
        
        print(f"Migration complete. Generated tokens for {len(clinics_without_tokens)} clinics.")
        
    except Exception as e:
        db.rollback()
        print(f"ERROR: Migration failed: {e}")
        raise
    finally:
        db.close()


def downgrade() -> None:
    """
    Remove LIFF access tokens from all clinics.
    
    This sets liff_access_token to NULL for all clinics. This is a destructive
    operation that should only be used if reverting the entire token feature.
    """
    # Get database connection
    bind = op.get_bind()
    
    # Use raw SQL to set all tokens to NULL
    # This is safer than using ORM in case of schema changes
    op.execute(sa.text("""
        UPDATE clinics 
        SET liff_access_token = NULL 
        WHERE liff_access_token IS NOT NULL
    """))
    
    print("Removed all liff_access_tokens from clinics.")

