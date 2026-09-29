/**
 * Developer Portal — Genel bakis ("buradan basla").
 *
 * Ne insa edilebilir (kullanim senaryolari → ilgili bolum), canli durum
 * (API Status /v1/health'ten; MCP Status AYRI blok — CTO karari), temel
 * ilkeler ve ham referans kaynaklari. Metin: devPortal.overview.*
 */
import {
    ApiOutlined,
    BarChartOutlined,
    CloudSyncOutlined,
    DownloadOutlined,
    FileTextOutlined,
    PlusSquareOutlined,
    RightOutlined,
    RobotOutlined,
} from '@ant-design/icons'

import { useT } from '../../../i18n'
import { VERIFIED_CLIENTS } from '../mcpClients'
import { Rich, SectionHead } from '../parts'

const USE_CASES = [
    { key: 'reports', icon: <BarChartOutlined />, tone: 'blue', target: 'code-examples',
        chips: ['GET /v1/work-logs', 'work-logs:read'] },
    { key: 'intake', icon: <PlusSquareOutlined />, tone: 'violet', target: 'api-reference',
        chips: ['POST /v1/tasks', 'tasks:write'] },
    { key: 'sync', icon: <CloudSyncOutlined />, tone: 'green', target: 'pagination',
        chips: ['updated_after', 'has_more'] },
    { key: 'ai', icon: <RobotOutlined />, tone: 'amber', target: 'mcp',
        chips: ['/mcp', 'Bearer hms_…'] },
]

const PRINCIPLES = ['versioned', 'layers', 'envelope', 'retries', 'limits', 'writes']

function StatusDot({ ok }) {
    return <i className={`dp-dot${ok ? ' is-ok' : ''}`} aria-hidden="true" />
}

function OverviewSection({ capabilities, goTo, health, specInfo }) {
    const t = useT()
    const version = capabilities?.api_version || 'v1'
    const apiOk = health?.status === 'ok'
    const specOk = Boolean(specInfo?.version)

    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.overview.eyebrow')}
                title={t('devPortal.overview.title')}
                lead={t('devPortal.overview.lead')}
            />

            <div className="dp-usecases">
                {USE_CASES.map((u) => (
                    <button
                        key={u.key}
                        type="button"
                        className="dp-usecase"
                        onClick={() => goTo(u.target)}
                    >
                        <span className={`lq-mico lq-mico--${u.tone}`} aria-hidden="true">{u.icon}</span>
                        <span className="dp-usecase__title">{t(`devPortal.overview.uc.${u.key}.title`)}</span>
                        <span className="dp-usecase__desc">{t(`devPortal.overview.uc.${u.key}.desc`)}</span>
                        <span className="dp-usecase__chips">
                            {u.chips.map((c) => <code key={c}>{c}</code>)}
                        </span>
                        <span className="dp-usecase__go">
                            {t(`devPortal.overview.uc.${u.key}.cta`)} <RightOutlined />
                        </span>
                    </button>
                ))}
            </div>

            {/* API Status canli /v1/health + spec info'dan. MCP durumu AYRI
                blok (CTO karari): /mcp ingress'inde CORS bilerek kapali,
                tarayicidan prob atilamaz — bunlar YETENEK etiketleridir,
                canli saglik iddiasi degil. */}
            <div className="dp-status-grid">
                <div className="dp-status" role="status">
                    <span className="dp-status__title">
                        {t('devPortal.overview.apiStatus')}{' '}
                        <b className={apiOk ? 'is-ok' : ''}>
                            {apiOk ? t('devPortal.common.operational') : t('devPortal.common.checking')}
                        </b>
                    </span>
                    <span className="dp-status__items">
                        <span><StatusDot ok={apiOk} /> {t('devPortal.overview.statusApi', { version })}</span>
                        <span><StatusDot ok /> {t('devPortal.overview.statusPortal')}</span>
                        <span><StatusDot ok={specOk} /> {t('devPortal.overview.statusSpec')}</span>
                    </span>
                </div>
                <div className="dp-status is-mcp" role="status">
                    <span className="dp-status__title">
                        {t('devPortal.overview.mcpStatus')}{' '}
                        <b className="is-ok">{t('devPortal.overview.mcpActive')}</b>
                    </span>
                    <span className="dp-status__items">
                        <span className="lq-tag lq-tag--ok">{t('devPortal.overview.mcpBearer')}</span>
                        <span className="lq-tag lq-tag--warn">{t('devPortal.overview.mcpOauth')}</span>
                    </span>
                    <span className="dp-status__note">
                        {t('devPortal.overview.mcpVerified', { clients: VERIFIED_CLIENTS.join(', ') })}
                    </span>
                </div>
            </div>

            <div className="lq-grp">{t('devPortal.overview.principlesTitle')}</div>
            <div className="dp-principles">
                {PRINCIPLES.map((p) => (
                    <div key={p} className="dp-principle">
                        <b>{t(`devPortal.overview.pr.${p}.title`)}</b>
                        <span><Rich text={t(`devPortal.overview.pr.${p}.text`, { version })} /></span>
                    </div>
                ))}
            </div>

            <div className="lq-grp">{t('devPortal.overview.resourcesTitle')}</div>
            <div className="dp-tiles">
                <a className="dp-tile" href="/api/public/v1/docs" target="_blank" rel="noreferrer">
                    <ApiOutlined className="dp-tile__icon" />
                    <b>{t('devPortal.overview.res.swagger')}</b>
                    <span>{t('devPortal.overview.res.swaggerDesc')}</span>
                </a>
                <a className="dp-tile" href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer">
                    <FileTextOutlined className="dp-tile__icon" />
                    <b>{t('devPortal.overview.res.spec')}</b>
                    <span>{t('devPortal.overview.res.specDesc')}</span>
                </a>
                <a className="dp-tile" href="/api/public/v1/openapi.json" download="hermes-public-api-v1.json">
                    <DownloadOutlined className="dp-tile__icon" />
                    <b>{t('devPortal.overview.res.download')}</b>
                    <span>{t('devPortal.overview.res.downloadDesc')}</span>
                </a>
            </div>
        </div>
    )
}

export default OverviewSection
