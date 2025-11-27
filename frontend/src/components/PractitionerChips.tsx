import React from 'react';
import { getPractitionerColor } from '../utils/practitionerColors';

interface Practitioner {
  id: number;
  full_name: string;
}

interface PractitionerChipsProps {
  practitioners: Practitioner[];
  selectedPractitionerIds: number[];
  currentUserId: number | null;
  isPractitioner: boolean;
  onRemove: (practitionerId: number) => void;
  primaryUserId?: number | null; // Primary user ID for color calculation (matches calendar)
}

const PractitionerChips: React.FC<PractitionerChipsProps> = ({
  practitioners,
  selectedPractitionerIds,
  currentUserId,
  isPractitioner,
  onRemove,
  primaryUserId,
}) => {
  // Get selected practitioner names for display
  const selectedPractitioners = practitioners.filter((p) =>
    selectedPractitionerIds.includes(p.id)
  );

  // Calculate all practitioner IDs for color indexing (must match calendar calculation)
  // Use primaryUserId if provided, otherwise fall back to currentUserId for practitioners
  const effectivePrimaryUserId = React.useMemo(() => {
    if (primaryUserId !== undefined) {
      return primaryUserId || -1;
    }
    return (currentUserId && isPractitioner) ? currentUserId : -1;
  }, [primaryUserId, currentUserId, isPractitioner]);

  const allPractitionerIds = React.useMemo(() => {
    // Match calendar's calculation: [primaryUserId, ...additionalPractitionerIds]
    if (effectivePrimaryUserId !== -1) {
      return [effectivePrimaryUserId, ...selectedPractitionerIds];
    }
    return selectedPractitionerIds;
  }, [effectivePrimaryUserId, selectedPractitionerIds]);

  // Memoize color calculations for each selected practitioner
  const chipColors = React.useMemo(() => {
    const primaryId = effectivePrimaryUserId;
    
    return selectedPractitioners.map((p) => {
      const color = getPractitionerColor(p.id, primaryId, allPractitionerIds);
      
      if (!color) {
        // Primary practitioner (only for practitioners) - use blue (#3B82F6)
        return {
          id: p.id,
          bg: 'bg-blue-100',
          text: 'text-blue-800',
          border: 'border-blue-200',
          practitionerColor: null,
        };
      }

      // Use the practitioner's color for the chip (hex value)
      // Use the exact color from calendar events for consistency
      return {
        id: p.id,
        bg: '', // Will use inline style
        text: 'text-white',
        border: '', // Will use inline style
        practitionerColor: color,
      };
    });
  }, [selectedPractitioners, effectivePrimaryUserId, allPractitionerIds]);

  if (selectedPractitioners.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-2 mb-2 pl-2">
      {selectedPractitioners.map((practitioner) => {
        const colorInfo = chipColors.find(c => c.id === practitioner.id);
        
        // Use inline style if we have a specific color, otherwise use classes
        const chipStyle = colorInfo?.practitionerColor && colorInfo.bg === ''
          ? {
              backgroundColor: colorInfo.practitionerColor,
              borderColor: colorInfo.practitionerColor,
            }
          : undefined;
        
        const chipClassName = colorInfo?.bg
          ? `inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium border ${colorInfo.bg} ${colorInfo.text} ${colorInfo.border}`
          : 'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-sm font-medium border';
        
        return (
          <div
            key={practitioner.id}
            className={chipClassName}
            style={chipStyle}
          >
            <span>{practitioner.full_name}</span>
            <button
              onClick={() => onRemove(practitioner.id)}
              className={`ml-0.5 rounded-full p-0.5 focus:outline-none focus:ring-1 focus:ring-offset-1 ${
                colorInfo?.practitionerColor
                  ? 'text-white hover:opacity-80'
                  : 'hover:bg-black/10'
              }`}
              aria-label={`移除 ${practitioner.full_name}`}
            >
              <span className="text-xs">×</span>
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default PractitionerChips;

