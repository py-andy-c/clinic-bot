import React, { useState, useRef, useEffect } from 'react';
import { clsx } from 'clsx';

export interface ActionMenuItem {
    label: string;
    icon: React.ReactNode;
    onClick: () => void;
    variant?: 'danger' | 'primary' | 'secondary' | 'default';
}

interface ActionMenuProps {
    items: ActionMenuItem[];
    triggerClassName?: string;
}

export const ActionMenu: React.FC<ActionMenuProps> = ({ items, triggerClassName }) => {
    const [isOpen, setIsOpen] = useState(false);
    const menuRef = useRef<HTMLDivElement>(null);

    // Close when clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // Close on Escape key
    useEffect(() => {
        const handleEsc = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setIsOpen(false);
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, []);

    const handleItemClick = (onClick: () => void) => {
        setIsOpen(false);
        onClick();
    };

    return (
        <div className="relative inline-block text-left" ref={menuRef}>
            <button
                onClick={() => setIsOpen(!isOpen)}
                className={clsx(
                    "flex items-center justify-between gap-2 px-4 py-2 rounded-lg bg-white border border-primary-200 text-primary-700 hover:bg-primary-50 hover:border-primary-300 shadow-sm transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2 font-semibold text-sm",
                    isOpen && "bg-primary-50 ring-2 ring-primary-500 ring-offset-2",
                    triggerClassName
                )}
                aria-haspopup="true"
                aria-expanded={isOpen}
                aria-label="操作選單"
            >
                <span>操作</span>
                <svg
                    className={clsx("w-4 h-4 transition-transform duration-200", isOpen && "rotate-180")}
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>

            {isOpen && (
                <>
                    {/* Mobile Overlay Background */}
                    <div className="fixed inset-0 z-40 bg-black/20 md:hidden animate-in fade-in duration-200" onClick={() => setIsOpen(false)} />

                    {/* Menu Container */}
                    <div className={clsx(
                        "fixed inset-x-4 bottom-8 z-50 mt-2 origin-bottom md:absolute md:inset-auto md:right-0 md:top-full md:bottom-auto md:w-56 md:origin-top-right rounded-2xl md:rounded-xl bg-white shadow-2xl md:shadow-lg border border-gray-100 ring-1 ring-black/5 focus:outline-none overflow-hidden animate-in slide-in-from-bottom-5 md:slide-in-from-top-2 duration-300 ease-out"
                    )}>
                        <div className="py-1" role="menu" aria-orientation="vertical">
                            <div className="px-4 py-3 border-b border-gray-50 md:hidden">
                                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">操作選單</p>
                            </div>
                            {items.map((item, index) => (
                                <button
                                    key={index}
                                    onClick={() => handleItemClick(item.onClick)}
                                    className={clsx(
                                        "flex items-center w-full px-4 py-3 md:py-2.5 text-sm transition-colors duration-150 group",
                                        item.variant === 'danger'
                                            ? "text-red-600 hover:bg-red-50"
                                            : item.variant === 'primary'
                                                ? "text-primary-600 hover:bg-primary-50"
                                                : "text-gray-700 hover:bg-gray-50"
                                    )}
                                    role="menuitem"
                                >
                                    <span className={clsx(
                                        "mr-3 transition-transform duration-200 group-hover:scale-110",
                                        item.variant === 'danger' ? "text-red-500" : "text-gray-400 group-hover:text-primary-500"
                                    )}>
                                        {item.icon}
                                    </span>
                                    <span className="font-medium">{item.label}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};
