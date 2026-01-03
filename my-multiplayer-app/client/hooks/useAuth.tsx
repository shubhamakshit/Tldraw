import { createContext, useContext, useState, useEffect, ReactNode } from 'react'

interface User {
    username: string
    token: string
}

interface AuthContextType {
    user: User | null
    isAuthenticated: boolean
    login: (username: string, token: string) => void
    logout: () => void
    token: string | null
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
    const [user, setUser] = useState<User | null>(null)

    useEffect(() => {
        // Check local storage on load
        const storedToken = localStorage.getItem('tldraw_auth_token')
        const storedUsername = localStorage.getItem('tldraw_auth_username')

        if (storedToken && storedUsername) {
            setUser({ username: storedUsername, token: storedToken })
        }
    }, [])

    const login = (username: string, token: string) => {
        localStorage.setItem('tldraw_auth_token', token)
        localStorage.setItem('tldraw_auth_username', username)
        setUser({ username, token })
    }

    const logout = () => {
        localStorage.removeItem('tldraw_auth_token')
        localStorage.removeItem('tldraw_auth_username')
        setUser(null)
    }

    return (
        <AuthContext.Provider value={{
            user,
            isAuthenticated: !!user,
            login,
            logout,
            token: user?.token || null
        }}>
            {children}
        </AuthContext.Provider>
    )
}

export function useAuth() {
    const context = useContext(AuthContext)
    if (context === undefined) {
        throw new Error('useAuth must be used within an AuthProvider')
    }
    return context
}
