import React, { useState, useCallback, useEffect } from 'react';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { useModal } from '../contexts/ModalContext';
import moment from 'moment-timezone';
import { Link, useParams } from 'react-router-dom';
import { apiService } from '../services/api';
import { Clinic, ClinicCreateData, ClinicHealth, PractitionerWithDetails } from '../types';
import { useApiData } from '../hooks/useApiData';

interface ClinicDetailsData {
  clinic: Clinic;
  health: ClinicHealth;
  practitioners?: PractitionerWithDetails[];
}

const SystemClinicsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { alert } = useModal();
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editingClinic, setEditingClinic] = useState<Partial<ClinicCreateData>>({});
  const [updating, setUpdating] = useState(false);

  // Scroll to top when component mounts or id changes
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [id]);

  // Stable fetch functions using useCallback
  const fetchClinics = useCallback(() => apiService.getClinics(), []);
  const fetchClinicDetails = useCallback(async (): Promise<ClinicDetailsData> => {
    if (!id) {
      throw new Error('Clinic ID is required');
    }
    const [clinicData, healthData, practitionersData] = await Promise.all([
      apiService.getClinicDetails(parseInt(id)),
      apiService.getClinicHealth(parseInt(id)),
      apiService.getClinicPractitioners(parseInt(id)).catch(() => ({ practitioners: [] }))
    ]);
    return {
      clinic: clinicData,
      health: healthData,
      practitioners: practitionersData.practitioners || []
    };
  }, [id]);

  // Fetch clinics list when no ID
  const {
    data: clinics,
    loading: clinicsLoading,
    error: clinicsError,
    refetch: refetchClinics,
    setData: setClinics,
  } = useApiData<Clinic[]>(fetchClinics, {
    enabled: !id,
    dependencies: [id],
    initialData: [],
  });

  // Fetch clinic details when ID exists
  const {
    data: clinicDetails,
    loading: detailsLoading,
    error: detailsError,
    refetch: refetchDetails,
  } = useApiData<ClinicDetailsData>(fetchClinicDetails, {
    enabled: !!id,
    dependencies: [id],
    // Cache key now includes clinic id via dependencies, so caching is safe
  });

  const selectedClinic = clinicDetails?.clinic ?? null;
  const clinicHealth = clinicDetails?.health ?? null;
  const practitioners = clinicDetails?.practitioners ?? [];
  const loading = clinicsLoading || detailsLoading;
  const error = clinicsError || detailsError;

  const handleCreateClinic = async (clinicData: ClinicCreateData) => {
    try {
      setCreating(true);
      const newClinic = await apiService.createClinic(clinicData);
      setClinics([...(clinics || []), newClinic]);
      setShowCreateModal(false);
    } catch (err) {
      logger.error('Create clinic error:', err);
      try {
        await alert('建立診所失敗，請稍後再試。', '錯誤');
      } catch (alertErr) {
        // Fallback if alert fails (shouldn't happen, but defensive programming)
        logger.error('Failed to show alert:', alertErr);
      }
    } finally {
      setCreating(false);
    }
  };

  const handleStartEdit = () => {
    if (selectedClinic) {
      setEditingClinic({
        name: selectedClinic.name,
        line_channel_id: selectedClinic.line_channel_id,
        line_channel_secret: selectedClinic.line_channel_secret || '',
        line_channel_access_token: selectedClinic.line_channel_access_token || '',
        subscription_status: selectedClinic.subscription_status,
        liff_id: selectedClinic.liff_id || '',
      });
      setIsEditing(true);
    }
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingClinic({});
  };

  const handleUpdateClinic = async () => {
    if (!selectedClinic || !id) return;

    try {
      setUpdating(true);
      // Only send fields that have changed, and exclude empty password fields
      const updateData: Partial<ClinicCreateData> = {};

      if (editingClinic.name !== undefined && editingClinic.name !== selectedClinic.name) {
        updateData.name = editingClinic.name;
      }
      if (editingClinic.line_channel_id !== undefined && editingClinic.line_channel_id !== selectedClinic.line_channel_id) {
        updateData.line_channel_id = editingClinic.line_channel_id;
      }
      if (editingClinic.line_channel_secret && editingClinic.line_channel_secret.trim() !== '') {
        updateData.line_channel_secret = editingClinic.line_channel_secret;
      }
      if (editingClinic.line_channel_access_token && editingClinic.line_channel_access_token.trim() !== '') {
        updateData.line_channel_access_token = editingClinic.line_channel_access_token;
      }
      if (editingClinic.subscription_status !== undefined && editingClinic.subscription_status !== selectedClinic.subscription_status) {
        updateData.subscription_status = editingClinic.subscription_status;
      }
      if (editingClinic.liff_id !== undefined && editingClinic.liff_id !== (selectedClinic.liff_id || '')) {
        // Set liff_id: convert empty string to undefined for clearing, or use the string value
        // Backend accepts undefined (Optional[str] in Python) to clear the value
        // Use type assertion to handle exactOptionalPropertyTypes restriction
        const trimmedLiffId = editingClinic.liff_id.trim();
        if (trimmedLiffId === '') {
          // Omit the property to clear it (backend will treat missing optional field as clearing)
          // TypeScript's exactOptionalPropertyTypes doesn't allow assigning undefined directly
          delete (updateData as Record<string, unknown>).liff_id;
        } else {
          updateData.liff_id = trimmedLiffId;
        }
      }

      await apiService.updateClinic(selectedClinic.id, updateData);
      // Refetch clinic details to get updated data
      await refetchDetails();
      setIsEditing(false);
      setEditingClinic({});
      try {
        await alert('診所資訊已更新！', '成功');
      } catch (alertErr) {
        logger.error('Failed to show alert:', alertErr);
      }
    } catch (err) {
      logger.error('Update clinic error:', err);
      try {
        await alert('更新診所資訊失敗，請稍後再試。', '錯誤');
      } catch (alertErr) {
        logger.error('Failed to show alert:', alertErr);
      }
    } finally {
      setUpdating(false);
    }
  };

  const handleGenerateSignupLink = async (clinicId: number): Promise<void> => {
    try {
      const result = await apiService.generateClinicSignupLink(clinicId);
      // Copy to clipboard with fallback
      let copied = false;

      // Try modern Clipboard API first
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(result.signup_url);
          try {
            await alert('註冊連結已複製到剪貼簿！', '成功');
          } catch (alertErr) {
            logger.error('Failed to show alert:', alertErr);
          }
          copied = true;
        } catch (clipboardErr) {
          // Clipboard API failed (permission denied, not secure context, etc.)
          // Fall through to fallback method
          logger.warn('Clipboard API failed, using fallback:', clipboardErr);
        }
      }

      // Fallback for browsers/environments without Clipboard API or when it fails
      if (!copied) {
        const textArea = document.createElement('textarea');
        textArea.value = result.signup_url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          const success = document.execCommand('copy');
          if (success) {
            try {
              await alert('註冊連結已複製到剪貼簿！', '成功');
            } catch (alertErr) {
              logger.error('Failed to show alert:', alertErr);
            }
          } else {
            throw new Error('execCommand copy failed');
          }
        } catch (fallbackErr) {
          // If fallback also fails, show the URL to user
          try {
            await alert(`註冊連結：\n${result.signup_url}`, '註冊連結');
          } catch (alertErr) {
            logger.error('Failed to show alert:', alertErr);
          }
        } finally {
          document.body.removeChild(textArea);
        }
      }
    } catch (err) {
      logger.error('Generate signup link error:', err);
      try {
        await alert('產生註冊連結失敗，請稍後再試。', '錯誤');
      } catch (alertErr) {
        logger.error('Failed to show alert:', alertErr);
      }
    }
  };

  const getHealthStatusColor = (status: string) => {
    switch (status) {
      case 'healthy':
        return 'text-green-600 bg-green-100';
      case 'warning':
        return 'text-yellow-600 bg-yellow-100';
      case 'error':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getWebhookStatusColor = (status: string) => {
    switch (status) {
      case 'very_active':
      case 'active':
        return 'text-green-600 bg-green-100';
      case 'moderate':
        return 'text-yellow-600 bg-yellow-100';
      case 'inactive':
      case 'stale':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getHealthStatusIcon = (status: string) => {
    switch (status) {
      case 'healthy':
        return '✅';
      case 'warning':
        return '⚠️';
      case 'error':
        return '❌';
      default:
        return '❓';
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-96">
        <LoadingSpinner size="xl" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <ErrorMessage
          message={error}
          onRetry={id ? refetchDetails : refetchClinics}
        />
      </div>
    );
  }

  // Show clinic details view
  if (id && selectedClinic && clinicHealth) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="md:flex md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              {selectedClinic.name}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              診所詳細資訊與健康監控
            </p>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4 space-x-3">
            {!isEditing ? (
              <>
                <button
                  onClick={handleStartEdit}
                  className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                >
                  編輯診所
                </button>
                <button
                  onClick={() => handleGenerateSignupLink(selectedClinic.id)}
                  className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
                >
                  產生註冊連結
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={handleCancelEdit}
                  disabled={updating}
                  className="inline-flex items-center rounded-md bg-white px-3 py-2 text-sm font-semibold text-gray-900 shadow-sm ring-1 ring-inset ring-gray-300 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
                >
                  取消
                </button>
                <button
                  onClick={handleUpdateClinic}
                  disabled={updating}
                  className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50"
                >
                  {updating ? '儲存中...' : '儲存變更'}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Clinic Information Form */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">診所資訊</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              管理診所詳細資訊與 LINE 整合設定
            </p>
          </div>
          <div className="border-t border-gray-200">
            <dl>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">診所 ID</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  <input
                    type="text"
                    value={selectedClinic.id}
                    disabled
                    className="block w-full border-gray-300 rounded-md shadow-sm bg-gray-100 text-gray-600 sm:text-sm"
                  />
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">診所名稱</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingClinic.name || ''}
                      onChange={(e) => setEditingClinic({ ...editingClinic, name: e.target.value })}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  ) : (
                    <span className="text-gray-900">{selectedClinic.name}</span>
                  )}
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">LINE Channel ID</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {isEditing ? (
                    <input
                      type="text"
                      value={editingClinic.line_channel_id || ''}
                      onChange={(e) => setEditingClinic({ ...editingClinic, line_channel_id: e.target.value })}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    />
                  ) : (
                    <span className="text-gray-900">{selectedClinic.line_channel_id}</span>
                  )}
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">LINE Channel Secret</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {isEditing ? (
                    <input
                      type="password"
                      value={editingClinic.line_channel_secret || ''}
                      onChange={(e) => setEditingClinic({ ...editingClinic, line_channel_secret: e.target.value })}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder="輸入新的 Secret 或留空以保持目前設定"
                    />
                  ) : (
                    <span className="text-gray-500 font-mono text-xs">••••••••••••••••</span>
                  )}
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">LINE Channel Access Token</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {isEditing ? (
                    <input
                      type="password"
                      value={editingClinic.line_channel_access_token || ''}
                      onChange={(e) => setEditingClinic({ ...editingClinic, line_channel_access_token: e.target.value })}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      placeholder="輸入新的 Token 或留空以保持目前設定"
                    />
                  ) : (
                    <span className="text-gray-500 font-mono text-xs">••••••••••••••••</span>
                  )}
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">訂閱狀態</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {isEditing ? (
                    <select
                      value={editingClinic.subscription_status || selectedClinic.subscription_status}
                      onChange={(e) => setEditingClinic({ ...editingClinic, subscription_status: e.target.value as 'trial' | 'active' | 'past_due' | 'canceled' })}
                      className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                    >
                      <option value="trial">試用</option>
                      <option value="active">啟用</option>
                      <option value="past_due">逾期</option>
                      <option value="canceled">已取消</option>
                    </select>
                  ) : (
                    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getHealthStatusColor(selectedClinic.subscription_status)}`}>
                      {selectedClinic.subscription_status === 'trial' ? '試用' :
                       selectedClinic.subscription_status === 'active' ? '啟用' :
                       selectedClinic.subscription_status === 'past_due' ? '逾期' :
                       selectedClinic.subscription_status === 'canceled' ? '已取消' :
                       selectedClinic.subscription_status}
                    </span>
                  )}
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">LIFF ID</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {isEditing ? (
                    <div>
                      <input
                        type="text"
                        id="edit_liff_id"
                        value={editingClinic.liff_id || ''}
                        onChange={(e) => setEditingClinic({ ...editingClinic, liff_id: e.target.value })}
                        placeholder="e.g., 1234567890-abcdefgh"
                        className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                      />
                      <p className="mt-1 text-xs text-gray-500">
                        For clinic-specific LIFF apps. Leave empty to use shared LIFF app. Format: channel_id-random_string
                      </p>
                    </div>
                  ) : (
                    <span className="text-gray-900">{selectedClinic.liff_id || 'N/A (使用共享 LIFF)'}</span>
                  )}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Clinic Info Cards */}
        <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <span className="text-2xl">📱</span>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">LINE Channel</dt>
                    <dd className="text-lg font-medium text-gray-900">{selectedClinic.line_channel_id}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <span className="text-2xl">📊</span>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">Webhooks (24小時)</dt>
                    <dd className="text-lg font-medium text-gray-900">{selectedClinic.webhook_count_24h || 0}</dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>

          <div className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-5">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <span className="text-lg">{getHealthStatusIcon(clinicHealth.line_integration_status)}</span>
                </div>
                <div className="ml-5 w-0 flex-1">
                  <dl>
                    <dt className="text-sm font-medium text-gray-500 truncate">整合狀態</dt>
                    <dd className={`text-lg font-medium ${getHealthStatusColor(clinicHealth.line_integration_status)}`}>
                      {clinicHealth.line_integration_status === 'healthy' ? '正常' :
                       clinicHealth.line_integration_status === 'warning' ? '警告' :
                       clinicHealth.line_integration_status === 'error' ? '錯誤' :
                       clinicHealth.line_integration_status}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* LIFF Link Section */}
        {selectedClinic.liff_url && (
          <div className="bg-white shadow rounded-lg">
            <div className="px-4 py-5 sm:p-6">
              <h3 className="text-lg font-medium text-gray-900 mb-4">LIFF Link</h3>
              <div className="flex items-center space-x-3">
                <input
                  type="text"
                  readOnly
                  value={selectedClinic.liff_url}
                  className="flex-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-primary-500 focus:ring-primary-500 sm:text-sm font-mono text-xs"
                />
                <button
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(selectedClinic.liff_url || '');
                      await alert('LIFF link copied to clipboard!', 'Success');
                    } catch (err) {
                      logger.error('Failed to copy to clipboard:', err);
                      await alert('Failed to copy to clipboard', 'Error');
                    }
                  }}
                  className="inline-flex items-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  📋 Copy
                </button>
                <a
                  href={selectedClinic.liff_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  🔗 Open
                </a>
              </div>
              <p className="mt-2 text-sm text-gray-500">
                Share this link with patients to allow them to book appointments via LINE.
              </p>
            </div>
          </div>
        )}

        {/* Health Details */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">健康檢查詳情</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              LINE 整合的詳細健康監控
            </p>
          </div>
          <div className="border-t border-gray-200">
            <dl>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Webhook 活動</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getWebhookStatusColor(clinicHealth.webhook_status)}`}>
                    {clinicHealth.webhook_status === 'very_active' ? '非常活躍' :
                     clinicHealth.webhook_status === 'active' ? '活躍' :
                     clinicHealth.webhook_status === 'moderate' ? '中等' :
                     clinicHealth.webhook_status === 'inactive' ? '不活躍' :
                     clinicHealth.webhook_status === 'stale' ? '過時' :
                     clinicHealth.webhook_status}
                  </span>
                  <span className="ml-2">過去 24 小時內 {clinicHealth.webhook_count_24h} 個 webhooks</span>
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">簽章驗證</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {clinicHealth.signature_verification_capable ? (
                    <span className="text-green-600">✓ 可驗證</span>
                  ) : (
                    <span className="text-red-600">✗ 無法驗證</span>
                  )}
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">API 連線狀態</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {clinicHealth.api_connectivity}
                </dd>
              </div>
              {clinicHealth.error_messages.length > 0 && (
                <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                  <dt className="text-sm font-medium text-gray-500">錯誤</dt>
                  <dd className="mt-1 text-sm text-red-600 sm:mt-0 sm:col-span-2">
                    <ul className="list-disc list-inside">
                      {clinicHealth.error_messages.map((error, index) => (
                        <li key={index}>{error}</li>
                      ))}
                    </ul>
                  </dd>
                </div>
              )}
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">最後健康檢查時間</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {moment.tz(clinicHealth.health_check_performed_at, 'Asia/Taipei').format('YYYY/MM/DD HH:mm:ss')}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        {/* Clinic Settings (Read-only) */}
        {selectedClinic.settings && (
          <div className="bg-white shadow overflow-hidden sm:rounded-md">
            <div className="px-4 py-5 sm:px-6">
              <h3 className="text-lg leading-6 font-medium text-gray-900">診所設定</h3>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                所有診所設定（唯讀）
              </p>
            </div>
            <div className="border-t border-gray-200">
              <dl>
                {/* Notification Settings */}
                {selectedClinic.settings.notification_settings && (
                  <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt className="text-sm font-medium text-gray-500">LINE提醒設定</dt>
                    <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                      <div className="space-y-1">
                        <div>預約前幾小時發送提醒: {selectedClinic.settings.notification_settings.reminder_hours_before || 'N/A'}</div>
                      </div>
                    </dd>
                  </div>
                )}
                {/* Booking Restriction Settings */}
                {selectedClinic.settings.booking_restriction_settings && (
                  <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt className="text-sm font-medium text-gray-500">預約限制設定</dt>
                    <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                      <div className="space-y-1">
                        <div>
                          限制類型: {
                            selectedClinic.settings.booking_restriction_settings.booking_restriction_type === 'same_day_disallowed'
                              ? '預約前至少需幾小時 (已從舊設定遷移)'
                              : selectedClinic.settings.booking_restriction_settings.booking_restriction_type === 'minimum_hours_required'
                              ? '預約前至少需幾小時'
                              : selectedClinic.settings.booking_restriction_settings.booking_restriction_type || 'N/A'
                          }
                        </div>
                        {selectedClinic.settings.booking_restriction_settings.minimum_booking_hours_ahead && (
                          <div>預約前至少需幾小時: {selectedClinic.settings.booking_restriction_settings.minimum_booking_hours_ahead}</div>
                        )}
                      </div>
                    </dd>
                  </div>
                )}
                {/* Clinic Info Settings */}
                {selectedClinic.settings.clinic_info_settings && (
                  <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt className="text-sm font-medium text-gray-500">診所資訊</dt>
                    <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                      <div className="space-y-1">
                        <div>顯示名稱: {selectedClinic.settings.clinic_info_settings.display_name || 'N/A'}</div>
                        <div>地址: {selectedClinic.settings.clinic_info_settings.address || 'N/A'}</div>
                        <div>電話: {selectedClinic.settings.clinic_info_settings.phone_number || 'N/A'}</div>
                        {selectedClinic.settings.clinic_info_settings.appointment_type_instructions && (
                          <div className="mt-2">
                            <div className="font-medium">預約類型說明:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.clinic_info_settings.appointment_type_instructions}</div>
                          </div>
                        )}
                      </div>
                    </dd>
                  </div>
                )}
                {/* Chat Settings */}
                {selectedClinic.settings.chat_settings && (
                  <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                    <dt className="text-sm font-medium text-gray-500">AI 聊天功能</dt>
                    <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                      <div className="space-y-2">
                        <div>啟用 AI 聊天功能: {selectedClinic.settings.chat_settings.chat_enabled ? '是' : '否'}</div>
                        {selectedClinic.settings.chat_settings.clinic_description && (
                          <div>
                            <div className="font-medium">診所介紹:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.clinic_description}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.therapist_info && (
                          <div>
                            <div className="font-medium">治療師介紹:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.therapist_info}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.treatment_details && (
                          <div>
                            <div className="font-medium">治療項目詳情:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.treatment_details}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.service_item_selection_guide && (
                          <div>
                            <div className="font-medium">服務項目選擇指南:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.service_item_selection_guide}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.operating_hours && (
                          <div>
                            <div className="font-medium">營業時間:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.operating_hours}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.location_details && (
                          <div>
                            <div className="font-medium">交通資訊:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.location_details}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.booking_policy && (
                          <div>
                            <div className="font-medium">預約與取消政策:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.booking_policy}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.payment_methods && (
                          <div>
                            <div className="font-medium">付款方式:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.payment_methods}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.equipment_facilities && (
                          <div>
                            <div className="font-medium">設備與設施:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.equipment_facilities}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.common_questions && (
                          <div>
                            <div className="font-medium">常見問題:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.common_questions}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.other_info && (
                          <div>
                            <div className="font-medium">其他:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.other_info}</div>
                          </div>
                        )}
                        {selectedClinic.settings.chat_settings.ai_guidance && (
                          <div>
                            <div className="font-medium">AI指引:</div>
                            <div className="text-gray-600 whitespace-pre-wrap">{selectedClinic.settings.chat_settings.ai_guidance}</div>
                          </div>
                        )}
                      </div>
                    </dd>
                  </div>
                )}
              </dl>
            </div>
          </div>
        )}

        {/* Practitioners (Read-only) */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">治療師</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              所有治療師及其設定（唯讀）
            </p>
          </div>
          <div className="border-t border-gray-200">
            {practitioners.length === 0 ? (
              <div className="px-4 py-5 sm:px-6">
                <p className="text-sm text-gray-500">此診所目前沒有治療師</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-200">
                {practitioners.map((practitioner) => (
                  <div key={practitioner.id} className="px-4 py-5 sm:px-6">
                    <div className="mb-4">
                      <h4 className="text-base font-medium text-gray-900">{practitioner.full_name || 'N/A'}</h4>
                      <p className="text-sm text-gray-500">ID: {practitioner.id} | Email: {practitioner.email}</p>
                      <p className="text-sm text-gray-500">角色: {practitioner.roles?.map((r: string) => r === 'admin' ? '管理員' : r === 'practitioner' ? '治療師' : r).join('、') || 'N/A'}</p>
                    </div>

                    {/* Appointment Types */}
                    <div className="mt-4">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">預約類型:</h5>
                      {practitioner.appointment_types && practitioner.appointment_types.length > 0 ? (
                        <ul className="list-disc list-inside text-sm text-gray-600 space-y-1">
                          {practitioner.appointment_types.map((at) => (
                            <li key={at.id}>{at.name} ({at.duration_minutes} 分鐘)</li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-sm text-gray-500">未設定預約類型</p>
                      )}
                    </div>

                    {/* Default Schedule */}
                    <div className="mt-4">
                      <h5 className="text-sm font-medium text-gray-700 mb-2">預設排程:</h5>
                      {practitioner.default_schedule && Object.keys(practitioner.default_schedule).length > 0 ? (
                        <div className="space-y-2">
                          {Object.entries(practitioner.default_schedule).map(([day, intervals]) => {
                            const dayNames: { [key: string]: string } = {
                              'monday': '週一',
                              'tuesday': '週二',
                              'wednesday': '週三',
                              'thursday': '週四',
                              'friday': '週五',
                              'saturday': '週六',
                              'sunday': '週日'
                            };
                            return (
                              <div key={day} className="text-sm">
                                <span className="font-medium">{dayNames[day] || day}:</span>{' '}
                                {intervals.map((interval, idx: number) => (
                                  <span key={idx} className="text-gray-600">
                                    {interval.start_time} - {interval.end_time}
                                    {idx < intervals.length - 1 && '、'}
                                  </span>
                                ))}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="text-sm text-gray-500">未設定預設排程</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Show clinics list view
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            Clinics Management
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            Create and manage clinics in the system
          </p>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4">
          <button
            onClick={() => setShowCreateModal(true)}
            className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
          >
            <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
            </svg>
            Create Clinic
          </button>
        </div>
      </div>

      {/* Clinics Grid */}
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {clinics?.map((clinic) => (
          <div key={clinic.id} className="bg-white overflow-hidden shadow rounded-lg">
            <div className="p-6">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <span className="text-3xl">🏥</span>
                </div>
                <div className="ml-4 flex-1">
                  <h3 className="text-lg font-medium text-gray-900">{clinic.name}</h3>
                  <p className="text-sm text-gray-500">Channel: {clinic.line_channel_id}</p>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-600">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getHealthStatusColor(clinic.subscription_status)}`}>
                    {clinic.subscription_status}
                  </span>
                </div>
                <div className="text-sm text-gray-600">
                  {clinic.webhook_count_24h || 0} webhooks
                </div>
              </div>

              <div className="mt-6 flex space-x-3">
                <Link
                  to={`/admin/system/clinics/${clinic.id}`}
                  className="flex-1 bg-primary-600 py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 text-center"
                >
                  View Details
                </Link>
                <button
                  onClick={() => handleGenerateSignupLink(clinic.id)}
                  className="flex-1 bg-white py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                >
                  Signup Link
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {(!clinics || clinics.length === 0) && (
        <div className="text-center py-12">
          <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
          </svg>
          <h3 className="mt-2 text-sm font-medium text-gray-900">No clinics</h3>
          <p className="mt-1 text-sm text-gray-500">Get started by creating your first clinic.</p>
          <div className="mt-6">
            <button
              onClick={() => setShowCreateModal(true)}
              className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
            >
              <svg className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 5a1 1 0 011 1v3h3a1 1 0 110 2h-3v3a1 1 0 11-2 0v-3H6a1 1 0 110-2h3V6a1 1 0 011-1z" clipRule="evenodd" />
              </svg>
              Create Clinic
            </button>
          </div>
        </div>
      )}

      {/* Create Clinic Modal */}
      {showCreateModal && (
        <CreateClinicModal
          onClose={() => setShowCreateModal(false)}
          onSubmit={handleCreateClinic}
          loading={creating}
        />
      )}
    </div>
  );
};

// Create Clinic Modal Component
interface CreateClinicModalProps {
  onClose: () => void;
  onSubmit: (data: ClinicCreateData) => Promise<void>;
  loading: boolean;
}

const CreateClinicModal: React.FC<CreateClinicModalProps> = ({ onClose, onSubmit, loading }) => {
  const [formData, setFormData] = useState<ClinicCreateData>({
    name: '',
    line_channel_id: '',
    line_channel_secret: '',
    line_channel_access_token: '',
    subscription_status: 'trial',
    liff_id: ''
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await onSubmit(formData);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true">
          <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={onClose}></div>
        </div>

        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div className="sm:flex sm:items-start">
            <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                Create New Clinic
              </h3>

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    Clinic Name
                  </label>
                  <input
                    type="text"
                    name="name"
                    id="name"
                    required
                    value={formData.name}
                    onChange={handleChange}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="line_channel_id" className="block text-sm font-medium text-gray-700">
                    LINE Channel ID
                  </label>
                  <input
                    type="text"
                    name="line_channel_id"
                    id="line_channel_id"
                    required
                    value={formData.line_channel_id}
                    onChange={handleChange}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="line_channel_secret" className="block text-sm font-medium text-gray-700">
                    LINE Channel Secret
                  </label>
                  <input
                    type="password"
                    name="line_channel_secret"
                    id="line_channel_secret"
                    required
                    value={formData.line_channel_secret}
                    onChange={handleChange}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="line_channel_access_token" className="block text-sm font-medium text-gray-700">
                    LINE Channel Access Token
                  </label>
                  <input
                    type="password"
                    name="line_channel_access_token"
                    id="line_channel_access_token"
                    required
                    value={formData.line_channel_access_token}
                    onChange={handleChange}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="subscription_status" className="block text-sm font-medium text-gray-700">
                    Subscription Status
                  </label>
                  <select
                    name="subscription_status"
                    id="subscription_status"
                    value={formData.subscription_status}
                    onChange={handleChange}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  >
                    <option value="trial">Trial</option>
                    <option value="active">Active</option>
                    <option value="past_due">Past Due</option>
                    <option value="canceled">Canceled</option>
                  </select>
                </div>

                <div>
                  <label htmlFor="liff_id" className="block text-sm font-medium text-gray-700">
                    LIFF ID (Optional)
                  </label>
                  <input
                    type="text"
                    name="liff_id"
                    id="liff_id"
                    value={formData.liff_id}
                    onChange={handleChange}
                    placeholder="e.g., 1234567890-abcdefgh"
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                  <p className="mt-1 text-xs text-gray-500">
                    For clinic-specific LIFF apps. Leave empty to use shared LIFF app. Format: channel_id-random_string
                  </p>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={loading}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {loading ? 'Creating...' : 'Create Clinic'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:mt-0 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SystemClinicsPage;
