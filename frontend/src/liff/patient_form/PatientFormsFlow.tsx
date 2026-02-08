import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { useLiffPatientForms } from '../../hooks/usePatientForms';
import { LoadingSpinner } from '../../components/shared/LoadingSpinner';
import { ErrorMessage } from '../components/StatusComponents';
import PatientFormPage from './PatientFormPage';

const PatientFormsFlow: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const token = searchParams.get('token');
  const { data: forms, isLoading, error, refetch } = useLiffPatientForms();

  const handleSelectForm = (accessToken: string) => {
    const newParams = new URLSearchParams(searchParams);
    newParams.set('token', accessToken);
    setSearchParams(newParams);
  };

  const handleBack = () => {
    const newParams = new URLSearchParams(searchParams);
    newParams.delete('token');
    setSearchParams(newParams);
    refetch();
  };

  if (token) {
    return <PatientFormPage accessToken={token} onBack={handleBack} />;
  }

  if (isLoading) return <LoadingSpinner />;
  if (error) return <ErrorMessage message="無法載入表單列表" onRetry={refetch} />;

  const pendingForms = forms?.filter(f => f.status === 'pending') || [];
  const submittedForms = forms?.filter(f => f.status === 'submitted') || [];

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="bg-white px-4 py-4 border-b sticky top-0 z-10">
        <h1 className="text-lg font-bold text-center">填寫表單</h1>
      </div>

      <div className="p-4 space-y-6">
        <section>
          <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">待填寫</h2>
          {pendingForms.length === 0 ? (
            <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
              <div className="text-4xl mb-2">🎉</div>
              <p className="text-gray-500">目前沒有待填寫的表單</p>
            </div>
          ) : (
            <div className="space-y-3">
              {pendingForms.map(form => (
                <button
                  key={form.id}
                  onClick={() => handleSelectForm(form.access_token)}
                  className="w-full bg-white p-4 rounded-xl border border-gray-200 shadow-sm text-left flex items-center justify-between group active:bg-gray-50"
                >
                  <div>
                    <div className="font-bold text-gray-900">{form.template_name}</div>
                    <div className="text-xs text-gray-500 mt-1">發送於 {new Date(form.sent_at).toLocaleDateString('zh-TW')}</div>
                  </div>
                  <div className="bg-primary-50 text-primary-600 px-3 py-1 rounded-full text-xs font-bold">
                    填寫
                  </div>
                </button>
              ))}
            </div>
          )}
        </section>

        {submittedForms.length > 0 && (
          <section>
            <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wider">已提交</h2>
            <div className="space-y-3">
              {submittedForms.map(form => (
                <button
                  key={form.id}
                  onClick={() => handleSelectForm(form.access_token)}
                  className="w-full bg-white p-4 rounded-xl border border-gray-200 shadow-sm text-left flex items-center justify-between active:bg-gray-50 opacity-80"
                >
                  <div>
                    <div className="font-medium text-gray-700">{form.template_name}</div>
                    <div className="text-xs text-gray-500 mt-1">提交於 {new Date(form.submitted_at!).toLocaleDateString('zh-TW')}</div>
                  </div>
                  <div className="text-gray-400">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
};

export default PatientFormsFlow;
