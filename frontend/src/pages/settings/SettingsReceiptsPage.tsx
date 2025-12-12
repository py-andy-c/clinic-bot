import React from 'react';
import { useSettings } from '../../contexts/SettingsContext';
import { useAuth } from '../../hooks/useAuth';
import { LoadingSpinner } from '../../components/shared';
import ReceiptSettings from '../../components/ReceiptSettings';
import SettingsBackButton from '../../components/SettingsBackButton';
import PageHeader from '../../components/PageHeader';

const SettingsReceiptsPage: React.FC = () => {
  const { settings, uiState, sectionChanges, saveData, updateData } = useSettings();
  const { isClinicAdmin } = useAuth();

  // Scroll to top when component mounts
  React.useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  if (uiState.loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <LoadingSpinner />
      </div>
    );
  }

  if (!settings) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">無法載入設定</p>
      </div>
    );
  }

  if (!isClinicAdmin) {
    return (
      <div className="text-center py-12">
        <p className="text-gray-600">只有診所管理員可以存取此設定</p>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <SettingsBackButton />
      <div className="flex justify-between items-center mb-6">
        <PageHeader title="收據設定" />
        {sectionChanges.receiptSettings && (
          <button
            type="button"
            onClick={saveData}
            disabled={uiState.saving}
            className="btn-primary text-sm px-4 py-2"
          >
            {uiState.saving ? '儲存中...' : '儲存更變'}
          </button>
        )}
      </div>
      <form onSubmit={(e) => { e.preventDefault(); saveData(); }} className="space-y-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6">
          <ReceiptSettings
            receiptSettings={settings.receipt_settings || { custom_notes: null, show_stamp: false }}
            onReceiptSettingsChange={(receiptSettings) => {
              updateData((prev) => ({
                ...prev,
                receipt_settings: receiptSettings
              }));
            }}
            isClinicAdmin={isClinicAdmin}
          />
        </div>

        {/* Error Display */}
        {uiState.error && (
          <div className="bg-white rounded-lg border border-red-200 shadow-sm p-6">
            <div className="p-4 bg-red-50 border border-red-200 rounded-md">
              <div className="flex">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800">錯誤</h3>
                  <div className="mt-2 text-sm text-red-700 whitespace-pre-line">
                    {uiState.error}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </form>
    </div>
  );
};

export default SettingsReceiptsPage;

