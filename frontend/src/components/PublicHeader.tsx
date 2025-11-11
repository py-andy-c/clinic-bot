import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface PublicHeaderProps {
  /** Optional active path to highlight in navigation */
  activePath?: string;
}

const PublicHeader: React.FC<PublicHeaderProps> = ({ activePath }) => {
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const location = useLocation();
  const currentPath = activePath || location.pathname;

  const isActive = (path: string) => currentPath === path;

  return (
    <header className="bg-white shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between items-center h-16">
          <Link to="/" className="flex items-center">
            <span className="text-2xl">🏥</span>
            <span className="ml-2 text-xl font-semibold text-gray-900">診所小幫手</span>
          </Link>
          
          {/* Desktop Navigation */}
          <nav className="hidden md:flex items-center space-x-4">
            <Link
              to="/free-trial"
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                isActive('/free-trial')
                  ? 'text-primary-600'
                  : 'text-gray-700 hover:text-primary-600'
              }`}
            >
              免費試用
            </Link>
            <Link
              to="/contact"
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                isActive('/contact')
                  ? 'text-primary-600'
                  : 'text-gray-700 hover:text-primary-600'
              }`}
            >
              聯絡我們
            </Link>
            <Link
              to="/admin/login"
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              後台登入
            </Link>
          </nav>

          {/* Mobile Menu Button */}
          <button
            onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
            className="md:hidden p-2 rounded-md text-gray-700 hover:text-gray-900 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-primary-500"
            aria-label="Toggle menu"
          >
            {isMobileMenuOpen ? (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>

        {/* Mobile Navigation Menu */}
        {isMobileMenuOpen && (
          <div className="md:hidden border-t border-gray-200 py-4">
            <div className="flex flex-col space-y-3">
              <Link
                to="/free-trial"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`px-4 py-2 text-base font-medium rounded-md transition-colors ${
                  isActive('/free-trial')
                    ? 'text-primary-600 bg-primary-50'
                    : 'text-gray-700 hover:text-primary-600 hover:bg-gray-50'
                }`}
              >
                免費試用
              </Link>
              <Link
                to="/contact"
                onClick={() => setIsMobileMenuOpen(false)}
                className={`px-4 py-2 text-base font-medium rounded-md transition-colors ${
                  isActive('/contact')
                    ? 'text-primary-600 bg-primary-50'
                    : 'text-gray-700 hover:text-primary-600 hover:bg-gray-50'
                }`}
              >
                聯絡我們
              </Link>
              <Link
                to="/admin/login"
                onClick={() => setIsMobileMenuOpen(false)}
                className="px-4 py-2 text-base font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
              >
                後台登入
              </Link>
            </div>
          </div>
        )}
      </div>
    </header>
  );
};

export default PublicHeader;

