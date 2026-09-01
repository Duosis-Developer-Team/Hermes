/**
 * =============================================================================
 * HERMES PLATFORM - Login Page
 * =============================================================================
 * Kullanıcı giriş sayfası. Jira tarzı minimalist tasarım.
 * =============================================================================
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, message, Switch } from 'antd'
import {
    UserOutlined,
    LockOutlined,
    WindowsOutlined,
    DownOutlined,
    UpOutlined,
    BulbFilled,
    BulbOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import { authService } from '../services/api'
import { platformService } from '../api/platformApi'
import { usePlatformAuthStore } from '../stores/platformAuthStore'
import logoIconDark from '../assets/logos/logo-icon-dark.jpg'
import logoIconLight from '../assets/logos/logo-icon-light.png'
import './LoginPage.css'
import { useT } from '../i18n'

/**
 * Login Page Component
 * 
 * E-posta ve şifre ile giriş yapılır.
 * Başarılı girişte token saklanır ve ana sayfaya yönlendirilir.
 */
function LoginPage() {
    const t = useT()
    const [loading, setLoading] = useState(false)
    // Microsoft sign-in is the primary path for almost everyone; the
    // email/password form is collapsed by default and mainly used for
    // admin / service accounts.
    const [showEmail, setShowEmail] = useState(false)
    const navigate = useNavigate()
    const { login } = useAuthStore()
    const platformLogin = usePlatformAuthStore((s) => s.login)
    // Light mode needs the dark-colored boot icon (logo-icon-light.png);
    // the white boot (logo-icon-dark.jpg) disappears on the light card.
    const isLight = useThemeStore((s) => s.theme === 'light')
    const toggleTheme = useThemeStore((s) => s.toggleTheme)
    const logoIcon = isLight ? logoIconLight : logoIconDark

    const handleSubmit = async (values) => {
        setLoading(true)
        try {
            // API'ye login isteği gönder
            const response = await authService.login(values.email, values.password)

            // [KRİTİK-6] Token cookie olarak backend'den geldi; store'a
            // yalnızca user + organizasyon özeti kaydedilir.
            // WS8: tenant, imzalı oturum çerezinin içindedir; UI onu
            // seçmez, yalnızca backend'in bildirdiğini gösterir.
            login(response.user, response.tenant || null)

            message.success(t('login.loginSuccess'))
            navigate('/time-entry')
        } catch (error) {
            /*
             * TEK GIRIS NOKTASI — iki AYRI guvenlik duzlemi.
             *
             * Platform Super Admin bir tenant kullanicisi DEGILDIR (uyeligi
             * yoktur), bu yuzden tenant girisi onu dogru sekilde reddeder.
             * Kullanicinin ayri bir adres ezberlemesi gerekmesin diye
             * burada platform duzlemine DUSULUR.
             *
             * Guvenlik degismedi: istek ayri uca (/api/platform/v1/login)
             * gider, ayri cerez ve ayri audience (`hermes-platform-admin`)
             * uretir. Platform token'i tenant uclarinda, tenant token'i
             * platform uclarinda hala REDDEDILIR — birlesen yalnizca FORM.
             *
             * Sizinti yok: her iki uc de zaten disaridan cagrilabilir
             * durumda; bu geri dusus yeni bir bilgi aciga cikarmaz. Yanlis
             * credential her iki duzlemde de basarisiz olur ve kullanici
             * TEK ve ayni hatayi gorur.
             */
            try {
                const platform = await platformService.login(
                    values.email, values.password
                )
                platformLogin(platform.admin, platform.permissions)
                message.success(t('login.signedInToPlatform'))
                navigate('/platform-admin')
                return
            } catch {
                // Platform da reddetti — asil (tenant) hatayi gosteririz.
            }
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
            message.warning(t('login.azureMisconfigured'))
            return
        }

        const url = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&response_type=code&redirect_uri=${redirectUri}&response_mode=query&scope=User.Read&prompt=select_account`

        window.location.href = url
    }

    return (
        <div className="login-page">
            {/* Light / Dark toggle — top-right, same control as the app header */}
            <Switch
                className="theme-switch login-theme-switch"
                checked={isLight}
                onChange={toggleTheme}
                checkedChildren={<BulbFilled />}
                unCheckedChildren={<BulbOutlined />}
                aria-label={t('login.toggleTheme')}
            />

            <div className="login-container">
                {/* Logo Section - Sadece çizme ikonu */}
                <div className="login-logo">
                    <img src={logoIcon} alt="Hermes" className="login-logo-image" />
                </div>

                {/* Login Card */}
                <div className="login-card">
                    <div className="login-header">
                        <h2>{t('login.signInToHermes')}</h2>
                        <p>{t('login.microsoftHint')}</p>
                    </div>

                    {/* Primary: Microsoft SSO */}
                    <Button
                        block
                        icon={<WindowsOutlined />}
                        onClick={handleMicrosoftLogin}
                        className="ms-login-btn"
                    >
                        {t('login.signInWithMicrosoft')}
                    </Button>

                    {/* Secondary: collapsible email/password (admins, service accounts) */}
                    <button
                        type="button"
                        className="login-email-toggle"
                        aria-expanded={showEmail}
                        onClick={() => setShowEmail((v) => !v)}
                    >
                        <span>Sign in with email &amp; password</span>
                        {showEmail ? <UpOutlined /> : <DownOutlined />}
                    </button>

                    {showEmail && (
                        <Form
                            name="login"
                            className="login-form login-email-section fade-in"
                            onFinish={handleSubmit}
                            layout="vertical"
                            requiredMark={false}
                        >
                            <Form.Item
                                name="email"
                                label={t('login.email')}
                                rules={[
                                    { required: true, message: t('login.emailRequired') },
                                    { type: 'email', message: t('login.emailInvalid') }
                                ]}
                            >
                                <Input
                                    prefix={<UserOutlined />}
                                    placeholder={t('login.emailPlaceholder')}
                                    size="large"
                                />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={t('login.password')}
                                rules={[
                                    { required: true, message: t('login.passwordRequired') }
                                ]}
                            >
                                <Input.Password
                                    prefix={<LockOutlined />}
                                    placeholder={t('login.passwordPlaceholder')}
                                    size="large"
                                />
                            </Form.Item>

                            <Form.Item style={{ marginBottom: 0 }}>
                                <Button
                                    type="primary"
                                    htmlType="submit"
                                    loading={loading}
                                    className="login-submit-btn"
                                >
                                    {t('login.signIn')}
                                </Button>
                            </Form.Item>
                        </Form>
                    )}
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
