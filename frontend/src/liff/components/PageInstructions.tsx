import React from 'react';

interface PageInstructionsProps {
  instructions: string | null | undefined;
}

/**
 * Displays custom page instructions in a non-intrusive info banner.
 * Only renders if instructions are provided.
 */
export const PageInstructions: React.FC<PageInstructionsProps> = ({ instructions }) => {
  if (!instructions || instructions.trim() === '') {
    return null;
  }

  return (
    <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg
            className="w-5 h-5 text-blue-600 mt-0.5"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
            aria-hidden="true"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <p className="text-sm text-blue-800 whitespace-pre-line">
            {instructions}
          </p>
        </div>
      </div>
    </div>
  );
};

