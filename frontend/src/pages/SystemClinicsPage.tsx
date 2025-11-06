import React, { useState, useEffect } from 'react';
import { logger } from '../utils/logger';
import moment from 'moment-timezone';
import { Link, useParams } from 'react-router-dom';
import { apiService } from '../services/api';
import { Clinic, ClinicCreateData, ClinicHealth } from '../types';

const SystemClinicsPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [clinics, setClinics] = useState<Clinic[]>([]);
  const [selectedClinic, setSelectedClinic] = useState<Clinic | null>(null);
  const [clinicHealth, setClinicHealth] = useState<ClinicHealth | null>(null);
  const [loading, setLoading] = useState(true);
  // const [error, setError] = useState<string | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (id) {
      fetchClinicDetails(id);
    } else {
      fetchClinics();
    }
  }, [id]);

  const fetchClinics = async () => {
    try {
      setLoading(true);
      const data = await apiService.getClinics();

      // Validate that we received an array
      if (Array.isArray(data)) {
        setClinics(data);
      } else {
        setClinics([]);
      }
    } catch (err) {
      logger.error('Failed to load clinics:', err);
      setClinics([]);
    } finally {
      setLoading(false);
    }
  };

  const fetchClinicDetails = async (clinicId: string) => {
    try {
      setLoading(true);
      const [clinicData, healthData] = await Promise.all([
        apiService.getClinicDetails(parseInt(clinicId)),
        apiService.getClinicHealth(parseInt(clinicId))
      ]);
      setSelectedClinic(clinicData);
      setClinicHealth(healthData);
    } catch (err) {
      // setError('Failed to load clinic details');
      logger.error('Clinic details error:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateClinic = async (clinicData: ClinicCreateData) => {
    try {
      setCreating(true);
      const newClinic = await apiService.createClinic(clinicData);
      setClinics(prev => [...prev, newClinic]);
      setShowCreateModal(false);
    } catch (err) {
      logger.error('Create clinic error:', err);
      alert('建立診所失敗，請稍後再試。');
    } finally {
      setCreating(false);
    }
  };

  const handleGenerateSignupLink = async (clinicId: number) => {
    try {
      const result = await apiService.generateClinicSignupLink(clinicId);
      // Copy to clipboard with fallback
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(result.signup_url);
        alert('註冊連結已複製到剪貼簿！');
      } else {
        // Fallback for browsers/environments without Clipboard API
        const textArea = document.createElement('textarea');
        textArea.value = result.signup_url;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();
        try {
          document.execCommand('copy');
          alert('註冊連結已複製到剪貼簿！');
        } catch (fallbackErr) {
          // If fallback also fails, show the URL to user
          alert(`註冊連結：\n${result.signup_url}\n\n請手動複製此連結。`);
        }
        document.body.removeChild(textArea);
      }
    } catch (err) {
      logger.error('Generate signup link error:', err);
      alert('產生註冊連結失敗，請稍後再試。');
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
        <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-primary-600"></div>
      </div>
    );
  }

  // Show clinic details view
  if (selectedClinic && clinicHealth) {
    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="md:flex md:items-center md:justify-between">
          <div className="min-w-0 flex-1">
            <h2 className="text-2xl font-bold leading-7 text-gray-900 sm:truncate sm:text-3xl sm:tracking-tight">
              {selectedClinic.name}
            </h2>
            <p className="mt-1 text-sm text-gray-500">
              Clinic details and health monitoring
            </p>
          </div>
          <div className="mt-4 flex md:mt-0 md:ml-4">
            <button
              onClick={() => handleGenerateSignupLink(selectedClinic.id)}
              className="inline-flex items-center rounded-md bg-primary-600 px-3 py-2 text-sm font-semibold text-white shadow-sm hover:bg-primary-500 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600"
            >
              Generate Signup Link
            </button>
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
                    <dt className="text-sm font-medium text-gray-500 truncate">Webhooks (24h)</dt>
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
                    <dt className="text-sm font-medium text-gray-500 truncate">Integration Status</dt>
                    <dd className={`text-lg font-medium capitalize ${getHealthStatusColor(clinicHealth.line_integration_status)}`}>
                      {clinicHealth.line_integration_status}
                    </dd>
                  </dl>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Health Details */}
        <div className="bg-white shadow overflow-hidden sm:rounded-md">
          <div className="px-4 py-5 sm:px-6">
            <h3 className="text-lg leading-6 font-medium text-gray-900">Health Check Details</h3>
            <p className="mt-1 max-w-2xl text-sm text-gray-500">
              Detailed health monitoring for LINE integration
            </p>
          </div>
          <div className="border-t border-gray-200">
            <dl>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Webhook Activity</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${getHealthStatusColor(clinicHealth.webhook_status)}`}>
                    {clinicHealth.webhook_status}
                  </span>
                  <span className="ml-2">{clinicHealth.webhook_count_24h} webhooks in last 24 hours</span>
                </dd>
              </div>
              <div className="bg-white px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">Signature Verification</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {clinicHealth.signature_verification_capable ? (
                    <span className="text-green-600">✓ Capable</span>
                  ) : (
                    <span className="text-red-600">✗ Not capable</span>
                  )}
                </dd>
              </div>
              <div className="bg-gray-50 px-4 py-5 sm:grid sm:grid-cols-3 sm:gap-4 sm:px-6">
                <dt className="text-sm font-medium text-gray-500">API Connectivity</dt>
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
                <dt className="text-sm font-medium text-gray-500">Last Health Check</dt>
                <dd className="mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-2">
                  {moment.tz(clinicHealth.health_check_performed_at, 'Asia/Taipei').format('YYYY/MM/DD HH:mm:ss')}
                </dd>
              </div>
            </dl>
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
        {clinics.map((clinic) => (
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
                  to={`/system/clinics/${clinic.id}`}
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

      {clinics.length === 0 && (
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
    subscription_status: 'trial'
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
