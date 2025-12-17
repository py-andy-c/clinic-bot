import React from 'react';
import { useNavigate } from 'react-router-dom';
import BackButton from './BackButton';
import { useUnsavedChanges } from '../contexts/UnsavedChangesContext';
import { useModal } from '../contexts/ModalContext';

const SettingsBackButton: React.FC = () => {
  const navigate = useNavigate();
  const { hasUnsavedChanges } = useUnsavedChanges();
  const { confirm } = useModal();

  const handleBack = async (e: React.MouseEvent) => {
    if (hasUnsavedChanges) {
      e.preventDefault();
      const confirmed = await confirm('您有未儲存的變更，確定要離開嗎？', '確認離開');
      if (confirmed) {
        navigate('/admin/clinic/settings');
      }
    }
  };

  return (
    <div onClick={handleBack} className="inline-block">
      <BackButton to="/admin/clinic/settings" label="返回設定選單" />
    </div>
  );
};

export default SettingsBackButton;
