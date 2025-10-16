# Clinic Bot - Testing Guide

This guide explains how to run the comprehensive test suite for the Clinic Bot backend.

## Quick Start

```bash
# From project root
./run_tests.sh

# Or from backend directory
cd backend && ../run_tests.sh
```

## What the Test Suite Includes

### 1. Type Checking (Pyright)
- Static type analysis using Microsoft's Pyright
- Ensures type safety and catches type-related bugs
- Configured for Python 3.12 with strict checking

### 2. Unit Tests
- **Configuration**: Settings validation and environment variable handling
- **Database**: Connection management, session handling, transactions
- **Models**: SQLAlchemy model validation and relationships
- **Services**: Google OAuth service functionality
- **Webhooks**: LINE and Google Calendar webhook processing

### 3. Integration Tests
- **API Endpoints**: FastAPI route testing with proper HTTP responses
- **Database Integration**: Real database operations with test data
- **External Services**: Mocked external API calls

### 4. Coverage Reporting
- Minimum 80% code coverage requirement
- HTML report generated in `htmlcov/index.html`
- Terminal summary with missing lines highlighted

## Manual Test Execution

### Run All Tests
```bash
cd backend
python -m pytest tests/ -v
```

### Run with Coverage
```bash
cd backend
python -m pytest tests/ -v --cov=src --cov-report=html
```

### Run Specific Test Categories
```bash
# Unit tests only
python -m pytest tests/unit/ -v

# Integration tests only
python -m pytest tests/integration/ -v

# Specific test file
python -m pytest tests/unit/test_models.py -v
```

### Type Checking Only
```bash
pyright
```

### Full Test Suite (Recommended)
```bash
# From project root (recommended)
./run_tests.sh

# Or from backend directory
cd backend && ../run_tests.sh
```

## Test Configuration

### pytest.ini
- Located in `backend/pytest.ini`
- Configures test discovery, coverage, and reporting
- Sets up Python path for imports

### Test Structure
```
backend/tests/
├── conftest.py          # Shared fixtures and configuration
├── unit/               # Unit tests (isolated testing)
│   ├── test_config.py
│   ├── test_database.py
│   ├── test_models.py
│   ├── test_google_oauth.py
│   └── test_webhooks.py
└── integration/        # Integration tests (full stack)
    └── test_api.py
```

## Test Fixtures

### Shared Fixtures (conftest.py)
- `test_settings`: Test configuration
- `test_engine`: SQLite test database engine
- `db_session`: Database session for tests
- `client`: FastAPI test client
- `sample_*_data`: Test data fixtures

### Database Testing
- Uses SQLite in-memory database for fast testing
- Automatic table creation/cleanup per test
- Transaction rollback ensures test isolation

## Writing New Tests

### Unit Test Example
```python
import pytest
from src.services.google_oauth import GoogleOAuthService

def test_oauth_service_creation():
    """Test OAuth service initialization."""
    service = GoogleOAuthService()
    assert service.client_id is not None
    assert service.redirect_uri.endswith("/api/admin/auth/google/callback")
```

### Integration Test Example
```python
import pytest
from httpx import AsyncClient

@pytest.mark.asyncio
async def test_api_endpoint(client: AsyncClient):
    """Test API endpoint response."""
    response = await client.get("/")
    assert response.status_code == 200
    data = response.json()
    assert "message" in data
```

### Using Fixtures
```python
def test_with_database(db_session, sample_clinic_data):
    """Test database operations."""
    from src.models.clinic import Clinic

    clinic = Clinic(**sample_clinic_data)
    db_session.add(clinic)
    db_session.commit()

    assert clinic.id is not None
    assert clinic.name == "Test Clinic"
```

## Troubleshooting

### Common Issues

1. **Module not found errors**
   - Ensure you're running from the `backend` directory
   - Check that `PYTHONPATH` includes `src`

2. **Virtual environment issues**
   - Run `./run_tests.sh` (Linux/macOS) or `run_tests.bat` (Windows)
   - Or manually: `source venv/bin/activate && pip install -r requirements.txt`

3. **Test failures**
   - Check test output for specific error messages
   - Run individual tests: `python -m pytest tests/unit/test_models.py::TestClinicModel::test_clinic_creation -v`

4. **Coverage below threshold**
   - Add tests for uncovered code
   - Check `htmlcov/index.html` for uncovered lines

### Environment Setup

The test suite requires:
- Python 3.12+
- All dependencies from `requirements.txt`
- Virtual environment (auto-created by test scripts)

## CI/CD Integration

For continuous integration, add this to your pipeline:

```yaml
- name: Run Tests
  run: |
    chmod +x run_tests.sh
    ./run_tests.sh
```

The test suite will:
- ✅ Pass with 0 errors and 0 warnings
- ✅ Achieve 80%+ code coverage
- ✅ Generate coverage reports
- ✅ Validate type safety
