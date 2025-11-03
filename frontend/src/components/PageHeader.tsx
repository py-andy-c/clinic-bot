import React, { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  action?: ReactNode;
  className?: string;
}

const PageHeader: React.FC<PageHeaderProps> = ({ title, action, className = '' }) => {
  return (
    <div className={`mb-2 md:mb-8 flex flex-row justify-between items-center gap-3 ${className}`}>
      <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{title}</h1>
      {action && <div>{action}</div>}
    </div>
  );
};

export default PageHeader;
