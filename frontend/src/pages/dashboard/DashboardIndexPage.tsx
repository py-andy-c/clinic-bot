import React from 'react';
import { Link } from 'react-router-dom';

interface DashboardCard {
  name: string;
  path: string;
  icon: string;
  description: string;
}

const dashboardCards: DashboardCard[] = [
  {
    name: '業務洞察',
    path: 'business-insights',
    icon: '📊',
    description: '查看診所營收趨勢、服務項目表現和治療師績效',
  },
  {
    name: '診所分潤審核',
    path: 'revenue-distribution',
    icon: '💰',
    description: '審核和檢視診所分潤，確認計費方案選擇和金額覆寫',
  },
  {
    name: 'LINE 訊息統計',
    path: 'line-usage',
    icon: '💬',
    description: '查看 LINE 推播訊息和 AI 回覆訊息的使用情況',
  },
];

const DashboardIndexPage: React.FC = () => {
  return (
    <div className="max-w-4xl mx-auto">
      {/* Page Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">儀表板</h1>
        <p className="mt-2 text-sm text-gray-600">查看診所營運數據、會計資訊和系統使用情況</p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {dashboardCards.map((card) => (
          <Link
            key={card.path}
            to={`/admin/clinic/dashboard/${card.path}`}
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

export default DashboardIndexPage;



