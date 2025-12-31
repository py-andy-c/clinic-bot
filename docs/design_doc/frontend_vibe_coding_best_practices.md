# Frontend Vibe Coding: Best Practices & Recommendations

## Overview
As a backend-heavy team using AI (like Cursor) for rapid development ("Vibe Coding"), you've noticed that while the backend is reliable and works "out-of-the-box," the frontend requires hours of iteration and manual debugging. 

The core reason is not just "AI is bad at frontend," but rather that **the current frontend architecture is "AI-Hostile."** It relies on complex, custom-built synchronization logic that overrides standard React patterns, leading to race conditions and state management bugs that AI struggles to track across multiple files.

This document outlines best practices to make your frontend "Vibe-Ready."

---

## 1. Core Diagnosis: Why Frontend is Failing
Looking into the codebase (e.g., `useApiData.ts`, `SettingsAppointmentsPage.tsx`), we see patterns that are common sources of AI-induced bugs:

1.  **Reinventing the Wheel**: `useApiData` is an 800-line custom implementation of data fetching. It uses regex on function source code to generate cache keys—a pattern that is fragile and unpredictable for AI.
2.  **Imperative State Syncing**: Heavy use of `useEffect` to sync form state with API data. Every `useEffect` is a potential race condition or infinite loop.
3.  **Manual Cache Management**: Contexts manually call `invalidateCacheForFunction`. If the AI forgets one call, the UI stays stale, leading to "bugs" that are just cache misses.
4.  **Defensive Boilerplate**: The AI has added `useRef`, `JSON.stringify` comparisons, and "locks" to solve symptoms rather than the root cause.

---

## 2. Recommendation 1: Adopt TanStack Query (React Query)
The single most impactful change for "Vibe Coding" is replacing custom fetching logic with **TanStack Query**.

*   **Why?** It is the industry standard. AI knows exactly how it works.
*   **Benefits**:
    *   **Automatic Caching**: No more manual invalidation logic.
    *   **Race Condition Protection**: Handles concurrent requests out-of-the-box.
    *   **Declarative**: You tell it *what* to fetch, not *how* to manage the state.
*   **Action**: Install `@tanstack/react-query` and migrate `useApiData` calls.

---

## 3. Recommendation 2: Use `.cursorrules` for Architectural Alignment
AI works best when it has clear "guardrails." You should create a `.cursorrules` file in your root directory to enforce patterns.

**Example `.cursorrules` content:**
```markdown
# Frontend Design Principles
- Prefer TanStack Query for all server state; avoid manual `useEffect` fetching.
- Use Zod schemas for all API responses and form validation.
- Avoid "Syncing Effects": Don't use `useEffect` to copy props to state. Use `key` prop to reset components when data changes.
- All components must be functional and use TypeScript.
- If a state management issue arises, prefer simplifying the component over adding `useRef` or `JSON.stringify`.
```

---

## 4. Recommendation 3: Declarative Over Imperative Syncing
Instead of complex sync logic in `useEffect`:
- **Uncontrolled Forms with `key`**: If you need a form to reset when `data` changes, just give the form a `key={data.id}`. React will handle the reset automatically.
- **Derived State**: If state B depends on state A, calculate B during render. Don't sync A to B in an effect.

---

## 5. Recommendation 4: MSW for Reliable Frontend Testing
AI spends hours debugging because "it doesn't have a backend" during implementation.
*   **Mock Service Worker (MSW)**: Allows you to mock the backend in the browser and in tests.
*   **Vibe Benefit**: You can ask the AI: "Write an integration test for this feature using MSW." The AI will mock the API calls and verify the UI logic without needing a running backend.

---

## 6. Recommendation 5: Enhanced Debuggability (State Logging)
Stop manual console logging. Use automated tools that the AI can interpret.
*   **Zustand DevTools**: Since you use Zustand, enable the `devtools` middleware. This allows you to see state transitions in the browser console.
*   **Request/Response Tracing**: Add an Axios interceptor that logs every request and response in a structured format. When an issue occurs, you can just copy-paste the last 10 log entries to the AI.
*   **Action**: Implement a "Debug Mode" that can be toggled to show state overlays.

---

## 7. Practical "Vibe Coding" Workflow for Frontend

1.  **Define the Contract**: Ask AI to write the Zod schema and API service first. 
    *   *Prompt*: "Write the Zod schema for the Appointment settings and the API service method."
2.  **Build the Mock**: Ask AI to create an MSW handler.
    *   *Prompt*: "Create an MSW handler that returns mock data matching that schema."
3.  **Implement UI with Mocks**: Work on the UI while the mock backend is active. This eliminates "API call failure" noise.
4.  **Review the State Flow**: Before finishing, ask the AI to "Review the state management in this component. Are there any `useEffect` syncs that can be simplified?"

---

## 7. Immediate Codebase Improvements
Based on the current project:
1.  **Deprecate `useApiData.ts`**: It's too complex. Migrate to a standard library.
2.  **Simplify `SettingsContext.tsx`**: It's trying to do too much. Split it or use TanStack Query's global cache.
3.  **Remove manual `JSON.stringify` comparisons**: These are expensive and usually indicate a design flaw in state syncing.

## Conclusion
Frontend "Vibe Coding" is hard because React is a state machine, and state machines are easy to break with imperative instructions. By moving to **Declarative Libraries (React Query, Zod)** and **Strict Rules (.cursorrules)**, you turn the frontend into a predictable system that AI can master as easily as the backend.
