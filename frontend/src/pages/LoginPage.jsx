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

            // Token ve kullanıcı bilgilerini store'a kaydet
            login(response.access_token, response.user)

            message.success('Giriş başarılı!')
            navigate('/time-entry')
        } catch (error) {
            const errorMsg = error.response?.data?.detail || 'Giriş başarısız. Lütfen bilgilerinizi kontrol edin.'
            message.error(errorMsg)
        } finally {
            setLoading(false)
        }
    }

    const handleMicrosoftLogin = () => {
        const tenantId = import.meta.env.VITE_AZURE_TENANT_ID || 'common'
        const clientId = import.meta.env.VITE_AZURE_CLIENT_ID
        const redirectUri = window.location.origin + '/auth/callback'

        if (!clientId) {
            message.warning('Azure Client ID .env dosyasında eksik')
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
                        <h2>Hesabınıza giriş yapın</h2>
                        <p>Devam etmek için bilgilerinizi girin</p>
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
                            label="E-posta"
                            rules={[
                                { required: true, message: 'E-posta adresinizi girin' },
                                { type: 'email', message: 'Geçerli bir e-posta adresi girin' }
                            ]}
                        >
                            <Input
                                prefix={<UserOutlined />}
                                placeholder="ornek@sirket.com"
                                size="large"
                            />
                        </Form.Item>

                        <Form.Item
                            name="password"
                            label="Şifre"
                            rules={[
                                { required: true, message: 'Şifrenizi girin' }
                            ]}
                        >
                            <Input.Password
                                prefix={<LockOutlined />}
                                placeholder="Şifrenizi girin"
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
                                Giriş Yap
                            </Button>
                        </Form.Item>

                        <Divider plain style={{ color: '#ccc', borderColor: '#444' }}>veya</Divider>

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
                            Microsoft ile Giriş Yap
                        </Button>
                    </Form>
                </div>

                {/* Footer */}
                <div className="login-footer">
                    Hermes Platformu v1.0
                </div>
            </div>
        </div>
    )
}

export default LoginPage
