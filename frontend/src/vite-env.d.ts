/// <reference types="vite/client" />

declare global {
  interface Window {
    liff: {
      init: (config: { liffId: string }) => Promise<void>;
      login: () => void;
      logout: () => void;
      getProfile: () => Promise<{ userId: string; displayName: string; pictureUrl?: string; statusMessage?: string }>;
      getAccessToken: () => string | null;
      isLoggedIn: () => boolean;
      isInClient: () => boolean;
      [key: string]: unknown;
    };
    __calendarCreateAppointment?: (date: Date) => void;
  }
}

export {};
