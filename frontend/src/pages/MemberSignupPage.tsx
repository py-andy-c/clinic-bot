import React from 'react';
import { apiService } from '../services/api';
import SignupPage from '../components/SignupPage';

const MemberSignupPage: React.FC = () => {
  const handleSignup = async (token: string) => {
    return await apiService.initiateMemberSignup(token);
  };

  return (
    <SignupPage
      signupType="member"
      title="加入診所團隊"
      icon="👥"
      buttonText="使用 Google 帳號加入"
      onSignup={handleSignup}
    />
  );
};

export default MemberSignupPage;
