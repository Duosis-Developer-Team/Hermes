/**
 * =============================================================================
 * WS9 — Platform konsolu: duzlem ayriligi ve destek banner'i
 * =============================================================================
 * Frontend tarafinda kilitlenen sozlesmeler:
 *   1. Tenant oturumu platform konsoluna erisim VERMEZ (iki store
 *      birbirinden bagimsizdir).
 *   2. Destek oturumu banner'i KAPATILAMAZ ve tenant/mod/kalan sureyi
 *      metinle soyler.
 *   3. Platform izinleri fail-closed'dir.
 */
import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useAuthStore } from '../../stores/authStore'
import { usePlatformAuthStore } from '../../stores/platformAuthStore'
import SupportSessionBanner from '../../pages/platform/SupportSessionBanner'

const resetStores = () => {
    useAuthStore.setState({
        user: null, tenant: null, memberships: [],
        isAuthenticated: false, permissions: null,
    })
    usePlatformAuthStore.setState({
        admin: null, permissions: null, isAuthenticated: false,
    })
}

describe('duzlem ayriligi', () => {
    beforeEach(resetStores)

    it('tenant oturumu platform oturumu ACMAZ', () => {
        useAuthStore.getState().login(
            { id: 'u1', is_admin: true },
            { id: 't1', slug: 'acme', display_name: 'Acme' },
        )

        // Tenant tarafinda tam yetkili olmak platform duzleminde
        // HICBIR sey ifade etmez.
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(false)
        expect(usePlatformAuthStore.getState().can('platform.tenants.view'))
            .toBe(false)
    })

    it('platform oturumu tenant oturumu ACMAZ', () => {
        usePlatformAuthStore.getState().login(
            { id: 'ops1', email: 'ops@hermes.dev' },
            ['platform.tenants.view'],
        )

        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(true)
        expect(useAuthStore.getState().isAuthenticated).toBe(false)
        // Platform operatoru tenant izinlerine sahip DEGILDIR.
        expect(useAuthStore.getState().can('users.manage')).toBe(false)
    })

    it('platform izinleri fail-closed', () => {
        // Izinler yuklenmeden hicbir sey yapilabilir sayilmaz.
        expect(usePlatformAuthStore.getState().can('platform.tenants.manage'))
            .toBe(false)

        usePlatformAuthStore.getState().login({ id: 'ops1' },
                                              ['platform.tenants.view'])
        expect(usePlatformAuthStore.getState().can('platform.tenants.view'))
            .toBe(true)
        // Sahip OLMADIGI izin false doner.
        expect(usePlatformAuthStore.getState().can('platform.tenants.manage'))
            .toBe(false)
    })

    it('platform logout tenant oturumuna DOKUNMAZ', () => {
        useAuthStore.getState().login({ id: 'u1' },
                                      { id: 't1', display_name: 'Acme' })
        usePlatformAuthStore.getState().login({ id: 'ops1' }, [])

        usePlatformAuthStore.getState().logout()

        expect(usePlatformAuthStore.getState().isAuthenticated).toBe(false)
        // Tenant oturumu etkilenmedi: iki duzlem bagimsiz.
        expect(useAuthStore.getState().isAuthenticated).toBe(true)
    })
})

describe('destek oturumu banner', () => {
    const session = {
        id: 'g1',
        tenant: { id: 't1', slug: 'acme', display_name: 'Acme Ltd' },
        mode: 'read_only',
        expires_at: new Date(Date.now() + 15 * 60 * 1000).toISOString(),
    }

    it('tenant adini, modu ve kalan sureyi METINLE gosterir', () => {
        render(<SupportSessionBanner session={session} onEnd={() => {}} />)

        expect(screen.getByText(/Support session active/i)).toBeInTheDocument()
        expect(screen.getByText('Acme Ltd')).toBeInTheDocument()
        // Mod renkle DEGIL metinle de belirtilir (erisilebilirlik).
        expect(screen.getByText('read-only')).toBeInTheDocument()
    })

    it('GIZLEME aksiyonu YOKTUR — yalnizca sonlandirma vardir', () => {
        render(<SupportSessionBanner session={session} onEnd={() => {}} />)

        const buttons = screen.getAllByRole('button')
        const labels = buttons.map((b) => b.textContent.toLowerCase())
        expect(labels.some((l) => l.includes('end session'))).toBe(true)
        // "hide"/"dismiss"/"close" gibi bir kacis yolu OLMAMALI:
        // operator baska bir sirketin verisine baktigini unutamamali.
        expect(labels.some((l) => /hide|dismiss|close/.test(l))).toBe(false)
    })

    it('oturum yoksa hicbir sey render etmez', () => {
        const { container } = render(
            <SupportSessionBanner session={null} onEnd={() => {}} />,
        )
        expect(container).toBeEmptyDOMElement()
    })

    it('sure dolunca onExpire cagrilir ve durum degisir', () => {
        const onExpire = vi.fn()
        const expired = {
            ...session,
            expires_at: new Date(Date.now() - 1000).toISOString(),
        }
        render(
            <SupportSessionBanner
                session={expired} onEnd={() => {}} onExpire={onExpire}
            />,
        )
        expect(onExpire).toHaveBeenCalled()
        expect(screen.getByText(/Support session expired/i)).toBeInTheDocument()
    })
})

