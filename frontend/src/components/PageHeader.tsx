import React, { ReactNode } from 'react';

interface PageHeaderProps {
  title: string;
  action?: ReactNode;
  className?: string;
}

const PageHeader: React.FC<PageHeaderProps> = React.memo(({ title, action, className = '' }) => {
  return (
    <div className={`mb-4 md:mb-8 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${className}`}>
      {title && <h1 className="text-2xl md:text-3xl font-bold text-gray-900">{title}</h1>}
      {action && <div className="flex-shrink-0">{action}</div>}
    </div>
  );
});

export default PageHeader;
