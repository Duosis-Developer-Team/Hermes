/**
 * =============================================================================
 * HERMES - Platform Admin Console (super-admin) — Faz 2
 * =============================================================================
 * Kabuk + bolumler. Bolumler ADRESLIDIR (paylasilabilir, geri tusu calisir):
 *   /platform-admin                 genel bakis
 *   /platform-admin/tenants         kiraci listesi
 *   /platform-admin/tenants/:id     kiraci detayi (moduller, uyeler, erisim…)
 *   /platform-admin/network         talep agi (kim kime talep acar)
 *   /platform-admin/audit           denetim kaydi
 *
 * TASARIM: Hermes'in KENDI kabugu (AppShell) — tenant tarafiyla ayni
 * bilesen; "Platform" rozeti duzlemi ayirt ettirir.
 *
 * GUVENLIK SINIRI: hicbir ekran tenant is verisi gostermez — yalnizca
 * metadata (durum, moduller, uyelik). Is verisine bakmak icin sureli/
 * gerekceli destek izni alinir ve o erisim AYRI, bannerli baglamda acilir.
 * Kimlik `usePlatformAuthStore`dan; istekler yalniz /api/platform'a gider.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Empty, Table, Tag, message } from 'antd'
import {
    ApartmentOutlined, ClusterOutlined, DashboardOutlined, FileSearchOutlined,
    LogoutOutlined, SafetyCertificateOutlined,
} from '@ant-design/icons'
import dayjs from 'dayjs'

import AppShell from '../../components/layout/AppShell'
import { GlassCard, PageHero } from '../../components/liquid'
import { platformService } from '../../api/platformApi'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import { useT } from '../../i18n'
import TicketNetwork from './TicketNetwork'
import SupportSessionBanner from './SupportSessionBanner'
import PlatformOverview from './PlatformOverview'
import TenantList from './TenantList'
import TenantDetail from './TenantDetail'
import './platform.css'

const ROOT = '/platform-admin'

// =============================================================================
// Denetim (tum kiracilar)
// =============================================================================

function AuditPage() {
    const t = useT()
    const [rows, setRows] = useState(null)
    useEffect(() => {
        platformService.listAuditEvents({ limit: 200 })
            .then(setRows)
            .catch(() => { setRows([]); message.error(t('platform.loadAuditFailed')) })
    }, [t])
    return (
        <GlassCard className="lq-card--flush lq-enter">
            <Table
                rowKey="id" loading={rows === null} dataSource={rows || []} size="small"
                pagination={{ pageSize: 25, hideOnSinglePage: true }}
                scroll={{ x: 'max-content' }}
                columns={[
                    { title: t('platform.when'), dataIndex: 'occurred_at', render: (v) => (v ? dayjs(v).format('D MMM YYYY HH:mm') : '—') },
                    { title: t('platform.action'), dataIndex: 'action' },
                    { title: t('platform.result'), dataIndex: 'result' },
                    { title: t('platform.reason'), dataIndex: 'reason', responsive: ['md'] },
                ]}
                locale={{ emptyText: <Empty description={t('platform.noAuditEvents')} /> }}
            />
        </GlassCard>
    )
}

function TenantDetailRoute({ onSupportStarted }) {
    const { tenantId } = useParams()
    const navigate = useNavigate()
    return (
        <TenantDetail
            tenantId={tenantId}
            onBack={() => navigate(`${ROOT}/tenants`)}
            onSupportStarted={onSupportStarted}
        />
    )
}

// =============================================================================
// Kabuk
// =============================================================================

// Bolum listesi ANAHTAR tasir; ceviri render'da yapilir.
const SECTIONS = [
    { key: ROOT, icon: <DashboardOutlined />, labelKey: 'platform.overview' },
    { key: `${ROOT}/tenants`, icon: <ApartmentOutlined />, labelKey: 'platform.tenants' },
    { key: `${ROOT}/network`, icon: <ClusterOutlined />, labelKey: 'platform.ticketNetwork', subtitleKey: 'platform.network.intro' },
    { key: `${ROOT}/audit`, icon: <FileSearchOutlined />, labelKey: 'platform.auditLog' },
]

/** Bulunulan adresin bolumu (en uzun on ek). */
const sectionOf = (pathname) => SECTIONS
    .filter((s) => pathname === s.key || pathname.startsWith(`${s.key}/`))
    .sort((a, b) => b.key.length - a.key.length)[0] || SECTIONS[0]

