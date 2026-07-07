# Autonomous Engineering Backlog

Backlog items are based on the current repository state and should be re-evaluated every cycle. Status values: `open`, `in-progress`, `blocked`, `done`, `rejected`.

## Items

### AE-BL-001

- **Priority:** HIGH
- **Area:** Backend validation and reliability
- **Observed evidence:** `backend/package.json` contains a placeholder `test` script that exits with `Error: no test specified`. Backend API routes exist for auth, attendance, leave, performance, timetable, and LMS.
- **Suggested improvement:** Add a minimal backend test foundation for route/controller behavior or authentication middleware without requiring a production MongoDB connection.
- **Expected value:** Creates a validation base for future autonomous backend changes and reduces regression risk.
- **Dependencies or blockers:** Requires choosing a lightweight test approach compatible with the existing CommonJS backend and Express 5 setup.
- **Status:** open

### AE-BL-002

- **Priority:** HIGH
- **Area:** Authentication observability and frontend security hygiene
- **Observed evidence:** `frontend/src/App.js` logs stored token and auth state using `console.debug` during session validation.
- **Suggested improvement:** Remove sensitive token logging while preserving useful non-secret diagnostics.
- **Expected value:** Reduces the risk of credential exposure in browser logs without changing application behavior.
- **Dependencies or blockers:** Must preserve current login, validation, and protected-route behavior.
- **Status:** open

### AE-BL-003

- **Priority:** HIGH
- **Area:** Attendance intelligence
- **Observed evidence:** The backend exposes protected attendance routes including `/api/attendance/stats` and `/api/attendance/subjects`; the product vision prioritizes attendance intelligence and early warnings.
- **Suggested improvement:** Strengthen attendance warning data or frontend presentation around low-attendance subjects using existing attendance flows.
- **Expected value:** Improves student academic visibility and early intervention value.
- **Dependencies or blockers:** Must inspect current controller data shape and frontend attendance page before implementation.
- **Status:** open

### AE-BL-004

- **Priority:** MEDIUM
- **Area:** Leave workflow clarity
- **Observed evidence:** The backend provides protected `GET /api/leave` and `POST /api/leave` routes and the frontend contains `frontend/src/pages/Leave.js`.
- **Suggested improvement:** Improve validation, status messaging, or UX clarity for leave submission and history using the existing flow.
- **Expected value:** Makes student leave requests more understandable and auditable.
- **Dependencies or blockers:** Must preserve existing API contract or update frontend/backend together.
- **Status:** open

### AE-BL-005

- **Priority:** MEDIUM
- **Area:** LMS usefulness
- **Observed evidence:** The backend exposes protected LMS index and resource routes and the frontend contains an LMS page.
- **Suggested improvement:** Improve resource metadata, empty states, or navigation around existing LMS materials.
- **Expected value:** Makes learning resources easier for students to discover and use.
- **Dependencies or blockers:** Requires verifying current static/seeded LMS data shape.
- **Status:** open

### AE-BL-006

- **Priority:** MEDIUM
- **Area:** Project automation
- **Observed evidence:** Project Health exists and reports frontend build health, package inventory, and backend route structure.
- **Suggested improvement:** Add focused validation around the autonomous agent state files and generated context without duplicating Project Health.
- **Expected value:** Keeps autonomous memory, backlog, and decision history machine-readable and trustworthy.
- **Dependencies or blockers:** Version 1 autonomous workflow provides initial checks; future improvements should avoid overlapping with `scripts/generate-project-health.js`.
- **Status:** open

### AE-BL-007

- **Priority:** LOW
- **Area:** Production readiness
- **Observed evidence:** `backend/server.js` connects to `process.env.MONGO_URI` and listens on port `5000` directly.
- **Suggested improvement:** Improve server configurability and testability by isolating app creation from process startup.
- **Expected value:** Enables cleaner backend testing and deployment configuration.
- **Dependencies or blockers:** Must avoid changing runtime behavior unexpectedly.
- **Status:** open
