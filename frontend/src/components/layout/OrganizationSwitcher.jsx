/**
 * =============================================================================
 * HERMES - Organizasyon secici (WS8)
 * =============================================================================
 * Yalnizca BIRDEN FAZLA aktif uyeligi olan kimlikler icin gorunur; tek
 * organizasyonu olan kullanici hicbir sey gormez (gereksiz kavram
 * yuku yaratmamak icin).
 *
 * GUVENLIK SOZLESMESI:
 *   - Secim bir TALEPTIR. Gecis, POST /auth/switch-tenant ile SUNUCUDA
 *     dogrulanir (uyelik + tenant durumu yeniden kontrol edilir) ve
 *     yeni oturum cerezi orada yazilir. UI kendi basina tenant SECEMEZ.
 *   - Yanit gelmeden hicbir tenant-bagimli state degismez.
 *   - Basarili gecisten SONRA React Query cache'i TAMAMEN bosaltilir ve
 *     ucusan sorgular iptal edilir (authStore.applyTenantSwitch); boylece
 *     onceki organizasyonun verisi yeni ekranda BIR AN BILE gorunmez.
 *   - Ardindan guvenli bir baslangic sayfasina donulur: mevcut rota
 *     yeni organizasyonda var olmayan bir kaydi isaret ediyor olabilir.
 */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Dropdown, Spin, Typography, message } from 'antd'
import { DownOutlined, TeamOutlined } from '@ant-design/icons'

import { authService } from '../../api/authApi'
import { useAuthStore } from '../../stores/authStore'
import { useT } from '../../i18n'

const { Text } = Typography

export default function OrganizationSwitcher() {
    const t = useT()
    const tenant = useAuthStore((s) => s.tenant)
    const memberships = useAuthStore((s) => s.memberships)
    const setMemberships = useAuthStore((s) => s.setMemberships)
    const applyTenantSwitch = useAuthStore((s) => s.applyTenantSwitch)
    const isAuthenticated = useAuthStore((s) => s.isAuthenticated)

    const [switching, setSwitching] = useState(false)
    const navigate = useNavigate()

    useEffect(() => {
        if (!isAuthenticated) return
        let cancelled = false
        authService
            .listMemberships()
            .then((rows) => {
                if (!cancelled) setMemberships(rows)
            })
            .catch(() => {
                // Secici yoksa uygulama calismaya devam eder; tek
                // organizasyonlu kurulumda bu zaten normal durumdur.
            })
        return () => {
            cancelled = true
        }
    }, [isAuthenticated, setMemberships])

    // Tek uyelik → secici YOK. Organizasyon adi shell'de ayrica gosterilir.
    if (!tenant || (memberships || []).length < 2) return null

    const handleSelect = async ({ key }) => {
        if (key === tenant.id || switching) return
        setSwitching(true)
        try {
            // Sunucu uyeligi ve tenant durumunu YENIDEN dogrular; cerez
            // ancak bundan sonra rotate edilir.
            const result = await authService.switchTenant(key)
            applyTenantSwitch(result.tenant)
            message.success(`Switched to ${result.tenant.display_name}`)
            // Guvenli baslangic: eski rota yeni organizasyonda anlamsiz
            // (hatta var olmayan) bir kaydi gosteriyor olabilir.
            navigate('/time-entry', { replace: true })
        } catch (error) {
            const detail = error?.response?.data?.detail
            message.error(
                detail?.message || 'Could not switch organization.',
            )
        } finally {
            setSwitching(false)
        }
    }

    const items = (memberships || []).map((m) => ({
        key: m.tenant_id,
        label: m.display_name,
        disabled: m.tenant_id === tenant.id,
    }))

    return (
        <Dropdown
            menu={{ items, onClick: handleSelect }}
            trigger={['click']}
            disabled={switching}
        >
            <span
                role="button"
                tabIndex={0}
                aria-label={t('shellExtra.switchOrganization')}
                className="hermes-org-switcher"
                style={{ cursor: 'pointer', display: 'inline-flex',
                         alignItems: 'center', gap: 6 }}
            >
                {switching ? <Spin size="small" /> : <TeamOutlined />}
                <Text strong>{tenant.display_name}</Text>
                <DownOutlined style={{ fontSize: 10 }} />
            </span>
        </Dropdown>
    )
}
