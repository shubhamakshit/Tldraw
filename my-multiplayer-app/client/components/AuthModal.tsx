import { useState } from 'react'
import { useAuth } from '../hooks/useAuth'
import { colors } from '../constants/theme'

interface AuthModalProps {
    isOpen: boolean
    onClose: () => void
}

export function AuthModal({ isOpen, onClose }: AuthModalProps) {
    const { login } = useAuth()
    const [isLogin, setIsLogin] = useState(true)
    const [username, setUsername] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [isLoading, setIsLoading] = useState(false)

    if (!isOpen) return null

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault()
        setError('')
        setIsLoading(true)

        try {
            const endpoint = isLogin ? '/api/auth/login' : '/api/auth/register'

            const res = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password })
            })

            if (!res.ok) {
                const text = await res.text()
                throw new Error(text || 'Authentication failed')
            }

            const data = await res.json() as any

            if (isLogin) {
                login(data.username, data.token)
                onClose()
            } else {
                // After register, switch to login or auto-login?
                // The backend register returns { success: true, username }
                // Let's just switch to login view and show success message
                setIsLogin(true)
                setError('Registration successful! Please log in.')
                setPassword('')
            }
        } catch (e: any) {
            setError(e.message)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: colors.overlay,
            backdropFilter: 'blur(2px)',
        }}>
            <div style={{
                background: '#1a1a1a', // Dark theme by default for the modal
                border: '1px solid #333',
                borderRadius: 12,
                padding: 32,
                width: '100%',
                maxWidth: 400,
                color: '#fff',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
                        {isLogin ? 'Welcome Back' : 'Create Account'}
                    </h2>
                    <button
                        onClick={onClose}
                        style={{ background: 'none', border: 'none', color: '#666', cursor: 'pointer', fontSize: '1.5rem' }}
                    >
                        &times;
                    </button>
                </div>

                {error && (
                    <div style={{
                        padding: '12px', background: 'rgba(255, 50, 50, 0.1)',
                        border: '1px solid rgba(255, 50, 50, 0.3)', borderRadius: 6,
                        color: '#ff6b6b', fontSize: '0.9rem', marginBottom: 20
                    }}>
                        {error}
                    </div>
                )}

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: 8, fontWeight: 600 }}>USERNAME</label>
                        <input
                            type="text"
                            value={username}
                            onChange={e => setUsername(e.target.value)}
                            required
                            style={{
                                width: '100%', padding: '12px', background: '#222',
                                border: '1px solid #333', borderRadius: 6, color: '#fff',
                                outline: 'none', fontSize: '1rem'
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = '#555'}
                            onBlur={e => e.currentTarget.style.borderColor = '#333'}
                        />
                    </div>
                    <div>
                        <label style={{ display: 'block', fontSize: '0.8rem', color: '#888', marginBottom: 8, fontWeight: 600 }}>PASSWORD</label>
                        <input
                            type="password"
                            value={password}
                            onChange={e => setPassword(e.target.value)}
                            required
                            style={{
                                width: '100%', padding: '12px', background: '#222',
                                border: '1px solid #333', borderRadius: 6, color: '#fff',
                                outline: 'none', fontSize: '1rem'
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = '#555'}
                            onBlur={e => e.currentTarget.style.borderColor = '#333'}
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={isLoading}
                        style={{
                            marginTop: 8, padding: '14px', background: colors.selected, color: '#fff',
                            border: 'none', borderRadius: 6, fontWeight: 600, fontSize: '1rem',
                            cursor: isLoading ? 'not-allowed' : 'pointer', opacity: isLoading ? 0.7 : 1
                        }}
                    >
                        {isLoading ? 'Processing...' : (isLogin ? 'Log In' : 'Sign Up')}
                    </button>
                </form>

                <div style={{ marginTop: 24, textAlign: 'center', fontSize: '0.9rem', color: '#888' }}>
                    {isLogin ? "Don't have an account? " : "Already have an account? "}
                    <button
                        onClick={() => { setIsLogin(!isLogin); setError(''); }}
                        style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', textDecoration: 'underline' }}
                    >
                        {isLogin ? 'Sign up' : 'Log in'}
                    </button>
                </div>
            </div>
        </div>
    )
}
