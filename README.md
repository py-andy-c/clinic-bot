# Clinic Bot

A comprehensive LLM-powered LINE bot system for physical therapy clinics.

## Quick Start

### Running Tests

```bash
# Run all backend tests with type checking
./run_tests.sh
```

### Development Setup

1. **Backend Setup:**
   ```bash
   cd backend
   python3 -m venv venv
   source venv/bin/activate
   pip install -r requirements.txt
   ```

2. **Environment Configuration:**
   ```bash
   cp backend/env.example backend/.env
   # Edit .env with your configuration
   ```

3. **Run the Application:**
   ```bash
   cd backend
   uvicorn src.main:app --reload
   ```

## Project Structure

```
clinic-bot/
├── backend/           # FastAPI backend application
│   ├── src/          # Source code
│   ├── tests/        # Test suite
│   ├── requirements.txt
│   └── pytest.ini    # Test configuration
├── docs/             # Documentation
├── run_tests.sh      # Test runner script
└── pyrightconfig.json # Type checking configuration
```

## Features

- 🤖 **LINE Bot Integration** - Automated patient communication
- 📅 **Google Calendar Sync** - Therapist schedule management
- 🔒 **Type Safety** - Full type checking with Pyright
- ✅ **Comprehensive Testing** - 80%+ code coverage
- 🚀 **Production Ready** - Docker deployment ready

## Development

See `backend/README_TESTS.md` for detailed testing instructions and `docs/` for project documentation.