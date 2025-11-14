import React from 'react';

interface SettingsSectionProps {
  title: string;
  showSaveButton?: boolean;
  onSave?: () => void;
  saving?: boolean;
  children: React.ReactNode;
  headerActions?: React.ReactNode;
}

/**
 * Reusable settings section wrapper component that provides visual distinction
 * and consistent styling for settings sections.
 */
const SettingsSection: React.FC<SettingsSectionProps> = ({
  title,
  showSaveButton = false,
  onSave,
  saving = false,
  children,
  headerActions,
}) => {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm hover:shadow-md transition-shadow duration-200 overflow-hidden">
      <div className="px-6 py-5 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
        <div className="flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 tracking-tight">{title}</h2>
          <div className="flex items-center gap-3">
            {headerActions}
            {showSaveButton && onSave && (
              <button
                type="button"
                onClick={onSave}
                disabled={saving}
                className="btn-primary text-sm px-4 py-2"
              >
                {saving ? '儲存中...' : '儲存更變'}
              </button>
            )}
          </div>
        </div>
      </div>
      <div className="px-6 py-6">
        {children}
      </div>
    </div>
  );
};

export default SettingsSection;

