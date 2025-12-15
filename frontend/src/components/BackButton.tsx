import React from 'react';
import { Link } from 'react-router-dom';

export interface BackButtonProps {
  to: string;
  label: string;
  className?: string;
}

const BackButton: React.FC<BackButtonProps> = ({ to, label, className = '' }) => {
  return (
    <Link
      to={to}
      className={`inline-flex items-center text-sm font-medium text-gray-600 hover:text-gray-900 mb-6 transition-colors ${className}`}
    >
      <svg
        className="mr-2 h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
      >
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
      </svg>
      {label}
    </Link>
  );
};

export default BackButton;

