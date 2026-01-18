import React from 'react';
import styles from './CalendarLayout.module.css';

/**
 * CalendarLayout - Full-width layout override for calendar pages
 *
 * This component overrides the standard ClinicLayout constraints to provide
 * a full-width, edge-to-edge calendar layout that matches the mock UI design.
 * It removes padding, centering, and max-width constraints while preserving
 * the ClinicLayout header functionality.
 */
interface CalendarLayoutProps {
  children: React.ReactNode;
}

const CalendarLayout: React.FC<CalendarLayoutProps> = ({ children }) => {
  return (
    <div className={styles.calendarLayout}>
      {children}
    </div>
  );
};

export default CalendarLayout;