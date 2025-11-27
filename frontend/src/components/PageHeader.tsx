import React, { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  action?: ReactNode;
  className?: string;
}

const PageHeader: React.FC<PageHeaderProps> = React.memo(({ title, action, className = '' }) => {
  return (
    <div className={`mb-2 md:mb-8 flex flex-col md:flex-row md:justify-between md:items-center gap-3 ${className}`}>
      {title && <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{title}</h1>}
      {action && <div className="w-full md:w-auto">{action}</div>}
    </div>
  );
});

export default PageHeader;
