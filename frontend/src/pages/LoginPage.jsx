/**
 * =============================================================================
 * HERMES PLATFORM - Login Page
 * =============================================================================
 * Kullanıcı giriş sayfası. Jira tarzı minimalist tasarım.
 * =============================================================================
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Divider } from 'antd'
import { UserOutlined, LockOutlined, WindowsOutlined } from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { authService } from '../services/api'
import logoIcon from '../assets/logos/logo-icon-dark.jpg'
import './LoginPage.css'

/**
 * Login Page Component
 * 
 * E-posta ve şifre ile giriş yapılır.
 * Başarılı girişte token saklanır ve ana sayfaya yönlendirilir.
 */
function LoginPage() {
    const [loading, setLoading] = useState(false)
    const navigate = useNavigate()
    const { login } = useAuthStore()

    const handleSubmit = async (values) => {
        setLoading(true)
        try {
            // API'ye login isteği gönder
            const response = await authService.login(values.email, values.password)

            // [KRİTİK-6] Token cookie olarak backend'den geldi; store'a yalnızca user kaydedilir
            login(response.user)

            message.success('Login successful!')
            navigate('/time-entry')
        } catch (error) {
            const errorMsg = error.response?.data?.detail || 'Login failed. Please check your credentials.'
            message.error(errorMsg)
        } finally {
            setLoading(false)
        }
    }

    const handleMicrosoftLogin = () => {
        const tenantId = window._env_?.VITE_AZURE_TENANT_ID || import.meta.env.VITE_AZURE_TENANT_ID || 'common'
        const clientId = window._env_?.VITE_AZURE_CLIENT_ID || import.meta.env.VITE_AZURE_CLIENT_ID
        const redirectUri = window.location.origin + '/auth/callback'

        if (!clientId) {
            message.warning('Azure Client ID is missing from the web configuration')
            return
        }

        const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=User.Read&prompt=select_account`

        window.location.href = url
    }

    return (
        <div className="login-page">
            <div className="login-container">
                {/* Logo Section - Sadece çizme ikonu */}
                <div className="login-logo">
                    <img src={logoIcon} alt="Hermes" className="login-logo-image" />
                </div>

                {/* Login Card */}
                <div className="login-card">
                    <div className="login-header">
                        <h2>Sign in to your account</h2>
                        <p>Enter your credentials to continue</p>
                    </div>

                    <Form
                        name="login"
                        className="login-form"
                        onFinish={handleSubmit}
                        layout="vertical"
                        requiredMark={false}
                    >
                        <Form.Item
                            name="email"
                            label="Email"
                            rules={[
                                { required: true, message: 'Please enter your email' },
                                { type: 'email', message: 'Please enter a valid email address' }
                            ]}
                        >
                            <Input
                                prefix={<UserOutlined />}
                                placeholder="you@company.com"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            label="Password"
                            rules={[
                                { required: true, message: 'Please enter your password' }
                            ]}
                        >
                            <Input.Password
                                prefix={<LockOutlined />}
                                placeholder="Enter your password"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item>
                            <Button
                                type="primary"
                                htmlType="submit"
                                loading={loading}
                                className="login-submit-btn"
                            >
                                Sign In
                            </Button>
                        </Form.Item>

                        <Divider plain style={{ color: '#ccc', borderColor: '#444' }}>or</Divider>

                        <Button
                            block
                            size="large"
                            icon={<WindowsOutlined />}
                            onClick={handleMicrosoftLogin}
                            style={{
                                background: '#2f2f2f',
                                borderColor: '#444',
                                color: '#fff',
                                height: 45,
                                fontSize: 15
                            }}
                        >
                            Sign in with Microsoft
                        </Button>
                    </Form>
                </div>

                {/* Footer */}
                <div className="login-footer">
                    Hermes Platform v1.0
                </div>
            </div>
        </div>
    )
}

export default LoginPage
