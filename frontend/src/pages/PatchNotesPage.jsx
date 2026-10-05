/**
 * =============================================================================
 * HERMES - Surum notlari (/patch-notes)
 * =============================================================================
 * Her surumde neyin degistigini anlatan sayfa. Veri features/releases
 * (tek kaynak), metinler i18n `patchNotes.*` + `releases.<key>.*`.
 *
 * Iki baglam, TEK icerik:
 *   - oturum acik  → kabugun (ada + dock) icinde, MainLayout Outlet'i
 *   - oturum yok   → landing cercevesiyle herkese acik (paylasilabilir link)
 * Masaustu uygulamasi ayni SPA rotasina gider (tam sayfa yuklemesi yok).
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
    AppleFilled, ArrowLeftOutlined, BugOutlined, CheckOutlined, LinkOutlined, RiseOutlined,
    StarOutlined, WindowsFilled,
} from '@ant-design/icons'
import dayjs from 'dayjs'

import LiquidBackdrop from '../components/layout/LiquidBackdrop'
import { AppMock, FeatureVisual } from './landing/LandingPage'
import { CookieNotice, LandingFooter, LandingIsland } from './landing/LandingChrome'
import {
    CHANGE_KINDS, RELEASES, changeCounts, formatVersion, versionAnchor,
} from '../features/releases/releases'
import { useT } from '../i18n'
import './landing/LandingPage.css'
import './PatchNotesPage.css'

const KIND_ICON = {
    new: <StarOutlined />,
    improved: <RiseOutlined />,
    fixed: <BugOutlined />,
}

/** Landing'de olmayan uc kucuk gorsel; digerleri FeatureVisual'dan. */
function ReleaseVisual({ kind }) {
    if (kind === 'liquid') {
        return (
            <div className="pn-v pn-v--liquid" aria-hidden="true">
                <span className="pn-v__island">
                    <span className="ld-mark ld-mark--xs"><i /></span>
                    <i className="is-on" /><i /><i /><i />
                </span>
                <span className="pn-v__dock">
                    {['blue', 'green', 'violet', 'amber', 'ink'].map((c) => <i key={c} className={`is-${c}`} />)}
                </span>
            </div>
        )
    }
    if (kind === 'desktop') {
        return (
            <div className="pn-v pn-v--desktop" aria-hidden="true">
                <span className="pn-v__window">
                    <span className="pn-v__lights"><i /><i /><i /></span>
                    <span className="pn-v__pane"><i /><i /><i /></span>
                </span>
                <span className="pn-v__os"><AppleFilled /><WindowsFilled /></span>
            </div>
        )
    }
    if (kind === 'brand') {
        return (
            <div className="pn-v pn-v--brand" aria-hidden="true">
                {/* Logo karolari: monogram (gercek logo yoksa Hermes'in yedegi de budur). */}
                {[['blue', 'H'], ['red', 'D'], ['green', 'L'], ['violet', 'SA']].map(([c, m], i) => (
                    <i key={c} className={`is-${c}`} style={{ animationDelay: `${i * 70}ms` }}>{m}</i>
                ))}
            </div>
        )
    }
    return <FeatureVisual kind={kind} />
}

function CopyLink({ anchor }) {
    const t = useT()
    const [copied, setCopied] = useState(false)
    const copy = async () => {
        const url = `${window.location.origin}${window.location.pathname}#${anchor}`
        try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
        } catch { /* panoya yazma kapali: sessiz */ }
    }
    return (
        <button type="button" className="pn-copy" onClick={copy} aria-live="polite">
            {copied ? <CheckOutlined aria-hidden="true" /> : <LinkOutlined aria-hidden="true" />}
            {copied ? t('patchNotes.copied') : t('patchNotes.copyLink')}
        </button>
    )
}

