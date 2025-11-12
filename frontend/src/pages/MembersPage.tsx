import React, { useState, useCallback } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useModal } from '../contexts/ModalContext';
import { apiService } from '../services/api';
import { Member, UserRole, MemberInviteData } from '../types';
import { logger } from '../utils/logger';
import { LoadingSpinner, ErrorMessage } from '../components/shared';
import { useApiData } from '../hooks/useApiData';
import PageHeader from '../components/PageHeader';

const MembersPage: React.FC = () => {
  const { isClinicAdmin, user: currentUser, isAuthenticated, checkAuthStatus, isLoading } = useAuth();
  const activeClinicId = currentUser?.active_clinic_id;
  const { alert, confirm } = useModal();
  
  // If not authenticated, show a message (in real app, this would redirect to login)
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-4">需要登入</h1>
          <p className="text-gray-600">請先登入以查看成員管理頁面</p>
        </div>
      </div>
    );
  }

  // Stable fetch function using useCallback
  const fetchMembers = useCallback(() => apiService.getMembers(), []);

  const { data: members, loading, error, refetch } = useApiData<Member[]>(
    fetchMembers,
    {
      enabled: !isLoading && isAuthenticated,
      dependencies: [isLoading, isAuthenticated, activeClinicId],
      defaultErrorMessage: '無法載入成員列表',
      initialData: [],
    }
  );

  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const [updatingRoles, setUpdatingRoles] = useState(false);

  const handleInviteMember = async (inviteData: MemberInviteData) => {
    try {
      setInviting(true);
      const response = await apiService.inviteMember(inviteData);
      return response;
    } catch (err: any) {
      logger.error('Invite member error:', err);
      const errorMessage = err?.response?.data?.detail;
      if (errorMessage === 'Invalid role specified') {
        await alert('指定的角色無效。請選擇有效的角色。');
      } else {
        await alert('邀請成員失敗，請稍後再試');
      }
      throw err;
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateRoles = async (userId: number, roles: UserRole[]) => {
    try {
      setUpdatingRoles(true);
      await apiService.updateMemberRoles(userId, roles);
      setShowRoleModal(null);
      await refetch(); // Refresh the list
      
      // If the current user updated their own roles, refresh auth status
      if (currentUser && userId === currentUser.user_id) {
        await checkAuthStatus();
      }
    } catch (err: any) {
      logger.error('Update roles error:', err);
      const errorMessage = err?.response?.data?.detail;
      if (errorMessage === '找不到成員') {
        await alert('找不到該成員，請重新載入頁面後再試。');
      } else if (errorMessage === '無法從最後一位管理員停用管理員權限') {
        await alert('無法停用最後一位管理員的管理員權限。');
      } else if (errorMessage === '指定的角色無效') {
        await alert('指定的角色無效。請選擇有效的角色。');
      } else {
        await alert('更新角色失敗，請稍後再試');
      }
    } finally {
      setUpdatingRoles(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    const confirmed = await confirm('確定要停用此成員嗎？此操作可以復原。');
    if (!confirmed) {
      return;
    }

    try {
      await apiService.removeMember(userId);
      await refetch(); // Refresh the list
    } catch (err: any) {
      logger.error('Remove member error:', err);

      // Check for specific error messages from backend
      const errorMessage = err?.response?.data?.detail;
      if (errorMessage === '無法停用最後一位管理員') {
        await alert('無法停用最後一位管理員。請先指派其他成員為管理員。');
      } else if (errorMessage === '找不到成員') {
        await alert('找不到該成員，請重新載入頁面後再試。');
      } else {
        await alert('停用成員失敗，請稍後再試');
      }
    }
  };

  const handleReactivateMember = async (userId: number) => {
    const confirmed = await confirm('確定要重新啟用此成員嗎？');
    if (!confirmed) {
      return;
    }

    try {
      await apiService.reactivateMember(userId);
      await refetch(); // Refresh the list
      await alert('成員已重新啟用');
    } catch (err: any) {
      logger.error('Reactivate member error:', err);

      // Check for specific error messages from backend
      const errorMessage = err?.response?.data?.detail;
      if (errorMessage === '找不到已停用的成員') {
        await alert('找不到已停用的成員，請重新載入頁面後再試。');
      } else {
        await alert('重新啟用成員失敗，請稍後再試');
      }
    }
  };

  const getRoleDisplay = (roles: UserRole[]) => {
    if (roles.includes('admin') && roles.includes('practitioner')) {
      return '管理員 & 治療師';
    } else if (roles.includes('admin')) {
      return '管理員';
    } else if (roles.includes('practitioner')) {
      return '治療師';
    }
    return '唯讀存取';
  };

  const getRoleColor = (roles: UserRole[]) => {
    if (roles.includes('admin')) {
      return 'bg-red-100 text-red-800';
    } else if (roles.includes('practitioner')) {
      return 'bg-blue-100 text-blue-800';
    }
    return 'bg-green-100 text-green-800';
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
        <PageHeader title="成員管理" />
        <ErrorMessage message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader
        title="成員管理"
        action={
          isClinicAdmin && (
            <button
              onClick={() => setShowInviteModal(true)}
              className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
              </svg>
              邀請新成員
            </button>
          )
        }
      />

      <div className="space-y-8">
        {/* Error Message */}
        {error && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4">
            <div className="flex">
              <div className="flex-shrink-0">
                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                </svg>
              </div>
              <div className="ml-3">
                <h3 className="text-sm font-medium text-red-800">載入錯誤</h3>
                <div className="mt-2 text-sm text-red-700">
                  <p>{error}</p>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Members List */}
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <ul role="list" className="divide-y divide-gray-200">
          {!members || members.length === 0 ? (
            <div className="text-center py-12">
              <svg className="mx-auto h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
              <h3 className="mt-2 text-sm font-medium text-gray-900">無成員</h3>
              <p className="mt-1 text-sm text-gray-500">
                {isClinicAdmin ? '邀請第一位成員加入您的診所' : '目前沒有其他成員'}
              </p>
              {isClinicAdmin && (
                <div className="mt-6">
                  <button
                    onClick={() => setShowInviteModal(true)}
                    className="inline-flex items-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-primary-600 hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                  >
                    <svg className="-ml-1 mr-2 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                    </svg>
                    邀請成員
                  </button>
                </div>
              )}
            </div>
          ) : (
            members?.map((member) => (
              <li key={member.id}>
                <div className={`px-4 py-4 sm:px-6 ${!member.is_active ? 'bg-gray-50 opacity-75' : ''}`}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div>
                        <div className={`text-sm font-medium ${!member.is_active ? 'text-gray-500' : 'text-gray-900'}`}>
                          {member.full_name}
                          {!member.is_active && ' (已停用)'}
                        </div>
                        <div className={`text-sm ${!member.is_active ? 'text-gray-400' : 'text-gray-500'}`}>{member.email}</div>
                        <div className="mt-1 flex items-center space-x-2">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(member.roles)}`}>
                            {getRoleDisplay(member.roles)}
                          </span>
                          {!member.is_active && (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                              已停用
                            </span>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      {/* Actions */}
                      <div className="flex items-center space-x-2">
                        {isClinicAdmin && (
                          <>
                            {member.is_active ? (
                              <>
                                <button
                                  onClick={() => setShowRoleModal(member)}
                                  className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                                >
                                  編輯角色
                                </button>

                                {member.id !== currentUser?.user_id && (
                                  <button
                                    onClick={() => handleRemoveMember(member.id)}
                                    className="inline-flex items-center px-2.5 py-1.5 border border-red-300 shadow-sm text-xs font-medium rounded text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                                  >
                                    停用
                                  </button>
                                )}
                              </>
                            ) : (
                              <button
                                onClick={() => handleReactivateMember(member.id)}
                                className="inline-flex items-center px-2.5 py-1.5 border border-green-300 shadow-sm text-xs font-medium rounded text-green-700 bg-white hover:bg-green-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500"
                              >
                                重新啟用
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </li>
            ))
          )}
        </ul>
        </div>
      </div>

      {/* Invite Member Modal */}
      {showInviteModal && (
        <InviteMemberModal
          onClose={() => setShowInviteModal(false)}
          onInvite={handleInviteMember}
          inviting={inviting}
        />
      )}

      {/* Edit Roles Modal */}
      {showRoleModal && (
        <EditRolesModal
          member={showRoleModal}
          onClose={() => setShowRoleModal(null)}
          onUpdate={handleUpdateRoles}
          updating={updatingRoles}
        />
      )}
    </div>
  );
};

// Invite Member Modal Component
interface InviteMemberModalProps {
  onClose: () => void;
  onInvite: (inviteData: MemberInviteData) => Promise<{ signup_url: string; expires_at: string }>;
  inviting: boolean;
}

const InviteMemberModal: React.FC<InviteMemberModalProps> = ({ onClose, onInvite, inviting }) => {
  const [formData, setFormData] = useState<MemberInviteData>({
    default_roles: ['practitioner']
  });
  const [signupLink, setSignupLink] = useState<string | null>(null);
  const [linkExpiry, setLinkExpiry] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Allow empty roles for read-only access
    const response = await onInvite(formData);
    setSignupLink(response.signup_url);
    setLinkExpiry(response.expires_at);
  };

  const handleRoleChange = (role: UserRole, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      default_roles: checked
        ? [...prev.default_roles, role]
        : prev.default_roles.filter(r => r !== role)
    }));
  };

  const copyToClipboard = async () => {
    if (signupLink) {
      try {
        await navigator.clipboard.writeText(signupLink);
        await alert('邀請連結已複製到剪貼簿');
      } catch (err) {
        logger.error('Failed to copy:', err);
        await alert('複製失敗，請手動複製連結');
      }
    }
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
                邀請新成員
              </h3>

              {!signupLink ? (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <fieldset>
                      <legend className="text-sm font-medium text-gray-700">角色權限</legend>
                      <div className="mt-2 space-y-2">
                        <div className="flex items-center">
                          <input
                            id="role-admin"
                            name="admin"
                            type="checkbox"
                            checked={formData.default_roles.includes('admin')}
                            onChange={(e) => handleRoleChange('admin', e.target.checked)}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <label htmlFor="role-admin" className="ml-3 text-sm text-gray-700">
                            <span className="font-medium">管理員</span> - 完整診所管理權限
                          </label>
                        </div>
                        <div className="flex items-center">
                          <input
                            id="role-practitioner"
                            name="practitioner"
                            type="checkbox"
                            checked={formData.default_roles.includes('practitioner')}
                            onChange={(e) => handleRoleChange('practitioner', e.target.checked)}
                            className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                          />
                          <label htmlFor="role-practitioner" className="ml-3 text-sm text-gray-700">
                            <span className="font-medium">治療師</span> - 預約管理
                          </label>
                        </div>
                        <div className="mt-2 text-xs text-gray-500">
                          <p>💡 提示：如果都不選擇，新成員將獲得唯讀存取權限，可以查看診所資料但無法進行修改。</p>
                        </div>
                      </div>
                    </fieldset>
                  </div>

                  <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                    <button
                      type="submit"
                      disabled={inviting}
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                    >
                      {inviting ? '生成中...' : '生成邀請連結'}
                    </button>
                    <button
                      type="button"
                      onClick={onClose}
                      className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:mt-0 sm:w-auto sm:text-sm"
                    >
                      取消
                    </button>
                  </div>
                </form>
              ) : (
                <div className="space-y-4">
                  <div className="bg-green-50 border border-green-200 rounded-md p-4">
                    <div className="flex">
                      <div className="flex-shrink-0">
                        <svg className="h-5 w-5 text-green-400" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      </div>
                      <div className="ml-3">
                        <h3 className="text-sm font-medium text-green-800">邀請連結已生成</h3>
                        <div className="mt-2 text-sm text-green-700">
                          <p>請將此連結分享給新成員，他們將透過 Google 帳號完成註冊。</p>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      邀請連結
                    </label>
                    <div className="flex rounded-md border border-gray-300 shadow-sm">
                      <input
                        type="text"
                        value={signupLink}
                        readOnly
                        className="flex-1 block w-full border-0 rounded-l-md shadow-none focus:ring-0 focus:border-0 sm:text-sm px-3 py-2 bg-white"
                      />
                      <button
                        type="button"
                        onClick={copyToClipboard}
                        className="inline-flex items-center px-3 py-2 border-0 border-l border-gray-300 rounded-r-md bg-white text-gray-500 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                        title="複製連結"
                      >
                        <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                  </div>

                  {linkExpiry && (
                    <div className="text-sm text-gray-500">
                      <span className="inline-flex items-center">
                        <svg className="h-4 w-4 mr-1" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                        </svg>
                        此連結將在 48 小時後過期
                      </span>
                    </div>
                  )}

                  <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                    <button
                      type="button"
                      onClick={onClose}
                      className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm"
                    >
                      關閉
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

// Edit Roles Modal Component
interface EditRolesModalProps {
  member: Member;
  onClose: () => void;
  onUpdate: (userId: number, roles: UserRole[]) => Promise<void>;
  updating: boolean;
}

const EditRolesModal: React.FC<EditRolesModalProps> = ({ member, onClose, onUpdate, updating }) => {
  const [roles, setRoles] = useState<UserRole[]>(member.roles);

  const handleRoleChange = (role: UserRole, checked: boolean) => {
    setRoles(prev => checked
      ? [...prev, role]
      : prev.filter(r => r !== role)
    );
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (roles.length > 0) {
      await onUpdate(member.id, roles);
    }
  };

  const hasRole = (role: UserRole) => roles.includes(role);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
        <div className="fixed inset-0 transition-opacity" aria-hidden="true">
          <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={onClose}></div>
        </div>

        <div className="inline-block align-bottom bg-white rounded-lg px-4 pt-5 pb-4 text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full sm:p-6">
          <div className="sm:flex sm:items-start">
            <div className="mt-3 text-center sm:mt-0 sm:text-left w-full">
              <h3 className="text-lg leading-6 font-medium text-gray-900 mb-2">
                編輯成員角色
              </h3>
              <p className="text-sm text-gray-500 mb-4">
                {member.full_name} ({member.email})
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                <fieldset>
                  <legend className="text-sm font-medium text-gray-700">角色權限</legend>
                  <div className="mt-2 space-y-3">
                    <div className="flex items-center">
                      <input
                        id="edit-role-admin"
                        name="admin"
                        type="checkbox"
                        checked={hasRole('admin')}
                        onChange={(e) => handleRoleChange('admin', e.target.checked)}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <label htmlFor="edit-role-admin" className="ml-3 text-sm text-gray-700">
                        <span className="font-medium">管理員</span> - 完整診所管理權限
                      </label>
                    </div>
                    <div className="flex items-center">
                      <input
                        id="edit-role-practitioner"
                        name="practitioner"
                        type="checkbox"
                        checked={hasRole('practitioner')}
                        onChange={(e) => handleRoleChange('practitioner', e.target.checked)}
                        className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                      />
                      <label htmlFor="edit-role-practitioner" className="ml-3 text-sm text-gray-700">
                        <span className="font-medium">治療師</span> - 預約管理
                      </label>
                    </div>
                  </div>
                </fieldset>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={updating || roles.length === 0}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {updating ? '更新中...' : '更新角色'}
                  </button>
                  <button
                    type="button"
                    onClick={onClose}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:mt-0 sm:w-auto sm:text-sm"
                  >
                    取消
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

export default MembersPage;
