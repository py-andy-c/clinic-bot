import React, { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { apiService } from '../services/api';
import { Member, UserRole, MemberInviteData } from '../types';

const MembersPage: React.FC = () => {
  const { isClinicAdmin } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showRoleModal, setShowRoleModal] = useState<Member | null>(null);
  const [inviting, setInviting] = useState(false);
  const [updatingRoles, setUpdatingRoles] = useState(false);

  useEffect(() => {
    fetchMembers();
  }, []);

  const fetchMembers = async () => {
    try {
      setLoading(true);
      const data = await apiService.getMembers();
      setMembers(data);
    } catch (err) {
      setError('無法載入成員列表');
      console.error('Fetch members error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleInviteMember = async (inviteData: MemberInviteData) => {
    try {
      setInviting(true);
      await apiService.inviteMember(inviteData);
      setShowInviteModal(false);
      await fetchMembers(); // Refresh the list
    } catch (err) {
      console.error('Invite member error:', err);
      alert('邀請成員失敗，請稍後再試');
    } finally {
      setInviting(false);
    }
  };

  const handleUpdateRoles = async (userId: number, roles: UserRole[]) => {
    try {
      setUpdatingRoles(true);
      await apiService.updateMemberRoles(userId, roles);
      setShowRoleModal(null);
      await fetchMembers(); // Refresh the list
    } catch (err) {
      console.error('Update roles error:', err);
      alert('更新角色失敗，請稍後再試');
    } finally {
      setUpdatingRoles(false);
    }
  };

  const handleRemoveMember = async (userId: number) => {
    if (!confirm('確定要移除此成員嗎？此操作無法復原。')) {
      return;
    }

    try {
      await apiService.removeMember(userId);
      await fetchMembers(); // Refresh the list
    } catch (err) {
      console.error('Remove member error:', err);
      alert('移除成員失敗，請稍後再試');
    }
  };

  const handleGcalAuth = async (userId: number) => {
    try {
      const response = await apiService.initiateMemberGcalAuth(userId);
      window.open(response.auth_url, '_blank');
    } catch (err) {
      console.error('GCal auth error:', err);
      alert('啟動 Google Calendar 授權失敗');
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
    return '一般使用者';
  };

  const getRoleColor = (roles: UserRole[]) => {
    if (roles.includes('admin')) {
      return 'bg-red-100 text-red-800';
    } else if (roles.includes('practitioner')) {
      return 'bg-blue-100 text-blue-800';
    }
    return 'bg-gray-100 text-gray-800';
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="md:flex md:items-center md:justify-between">
        <div className="min-w-0 flex-1">
          <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
            成員管理
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            管理診所成員及其角色權限
          </p>
        </div>
        <div className="mt-4 flex md:mt-0 md:ml-4">
          <button
            onClick={() => setShowInviteModal(true)}
            disabled={!isClinicAdmin}
            className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <svg className="-ml-0.5 mr-1.5 h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
            </svg>
            邀請新成員
          </button>
        </div>
      </div>

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
      <div className="bg-white shadow overflow-hidden sm:rounded-md">
        <ul role="list" className="divide-y divide-gray-200">
          {members.length === 0 ? (
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
            members.map((member) => (
              <li key={member.id}>
                <div className="px-4 py-4 sm:px-6">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center">
                      <div className="flex-shrink-0">
                        <div className="w-10 h-10 bg-primary-100 rounded-full flex items-center justify-center">
                          <span className="text-lg">
                            {member.roles.includes('admin') ? '👑' : member.roles.includes('practitioner') ? '👨‍⚕️' : '👤'}
                          </span>
                        </div>
                      </div>
                      <div className="ml-4">
                        <div className="text-sm font-medium text-gray-900">{member.full_name}</div>
                        <div className="text-sm text-gray-500">{member.email}</div>
                        <div className="mt-1">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getRoleColor(member.roles)}`}>
                            {getRoleDisplay(member.roles)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3">
                      {/* Google Calendar Status */}
                      <div className="flex items-center space-x-2">
                        <div className={`w-2 h-2 rounded-full ${member.gcal_sync_enabled ? 'bg-green-500' : 'bg-gray-400'}`}></div>
                        <span className="text-sm text-gray-600 hidden sm:inline">
                          {member.gcal_sync_enabled ? 'Calendar 已同步' : 'Calendar 未同步'}
                        </span>
                      </div>

                      {/* Actions */}
                      <div className="flex items-center space-x-2">
                        {member.roles.includes('practitioner') && !member.gcal_sync_enabled && (
                          <button
                            onClick={() => handleGcalAuth(member.id)}
                            className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                          >
                            設定 Calendar
                          </button>
                        )}

                        {isClinicAdmin && (
                          <>
                            <button
                              onClick={() => setShowRoleModal(member)}
                              className="inline-flex items-center px-2.5 py-1.5 border border-gray-300 shadow-sm text-xs font-medium rounded text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500"
                            >
                              編輯角色
                            </button>

                            <button
                              onClick={() => handleRemoveMember(member.id)}
                              className="inline-flex items-center px-2.5 py-1.5 border border-red-300 shadow-sm text-xs font-medium rounded text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                            >
                              移除
                            </button>
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
  onInvite: (inviteData: MemberInviteData) => Promise<void>;
  inviting: boolean;
}

const InviteMemberModal: React.FC<InviteMemberModalProps> = ({ onClose, onInvite, inviting }) => {
  const [formData, setFormData] = useState<MemberInviteData>({
    email: '',
    name: '',
    roles: ['practitioner']
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (formData.email && formData.name && formData.roles.length > 0) {
      await onInvite(formData);
    }
  };

  const handleRoleChange = (role: UserRole, checked: boolean) => {
    setFormData(prev => ({
      ...prev,
      roles: checked
        ? [...prev.roles, role]
        : prev.roles.filter(r => r !== role)
    }));
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

              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label htmlFor="name" className="block text-sm font-medium text-gray-700">
                    成員姓名
                  </label>
                  <input
                    type="text"
                    name="name"
                    id="name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>

                <div>
                  <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                    電子郵件
                  </label>
                  <input
                    type="email"
                    name="email"
                    id="email"
                    required
                    value={formData.email}
                    onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                    className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-primary-500 focus:border-primary-500 sm:text-sm"
                  />
                </div>

                <div>
                  <fieldset>
                    <legend className="text-sm font-medium text-gray-700">角色權限</legend>
                    <div className="mt-2 space-y-2">
                      <div className="flex items-center">
                        <input
                          id="role-admin"
                          name="admin"
                          type="checkbox"
                          checked={formData.roles.includes('admin')}
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
                          checked={formData.roles.includes('practitioner')}
                          onChange={(e) => handleRoleChange('practitioner', e.target.checked)}
                          className="h-4 w-4 text-primary-600 focus:ring-primary-500 border-gray-300 rounded"
                        />
                        <label htmlFor="role-practitioner" className="ml-3 text-sm text-gray-700">
                          <span className="font-medium">治療師</span> - 預約管理和 Google Calendar 同步
                        </label>
                      </div>
                    </div>
                  </fieldset>
                </div>

                <div className="mt-5 sm:mt-4 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    disabled={inviting || !formData.email || !formData.name || formData.roles.length === 0}
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-primary-600 text-base font-medium text-white hover:bg-primary-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-primary-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50"
                  >
                    {inviting ? '邀請中...' : '發送邀請'}
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
                        <span className="font-medium">治療師</span> - 預約管理和 Google Calendar 同步
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
