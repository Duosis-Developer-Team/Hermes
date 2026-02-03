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

                const data = await authService.microsoftLogin({
                    code,
                    redirect_uri: redirectUri
                })

                console.log("SSO RESPONSE DATA:", data)

                const { access_token, user } = data
                console.log("Extracted Token:", access_token)
                console.log("Extracted User:", user)

                // Store'a kaydet
                if (!access_token) {
                    throw new Error("Access token missing in response")
                }
                login(access_token, user)

                message.success('Giriş başarılı!')
                navigate('/')
            } catch (error) {
                console.error('SSO Error:', error)
                message.error('Microsoft girişi başarısız oldu.')
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
