import React, { useState, useCallback, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { apiService } from '../services/api';
import { LineUserWithStatus } from '../types';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { InfoModal } from '../components/shared/InfoModal';
import { useApiData } from '../hooks/useApiData';
import PageHeader from '../components/PageHeader';

const LineUsersPage: React.FC = () => {
  const { isClinicAdmin, user: currentUser, isAuthenticated, isLoading } = useAuth();
  const activeClinicId = currentUser?.active_clinic_id;
  const { alert, confirm } = useModal();
  
  // If not authenticated, show a message
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">需要登入</h1>
          <p className="text-gray-600">請先登入以查看LINE使用者管理頁面</p>
        </div>
      </div>
    );
  }

  // Only admins can access this page
  if (!isClinicAdmin) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="LINE 使用者" />
        <div className="bg-red-50 border border-red-200 rounded-md p-4 mt-4">
          <div className="flex">
            <div className="flex-shrink-0">
              <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
              </svg>
            </div>
            <div className="ml-3">
              <h3 className="text-sm font-medium text-red-800">無權限</h3>
              <div className="mt-2 text-sm text-red-700">
                <p>只有診所管理員可以管理LINE使用者的AI回覆設定。</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Stable fetch function using useCallback
  const fetchLineUsers = useCallback(() => apiService.getLineUsers(), []);

  const { data: lineUsers, loading, error, refetch } = useApiData<LineUserWithStatus[]>(
    fetchLineUsers,
    {
      enabled: !isLoading && isAuthenticated && isClinicAdmin,
      dependencies: [isLoading, isAuthenticated, activeClinicId],
      defaultErrorMessage: '無法載入LINE使用者列表',
      initialData: [],
    }
  );

  const [toggling, setToggling] = useState<Set<string>>(new Set());
  const [expandedUsers, setExpandedUsers] = useState<Set<string>>(new Set());
  const [showAiStatusInfo, setShowAiStatusInfo] = useState(false);
  const aiStatusInfoButtonRef = useRef<HTMLButtonElement>(null);

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
    } catch (err: any) {
      logger.error('Toggle AI error:', err);
      const status = err?.response?.status;
      let errorMessage = err?.response?.data?.detail || err?.message;
      
      if (status === 403) {
        errorMessage = '您沒有權限執行此操作';
      } else if (status === 404) {
        errorMessage = '找不到此LINE使用者';
      } else if (status === 400) {
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title="LINE 使用者" />
        <ErrorMessage message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader title="LINE 使用者" />

      <div className="space-y-8">
        {/* Line Users List */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          {!lineUsers || lineUsers.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">無LINE使用者</h3>
              <p className="mt-1 text-sm text-gray-500">
                目前沒有LINE使用者連結到此診所的病患
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      LINE 使用者
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      病患
                    </th>
                    <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                      <div className="flex items-center justify-center gap-2">
                        <span>AI 狀態</span>
                        <button
                          ref={aiStatusInfoButtonRef}
                          type="button"
                          onClick={() => setShowAiStatusInfo(!showAiStatusInfo)}
                          className="text-blue-600 hover:text-blue-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1 rounded-full p-1"
                          title="AI自動回覆控制說明"
                          aria-label="顯示AI自動回覆控制說明"
                        >
                          <svg
                            className="w-4 h-4"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            xmlns="http://www.w3.org/2000/svg"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                            />
                          </svg>
                        </button>
                        <InfoModal
                          isOpen={showAiStatusInfo}
                          onClose={() => setShowAiStatusInfo(false)}
                          buttonRef={aiStatusInfoButtonRef}
                          title="AI自動回覆控制"
                        >
                          <p className="mb-3">
                            您可以在此管理每個LINE使用者的AI自動回覆功能。停用後，該使用者的訊息將不會由AI處理，直到您重新啟用。
                          </p>
                          <p>
                            此設定與使用者自行選擇的「人工回覆」不同，此設定由管理員控制且永久有效。
                          </p>
                        </InfoModal>
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
                          className="hover:bg-gray-50 cursor-pointer"
                          onClick={() => toggleExpand(lineUser.line_user_id)}
                        >
                          <td className="px-6 py-4">
                            <div className="text-sm font-medium text-gray-900">
                              {lineUser.display_name || '未設定名稱'}
                            </div>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center">
                              <div className="flex-1">
                                <div className="text-sm text-gray-900">
                                  {lineUser.patient_count} 位病患
                                </div>
                                {!isExpanded && lineUser.patient_names.length > 0 && (
                                  <div className="text-sm text-gray-500 mt-1">
                                    {lineUser.patient_names.slice(0, 3).join(', ')}
                                    {lineUser.patient_names.length > 3 && ` 等${lineUser.patient_names.length}位`}
                                  </div>
                                )}
                                {isExpanded && (
                                  <div className="mt-2">
                                    <div className="text-sm text-gray-700 font-medium mb-1">所有病患：</div>
                                    <div className="text-sm text-gray-600 space-y-1">
                                      {lineUser.patient_names.map((name, index) => (
                                        <div key={index}>{name}</div>
                                      ))}
                                    </div>
                                  </div>
                                )}
                              </div>
                              {lineUser.patient_names.length > 0 && (
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
                          <td className="px-6 py-4 whitespace-nowrap text-center">
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
          )}
        </div>
      </div>
    </div>
  );
};

export default LineUsersPage;

