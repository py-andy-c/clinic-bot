import React from 'react';

type ClinicType = '物理治療' | '醫美' | '牙醫';

interface ClinicTypeTabsProps {
  /** Array of clinic types to display as tabs */
  types: ClinicType[];
  /** Currently active clinic type */
  activeType: ClinicType;
  /** Callback when a tab is clicked */
  onChange: (type: ClinicType) => void;
  /** Optional ARIA label for the tab group */
  ariaLabel?: string;
}

/**
 * Reusable component for clinic type tab navigation.
 * Provides accessible tab interface with keyboard navigation support.
 */
const ClinicTypeTabs: React.FC<ClinicTypeTabsProps> = ({
  types,
  activeType,
  onChange,
  ariaLabel = '選擇診所類型',
}) => {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex justify-center mb-6 space-x-2"
    >
      {types.map((type) => (
        <button
          key={type}
          role="tab"
          aria-selected={activeType === type}
          aria-controls={`${type}-panel`}
          id={`${type}-tab`}
          onClick={() => onChange(type)}
          className={`px-4 py-2 rounded-lg font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 ${
            activeType === type
              ? 'bg-primary-600 text-white'
              : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          {type}
        </button>
      ))}
    </div>
  );
};

export default ClinicTypeTabs;

