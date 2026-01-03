import { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

interface ToastProps {
    message: string
    duration?: number
    type?: 'info' | 'success' | 'error'
    onClose: () => void
}

function Toast({ message, duration = 3000, type = 'info', onClose }: ToastProps) {
    const [visible, setVisible] = useState(false)

    useEffect(() => {
        // Trigger enter animation
        requestAnimationFrame(() => setVisible(true))

        const timer = setTimeout(() => {
            setVisible(false)
            // Wait for exit animation to finish before unmounting
            setTimeout(onClose, 300)
        }, duration)

        return () => clearTimeout(timer)
    }, [duration, onClose])

    const getBgColor = () => {
        switch (type) {
            case 'success': return '#10b981' // Green
            case 'error': return '#ef4444'   // Red
            default: return '#3b82f6'        // Blue
        }
    }

    return (
        <div style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: `translateX(-50%) translateY(${visible ? 0 : 20}px)`,
            opacity: visible ? 1 : 0,
            background: getBgColor(),
            color: '#fff',
            padding: '10px 20px',
            borderRadius: 8,
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            fontSize: '0.9rem',
            fontWeight: 500,
            zIndex: 10000,
            transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
            pointerEvents: 'none', // Allow clicks to pass through
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            minWidth: 200,
            justifyContent: 'center'
        }}>
            {type === 'success' && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
            )}
            {type === 'info' && (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
            )}
            {message}
        </div>
    )
}

export function showToast(message: string, options: { duration?: number, type?: 'info' | 'success' | 'error' } = {}) {
    const div = document.createElement('div')
    document.body.appendChild(div)
    const root = createRoot(div)

    const cleanup = () => {
        root.unmount()
        if (document.body.contains(div)) {
            document.body.removeChild(div)
        }
    }

    root.render(
        <Toast
            message={message}
            duration={options.duration}
            type={options.type}
            onClose={cleanup}
        />
    )
}
