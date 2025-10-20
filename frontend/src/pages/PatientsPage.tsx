import React, { useState, useEffect } from 'react';
import { apiService } from '../services/api';
import { Patient } from '../types';

const PatientsPage: React.FC = () => {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchPatients();
  }, []);

  const fetchPatients = async () => {
    try {
      setLoading(true);
      const data = await apiService.getPatients();
      setPatients(data);
    } catch (err) {
      setError('無法載入病患列表');
      console.error('Fetch patients error:', err);
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">病患管理</h1>
        <p className="text-gray-600">查看已註冊的病患和 LINE 帳號連結狀態</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-md p-4">
          <p className="text-red-800">{error}</p>
        </div>
      )}

      {/* Patients List */}
      <div className="card">
        <div className="space-y-4">
          {patients.length === 0 ? (
            <div className="text-center py-8">
              <p className="text-gray-500">尚未有病患註冊</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      病患姓名
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      手機號碼
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      LINE 連結狀態
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      註冊時間
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {patients.map((patient) => (
                    <tr key={patient.id} className="hover:bg-gray-50">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center mr-3">
                            <span className="text-sm">👤</span>
                          </div>
                          <div className="text-sm font-medium text-gray-900">
                            {patient.full_name}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {patient.phone_number}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <div className={`w-2 h-2 rounded-full mr-2 ${
                            patient.line_user_id ? 'bg-green-500' : 'bg-gray-400'
                          }`}></div>
                          <span className={`text-sm ${
                            patient.line_user_id ? 'text-green-800' : 'text-gray-600'
                          }`}>
                            {patient.line_user_id ? '已連結' : '未連結'}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {new Date(patient.created_at).toLocaleDateString('zh-TW')}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      {patients.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="card">
            <div className="text-center">
              <div className="text-2xl font-bold text-gray-900">{patients.length}</div>
              <div className="text-sm text-gray-600">總病患數</div>
            </div>
          </div>
          <div className="card">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">
                {patients.filter(p => p.line_user_id).length}
              </div>
              <div className="text-sm text-gray-600">已連結 LINE</div>
            </div>
          </div>
          <div className="card">
            <div className="text-center">
              <div className="text-2xl font-bold text-blue-600">
                {patients.filter(p => !p.line_user_id).length}
              </div>
              <div className="text-sm text-gray-600">未連結 LINE</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default PatientsPage;
