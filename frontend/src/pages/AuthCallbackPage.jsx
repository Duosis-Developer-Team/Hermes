/**
 * =============================================================================
 * HERMES PLATFORM - Auth Callback Page
 * =============================================================================
 * Microsoft SSO dönüşünü karşılar.
 * URL'deki 'code' parametresini backend'e iletir ve token alır.
 * =============================================================================
 */

import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { message, Spin } from 'antd'
import { authService } from '../services/api'
import { useAuthStore } from '../stores/authStore'

function AuthCallbackPage() {
    const [searchParams] = useSearchParams()
    const navigate = useNavigate()
    const { login } = useAuthStore()
    const processed = useRef(false)

    useEffect(() => {
        const code = searchParams.get('code')

        if (!code) {
            message.error('Authorization code missing')
            navigate('/login')
            return
        }

        if (processed.current) return
        processed.current = true

        const handleLogin = async () => {
            try {
                // Backend'e authorization code'u gönder
                // Redirect URI, Azure'da kayıtlı olanla aynı olmalı
                const redirectUri = window.location.origin + '/auth/callback'

                // [KRİTİK-6] Backend artık token döndürmez; HttpOnly cookie set eder.
                // Response yalnızca { user } içerir. console.log'lar kaldırıldı.
                const data = await authService.microsoftLogin({
                    code,
                    redirect_uri: redirectUri
                })

                const user = data?.user
                if (!user) {
                    throw new Error("Could not load user information")
                }

                // Store'a yalnızca kullanıcı + organizasyon özeti
                // kaydedilir — token değil.
                login(user, user?.tenant || null)

                message.success('Signed in successfully.')
                navigate('/')
            } catch (error) {
                const detail = error?.response?.data?.detail || error?.message || 'Bilinmeyen hata'
                message.error(`Microsoft sign-in failed: ${detail}`, 8)
                navigate('/login')
            }
        }

        handleLogin()
    }, [searchParams, navigate, login])

    return (
        <div style={{
            height: '100vh',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: '#000',
            flexDirection: 'column',
            gap: 20
        }}>
            <Spin size="large" />
            <div style={{ color: '#fff', fontSize: 16 }}>Logging in with Microsoft...</div>
        </div>
    )
}

export default AuthCallbackPage
