import React from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../hooks/useAuth';

interface SettingCard {
  name: string;
  path: string;
  icon: string;
  description: string;
  adminOnly?: boolean;
}

const settingCards: SettingCard[] = [
  {
    name: '服務項目',
    path: 'service-items',
    icon: '📋',
    description: '管理診所提供的服務項目',
  },
  {
    name: '預約設定',
    path: 'appointments',
    icon: '📅',
    description: '設定預約規則和限制',
  },
  {
    name: '診所資訊',
    path: 'clinic-info',
    icon: '🏥',
    description: '設定診所的基本資訊和顯示名稱',
  },
  {
    name: 'LINE提醒',
    path: 'reminders',
    icon: '🔔',
    description: '設定預約提醒的時間和方式',
  },
  {
    name: 'AI 聊天',
    path: 'chat',
    icon: '💬',
    description: '管理 AI 聊天機器人的設定和行為',
  },
  {
    name: '收據設定',
    path: 'receipts',
    icon: '🧾',
    description: '自訂收據的格式和內容',
    adminOnly: true,
  },
  {
    name: '設備資源',
    path: 'resources',
    icon: '🏢',
    description: '管理診所的設備和資源（治療室、設備等）',
    adminOnly: true,
  },
];

const SettingsIndexPage: React.FC = () => {
  const { isClinicAdmin } = useAuth();

  const visibleCards = settingCards.filter(
    card => !card.adminOnly || isClinicAdmin
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {visibleCards.map((card) => (
          <Link
            key={card.path}
            to={`/admin/clinic/settings/${card.path}`}
            className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 hover:shadow-md hover:border-primary-300 transition-all group"
          >
            <div className="flex items-start">
              <div className="flex-shrink-0">
                <span className="text-4xl">{card.icon}</span>
              </div>
              <div className="ml-4 flex-1">
                <h3 className="text-lg font-semibold text-gray-900 group-hover:text-primary-600 transition-colors">
                  {card.name}
                </h3>
                <p className="mt-2 text-sm text-gray-600">{card.description}</p>
              </div>
              <div className="flex-shrink-0 ml-4">
                <svg
                  className="h-5 w-5 text-gray-400 group-hover:text-primary-500 transition-colors"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
};

export default SettingsIndexPage;

