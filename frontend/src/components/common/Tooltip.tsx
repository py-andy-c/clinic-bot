import React, { useRef, useState, useEffect } from 'react';
import { createPortal } from 'react-dom';

interface TooltipProps {
    text: string;
    x: number;
    y: number;
    visible: boolean;
}

export const Tooltip: React.FC<TooltipProps> = ({ text, x, y, visible }) => {
    const tooltipRef = useRef<HTMLDivElement>(null);
    const [pos, setPos] = useState({ left: x + 12, top: y + 12 });

    useEffect(() => {
        if (visible && tooltipRef.current) {
            const rect = tooltipRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let newLeft = x + 12;
            let newTop = y + 12;

            // Right edge collision
            if (newLeft + rect.width > viewportWidth) {
                newLeft = x - rect.width - 12; // Flip to left of cursor
            }

            // Bottom edge collision
            if (newTop + rect.height > viewportHeight) {
                newTop = y - rect.height - 12; // Flip to above cursor
            }

            setPos({ left: newLeft, top: newTop });
        }
    }, [x, y, visible]);

    if (!visible) return null;

    return createPortal(
        <div
            ref={tooltipRef}
            className="fixed z-[9999] bg-gray-800/95 text-white px-2.5 py-1.5 rounded-md text-xs shadow-lg pointer-events-none whitespace-pre-wrap leading-tight max-w-[300px]"
            style={{
                left: pos.left,
                top: pos.top,
            }}
        >
            {text}
        </div>,
        document.body
    );
};
