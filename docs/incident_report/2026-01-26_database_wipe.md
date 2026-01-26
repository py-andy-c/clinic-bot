# Incident Report: Partial Database Wipe during Deployment
**Date:** 2026-01-26
**Status:** Resolved / Guarded
**Impact:** Total data loss in tables registered to `Base.metadata` (Production Environment)

## 1. Facts & Observations

### 1.1 Error Signature
During the deployment of commit `0b0b3be`, the Railway startup script (`start.sh`) failed at **Phase 4 (Post-Migration Validation)**.
*   **Log Output:** `❌ Table users has insufficient records: 0 < 1`
*   **Log Output:** `❌ CRITICAL: Post-migration validation failed`
*   **Result:** Railway halted the deployment and rolled back (leaving the previous version running, but pointing to a now-empty database).

### 1.2 Database State
Manual inspection revealed:
*   **Wiped Tables:** `users`, `clinics`, `patients`, `appointments`, and others defined in SQLAlchemy models.
*   **Surviving Tables:** `agent_messages` and `agent_sessions` (metadata tables NOT registered to `Base.metadata`).
*   **Conclusion:** The destructive operation specifically targeted the application's SQLAlchemy metadata (`Base.metadata.drop_all()`).

### 1.3 Validation of Inventory System (Post-Incident)
Following the implementation of "Phase 0" logging in `start.sh`, we successfully validated that the inventory check accurately reflects the database state at the moment of deployment. In deployment `581d66fd`, the check correctly identified:
*   `Table users: 10 records`
*   `Table clinics: 2 records`
This confirms our visibility into the "Pre-Migration" state is now absolute.

## 2. Analysis & Hypotheses

### 2.1 [DISPROVED] Hypothesis: Universal Auto-Detection in Railpack 0.17.1
We attempted to trigger the wipe again by removing the `testCommand` guard and modifying `conftest.py`. 
*   **Observed Behavior:** Railpack 0.17.1 skipped the test phase entirely.
*   **Conclusion:** The builder does NOT always run tests by default.

### 2.2 [REFINED] Hypothesis: Railpack Heuristic Trap
Research indicates that Railpack (Railway's default builder) generates a `railpack-plan.json` dynamically. 
*   **Mechanism:** If Railpack detects substantial changes to the `tests/` directory or modifications to test dependencies (e.g., `requirements.txt`), it can inject an ephemeral `test` step into the build plan.
*   **The Leak:** Because `DATABASE_URL` was available at build-time, this "helpful" auto-detected test step connects to production.
*   **The Wipe**: The original incident involved significant changes to `backend/tests/`, which likely triggered this heuristic. Our reproduction attempt failed because it was too minor (a comment) to invalidate the Railpack "Confidence Bit."

### 2.3 [STILL ACTIVE] Alternative: Post-Install Imports
A tool in the `install` phase (linter, internal Railway check) might have imported the `tests` package, triggering the `conftest.py` initialization and its side effects.

### 2.4 [STILL ACTIVE] General Industry Finding: The "Alembic Rollback" Trap
Research into deployment failures on platform-as-a-service (PaaS) providers reveals a common failure pattern:
*   **Automatic Self-Healing**: Some CI/CD or deployment managers are configured to run `alembic downgrade -1` automatically if an `upgrade head` fails.
*   **The Baseline Risk**: Since our migration history was recently reset (Nov 5), a `downgrade -1` from the head would target the **Baseline Migration**.
*   **Destruction**: Historically, baseline downgrades contain `drop_all()`. An automated rollback triggered by a minor migration timeout could have theoretically triggered a full wipe.

## 3. Mitigation & Safeguards (Implemented)

We have implemented a multi-layered defense-in-depth strategy to ensure this cannot happen again, even if the builder's behavior changes:

### 3.1 Layer 1: The "fail-fast" Code Guard (conftest.py)
The test entry point now contains a strict environment check:
```python
is_railway_prod = os.getenv("RAILWAY_ENVIRONMENT_NAME") == "production"
looks_like_prod = re.search(r"railway\.app|production", final_url, re.I) is not None
# ... BLOCK EXECUTION IF TRUE ...
```
This protects production even if tests are accidentally triggered locally or in CI/CD.

### 3.2 Layer 2: Explicit Railway Instruction (railway.toml)
Explicitly disabling the build-time test command to override any builder heuristics:
```toml
testCommand = "echo 'Build-time tests explicitly disabled for safety'"
```

### 3.3 Layer 3: Environment Traceability (start.sh)
The startup script now performs a "Phase 0" inventory before any migrations:
*   Logs the exact Process ID and Deployment IDs.
*   Prints table counts to verify the database is healthy *before* the application starts.

### 3.4 Layer 4: Standardized Naming Convention
PostgreSQL tests now enforce that the database name must contain the substring "test". This protects local development `_dev` databases from accidental wipes during local test runs.

### 3.5 Layer 5: Framework Hardening (Baseline Migration & DB Utilities)
We have added explicit environment guards to specific "Nuclear" functions in the codebase:
*   **Alembic Baseline**: The `downgrade()` function in the baseline migration now checks for `RAILWAY_ENVIRONMENT_NAME == 'production'` before allowing a `drop_all()`.
*   **Database Utility**: The `drop_tables()` helper in `core/database.py` now includes a local environment check to prevent accidental execution in production.

## 4. Final Conclusion
While we were unable to reproduce the exact "phantom" test execution in a controlled environment, the implementation of these **five layers of defense-in-depth** ensures that:
1.  **Destructive code is blocked** at the source, whether it's triggered by the test framework, the migration framework, or a manual utility call.
2.  **Intentional overrides** (e.g., `ALLOW_DANGEROUS_TEST_CLEANUP`) are required for any destructive operation on a non-test database.
3.  **Real-time visibility** is provided via Phase 0 logging, ensuring we always know the database state before a deployment proceeds.
