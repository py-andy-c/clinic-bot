import React, { useState, useEffect } from 'react';
import { PatientPhoto } from '../types/medicalRecord';
import { BaseModal } from './shared/BaseModal';

// Simple SVG Icons
const XIcon = () => (
  <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

const ChevronLeftIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
  </svg>
);

const ChevronRightIcon = () => (
  <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

interface PhotoLightboxProps {
  photos: PatientPhoto[];
  initialIndex: number;
  onClose: () => void;
}

export const PhotoLightbox: React.FC<PhotoLightboxProps> = ({
  photos,
  initialIndex,
  onClose,
}) => {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const currentPhoto = photos[currentIndex];
  const hasPrevious = currentIndex > 0;
  const hasNext = currentIndex < photos.length - 1;

  const handlePrevious = () => {
    if (hasPrevious) {
      setCurrentIndex(currentIndex - 1);
    }
  };

  const handleNext = () => {
    if (hasNext) {
      setCurrentIndex(currentIndex + 1);
    }
  };

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        handlePrevious();
      } else if (e.key === 'ArrowRight') {
        handleNext();
      } else if (e.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex, onClose]);

  if (!currentPhoto) return null;

  return (
    <BaseModal onClose={onClose} showCloseButton={false}>
      <div className="fixed inset-0 bg-black bg-opacity-95 flex items-center justify-center z-50">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-white hover:bg-white hover:bg-opacity-10 rounded-full transition-colors z-10"
          aria-label="Close"
        >
          <XIcon />
        </button>

        {/* Previous Button */}
        {hasPrevious && (
          <button
            onClick={handlePrevious}
            className="absolute left-4 p-3 text-white hover:bg-white hover:bg-opacity-10 rounded-full transition-colors z-10"
            aria-label="Previous"
          >
            <ChevronLeftIcon />
          </button>
        )}

        {/* Next Button */}
        {hasNext && (
          <button
            onClick={handleNext}
            className="absolute right-4 p-3 text-white hover:bg-white hover:bg-opacity-10 rounded-full transition-colors z-10"
            aria-label="Next"
          >
            <ChevronRightIcon />
          </button>
        )}

        {/* Image */}
        <div className="max-w-7xl max-h-full p-4 flex flex-col items-center justify-center">
          <img
            src={currentPhoto.url}
            alt={currentPhoto.description || currentPhoto.filename}
            className="max-w-full max-h-[85vh] object-contain"
          />

          {/* Image Info */}
          <div className="mt-4 text-center text-white">
            {currentPhoto.description && (
              <p className="text-lg mb-2">{currentPhoto.description}</p>
            )}
            <p className="text-sm text-gray-400">
              {currentIndex + 1} / {photos.length}
            </p>
          </div>
        </div>
      </div>
    </BaseModal>
  );
};
