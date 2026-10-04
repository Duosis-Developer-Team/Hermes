/**
 * =============================================================================
 * HERMES PLATFORM - Giris ekrani (Hermes Liquid, 30.09)
 * =============================================================================
 * Uygulamanin kendi dili: sivi zemin, ustte dinamik ada (marka + sunucu /
 * tema / dil haplari), solda Hermes'i anlatan vitrin (baslik, yuzen urun
 * kartlari, dock), sagda cam giris karti. Dar ekranda vitrin gizlenir,
 * yalniz kart kalir.
 *
 * Akis DEGISMEDI:
 *   - Birincil yol Microsoft SSO (redirect_uri sabit; `?workspace=` OAuth
 *     `state` ile korunur — api/workspace.js).
 *   - E-posta/parola katlanir; tenant reddederse platform ucu denenir
 *     (ayri audience/cerez), basarisizlikta TEK ve ayni hata gosterilir.
 * Vitrindeki kartlar SUSLEMEDIR (aria-hidden): gercek veri gostermez.
 * =============================================================================
 */

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Form, Input, Button, Checkbox, message } from 'antd'
import {
    CalendarOutlined,
    CheckSquareOutlined,
    ClockCircleOutlined,
    CustomerServiceOutlined,
    DownOutlined,
    LockOutlined,
    MoonOutlined,
    SafetyCertificateOutlined,
    SunOutlined,
    UpOutlined,
    UserOutlined,
} from '@ant-design/icons'
import { useAuthStore } from '../stores/authStore'
import { useThemeStore } from '../stores/themeStore'
import { useLocaleStore } from '../stores/localeStore'
import { authService } from '../services/api'
import { platformService } from '../api/platformApi'
import { usePlatformAuthStore } from '../stores/platformAuthStore'
import { buildMicrosoftAuthorizeUrl, readWorkspace } from '../api/workspace'
import LiquidBackdrop from '../components/layout/LiquidBackdrop'
import ServerSwitch from '../components/layout/ServerSwitch'
import './LoginPage.css'
import { useT } from '../i18n'

/** Microsoft dort kare isareti (resmi renkler). */
function MicrosoftMark() {
    return (
        <svg viewBox="0 0 21 21" width="18" height="18" aria-hidden="true">
            <rect x="1" y="1" width="9" height="9" fill="#F25022" />
            <rect x="11" y="1" width="9" height="9" fill="#7FBA00" />
            <rect x="1" y="11" width="9" height="9" fill="#00A4EF" />
            <rect x="11" y="11" width="9" height="9" fill="#FFB900" />
        </svg>
    )
}

const FEATURES = [
    ['time', <ClockCircleOutlined key="i" />, 'featTime', 'featTimeSub'],
    ['work', <CheckSquareOutlined key="i" />, 'featWork', 'featWorkSub'],
    ['meet', <CalendarOutlined key="i" />, 'featMeet', 'featMeetSub'],
    ['tickets', <CustomerServiceOutlined key="i" />, 'featTickets', 'featTicketsSub'],
]

