import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { LoadingSpinner, ErrorMessage, SearchInput } from '../components/shared';
import moment from 'moment-timezone';
import { apiService } from '../services/api';
import { Patient } from '../types';
import { useAuth } from '../hooks/useAuth';
import { useApiData } from '../hooks/useApiData';
import { useHighlightRow } from '../hooks/useHighlightRow';
import PageHeader from '../components/PageHeader';
import { ClinicSettings } from '../schemas/api';

const PatientsPage: React.FC = () => {
  const navigate = useNavigate();
  const { isLoading, isAuthenticated, user } = useAuth();
  const activeClinicId = user?.active_clinic_id;

  // Memoize fetch functions to ensure stable cache keys
  const fetchPatients = useCallback(() => apiService.getPatients(), []);
  const fetchClinicSettings = useCallback(() => apiService.getClinicSettings(), []);

  const { data: patients, loading, error, refetch } = useApiData<Patient[]>(
    fetchPatients,
    {
      enabled: !isLoading && isAuthenticated,
      dependencies: [isLoading, isAuthenticated, activeClinicId],
      defaultErrorMessage: '無法載入病患列表',
      initialData: [],
    }
  );

  // Fetch clinic settings to check if birthday column should be shown
  // Use useApiData with caching to avoid redundant API calls
  const { data: clinicSettings } = useApiData<ClinicSettings>(
    fetchClinicSettings,
    {
      enabled: !isLoading && isAuthenticated,
      dependencies: [isLoading, isAuthenticated, activeClinicId],
      defaultErrorMessage: '無法載入診所設定',
      cacheTTL: 5 * 60 * 1000, // 5 minutes cache
    }
  );

  const requireBirthday = clinicSettings?.clinic_info_settings?.require_birthday || false;
  const [searchParams, setSearchParams] = useSearchParams();
  const hasHandledQueryRef = useRef(false);

  // Search functionality
  const [searchQuery, setSearchQuery] = useState<string>('');
  const filteredPatients = useMemo(() => {
    if (!searchQuery.trim()) return patients || [];
    const normalizedQuery = searchQuery.toLowerCase().trim();
    return (patients || []).filter(p =>
      p.full_name.toLowerCase().includes(normalizedQuery) ||
      p.phone_number?.toLowerCase().includes(normalizedQuery) ||
      p.line_user_display_name?.toLowerCase().includes(normalizedQuery)
    );
  }, [patients, searchQuery]);

  // Get patient ID to highlight from query parameter
  const patientNameFromQuery = searchParams.get('patientName');
  const targetPatientId = useMemo(() => {
    if (!patientNameFromQuery || !patients || patients.length === 0) return null;
    const matchingPatients = patients.filter(p => 
      p.full_name.toLowerCase().includes(patientNameFromQuery.toLowerCase())
    );
    const firstPatient = matchingPatients[0];
    return firstPatient ? firstPatient.id.toString() : null;
  }, [patientNameFromQuery, patients]);

  // Use highlight hook for navigation from Line Users page
  const highlightedPatientId = useHighlightRow(targetPatientId, 'data-patient-id');

  // Handle navigation from Line Users page
  useEffect(() => {
    if (patientNameFromQuery && patients && patients.length > 0 && !hasHandledQueryRef.current) {
      // Mark as handled
      hasHandledQueryRef.current = true;
      
      // Auto-fill search with patient name
      setSearchQuery(patientNameFromQuery);
      
      // Remove query parameter after handling
      const newSearchParams = new URLSearchParams(searchParams);
      newSearchParams.delete('patientName');
      setSearchParams(newSearchParams, { replace: true });
    }
    
    // Reset ref when patientName query is removed
    if (!patientNameFromQuery) {
      hasHandledQueryRef.current = false;
    }
  }, [patientNameFromQuery, patients, searchParams, setSearchParams]);

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
        <PageHeader title="病患管理" />
        <ErrorMessage message={error} onRetry={refetch} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <PageHeader title="病患管理" />

      <div className="space-y-8">
        {/* Patients List */}
        <div className="bg-white rounded-lg shadow-md p-6">
        <div className="space-y-4">
          {/* Search Bar */}
          <SearchInput
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="搜尋病患姓名、電話或LINE使用者名稱..."
          />
          
          {!patients || patients.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">尚未有病患註冊</p>
            </div>
          ) : filteredPatients.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">找不到符合搜尋條件的病患</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky left-0 z-10 bg-gray-50">
                      病患姓名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      手機號碼
                    </th>
                    {requireBirthday && (
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                        生日
                      </th>
                    )}
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      LINE 使用者
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      註冊時間
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      操作
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {filteredPatients.map((patient) => (
                    <tr 
                      key={patient.id} 
                      data-patient-id={patient.id}
                      className={`group hover:bg-gray-50 transition-colors ${
                        highlightedPatientId === patient.id.toString() ? 'bg-blue-50' : ''
                      }`}
                    >
                      <td className="px-6 py-4 whitespace-nowrap sticky left-0 z-10 bg-white group-hover:bg-gray-50">
                        <div className="text-sm font-medium text-gray-900">
                          {patient.full_name}
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {patient.phone_number}
                      </td>
                      {requireBirthday && (
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {patient.birthday ? moment(patient.birthday).format('YYYY/MM/DD') : '-'}
                        </td>
                      )}
                      <td className="px-6 py-4 whitespace-nowrap">
                        {patient.line_user_id ? (
                          <button
                            onClick={() => {
                              const lineUserId = patient.line_user_id;
                              if (lineUserId) {
                                navigate(`/admin/clinic/line-users?lineUserId=${encodeURIComponent(lineUserId)}`);
                              }
                            }}
                            className="text-sm text-blue-600 hover:text-blue-800 hover:underline font-medium"
                          >
                            {patient.line_user_display_name || '未設定名稱'}
                          </button>
                        ) : (
                          <span className="text-sm text-gray-500">-</span>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {moment.tz(patient.created_at, 'Asia/Taipei').format('YYYY/MM/DD')}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm">
                        <button
                          onClick={() => {
                            // Navigate to calendar page with pre-selected patient (client-side navigation)
                            navigate(`/admin/calendar?createAppointment=${patient.id}`);
                          }}
                          className="text-blue-600 hover:text-blue-800 font-medium"
                        >
                          新增預約
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
};

export default PatientsPage;
