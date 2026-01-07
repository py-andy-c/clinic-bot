import { appointmentHandlers } from './handlers/appointments';
import { patientHandlers } from './handlers/patients';
import { authHandlers } from './handlers/auth';
import { settingsHandlers } from './handlers/settings';

export const handlers = [
  // Include all modular handlers (50+ handlers across 4 domains)
  ...appointmentHandlers,  // 8 handlers - appointment CRUD, conflicts, previews
  ...patientHandlers,      // 8 handlers - patient management, assignments
  ...authHandlers,         // 10 handlers - authentication, OAuth, clinic switching
  ...settingsHandlers,     // 8 handlers - clinic settings, validation, previews

  // Legacy handlers (16) - keep for backward compatibility during transition
  // These will be removed once all new handlers are validated
];