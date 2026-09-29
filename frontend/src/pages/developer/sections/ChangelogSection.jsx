/**
 * Developer Portal — Degisiklik gunlugu.
 *
 * Veri-odakli: yeni surum = CHANGELOG dizisinin BASINA bir kayit eklemek.
 * Girdi bicimi: { version, date, titleKey, entries: [{ tag, key }] }.
 * Metinler sozlukte: devPortal.changelog.<key> (iki dilde); PR'da icerik
 * olarak review edilir. `date` ISO ay (YYYY-MM) — dile gore bicimlenir.
 */
import { useT } from '../../../i18n'
import { useLocaleStore } from '../../../stores/localeStore'
import { SectionHead } from '../parts'

const CHANGELOG = [
    {
        version: 'v1.2.0',
        date: '2026-07',
        titleKey: 'r120',
        entries: [
            { tag: 'API', key: 'r120_api_groups' },
            { tag: 'MCP', key: 'r120_mcp_group_tool' },
            { tag: 'MCP', key: 'r120_mcp_active' },
            { tag: 'Fix', key: 'r120_fix_directory' },
            { tag: 'Docs', key: 'r120_docs' },
        ],
    },
    {
        version: 'v1.1.0',
        date: '2026-07',
        titleKey: 'r110',
        entries: [
            { tag: 'API', key: 'r110_api_directory' },
            { tag: 'Platform', key: 'r110_platform_s2s' },
        ],
    },
    {
        version: 'v1.0.0',
        date: '2026-07',
        titleKey: 'r100',
        entries: [
            { tag: 'API', key: 'r100_api' },
            { tag: 'Auth', key: 'r100_auth_tokens' },
            { tag: 'Auth', key: 'r100_auth_layers' },
            { tag: 'Admin', key: 'r100_admin' },
            { tag: 'Docs', key: 'r100_docs' },
            { tag: 'Platform', key: 'r100_rate' },
            { tag: 'Platform', key: 'r100_idem' },
            { tag: 'Platform', key: 'r100_capabilities' },
        ],
    },
]

const TAG_TONE = {
    API: 'info',
    MCP: 'violet',
    Auth: 'violet',
    Admin: 'warn',
    Docs: 'ok',
    Fix: 'bad',
    Platform: '',
}

function monthLabel(iso, locale) {
    const [y, m] = iso.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(
        locale === 'tr' ? 'tr-TR' : 'en-US',
        { month: 'long', year: 'numeric', timeZone: 'UTC' },
    )
}

function ChangelogSection() {
    const t = useT()
    const locale = useLocaleStore((s) => s.locale)
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.changelog.eyebrow')}
                title={t('devPortal.changelog.title')}
                lead={t('devPortal.changelog.lead')}
            />
            <ol className="dp-timeline">
                {CHANGELOG.map((rel, i) => (
                    <li key={rel.version} className={`dp-release${i === 0 ? ' is-latest' : ''}`}>
                        <div className="dp-release__head">
                            <span className="dp-release__version">{rel.version}</span>
                            {i === 0 && <span className="lq-tag lq-tag--ok">{t('devPortal.changelog.latest')}</span>}
                            <b>{t(`devPortal.changelog.${rel.titleKey}`)}</b>
                            <span className="dp-muted">{monthLabel(rel.date, locale)}</span>
                        </div>
                        <ul className="dp-release__entries">
                            {rel.entries.map((e) => (
                                <li key={e.key}>
                                    <span className={`lq-tag${TAG_TONE[e.tag] ? ` lq-tag--${TAG_TONE[e.tag]}` : ''}`}>{e.tag}</span>
                                    <span>{t(`devPortal.changelog.${e.key}`)}</span>
                                </li>
                            ))}
                        </ul>
                    </li>
                ))}
            </ol>
        </div>
    )
}

export default ChangelogSection
