/**
 * Developer Portal — API referansi (+ eski "API Explorer" bolumu).
 *
 * Uc listesi TEK kaynaktan: ../endpoints.js (portalReality testi gercek
 * router'larla iki yonlu kilitler). Her satir taranabilir rozetler tasir:
 * Okuma/Yazma · yalnizca user-bound / service destekli · Idempotent ·
 * scope. Kopya butonu yalnizca "METHOD /tam/yol" metnini kopyalar.
 * Filtre istemci tarafindadir (yol, scope, aciklama). Metin:
 * devPortal.ref.*, devPortal.ep.*
 */
import { useState } from 'react'
import { Input } from 'antd'
import {
    ApiOutlined,
    CheckOutlined,
    CopyOutlined,
    DownloadOutlined,
    FileTextOutlined,
    SearchOutlined,
} from '@ant-design/icons'

import { useT } from '../../../i18n'
import { API_BASE_PATH, ENDPOINT_GROUPS } from '../endpoints'
import { Bullets, Fold, Method, Rich, SectionHead } from '../parts'

function EndpointRow({ ep, t }) {
    const [copied, setCopied] = useState(false)
    const full = `${ep.m} ${API_BASE_PATH}${ep.path}`
    const copy = async () => {
        try {
            await navigator.clipboard.writeText(full)
            setCopied(true)
            setTimeout(() => setCopied(false), 1500)
        } catch {
            /* pano engellendiyse sessiz kal: yol zaten gorunur ve secilebilir */
        }
    }
    return (
        <li className="dp-ep">
            <div className="dp-ep__sig">
                <Method m={ep.m} />
                <code className="dp-ep__path">{ep.path}</code>
                <button
                    type="button"
                    className="dp-ep__copy"
                    aria-label={t('devPortal.common.copyNamed', { name: full })}
                    title={copied ? t('devPortal.common.copied') : full}
                    onClick={copy}
                >
                    {copied ? <CheckOutlined /> : <CopyOutlined />}
                </button>
            </div>
            <p className="dp-ep__desc"><Rich text={t(`devPortal.ep.${ep.id}`)} /></p>
            <div className="dp-ep__badges">
                {ep.noAuth ? (
                    <span className="lq-tag">{t('devPortal.ref.noAuth')}</span>
                ) : ep.write ? (
                    <>
                        <span className="lq-tag lq-tag--violet">{t('devPortal.ref.write')}</span>
                        <span className="lq-tag lq-tag--warn">{t('devPortal.ref.userBound')}</span>
                    </>
                ) : (
                    <>
                        <span className="lq-tag lq-tag--ok">{t('devPortal.ref.read')}</span>
                        <span className="lq-tag">{t('devPortal.ref.serviceOk')}</span>
                    </>
                )}
                {ep.idempotent && <span className="lq-tag lq-tag--info">{t('devPortal.ref.idempotent')}</span>}
                {ep.scope && <span className="lq-tag dp-scope"><code>{ep.scope}</code></span>}
            </div>
        </li>
    )
}

function ApiReferenceSection() {
    const t = useT()
    const [filter, setFilter] = useState('')
    const f = filter.trim().toLowerCase()
    const hit = (ep) => !f || [ep.m, ep.path, ep.scope || '', t(`devPortal.ep.${ep.id}`)]
        .join(' ').toLowerCase().includes(f)
    const groups = ENDPOINT_GROUPS
        .map((g) => ({ ...g, endpoints: g.endpoints.filter(hit) }))
        .filter((g) => g.endpoints.length)

    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.ref.eyebrow')}
                title={t('devPortal.ref.title')}
                lead={t('devPortal.ref.lead')}
            />

            <div className="dp-tiles">
                <a className="dp-tile" href="/api/public/v1/docs" target="_blank" rel="noreferrer">
                    <ApiOutlined className="dp-tile__icon" />
                    <b>{t('devPortal.overview.res.swagger')}</b>
                    <span>{t('devPortal.ref.swaggerDesc')}</span>
                </a>
                <a className="dp-tile" href="/api/public/v1/openapi.json" target="_blank" rel="noreferrer">
                    <FileTextOutlined className="dp-tile__icon" />
                    <b>{t('devPortal.overview.res.spec')}</b>
                    <span>{t('devPortal.ref.specDesc')}</span>
                </a>
                <a className="dp-tile" href="/api/public/v1/openapi.json" download="hermes-public-api-v1.json">
                    <DownloadOutlined className="dp-tile__icon" />
                    <b>{t('devPortal.overview.res.download')}</b>
                    <span>{t('devPortal.ref.downloadDesc')}</span>
                </a>
            </div>

            <div className="dp-ref-tools">
                <Input
                    allowClear
                    className="dp-ref-filter"
                    prefix={<SearchOutlined />}
                    placeholder={t('devPortal.ref.filter')}
                    aria-label={t('devPortal.ref.filter')}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                />
                <span className="dp-muted"><Rich text={t('devPortal.ref.baseNote', { base: API_BASE_PATH })} /></span>
            </div>

            {groups.length === 0 && (
                <p className="dp-empty" role="status">{t('devPortal.ref.noMatch', { query: filter })}</p>
            )}

            <div className="dp-folds">
                {groups.map((g) => (
                    <Fold
                        key={g.key}
                        defaultOpen
                        title={t(`devPortal.ref.group.${g.key}.title`)}
                        hint={t('devPortal.ref.count', { n: g.endpoints.length })}
                    >
                        <p className="dp-muted"><Rich text={t(`devPortal.ref.group.${g.key}.note`)} /></p>
                        <ul className="dp-eps">
                            {g.endpoints.map((ep) => <EndpointRow key={`${ep.m} ${ep.path}`} ep={ep} t={t} />)}
                        </ul>
                    </Fold>
                ))}
            </div>

            <Bullets items={[t('devPortal.ref.noDelete'), t('devPortal.ref.specLive')]} />
        </div>
    )
}

export default ApiReferenceSection
