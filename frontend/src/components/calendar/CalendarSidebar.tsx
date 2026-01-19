import React from 'react';
import { CalendarView, CalendarViews } from '../../types/calendar';
import { getPractitionerColor } from '../../utils/practitionerColors';
import { getResourceColorById } from '../../utils/resourceColorUtils';
import styles from './CalendarSidebar.module.css';

interface Practitioner {
  id: number;
  full_name: string;
}

interface Resource {
  id: number;
  name: string;
}

interface CalendarSidebarProps {
  view: CalendarView;
  onViewChange: (view: CalendarView) => void;
  practitioners: Practitioner[];
  selectedPractitioners: number[];
  onPractitionersChange: (ids: number[]) => void;
  resources: Resource[];
  selectedResources: number[];
  onResourcesChange: (ids: number[]) => void;
  isOpen: boolean;
  onToggle: () => void;
}

const CalendarSidebar: React.FC<CalendarSidebarProps> = ({
  view,
  onViewChange,
  practitioners,
  selectedPractitioners,
  onPractitionersChange,
  resources,
  selectedResources,
  onResourcesChange,
  isOpen,
  onToggle,
}) => {
  const handleViewChange = (newView: CalendarView) => {
    onViewChange(newView);
  };

  const handlePractitionerToggle = (practitionerId: number) => {
    const newSelection = selectedPractitioners.includes(practitionerId)
      ? selectedPractitioners.filter(id => id !== practitionerId)
      : [...selectedPractitioners, practitionerId];

    // Limit to 10 practitioners
    if (newSelection.length <= 10) {
      onPractitionersChange(newSelection);
    }
  };

  const handleResourceToggle = (resourceId: number) => {
    const newSelection = selectedResources.includes(resourceId)
      ? selectedResources.filter(id => id !== resourceId)
      : [...selectedResources, resourceId];

    // Limit to 10 resources
    if (newSelection.length <= 10) {
      onResourcesChange(newSelection);
    }
  };

  const getPractitionerColorStyle = (practitionerId: number) => {
    const color = getPractitionerColor(practitionerId, -1, selectedPractitioners) || '#6b7280';
    return { backgroundColor: color };
  };

  const getResourceColorStyle = (resourceId: number) => {
    const color = getResourceColorById(resourceId, selectedResources) || '#6b7280';
    return { backgroundColor: color };
  };

  return (
    <>
      {/* Mobile overlay */}
      <div
        className={styles.sidebarOverlay}
        onClick={onToggle}
        style={{
          '--sidebar-overlay-opacity': isOpen ? '1' : '0',
          '--sidebar-overlay-visibility': isOpen ? 'visible' : 'hidden',
        } as React.CSSProperties}
      />

      {/* Sidebar */}
      <div
        className={styles.sidebar}
        style={{
          '--sidebar-translate-x': isOpen ? '0' : '-100%',
        } as React.CSSProperties}
        role="complementary"
        aria-label="Calendar sidebar with view controls and filters"
        data-testid="calendar-sidebar"
      >
        <div className={styles.sidebarContent}>
          {/* View Switcher */}
          <div className={styles.sidebarSection}>
            <span className={styles.sidebarSectionTitle}>模式</span>
            <div className={styles.viewOptionsRow} role="radiogroup" aria-label="Calendar view selection">
              <button
                className={`${styles.viewOption} ${view === CalendarViews.MONTH ? styles.viewOptionActive : ''}`}
                onClick={() => handleViewChange(CalendarViews.MONTH)}
                role="radio"
                aria-checked={view === CalendarViews.MONTH}
                aria-label="Switch to monthly view"
              >
                月
              </button>
              <button
                className={`${styles.viewOption} ${view === CalendarViews.WEEK ? styles.viewOptionActive : ''}`}
                onClick={() => handleViewChange(CalendarViews.WEEK)}
                role="radio"
                aria-checked={view === CalendarViews.WEEK}
                aria-label="Switch to weekly view"
              >
                週
              </button>
              <button
                className={`${styles.viewOption} ${view === CalendarViews.DAY ? styles.viewOptionActive : ''}`}
                onClick={() => handleViewChange(CalendarViews.DAY)}
                role="radio"
                aria-checked={view === CalendarViews.DAY}
                aria-label="Switch to daily view"
              >
                日
              </button>
            </div>
          </div>

          {/* Practitioner Filters */}
          <div className={styles.sidebarSection}>
            <h3 className={styles.sidebarSectionTitle}>
              顯示治療師 ({selectedPractitioners.length}/10)
            </h3>
            {practitioners.map((practitioner) => {
              const isSelected = selectedPractitioners.includes(practitioner.id);
              return (
                <label key={practitioner.id} className={styles.filterItem}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handlePractitionerToggle(practitioner.id)}
                    aria-label={`Show/hide appointments for ${practitioner.full_name}`}
                  />
                  <span
                    className={styles.filterIndicator}
                    style={getPractitionerColorStyle(practitioner.id)}
                    aria-hidden="true"
                  />
                  {practitioner.full_name}
                </label>
              );
            })}
            {selectedPractitioners.length >= 10 && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px' }}>
                已達治療師上限 (10 位)
              </div>
            )}
          </div>

          {/* Resource Filters */}
          <div className={styles.sidebarSection}>
            <h3 className={styles.sidebarSectionTitle}>
              顯示資源 ({selectedResources.length}/10)
            </h3>
            {resources.map((resource) => {
              const isSelected = selectedResources.includes(resource.id);
              return (
                <label key={resource.id} className={styles.filterItem}>
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => handleResourceToggle(resource.id)}
                    aria-label={`Show/hide appointments for ${resource.name}`}
                  />
                  <span
                    className={styles.filterIndicator}
                    style={getResourceColorStyle(resource.id)}
                    aria-hidden="true"
                  />
                  {resource.name}
                </label>
              );
            })}
            {selectedResources.length >= 10 && (
              <div style={{ fontSize: '12px', color: '#ef4444', marginTop: '8px' }}>
                已達資源上限 (10 個)
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Mobile menu button */}
      <button className={styles.mobileMenuBtn} onClick={onToggle}>
        ☰
      </button>
    </>
  );
};

export default CalendarSidebar;