export default function PlatformConsole() {
    const t = useT()
    const admin = usePlatformAuthStore((s) => s.admin)
    const logout = usePlatformAuthStore((s) => s.logout)
    const [supportSession, setSupportSession] = useState(null)
    const navigate = useNavigate()
    const { pathname } = useLocation()
    const section = sectionOf(pathname)
    const isDetail = /\/tenants\/[^/]+/.test(pathname)

    const endSupport = async () => {
        if (supportSession?.id) {
            try {
                await platformService.revokeSupportGrant(supportSession.id)
            } catch {
                // Iptal edilemese bile banner kalkar; sunucu tarafinda izin SURELIDIR.
            }
        }
        setSupportSession(null)
    }

    const handleLogout = async () => {
        try {
            await platformService.logout()
        } finally {
            logout()
            // Ayri platform giris ekrani YOK: cikista ANA giris ekranina
            // donulur; `replace` ile geri tusu kapali konsola dondurmez.
            navigate('/login', { replace: true })
        }
    }

    const accountMenuItems = [
        { key: 'logout', icon: <LogoutOutlined />, label: t('platform.signOut'), danger: true, onClick: handleLogout },
    ]

    return (
        <>
            {/* Destek oturumu banner'i EN USTTE ve kapatilamaz. */}
            <SupportSessionBanner
                session={supportSession}
                onEnd={endSupport}
                onExpire={() => { /* sure doldu — banner kendi durumunu gosterir */ }}
            />
            <AppShell
                menuItems={SECTIONS.map((s) => ({ ...s, label: t(s.labelKey) }))}
                selectedKey={section.key}
                onMenuClick={({ key }) => navigate(key)}
                onLogoClick={() => navigate(ROOT)}
                accountName={admin?.full_name || admin?.email}
                accountRole="Platform Admin"
                accountMenuItems={accountMenuItems}
                // Bildirimler KIRACI verisidir; platform duzleminde zil yok.
                showNotifications={false}
                headerExtra={(
                    <Tag icon={<SafetyCertificateOutlined />} color="purple">PLATFORM</Tag>
                )}
                contentKey={pathname}
            >
                {!isDetail && (
                    <PageHero
                        className="lq-enter"
                        title={t(section.labelKey)}
                        subtitle={t(section.subtitleKey || 'platform.consoleSubtitle')}
                    />
                )}
                <Routes>
                    <Route
                        index
                        element={(
                            <PlatformOverview
                                onOpenTenant={(id) => navigate(`${ROOT}/tenants/${id}`)}
                                onViewTenants={() => navigate(`${ROOT}/tenants`)}
                            />
                        )}
                    />
                    <Route path="tenants" element={<TenantList onOpen={(id) => navigate(`${ROOT}/tenants/${id}`)} />} />
                    <Route path="tenants/:tenantId" element={<TenantDetailRoute onSupportStarted={setSupportSession} />} />
                    <Route path="network" element={<TicketNetwork />} />
                    {/* Eski adres (tek saglayicili yonlendirme) → talep agi. */}
                    <Route path="routing" element={<Navigate to={`${ROOT}/network`} replace />} />
                    <Route path="audit" element={<AuditPage />} />
                    <Route path="*" element={<Navigate to={ROOT} replace />} />
                </Routes>
            </AppShell>
        </>
    )
}
