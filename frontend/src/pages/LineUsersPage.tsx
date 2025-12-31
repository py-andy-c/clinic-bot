import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { apiService } from '../services/api';
import { LineUserWithStatus } from '../types';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage, SearchInput, PaginationControls } from '../components/shared';
import { BaseModal } from '../components/shared/BaseModal';
import { useApiData } from '../hooks/useApiData';
import { useHighlightRow } from '../hooks/useHighlightRow';
import PageHeader from '../components/PageHeader';
import { useDebouncedSearch } from '../utils/searchUtils';
import { getErrorMessage } from '../types/api';

// Component to handle profile picture with fallback on error
const ProfilePictureWithFallback: React.FC<{
  src: string | null | undefined;
  alt: string;
  size: 'small' | 'medium';
}> = ({ src, alt, size }) => {
  const [imageError, setImageError] = React.useState(false);
  
  // Reset error state when src changes
  React.useEffect(() => {
    setImageError(false);
  }, [src]);
  
  if (!src || imageError) {
    const containerClass = size === 'small' ? 'w-6 h-6' : 'w-8 h-8';
    const iconClass = size === 'small' ? 'w-4 h-4' : 'w-5 h-5';
    return (
      <div className={`${containerClass} rounded-full bg-gray-300 flex items-center justify-center flex-shrink-0`}>
        <svg className={`${iconClass} text-gray-500`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
        </svg>
      </div>
    );
  }
  
  const imageClass = size === 'small' ? 'w-6 h-6' : 'w-8 h-8';
  return (
    <img
      src={src}
      alt={alt}
      className={`${imageClass} rounded-full object-cover flex-shrink-0`}
      onError={() => setImageError(true)}
    />
  );
};

const LineUsersPage: React.FC = () => {
  const navigate = useNavigate();
  const { user: currentUser, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = currentUser?.active_clinic_id;
  const { alert, confirm } = useModal();
  const [searchParams, setSearchParams] = useSearchParams();

  // Scroll to top when component mounts
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Get pagination state from URL with validation
  const currentPage = Math.max(1, parseInt(searchParams.get('page') || '1', 10) || 1);
  // Default page size increased from 10 to 25 for better UX (fewer pagination clicks)
  const pageSize = Math.max(1, Math.min(100, parseInt(searchParams.get('pageSize') || '25', 10) || 25));

  // Server-side search functionality (declare before useCallback)
  const [searchInput, setSearchInput] = useState<string>('');
  const [isComposing, setIsComposing] = useState(false);
  const debouncedSearchQuery = useDebouncedSearch(searchInput, 400, isComposing);
  
  // State for editing display names
  const [editingLineUserId, setEditingLineUserId] = useState<string | null>(null);
  const [editingDisplayName, setEditingDisplayName] = useState<string>('');
  const [isSaving, setIsSaving] = useState(false);

  // Stable fetch function using useCallback
  // Only search if debouncedSearchQuery has a value (empty string means no search)
  const fetchLineUsers = useCallback(
    () => apiService.getLineUsers(
      currentPage,
      pageSize,
      undefined, // no signal
      debouncedSearchQuery || undefined // search parameter (empty string becomes undefined)
    ),
    [currentPage, pageSize, debouncedSearchQuery]
  );

  const { data: lineUsersData, loading, error, refetch } = useApiData<{
    line_users: LineUserWithStatus[];
    total: number;
    page: number;
    page_size: number;
  }>(
    fetchLineUsers,
    {
      enabled: !isLoading && isAuthenticated,
      dependencies: [isLoading, isAuthenticated, activeClinicId, currentPage, pageSize, debouncedSearchQuery],
      defaultErrorMessage: '無法載入LINE使用者列表',
      initialData: { line_users: [], total: 0, page: 1, page_size: 25 },
    }
  );

  // Keep previous data visible during loading to prevent flicker
  const [previousLineUsersData, setPreviousLineUsersData] = useState<{
    line_users: LineUserWithStatus[];
    total: number;
    page: number;
    page_size: number;
  } | null>(null);

  // Update previous data when new data arrives (not during loading)
  useEffect(() => {
    if (!loading && lineUsersData) {
      setPreviousLineUsersData(lineUsersData);
    }
  }, [loading, lineUsersData]);

  // Use previous data if currently loading, otherwise use current data
  const displayData = loading && previousLineUsersData ? previousLineUsersData : lineUsersData;
  const lineUsers = useMemo(() => displayData?.line_users || [], [displayData?.line_users]);
  const totalLineUsers = displayData?.total || 0;
  const totalPages = Math.ceil(totalLineUsers / pageSize);
  
  // Validate currentPage doesn't exceed totalPages and reset if needed
  // This runs after we have totalPages from the API response
  useEffect(() => {
    if (totalPages > 0 && currentPage > totalPages) {
      // Page exceeds total, reset to page 1
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('page', '1');
      setSearchParams(newSearchParams, { replace: true });
    }
  }, [currentPage, totalPages, searchParams, setSearchParams]);
  
  // Use validated page for display (clamp to valid range)
  const validatedPage = Math.max(1, Math.min(currentPage, totalPages || 1));
  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [showAiStatusInfo, setShowAiStatusInfo] = useState(false);
  const targetLineUserIdRef = useRef<string | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Memoize PageHeader to prevent re-renders when only data changes
  // Must be called before any conditional returns to follow Rules of Hooks
  const pageHeader = useMemo(() => <PageHeader title="LINE 使用者" />, []);

  // Focus preservation is now handled inside SearchInput component
  // No need for additional focus logic here

  // Get lineUserId from query parameter
  const lineUserIdFromQuery = searchParams.get('lineUserId');

  // Use highlight hook for navigation from patient list
  // NOTE: This only searches within the current page's results.
  // If the line user is on a different page, it won't be found.
  // Server-side search (Phase 3) would allow finding and navigating to the correct page.
  const highlightedLineUserId = useHighlightRow(
    lineUserIdFromQuery && lineUsers.length > 0 ? lineUserIdFromQuery : null,
    'data-line-user-id'
  );

  // Auto-expand and search when navigating from patient list
  useEffect(() => {
    if (lineUserIdFromQuery && lineUsers.length > 0 && !targetLineUserIdRef.current) {
      const targetUser = lineUsers.find(lu => lu.line_user_id === lineUserIdFromQuery);
      if (targetUser) {
        // Mark as handled to prevent re-running
        targetLineUserIdRef.current = lineUserIdFromQuery;
        
        // Auto-expand the target user
        setExpandedUsers(prev => new Set(prev).add(lineUserIdFromQuery));
        
        // Auto-fill search with display name if available and search is empty
        if (targetUser.display_name) {
          setSearchInput(targetUser.display_name);
        }
        
        // Remove query parameter after handling
        const newSearchParams = new URLSearchParams(searchParams);
        newSearchParams.delete('lineUserId');
        setSearchParams(newSearchParams, { replace: true });
      }
    }
    
    // Reset ref when lineUserIdFromQuery changes (new navigation)
    if (!lineUserIdFromQuery) {
      targetLineUserIdRef.current = null;
    }
  }, [lineUserIdFromQuery, lineUsers, searchParams, setSearchParams, setExpandedUsers]);

  // Reset to page 1 when search query changes (including when cleared)
  const prevSearchQueryRef = useRef<string>('');
  useEffect(() => {
    // Only reset if search query actually changed and we're not on page 1
    if (prevSearchQueryRef.current !== debouncedSearchQuery && currentPage !== 1) {
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.set('page', '1');
      setSearchParams(newSearchParams, { replace: true });
    }
    prevSearchQueryRef.current = debouncedSearchQuery;
  }, [debouncedSearchQuery, currentPage, searchParams, setSearchParams]);

  // Handle page change
  const handlePageChange = useCallback((page: number) => {
    // Validate page is within bounds
    const validPage = Math.max(1, Math.min(page, totalPages));
    const newSearchParams = new URLSearchParams(searchParams);
    newSearchParams.set('page', validPage.toString());
    setSearchParams(newSearchParams, { replace: true });
    // Scroll to top when page changes
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [searchParams, setSearchParams, totalPages]);


  const handleSaveDisplayName = async (lineUser: LineUserWithStatus) => {
    if (isSaving) return;
    
    setIsSaving(true);
    try {
      const newDisplayName = editingDisplayName.trim() || null;
      await apiService.updateLineUserDisplayName(lineUser.line_user_id, newDisplayName);
      
      // Update local state
      setEditingLineUserId(null);
      setEditingDisplayName('');
      
      // Refetch to get updated data
      await refetch();
      
      await alert('顯示名稱已更新');
    } catch (error) {
      logger.error('Failed to update display name:', error);
      await alert(getErrorMessage(error) || '無法更新顯示名稱');
    } finally {
      setIsSaving(false);
    }
  };

  const handleToggleAi = async (lineUser: LineUserWithStatus, e: React.ChangeEvent<HTMLInputElement>) => {
    e.stopPropagation(); // Prevent row click when toggling
    e.preventDefault(); // Prevent default checkbox behavior
    
    const lineUserId = lineUser.line_user_id;
    const willBeDisabled = !lineUser.ai_disabled; // New state after toggle
    
    // Show confirmation dialog when disabling
    if (willBeDisabled) {
      const confirmed = await confirm(
        `確定要停用 ${lineUser.display_name || '此使用者'} 的AI自動回覆功能嗎？\n\n停用後，該使用者的訊息將不會由AI處理，直到您重新啟用。`
      );
      if (!confirmed) {
        return;
      }
    }

    try {
      setToggling(prev => new Set(prev).add(lineUserId));
      
      if (lineUser.ai_disabled) {
        await apiService.enableAiForLineUser(lineUserId);
        await alert('AI自動回覆已啟用');
      } else {
        await apiService.disableAiForLineUser(lineUserId);
        await alert('AI自動回覆已停用');
      }
      
      await refetch(); // Refresh the list
    } catch (err: unknown) {
      logger.error('Toggle AI error:', err);
      const status = err?.response?.status;
      let errorMessage = getErrorMessage(err);
      
      if (status === 403) {
        errorMessage = '您沒有權限執行此操作';
      } else if (status === 404) {
        errorMessage = '找不到此LINE使用者';
      } else if (status === 400 && !errorMessage) {
        errorMessage = '無效的請求';
      } else if (!errorMessage) {
        errorMessage = '請稍後再試';
      }
      
      await alert(`操作失敗：${errorMessage}`);
    } finally {
      setToggling(prev => {
        const next = new Set(prev);
        next.delete(lineUserId);
        return next;
      });
    }
  };

  const toggleExpand = (lineUserId: string) => {
    setExpandedUsers(prev => {
      const next = new Set(prev);
      if (next.has(lineUserId)) {
        next.delete(lineUserId);
      } else {
        next.add(lineUserId);
      }
      return next;
    });
  };

  const handlePatientNameClick = (patientId: number, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent row expansion when clicking patient name
    navigate(`/admin/clinic/patients/${patientId}`);
  };

  // Only show full-page loading on initial load (when we have no previous data)
  // During search/deletion, keep previous data visible
  if (loading && !previousLineUsersData) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <>
        {pageHeader}
        <ErrorMessage message={error} onRetry={refetch} />
      </>
    );
  }

  return (
    <>
      {/* Header */}
      {pageHeader}

      <div className="space-y-8">
        {/* Line Users List */}
        <div className="bg-white md:rounded-lg md:shadow-md overflow-hidden">
          {/* Search Bar */}
          <div className="p-2 md:p-4 border-b border-gray-200">
            <SearchInput
              ref={searchInputRef}
              value={searchInput}
              onChange={setSearchInput}
              onCompositionStart={() => { setIsComposing(true); }}
              onCompositionEnd={() => { setIsComposing(false); }}
              placeholder="搜尋LINE使用者名稱或病患姓名..."
            />
          </div>
          
          {!loading && totalLineUsers === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">無LINE使用者</h3>
              <p className="mt-1 text-sm text-gray-500">
                目前沒有LINE使用者連結到此診所的病患
              </p>
            </div>
          ) : !loading && lineUsers.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-gray-500">
                {searchInput.trim()
                  ? '找不到符合搜尋條件的LINE使用者'
                  : '目前頁面沒有LINE使用者'}
              </p>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto relative">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-2 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 z-10 bg-gray-50 whitespace-nowrap">
                        LINE 使用者
                      </th>
                      <th className="px-2 py-2 md:px-6 md:py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        病患
                      </th>
                      <th className="px-2 py-2 md:px-6 md:py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider w-24">
                        <div className="flex items-center justify-center gap-2">
                          <span>AI 狀態</span>
                          <button
                            type="button"
                            onClick={() => setShowAiStatusInfo(true)}
                            className="inline-flex items-center justify-center p-1 text-gray-400 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full"
                            aria-label="查看說明"
                          >
                            <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                            </svg>
                          </button>
                          {showAiStatusInfo && (
                            <BaseModal
                              onClose={() => setShowAiStatusInfo(false)}
                              aria-label="AI自動回覆控制說明"
                            >
                              <div className="flex items-start">
                                <div className="flex-shrink-0">
                                  <svg className="h-5 w-5 text-blue-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                  </svg>
                                </div>
                                <div className="ml-3 flex-1">
                                  <h3 className="text-lg font-semibold text-gray-900 mb-3">AI自動回覆控制</h3>
                                  <div className="text-sm text-gray-700 space-y-2">
                                    <p>
                                      您可以在此管理每個LINE使用者的AI自動回覆功能。停用後，該使用者的訊息將不會由AI處理，直到您重新啟用。
                                    </p>
                                    <p>
                                      此設定與使用者自行選擇的「人工回覆」不同，此設定由管理員控制且永久有效。
                                    </p>
                                  </div>
                                  <div className="mt-4 flex justify-end">
                                    <button
                                      type="button"
                                      onClick={() => setShowAiStatusInfo(false)}
                                      className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm"
                                    >
                                      關閉
                                    </button>
                                  </div>
                                </div>
                              </div>
                            </BaseModal>
                          )}
                        </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {lineUsers.map((lineUser) => {
                      const isToggling = toggling.has(lineUser.line_user_id);
                      const isExpanded = expandedUsers.has(lineUser.line_user_id);
                      return (
                        <React.Fragment key={lineUser.line_user_id}>
                          <tr 
                            data-line-user-id={lineUser.line_user_id}
                            className={`group hover:bg-gray-50 cursor-pointer transition-colors ${
                              highlightedLineUserId === lineUser.line_user_id ? 'bg-blue-50' : ''
                            }`}
                            onClick={() => toggleExpand(lineUser.line_user_id)}
                          >
                            <td className={`px-2 py-2 md:px-6 md:py-4 whitespace-nowrap sticky left-0 z-10 transition-colors ${
                              highlightedLineUserId === lineUser.line_user_id
                                ? 'bg-blue-50 group-hover:bg-blue-50'
                                : 'bg-white group-hover:bg-gray-50'
                            }`}>
                              {editingLineUserId === lineUser.line_user_id ? (
                                <div className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    value={editingDisplayName}
                                    onChange={(e) => {
                                      e.stopPropagation();
                                      setEditingDisplayName(e.target.value);
                                    }}
                                    onKeyDown={(e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') {
                                        handleSaveDisplayName(lineUser);
                                      } else if (e.key === 'Escape') {
                                        setEditingLineUserId(null);
                                        setEditingDisplayName('');
                                      }
                                    }}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-32 px-1.5 py-0.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
                                    autoFocus
                                    disabled={isSaving}
                                  />
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleSaveDisplayName(lineUser);
                                    }}
                                    disabled={isSaving}
                                    className="px-1.5 py-0.5 text-xs text-white bg-blue-600 rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isSaving ? '...' : '✓'}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingLineUserId(null);
                                      setEditingDisplayName('');
                                    }}
                                    disabled={isSaving}
                                    className="px-1.5 py-0.5 text-xs text-gray-600 bg-gray-200 rounded hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ) : (
                                <div className="flex items-center gap-2 min-w-0">
                                  <ProfilePictureWithFallback
                                    src={lineUser.picture_url}
                                    alt={lineUser.display_name || 'LINE user'}
                                    size="medium"
                                  />
                                  <div className="text-sm font-medium text-gray-900 whitespace-nowrap truncate min-w-0 max-w-[200px]" title={lineUser.display_name || '未設定名稱'}>
                                    {lineUser.display_name || '未設定名稱'}
                                  </div>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setEditingLineUserId(lineUser.line_user_id);
                                      setEditingDisplayName(lineUser.display_name || '');
                                    }}
                                    className="px-1 py-1 text-gray-400 hover:text-gray-600 transition-colors flex-shrink-0"
                                    title="編輯顯示名稱"
                                  >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                    </svg>
                                  </button>
                                </div>
                              )}
                            </td>
                            <td className="px-2 py-2 md:px-6 md:py-4 whitespace-nowrap">
                              <div className="flex items-center">
                                <div className="flex-1">
                                  <div className="text-sm text-gray-900">
                                    {lineUser.patient_count} 位病患
                                  </div>
                                  {!isExpanded && lineUser.patient_info.length > 0 && (
                                    <div className="text-sm text-gray-500 mt-1">
                                      {lineUser.patient_info.slice(0, 3).map((patient, index, array) => (
                                        <React.Fragment key={`${lineUser.line_user_id}-${patient.id}-${index}`}>
                                          <button
                                            onClick={(e) => handlePatientNameClick(patient.id, e)}
                                            className="text-blue-600 hover:text-blue-800 hover:underline"
                                          >
                                            {patient.name}
                                          </button>
                                          {index < array.length - 1 && ', '}
                                        </React.Fragment>
                                      ))}
                                      {lineUser.patient_info.length > 3 && ` 等${lineUser.patient_info.length}位`}
                                    </div>
                                  )}
                                  {isExpanded && (
                                    <div className="mt-2">
                                      <div className="text-sm text-gray-700 font-medium mb-1">所有病患：</div>
                                      <div className="text-sm text-gray-600 space-y-1">
                                        {lineUser.patient_info.map((patient, index) => (
                                          <button
                                            key={`${lineUser.line_user_id}-${patient.id}-${index}`}
                                            onClick={(e) => handlePatientNameClick(patient.id, e)}
                                            className="text-blue-600 hover:text-blue-800 hover:underline block text-left"
                                          >
                                            {patient.name}
                                          </button>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                                {lineUser.patient_info.length > 0 && (
                                  <div className="ml-2 flex-shrink-0">
                                    <svg
                                      className={`h-5 w-5 text-gray-400 transition-transform ${isExpanded ? 'transform rotate-180' : ''}`}
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                    >
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                    </svg>
                                  </div>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 md:px-6 md:py-4 whitespace-nowrap text-center">
                              <label className="relative inline-flex items-center cursor-pointer">
                                <span className="sr-only">
                                  {lineUser.ai_disabled ? '啟用' : '停用'} {lineUser.display_name || '此使用者'} 的AI自動回覆
                                </span>
                                <input
                                  type="checkbox"
                                  checked={!lineUser.ai_disabled}
                                  onChange={(e) => {
                                    e.stopPropagation();
                                    handleToggleAi(lineUser, e);
                                  }}
                                  disabled={isToggling}
                                  className="sr-only peer"
                                  aria-label={`${lineUser.ai_disabled ? '啟用' : '停用'} ${lineUser.display_name || '此使用者'} 的AI自動回覆`}
                                />
                                <div className={`w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-green-600 ${isToggling ? 'opacity-50 cursor-not-allowed' : ''}`}></div>
                                {isToggling && (
                                  <svg className="animate-spin ml-2 h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                )}
                              </label>
                            </td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              {totalPages > 1 && (
                <div className="mt-2 pt-2 md:mt-4 md:pt-4 border-t border-gray-200">
                  <PaginationControls
                    currentPage={validatedPage}
                    totalPages={totalPages}
                    totalItems={totalLineUsers}
                    pageSize={pageSize}
                    onPageChange={handlePageChange}
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
};

export default LineUsersPage;