/** Solda urun vitrini — suslemedir, gercek veri gostermez. */
function Showcase() {
    const t = useT()
    return (
        <section className="lg-show" aria-labelledby="lg-headline">
            <span className="lg-eyebrow">{t('login.eyebrow')}</span>
            <h1 id="lg-headline" className="lg-headline">{t('login.headline')}</h1>
            <p className="lg-sub">{t('login.sub')}</p>

            <div className="lg-stage" aria-hidden="true">
                <div className="lg-float lg-float--week">
                    <span className="lg-float__label">{t('login.prevWeek')}</span>
                    <div className="lg-week">
                        <svg viewBox="0 0 64 64" className="lg-ring">
                            <circle cx="32" cy="32" r="26" className="lg-ring__track" />
                            <circle cx="32" cy="32" r="26" className="lg-ring__arc" />
                        </svg>
                        <div>
                            <b>32<small> / 40</small></b>
                            <span>{t('login.prevHours')}</span>
                        </div>
                    </div>
                    <div className="lg-bars">
                        {[8, 7, 8, 6, 3].map((h, i) => <i key={i} style={{ '--h': `${(h / 8) * 100}%`, animationDelay: `${i * 90}ms` }} />)}
                    </div>
                </div>
                <div className="lg-float lg-float--meet">
                    <span className="lg-float__label">{t('login.prevNext')}</span>
                    <b>{t('login.prevMeeting')}</b>
                    <span className="lg-pill">{t('login.prevIn')}</span>
                </div>
                <div className="lg-float lg-float--work">
                    <span className="lg-float__label">{t('login.prevWork')}</span>
                    <div className="lg-mix"><i className="is-bad" /><i className="is-warn" /><i className="is-info" /></div>
                    <div className="lg-mix__legend">
                        <span><i className="is-bad" />2 {t('login.prevOverdue')}</span>
                        <span><i className="is-warn" />3 {t('login.prevToday')}</span>
                        <span><i className="is-info" />5 {t('login.prevWeekItems')}</span>
                    </div>
                </div>
            </div>

            <ul className="lg-features">
                {FEATURES.map(([key, icon, title, sub]) => (
                    <li key={key} className={`lg-feature lg-feature--${key}`}>
                        <span className="lg-feature__icon" aria-hidden="true">{icon}</span>
                        <span className="lg-feature__text">
                            <b>{t(`login.${title}`)}</b>
                            <small>{t(`login.${sub}`)}</small>
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    )
}

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
    // "Oturumu acik tut": iki giris yoluna da uygulanir. Kapaliyken oturum
    // son kullanimdan 1 gun, aciksa 30 gun sonra duser (yenileme cerezi).
    const [remember, setRemember] = useState(false)
    const navigate = useNavigate()
    const { login } = useAuthStore()
    const platformLogin = usePlatformAuthStore((s) => s.login)
    const theme = useThemeStore((s) => s.theme)
    const setTheme = useThemeStore((s) => s.setTheme)
    const locale = useLocaleStore((s) => s.locale)
    const toggleLocale = useLocaleStore((s) => s.toggleLocale)
    const workspace = readWorkspace(window.location.search)

    const handleSubmit = async (values) => {
        setLoading(true)
        try {
            // API'ye login isteği gönder
            const response = await authService.login(
                values.email, values.password, { remember },
            )

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

        if (!clientId) {
            message.warning(t('login.azureMisconfigured'))
            return
        }

        // redirect_uri sabittir (Azure'da kayitli); `?workspace=` ve
        // "Oturumu acik tut" Microsoft donusunde kaybolmasin diye OAuth
        // `state` icinde tasinir (AuthCallbackPage geri okur).
        window.location.href = buildMicrosoftAuthorizeUrl({
            tenantId,
            clientId,
            origin: window.location.origin,
            workspace,
            remember,
        })
    }

    return (
        <div className="login-page">
            {/* Hermes Liquid: uygulamayla ayni sivi zemin. */}
            <LiquidBackdrop />

            {/* Dinamik ada: marka solda; sunucu (yalniz masaustu), tema ve dil. */}
            <header className="lg-island">
                <span className="lg-island__brand">
                    <span className="lg-mark lg-mark--sm" aria-hidden="true"><i /></span>
                    <b>Hermes</b>
                </span>
                <span className="lg-island__prefs">
                    <ServerSwitch />
                    <span className="island-seg login-theme-switch" role="group" aria-label={t('login.toggleTheme')}>
                        {[['light', <SunOutlined key="s" />], ['dark', <MoonOutlined key="m" />]].map(([mode, icon]) => (
                            <button
                                key={mode}
                                type="button"
                                className={theme === mode ? 'is-on' : undefined}
                                aria-pressed={theme === mode}
                                aria-label={mode === 'light' ? t('shell.switchToLight') : t('shell.switchToDark')}
                                onClick={() => setTheme(mode)}
                            >
                                {icon}
                            </button>
                        ))}
                    </span>
                    <span className="island-seg island-seg--text" role="group" aria-label={t('shell.language')}>
                        {['tr', 'en'].map((code) => (
                            <button
                                key={code}
                                type="button"
                                className={locale === code ? 'is-on' : undefined}
                                aria-pressed={locale === code}
                                aria-label={code === 'tr' ? t('shell.switchToTurkish') : t('shell.switchToEnglish')}
                                onClick={() => { if (locale !== code) toggleLocale() }}
                            >
                                {code.toUpperCase()}
                            </button>
                        ))}
                    </span>
                </span>
            </header>

            <main className="lg-main">
                <Showcase />

                {/* Giris karti */}
                <section className="login-card" aria-labelledby="lg-card-title">
                    <span className="lg-mark" aria-hidden="true"><i /></span>
                    <div className="login-header">
                        <h2 id="lg-card-title">{t('login.signInToHermes')}</h2>
                        <p>{t('login.microsoftHint')}</p>
                    </div>

                    {/* Primary: Microsoft SSO */}
                    <Button block onClick={handleMicrosoftLogin} className="ms-login-btn">
                        <MicrosoftMark />
                        {t('login.signInWithMicrosoft')}
                    </Button>

                    {/* Oturumu acik tut — Microsoft butonunun hemen ALTINDA; iki giris
                        yoluna da (Microsoft + e-posta) uygulanir. */}
                    <div className="login-remember">
                        <Checkbox checked={remember} onChange={(e) => setRemember(e.target.checked)}>
                            {t('login.rememberMe')}
                        </Checkbox>
                    </div>

                    <div className="lg-or"><span>{t('login.or')}</span></div>

                    {/* Secondary: collapsible email/password (admins, service accounts) */}
                    <button
                        type="button"
                        className="login-email-toggle"
                        aria-expanded={showEmail}
                        onClick={() => setShowEmail((v) => !v)}
                    >
                        <span>{t('login.emailToggle')}</span>
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
                                    { type: 'email', message: t('login.emailInvalid') },
                                ]}
                            >
                                <Input
                                    prefix={<UserOutlined />}
                                    placeholder={t('login.emailPlaceholder')}
                                    size="large"
                                    autoComplete="username"
                                />
                            </Form.Item>

                            <Form.Item
                                name="password"
                                label={t('login.password')}
                                rules={[{ required: true, message: t('login.passwordRequired') }]}
                            >
                                <Input.Password
                                    prefix={<LockOutlined />}
                                    placeholder={t('login.passwordPlaceholder')}
                                    size="large"
                                    autoComplete="current-password"
                                />
                            </Form.Item>

                            <Form.Item style={{ marginBottom: 0 }}>
                                <Button type="primary" htmlType="submit" loading={loading} className="login-submit-btn">
                                    {t('login.signIn')}
                                </Button>
                            </Form.Item>
                        </Form>
                    )}

                    <div className="lg-card__foot">
                        <span><SafetyCertificateOutlined aria-hidden="true" /> {t('login.secure')}</span>
                        {workspace && <span>{t('login.workspace')}: <b>{workspace}</b></span>}
                    </div>
                </section>
            </main>

            <footer className="login-footer">{t('login.footer')}</footer>
        </div>
    )
}

export default LoginPage
