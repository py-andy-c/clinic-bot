# AI-First Frontend Strategy: Vibe Coding & Autonomy

This document outlines the architectural changes and development workflows required to make frontend development as reliable and "self-debugging" as the backend.

---

## 1. Core Principles: Making Frontend "AI-Friendly"
To reduce iteration time, we must shift from **Imperative Syncing** (manual state management) to **Declarative Identity**.

### 1.1 The "Key" Prop Trick
*   **The Problem:** Using `useEffect` to copy props or API data into local state. This causes "state drift" and race conditions.
*   **The Solution:** Use the React `key` prop on components or forms.
*   **Example:** `<AppointmentForm key={data.id} initialData={data} />`. When `data.id` changes, React destroys the old form and creates a fresh one. No manual sync code needed.

### 1.2 Zod-Driven API Contracts
*   **The Problem:** "Type errors" that only appear as `undefined` at runtime (hard for AI to debug).
*   **The Solution:** Use Zod to validate all API responses immediately.
*   **Example:** `const schema = z.object({ id: z.number() });`. If the backend returns a string, the app fails with a clear error the AI can read.

### 1.3 Logic-Store Separation
*   **The Problem:** Business logic trapped inside UI components (`.tsx` files).
*   **The Solution:** Extract state transitions into **Zustand Actions** or pure functions.
*   **Example:** Move a "Save Sequence" (Validate -> API Call -> Toast) into a store action. This makes logic unit-testable without a browser.

---

## 2. Phased Implementation Plan

### Phase 1: Establish Reliability (Foundation)
**Goal:** Eliminate the custom logic that AI models tend to break.
1.  **Standardize Fetching**: Replace the custom 800-line `useApiData.ts` with **TanStack Query (React Query)**. AI is an expert in this library.
2.  **Add .cursorrules**: Create a root file to enforce patterns (e.g., "Prefer functional components," "No useEffect for syncing").
3.  **Flight Recorder**: Implement structured logging for API requests/responses. When a "save" fails, the AI can read the structured log instead of asking you for manual debugging.

### Phase 2: Enable Self-Debugging (Autonomy)
**Goal:** Give the AI a sandbox where it can find and fix bugs independently.
1.  **Set up MSW (Mock Service Worker)**: Create a mock backend that runs in the AI's terminal.
2.  **"Repro-First" Workflow**: When Reporting a bug, instruct the AI: *"Write a failing Vitest + MSW test that reproduces this issue in the terminal. Once it fails, fix the code."*
3.  **Result:** The AI debugging loop happens in the terminal, not in your browser.

### Phase 3: Architectural Simplification
**Goal:** Remove "Defensive" boilerplate.
1.  **Remove Manual Locks**: Get rid of `isSavingRef` and `JSON.stringify` comparisons. Standard libraries (React Query/Hook Form) handle these automatically.
2.  **Atomic Stores**: Split the complex `SettingsContext` into smaller, atomic Zustand stores.

---

## 3. The "Vibe Coding" Workflow for Features

1.  **Define Schema**: Ask AI to write the Zod schema and API service first. 
    *   *Prompt:* "Write the Zod schema for the Appointment settings and the API service method."
2.  **Build Mock**: Ask AI to create an MSW handler for that endpoint.
3.  **Implement UI**: Work on the UI while the mock backend is active. This eliminates network noise.
4.  **Auto-Debug**: If a state issue arises, ask the AI to write a failing integration test to find the root cause.

---

## 4. Summary of Improvements

| Target | Current Issue | AI-First Solution |
| :--- | :--- | :--- |
| **Data Flow** | Manual `useEffect` syncing | **Declarative `key` resets** |
| **API Caching** | Custom logic in `useApiData` | **TanStack Query** |
| **Debugging** | 10+ manual manual log iterations | **Headless Vitest + MSW Tests** |
| **Validation** | Silent failures (`undefined`) | **Strict Zod Schema validation** |
