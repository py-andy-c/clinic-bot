import React from 'react';

/**
 * Shared utility functions for appointment status badges and styling.
 * Used across PatientAppointmentsList and AppointmentCard components.
 */

export interface StatusBadgeConfig {
  className: string;
  text: string;
}

/**
 * Get status badge configuration for appointment status.
 * Returns null for confirmed appointments (no badge shown).
 */
export const getStatusBadgeConfig = (status: string): StatusBadgeConfig | null => {
  switch (status) {
    case 'confirmed':
      // Don't show badge for confirmed appointments
      return null;
    case 'canceled_by_patient':
      return {
        className: 'bg-blue-100 text-blue-800',
        text: '病患取消',
      };
    case 'canceled_by_clinic':
      return {
        className: 'bg-red-100 text-red-800',
        text: '診所取消',
      };
    default:
      return {
        className: 'bg-gray-100 text-gray-800',
        text: status,
      };
  }
};

/**
 * Get status badge CSS classes only (for components that handle text separately).
 * Returns null for confirmed appointments.
 */
export const getStatusBadgeColor = (status: string): string | null => {
  const config = getStatusBadgeConfig(status);
  return config?.className || null;
};

/**
 * Get status badge text only (for components that handle styling separately).
 * Returns null for confirmed appointments.
 */
export const getStatusBadgeText = (status: string): string | null => {
  const config = getStatusBadgeConfig(status);
  return config?.text || null;
};

/**
 * Render a status badge component.
 * Returns null for confirmed appointments.
 */
export const renderStatusBadge = (status: string): React.ReactNode => {
  const config = getStatusBadgeConfig(status);
  if (!config) {
    return null;
  }

  return (
    <span className={`px-2 py-1 text-xs font-medium rounded-full whitespace-nowrap ${config.className}`}>
      {config.text}
    </span>
  );
};

