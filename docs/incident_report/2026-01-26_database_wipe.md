# Incident Report: Partial Database Wipe during Deployment
**Date:** 2026-01-26
**Status:** Under Investigation / Mitigation in Progress
**Impact:** Total data loss in tables registered to `Base.metadata` (Production Environment)

## 1. Facts & Observations

### 1.1 Error Signature
During the deployment of commit `0b0b3be`, the Railway startup script (`start.sh`) failed at **Phase 4 (Post-Migration Validation)**.
*   **Log Output:** `❌ Table users has insufficient records: 0 < 1`
*   **Log Output:** `❌ CRITICAL: Post-migration validation failed`
*   **Result:** Railway halted the deployment and rolled back (leaving the previous version running, but pointing to a now-empty database).

### 1.2 Database State
Manual inspection of the production database revealed:
*   **Wiped Tables:** `users`, `clinics`, `patients`, `appointments`, and others defined in the application's models.
*   **Surviving Tables:** `agent_messages` (part of the `openai-agents` SDK metadata) and `agent_sessions`.
*   **Observation:** The survived tables are **not** registered to the application's primary `Base.metadata` object.
*   **Conclusion:** Whatever wiped the database specifically targeted tables registered to the application's SQLAlchemy metadata.

### 1.3 Code Environment
*   **`conftest.py` Logic:** The test configuration contains an `autouse` session fixture `setup_test_database` which calls `Base.metadata.drop_all(bind=db_engine)` followed by `command.upgrade(alembic_cfg, "head")`.
*   **URL Resolution:** `conftest.py` resolves the test database URL as follows:
    ```python
    TEST_DATABASE_URL = os.getenv(
        "TEST_DATABASE_URL",
        os.getenv("DATABASE_URL", "postgresql://localhost/clinic_bot_test")
    )
    ```
    In Railway, `DATABASE_URL` is set to the production database. If `TEST_DATABASE_URL` is unset, the tests target production.

### 1.4 Commit History
*   **Latest Commit:** `3264b60` ("Fix flaky test_batch_conflicts_practitioner_type_mismatch...").
*   **Observation:** This commit specifically modified files in the `backend/tests/` directory.
*   **Context:** Most previous successful deployments only involved changes to `backend/src/` or `frontend/`.

## 2. Analysis & Hypotheses

### 2.1 Hypothesis: Railway Build-Time Test Execution (Current Leading Theory)
Railway's builder (**Railpack/Nixpacks**) uses intelligent caching. 
1.  **Historically:** When only `src` or `frontend` changed, the builder reused the "Test" layer from cache or skipped it if it didn't detect a command.
2.  **Trigger:** By touching `backend/tests/`, the builder determined that the test cache was invalid.
3.  **Execution:** For reasons we are still validating (potentially automatic detection of `pytest`), the builder executed the test suite during the **Build Phase**.
4.  **Destruction:** Because the backend is "Linked" to the Postgres service, the build environment had access to the production `DATABASE_URL`. `pytest` initialized `conftest.py`, connected to production, and executed `drop_all()`.

### 2.2 Hypothesis: Startup Script "Bridge" Execution
Alternatively, a process in the `setup` or `install` phase of the build might have imported `tests` or triggered a script that depends on the test configuration.

### 2.3 Why it didn't happen every time
*   **Cache:** Railway avoids running expensive steps. Tests are a primary candidate for caching.
*   **Safety System:** The Phase 4 validation in `start.sh` was added on Jan 14. Before this, a wipe might have been "silent" (tables re-created empty, app starts), which users would only notice upon login failure. This time, the safety system caught the failure and stopped the deployment.

## 3. Mitigation & Safeguards

To prevent a recurrence, we are implementing a multi-layered defense-in-depth strategy:

### 3.1 Layer 1: Code-Level Production Guard (Immediate)
Modify `conftest.py` to check the connection string before execution. If any string resembling "production" or "railway.app" is found, the test suite will intentionally crash.

### 3.2 Layer 2: Standardized Naming Convention (PostgreSQL)
Universally require that any PostgreSQL database used for testing **must** contain the substring "test" in its name (e.g., `clinic_bot_test`). This prevents the test suite from accidentally wiping local development databases (`clinic_bot_dev`) or production databases if they are misconfigured.

### 3.3 Layer 3: Explicit Railway Test Disabling
Update `railway.toml` to explicitly define an empty test command. This overrides Railway's auto-detection logic.
```toml
[build]
testCommand = "echo 'Build-time tests explicitly disabled for safety'"
```

### 3.4 Layer 4: Environment Variable Isolation
Ensure that sensitive variables like `DATABASE_URL` are strictly minimized during the build phase via Railway's "Available at build time" settings.

## 4. Enhanced Observability
To validate our hypotheses and prevent "ghost" issues, we will add the following logging:

1.  **Build Phase Logging:** Add an `echo` in `conftest.py` that prints whether `DATABASE_URL` is detected and which URL is being used (obfuscated).
2.  **Startup Metadata:** `start.sh` will log a "Sanity Check" of the database state *before* any migration or validation logic runs, including counts of existing tables.
3.  **Process Context:** Logs will include whether the code is running in a `PYTEST` environment vs. a `RUN` environment.
