import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import ProviderLayout from './components/ProviderLayout';
import ProviderDashboardPage from './pages/ProviderDashboardPage';
import ProviderClinicsPage from './pages/ProviderClinicsPage';

const ProviderApp: React.FC = () => {
  return (
    <ProviderLayout>
      <Routes>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="/dashboard" element={<ProviderDashboardPage />} />
        <Route path="/clinics" element={<ProviderClinicsPage />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </ProviderLayout>
  );
};

export default ProviderApp;
