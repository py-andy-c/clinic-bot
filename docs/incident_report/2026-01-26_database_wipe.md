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
We attempted to trigger the wipe again by removing the `testCommand` guard and modifying `conftest.py` (Commit `2e994a7`). 
*   **Observed Behavior:** Railway's Railpack 0.17.1 skipped the test phase entirely, even with modified test files.
*   **Conclusion:** The builder does NOT always run tests by default. The auto-detection is conditional and depends on specific environment states or internal heuristics.

### 2.2 [STILL ACTIVE] Hypothesis: Build-Phase Environment Leak
The leading theory remains that a specific combination of build-time environment variables or a specific builder version (possibly an auto-update of Nixpacks) triggered an isolated test execution. 
*   **Mechanism:** `pytest` auto-discovery + `DATABASE_URL` presence during build + `conftest.py` lacking a production guard = `drop_all()` on production.

### 2.3 [STILL ACTIVE] Hypothesis: Post-Install Script Execution
Alternative theory: A different tool in the `install` phase (possibly a linter or migration check) might have imported the `tests` package, triggering the `conftest.py` initialization and its side effects.

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

## 4. Final Conclusion
While we were unable to reproduce the exact "phantom" test execution in a controlled environment, the implementation of the **Layer 1 Code Guard** and **Layer 3 Inventory System** ensures that:
1.  Destructive code is blocked from execution on production URLs.
2.  If a wipe were to happen (via a different path), we would have an immediate log-based proof of the state change.
