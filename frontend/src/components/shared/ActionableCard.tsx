import React, { ReactNode } from 'react';

export interface CardAction {
    label: string;
    onClick: (e: React.MouseEvent) => void;
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    icon?: ReactNode;
    disabled?: boolean;
    isLoading?: boolean;
}

export interface CardMetadataItem {
    icon?: ReactNode;
    label: string | ReactNode;
    title?: string;
    variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
}

interface ActionableCardProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'title'> {
    title: string | ReactNode;
    description?: string | ReactNode;
    actions?: CardAction[];
    metadata?: CardMetadataItem[];
    onClick?: (e: React.MouseEvent<HTMLDivElement>) => void;
    isDeleted?: boolean;
    className?: string;
    badge?: ReactNode;
    leading?: ReactNode;
}

export const ActionableCard: React.FC<ActionableCardProps> = ({
    title,
    description,
    actions = [],
    metadata = [],
    onClick,
    isDeleted = false,
    className = '',
    badge,
    leading,
    ...props
}) => {
    const isClickable = !!onClick && !isDeleted;

    const getActionStyles = (variant: CardAction['variant'] = 'secondary') => {
        const baseStyles = 'px-3 py-1.5 text-sm rounded-lg transition-all duration-200 font-medium whitespace-nowrap';
        switch (variant) {
            case 'primary':
                return `${baseStyles} bg-primary-600 text-white hover:bg-primary-700 shadow-sm`;
            case 'danger':
                return `${baseStyles} bg-red-50 text-red-600 hover:bg-red-100 border border-red-100`;
            case 'ghost':
                return `${baseStyles} text-gray-500 hover:bg-gray-100`;
            case 'secondary':
            default:
                return `${baseStyles} bg-primary-50 text-primary-600 hover:bg-primary-100 border border-primary-100`;
        }
    };

    const getMetadataStyles = (variant: CardMetadataItem['variant'] = 'default') => {
        switch (variant) {
            case 'success':
                return 'text-green-600 bg-green-50 px-1.5 py-0.5 rounded-md font-medium';
            case 'warning':
                return 'text-yellow-600 bg-yellow-50 px-1.5 py-0.5 rounded-md font-medium';
            case 'danger':
                return 'text-red-600 bg-red-50 px-1.5 py-0.5 rounded-md font-medium';
            case 'info':
                return 'text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded-md font-medium';
            default:
                return 'text-gray-500';
        }
    };

    return (
        <div
            {...props}
            role={isClickable ? "button" : undefined}
            tabIndex={isClickable ? 0 : undefined}
            onClick={(e) => {
                if (isClickable && onClick) onClick(e);
            }}
            onKeyDown={(e) => {
                if (isClickable && onClick && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault();
                    onClick(e as unknown as React.MouseEvent<HTMLDivElement>);
                }
            }}
            className={`p-4 border rounded-lg transition-all duration-200 outline-none ${isDeleted ? 'bg-gray-50 border-gray-300 opacity-75' : 'bg-white border-gray-200'
                } ${isClickable ? 'hover:border-primary-400 hover:shadow-md cursor-pointer focus:ring-2 focus:ring-primary-500 focus:border-primary-500' : ''
                } ${className}`}
        >
            <div className="flex justify-between items-start mb-3 gap-3">
                {leading && (
                    <div className="shrink-0 mt-0.5">
                        {leading}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                        {typeof title === 'string' ? (
                            <h4 className="text-base font-semibold text-gray-900 truncate">
                                {title}
                            </h4>
                        ) : (
                            title
                        )}
                        {badge}
                    </div>
                    {description && (
                        <div className="text-sm text-gray-600">
                            {description}
                        </div>
                    )}
                </div>

                {actions.length > 0 && (
                    <div
                        className="flex items-center gap-1.5 shrink-0"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {actions.map((action, index) => (
                            <button
                                key={`${action.label}-${index}`}
                                onClick={action.onClick}
                                disabled={action.disabled || action.isLoading}
                                className={getActionStyles(action.variant)}
                            >
                                {action.isLoading ? (
                                    <div className="flex items-center gap-1.5">
                                        <svg className="animate-spin h-4 w-4" fill="none" viewBox="0 0 24 24">
                                            <circle
                                                className="opacity-25"
                                                cx="12"
                                                cy="12"
                                                r="10"
                                                stroke="currentColor"
                                                strokeWidth="4"
                                            />
                                            <path
                                                className="opacity-75"
                                                fill="currentColor"
                                                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                                            />
                                        </svg>
                                        <span>{action.label}</span>
                                    </div>
                                ) : (
                                    action.label
                                )}
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {metadata.length > 0 && (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    {metadata.map((item, index) => (
                        <div
                            key={index}
                            className={`flex items-center gap-1.5 text-sm min-w-0 ${getMetadataStyles(item.variant)}`}
                            title={item.title}
                        >
                            {item.icon && (
                                <span className="shrink-0 text-gray-400">
                                    {item.icon}
                                </span>
                            )}
                            <span className="truncate">{item.label}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