/**
 * =============================================================================
 * Tasarim birligi — konsol Hermes'in KENDI kabugunu kullanmali
 * =============================================================================
 * Konsol once kendi `Layout` + `Tabs` yapisini kullaniyordu ve Hermes'e
 * benzemiyordu. "Benzer" yetmez: ayni bilesen ve ayni CSS kullanilmadikca
 * iki kabuk zamanla ayrisir. Bu testler, konsolun paylasilan kabuga bagli
 * kalmasini YAPISAL olarak zorlar.
 */
describe('tasarim birligi', () => {
    const consoleSrc = () => readFileSync(resolve(process.cwd(), 'src/pages/platform/PlatformConsole.jsx'), 'utf-8')

    it('paylasilan AppShell kullanir', () => {
        const src = consoleSrc()
        expect(src).toMatch(/from ['"][^'"]*components\/layout\/AppShell['"]/)
        expect(src).toMatch(/<AppShell\b/)
    })

    it('KENDI layout/sekme kabugunu KURMAZ', () => {
        const src = consoleSrc()
        // Bunlar geri gelirse tasarim yeniden ayrisir.
        expect(src).not.toMatch(/<Layout\b/)
        expect(src).not.toMatch(/<Tabs\b/)
    })

    it('kabuk, tenant tarafiyla AYNI bilesendir', () => {
        const shell = readFileSync(resolve(process.cwd(), 'src/components/layout/MainLayout.jsx'), 'utf-8')
        expect(shell).toMatch(/from ['"]\.\/AppShell['"]/)
        expect(shell).toMatch(/<AppShell\b/)
    })

    it('kabuk tenant store\'una DOKUNMAZ (izolasyon)', () => {
        const shell = readFileSync(resolve(process.cwd(), 'src/components/layout/AppShell.jsx'), 'utf-8')
        // Gorsel kabuk veri kaynagi BILMEZ; tema disinda store import etmez.
        expect(shell).not.toMatch(/authStore/)
        expect(shell).not.toMatch(/platformAuthStore/)
        expect(shell).not.toMatch(/OrganizationSwitcher/)
    })

    it('konsol tenant store\'unu HIC import etmez', () => {
        expect(consoleSrc()).not.toMatch(/stores\/authStore/)
    })
})

/**
 * =============================================================================
 * Tek giris noktasi — iki duzlem, tek form
 * =============================================================================
 * Platform admin bir tenant kullanicisi degildir; tenant girisi onu dogru
 * sekilde reddeder. Kullanici ayri adres ezberlemesin diye giris formu
 * platform duzlemine DUSER. Guvenlik degismez: ayri uc, ayri cerez, ayri
 * audience — birlesen yalnizca FORM'dur.
 */
describe('tek giris noktasi', () => {
    const loginSrc = () => readFileSync(resolve(process.cwd(), 'src/pages/LoginPage.jsx'), 'utf-8')

    it('tenant reddedince platform ucunu dener', () => {
        const src = loginSrc()
        expect(src).toMatch(/platformService\.login/)
        expect(src).toMatch(/navigate\(['"]\/platform-admin['"]\)/)
    })

    it('platform girisi AYRI ucu kullanir (tenant ucundan turetilmez)', () => {
        const api = readFileSync(resolve(process.cwd(), 'src/api/platformApi.js'), 'utf-8')
        expect(api).toMatch(/\/api\/platform\/v1/)
        // Platform istemcisi tenant API tabanini KULLANMAZ.
        expect(api).not.toMatch(/\/api\/v1\/auth/)
    })

    it('basarisiz platform denemesi TEK ve ayni hatayi gosterir', () => {
        const src = loginSrc()
        // Platform hatasi yutulur; kullaniciya tenant hatasi doner —
        // aksi halde "bu e-posta platform admin'i" bilgisi sizardi.
        expect(src).toMatch(/catch\s*{[^}]*}/)
        expect(src).toMatch(/errorMsg/)
    })
})

/**
 * =============================================================================
 * WS12 — Tenant yonetimi ve workspace tasima
 * =============================================================================
 */
describe('tenant yonetimi', () => {
    const consoleSrc = () => readFileSync(
        resolve(process.cwd(), 'src/pages/platform/PlatformConsole.jsx'), 'utf-8')

    it('yeni tenant ve duzenleme aksiyonlari vardir', () => {
        const src = consoleSrc()
        // i18n sonrasi metin sozlukten gelir; kilit ANAHTAR uzerinde.
        // Kilitlenen sey "yeni tenant aksiyonu var" idi ve aynen duruyor.
        expect(src).toMatch(/platform\.newTenant/)
        expect(src).toMatch(/CreateTenantModal/)
        expect(src).toMatch(/EditTenantModal/)
    })

    it('plan SECILEBILIR (salt okunur etiket degil)', () => {
        // Sikayet buydu: plan gorunuyor ama degistirilemiyor.
        expect(consoleSrc()).toMatch(/name="plan_code"[\s\S]{0,400}<Select/)
    })

    it('tek seferlik parola YALNIZCA ekranda gosterilir, saklanmaz', () => {
        const src = consoleSrc()
        expect(src).toMatch(/one_time_password/)
        // Hicbir depolamaya yazilmamali.
        expect(src).not.toMatch(/localStorage|sessionStorage/)
    })

    it('workspace adresi kullaniciya SOYLENIR', () => {
        // Slug ile adreslenen bir tenant, adresi gosterilmezse
        // ulasilamaz olur.
        expect(consoleSrc()).toMatch(/workspace_hint/)
    })
})

describe('workspace tasima', () => {
    it('API istemcisi adres cubugundaki workspace parametresini tasir', () => {
        const src = readFileSync(
            resolve(process.cwd(), 'src/api/httpClient.js'), 'utf-8')
        expect(src).toMatch(/interceptors\.request\.use/)
        expect(src).toMatch(/['"]workspace['"]/)
    })

    it('PLATFORM istemcisi workspace TASIMAZ (duzlem tenant\'siz)', () => {
        const src = readFileSync(
            resolve(process.cwd(), 'src/api/platformApi.js'), 'utf-8')
        expect(src).not.toMatch(/workspace/)
        // Kendi axios ornegini kurar; tenant istemcisinden TUREMEZ.
        expect(src).not.toMatch(/createApiClient/)
    })
})

/**
 * =============================================================================
 * Tek giris ekrani — ayri platform login sayfasi KALDIRILDI
 * =============================================================================
 */
describe('tek giris ekrani', () => {
    it('ayri PlatformLoginPage dosyasi YOKTUR', () => {
        expect(existsSync(resolve(
            process.cwd(), 'src/pages/platform/PlatformLoginPage.jsx'))).toBe(false)
    })

    it('hicbir yerde referansi kalmamistir', () => {
        for (const f of ['src/App.jsx', 'src/routes/loaders.js']) {
            const src = readFileSync(resolve(process.cwd(), f), 'utf-8')
            expect(src).not.toMatch(/PlatformLoginPage|platformLogin\b/)
        }
    })

    it('oturumsuz platform rotasi ANA giris ekranina gider', () => {
        const src = readFileSync(resolve(process.cwd(), 'src/App.jsx'), 'utf-8')
        // Ayri giris ekranina yonlendirme HICBIR yerde kalmamali.
        expect(src).not.toMatch(/\/platform-admin\/login/)
        // Platform rota blogunu izole edip icinde /login'e dusuldugunu
        // dogrula (dosyanin tamaminda aramak yaniltici olur).
        const start = src.indexOf('path="/platform-admin/*"')
        expect(start).toBeGreaterThan(-1)
        const block = src.slice(start, start + 600)
        expect(block).toMatch(/platformAuthenticated/)
        expect(block).toMatch(/Navigate to=["']\/login["']/)
    })

    it('konsoldan cikis ANA giris ekranina doner', () => {
        const src = readFileSync(resolve(
            process.cwd(), 'src/pages/platform/PlatformConsole.jsx'), 'utf-8')
        expect(src).toMatch(/navigate\(['"]\/login['"],\s*\{\s*replace:\s*true\s*\}\)/)
    })
})

/**
 * =============================================================================
 * Duzenleme / olusturma paritesi
 * =============================================================================
 * Sikayet: "yeni eklerken istenilen kisimlar editte de duzenlenebiliyor
 * olmali". Olusturmadaki her alan duzenlemede de GORUNMELI; degistirilemeyen
 * alan gizlenmez, neden kilitli oldugu soylenir.
 */
describe('duzenleme paritesi', () => {
    const consoleSrc = () => readFileSync(resolve(
        process.cwd(), 'src/pages/platform/PlatformConsole.jsx'), 'utf-8')

    const editBlock = () => {
        const s = consoleSrc()
        const start = s.indexOf('function EditTenantModal')
        return s.slice(start, s.indexOf('\nfunction ', start + 10))
    }

    it('olusturmadaki alanlarin hepsi duzenlemede de vardir', () => {
        const edit = editBlock()
        for (const field of ['display_name', 'email_domains', 'plan_code',
                             'owner_email']) {
            expect(edit).toMatch(new RegExp(`name="${field}"`))
        }
        // Slug degistirilemez ama GOSTERILIR. (i18n: anahtar uzerinden.)
        expect(edit).toMatch(/platform\.workspaceAddress/)
        expect(edit).toMatch(/disabled/)
    })

    it('plan duzenlemede de SECILEBILIR', () => {
        expect(editBlock()).toMatch(/name="plan_code"[\s\S]{0,300}<Select/)
    })
})
