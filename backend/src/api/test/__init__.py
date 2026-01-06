"""
Test API endpoints for E2E testing.

These endpoints are only available when E2E_TEST_MODE=true and provide
test-only functionality like authentication bypass and data seeding.
"""

from fastapi import APIRouter
from . import auth, seed

# Create test router
router = APIRouter()

# Include test sub-routers
router.include_router(
    auth.router,
    prefix="/auth",
    tags=["test-auth"],
)
router.include_router(
    seed.router,
    prefix="/seed",
    tags=["test-seed"],
)
