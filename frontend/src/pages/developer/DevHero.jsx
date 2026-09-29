/**
 * Developer Portal — karsilama (hero).
 *
 * Amac: sayfaya gelen birine 5 saniyede "burada ne yapabilirim, nereden
 * baslarim" cevabini vermek. Uc eylem: ilk istek (hizli baslangic),
 * API anahtari (yalnizca `api.manage` izni olan API Yonetimi'ne gider;
 * digerlerine kimden isteyecegi soylenir), MCP ile baglanma.
 *
 * Rozetler CANLIDIR: surum /v1/capabilities'ten, OpenAPI surumu spec
 * info'dan, API durumu /v1/health'ten. Terminal ornegi KURGUSALDIR.
 * Sayilar da tek kaynaktan: uc katalogu (endpoints.js), MCP tool
 * listesi (mcpTools.js), canli hata/scope katalogu.
 */
import { Button } from 'antd'
import {
    ApiOutlined,
    KeyOutlined,
    RobotOutlined,
    RocketOutlined,
} from '@ant-design/icons'

import { CountUp } from '../../components/liquid'
import { useT } from '../../i18n'
import { ALL_ENDPOINTS } from './endpoints'
import { MCP_READ_TOOLS, MCP_TOOLS, MCP_WRITE_TOOLS } from './mcpTools'

function Kpi({ value, label, hint }) {
    return (
        <div className="dp-hero__kpi">
            <b className="dp-hero__kpi-value">
                {typeof value === 'number' ? <CountUp value={value} /> : value}
            </b>
            <span className="dp-hero__kpi-label">{label}</span>
            {hint && <small>{hint}</small>}
        </div>
    )
}

function Terminal({ t }) {
    // Kurgusal istek/yanit: gercek host, token ya da kayit ICERMEZ.
    return (
        <div className="dp-term" aria-label={t('devPortal.hero.terminalLabel')} role="img">
            <div className="dp-term__bar" aria-hidden="true">
                <i /><i /><i />
                <span>{t('devPortal.hero.terminalTitle')}</span>
            </div>
            <pre className="dp-term__body" aria-hidden="true">
                <span className="tk-p">$ </span>curl -s <span className="tk-s">&quot;$HERMES_BASE/api/public/v1/tasks?limit=1&quot;</span> \{'\n'}
                {'    '}-H <span className="tk-s">&quot;Authorization: Bearer $HERMES_API_TOKEN&quot;</span>{'\n'}
                {'\n'}
                <span className="tk-c">{'# 200 OK · X-RateLimit-Remaining: 59'}</span>{'\n'}
                {'{'}{'\n'}
                {'  '}<span className="tk-k">&quot;data&quot;</span>: [{'{'}{'\n'}
                {'    '}<span className="tk-k">&quot;task_code&quot;</span>: <span className="tk-s">&quot;TASK-12&quot;</span>,{'\n'}
                {'    '}<span className="tk-k">&quot;title&quot;</span>: <span className="tk-s">&quot;Renew TLS certificate&quot;</span>,{'\n'}
                {'    '}<span className="tk-k">&quot;status&quot;</span>: <span className="tk-s">&quot;in_progress&quot;</span>{'\n'}
                {'  '}{'}'}],{'\n'}
                {'  '}<span className="tk-k">&quot;pagination&quot;</span>: {'{ '}<span className="tk-k">&quot;has_more&quot;</span>: <span className="tk-n">true</span>{' }'}{'\n'}
                {'}'}
            </pre>
        </div>
    )
}

function DevHero({ capabilities, specInfo, health, canManageApi, goTo, openApiManagement }) {
    const t = useT()
    const version = capabilities?.api_version || 'v1'
    const apiOk = health?.status === 'ok'
    const errorCount = capabilities?.errors?.length
    const scopeCount = capabilities?.scopes ? Object.keys(capabilities.scopes).length : undefined

    return (
        <section className="dp-hero lq-card" aria-labelledby="dp-hero-title">
            <span className="dp-hero__glow" aria-hidden="true" />
            <div className="dp-hero__grid">
                <div className="dp-hero__copy">
                    <div className="dp-hero__badges">
                        <span className="lq-tag lq-tag--ok">
                            <i className={`dp-dot${apiOk ? ' is-ok' : ''}`} aria-hidden="true" />
                            {t('devPortal.hero.versionBadge', { version })}
                        </span>
                        {specInfo?.version && (
                            <span className="lq-tag lq-tag--info">OpenAPI {specInfo.version}</span>
                        )}
                        <span className="lq-tag lq-tag--violet">{t('devPortal.hero.mcpBadge')}</span>
                    </div>
                    <h1 id="dp-hero-title" className="dp-hero__title">{t('devPortal.hero.title')}</h1>
                    <p className="dp-hero__lead">{t('devPortal.hero.lead')}</p>
                    <div className="dp-hero__ctas">
                        <Button
                            type="primary"
                            size="large"
                            icon={<RocketOutlined />}
                            onClick={() => goTo('getting-started')}
                        >
                            {t('devPortal.hero.ctaFirstRequest')}
                        </Button>
                        {canManageApi ? (
                            <Button size="large" icon={<KeyOutlined />} onClick={openApiManagement}>
                                {t('devPortal.hero.ctaGetKey')}
                            </Button>
                        ) : (
                            <Button size="large" icon={<KeyOutlined />} onClick={() => goTo('getting-started')}>
                                {t('devPortal.hero.ctaRequestKey')}
                            </Button>
                        )}
                        <Button size="large" icon={<RobotOutlined />} onClick={() => goTo('mcp')}>
                            {t('devPortal.hero.ctaMcp')}
                        </Button>
                    </div>
                    <p className="dp-hero__hint">
                        <ApiOutlined aria-hidden="true" />{' '}
                        {canManageApi ? t('devPortal.hero.hintAdmin') : t('devPortal.hero.hintMember')}
                    </p>
                </div>
                <Terminal t={t} />
            </div>
            <div className="dp-hero__kpis">
                <Kpi value={ALL_ENDPOINTS.length} label={t('devPortal.hero.kpiOps')} hint={t('devPortal.hero.kpiOpsHint')} />
                <Kpi
                    value={MCP_TOOLS.length}
                    label={t('devPortal.hero.kpiTools')}
                    hint={t('devPortal.hero.kpiToolsHint', { read: MCP_READ_TOOLS.length, write: MCP_WRITE_TOOLS.length })}
                />
                <Kpi value={errorCount ?? '—'} label={t('devPortal.hero.kpiErrors')} hint={t('devPortal.hero.kpiErrorsHint')} />
                <Kpi value={scopeCount ?? '—'} label={t('devPortal.hero.kpiScopes')} hint={t('devPortal.hero.kpiScopesHint')} />
            </div>
        </section>
    )
}

export default DevHero