function Release({ release, latest }) {
    const t = useT()
    const k = (s) => `releases.${release.key}.${s}`
    const counts = changeCounts(release)
    const anchor = versionAnchor(release.version)
    return (
        <article className="pn-release" id={anchor} aria-labelledby={`${anchor}-title`}>
            <header className="pn-hero">
                <div className="pn-hero__text">
                    <span className="ld-eyebrow">{t('patchNotes.eyebrow')}</span>
                    <h1 className="pn-hero__title" id={`${anchor}-title`}>
                        Hermes <span className="pn-hero__ver">{formatVersion(release.version)}</span>
                    </h1>
                    <p className="pn-hero__name">{t(k('title'))}</p>
                    <p className="pn-hero__meta">
                        {latest && <span className="pn-chip pn-chip--live">{t('patchNotes.latest')}</span>}
                        <time dateTime={release.date}>
                            {t('patchNotes.released', { date: dayjs(release.date).format('D MMMM YYYY') })}
                        </time>
                    </p>
                    <p className="ld-lead pn-hero__lead">{t(k('summary'))}</p>
                    <ul className="pn-counts" aria-label={t('patchNotes.allChanges')}>
                        {CHANGE_KINDS.map((kind) => (
                            <li key={kind} className={`pn-count pn-count--${kind}`}>
                                <span aria-hidden="true">{KIND_ICON[kind]}</span>
                                {t(`patchNotes.count.${kind}`, { count: counts[kind] })}
                            </li>
                        ))}
                    </ul>
                </div>
                {latest && <div className="pn-hero__visual"><AppMock /></div>}
            </header>

            {release.highlights?.length > 0 && (
                <section className="pn-section" aria-labelledby={`${anchor}-hl`}>
                    <div className="pn-section__head">
                        <h2 id={`${anchor}-hl`}>{t('patchNotes.highlights')}</h2>
                        <p>{t('patchNotes.highlightsLead')}</p>
                    </div>
                    <ul className="pn-highlights">
                        {release.highlights.map((h, i) => (
                            <li key={h.id} className={`pn-hl pn-hl--${h.tone}`} style={{ animationDelay: `${i * 60}ms` }}>
                                <ReleaseVisual kind={h.visual} />
                                <h3>{t(k(`h.${h.id}.title`))}</h3>
                                <p>{t(k(`h.${h.id}.body`))}</p>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section className="pn-section" aria-labelledby={`${anchor}-all`}>
                <div className="pn-section__head pn-section__head--row">
                    <h2 id={`${anchor}-all`}>{t('patchNotes.allChanges')}</h2>
                    <CopyLink anchor={anchor} />
                </div>
                <div className="pn-changes">
                    {CHANGE_KINDS.filter((kind) => release.changes?.[kind]?.length).map((kind) => (
                        <section key={kind} className={`pn-group pn-group--${kind}`}>
                            <h3>
                                <span className="pn-group__icon" aria-hidden="true">{KIND_ICON[kind]}</span>
                                {t(`patchNotes.kind.${kind}`)}
                                <span className="pn-group__n">{release.changes[kind].length}</span>
                            </h3>
                            <ul>
                                {release.changes[kind].map((id) => <li key={id}>{t(k(`${kind}.${id}`))}</li>)}
                            </ul>
                        </section>
                    ))}
                </div>
            </section>
        </article>
    )
}

/** Sayfa icerigi (iki baglamda ortak). */
export function PatchNotesContent({ standalone = false }) {
    const t = useT()
    // Paylasilan #v1-0 baglantisi: ilgili surume kaydir.
    useEffect(() => {
        const id = window.location.hash.slice(1)
        const el = id && document.getElementById(id)
        if (el) el.scrollIntoView({ block: 'start' })
        else if (standalone) window.scrollTo(0, 0)
    }, [standalone])
    return (
        <div className={`pn${standalone ? ' pn--standalone' : ''}`}>
            {standalone && (
                <Link to="/" className="ld-back"><ArrowLeftOutlined aria-hidden="true" />{t('landing.backHome')}</Link>
            )}
            {RELEASES.length > 1 && (
                <nav className="pn-versions" aria-label={t('patchNotes.versions')}>
                    {RELEASES.map((r, i) => (
                        <a key={r.version} href={`#${versionAnchor(r.version)}`} className={i === 0 ? 'is-latest' : undefined}>
                            {formatVersion(r.version)}
                        </a>
                    ))}
                </nav>
            )}
            {RELEASES.map((r, i) => <Release key={r.version} release={r} latest={i === 0} />)}
            <p className="pn-versioning">{t('patchNotes.versioning')}</p>
        </div>
    )
}

/** Oturum yokken: landing cercevesi (ada, alt bilgi, cerez bildirimi). */
function PatchNotesPage({ standalone = false }) {
    const [cookieOpen, setCookieOpen] = useState(false)
    if (!standalone) return <PatchNotesContent />
    return (
        <div className="ld-page">
            <LiquidBackdrop />
            <LandingIsland />
            <main className="pn-public">
                <PatchNotesContent standalone />
            </main>
            <LandingFooter onCookiePrefs={() => setCookieOpen(true)} />
            <CookieNotice forceOpen={cookieOpen} onClose={() => setCookieOpen(false)} />
        </div>
    )
}

export default PatchNotesPage
