import React from 'react';
import { apiService } from '../services/api';
import SignupPage from '../components/SignupPage';

const ClinicSignupPage: React.FC = () => {
  const handleSignup = async (token: string) => {
    return await apiService.initiateClinicSignup(token);
  };

  return (
    <SignupPage
      signupType="clinic"
      title="加入診所管理系統"
      icon={<img src="/images/logo.svg" alt="Logo" className="h-full w-full" />}
      buttonText="使用 Google 帳號註冊"
      onSignup={handleSignup}
    />
  );
};

export default ClinicSignupPage;
