/**
 * =============================================================================
 * HERMES - Landing (oturumsuz ana sayfa, Hermes Liquid 30.09)
 * =============================================================================
 * Oturumu olmayan ziyaretci `/`da bunu gorur (App.jsx PublicHome):
 *   Dene   → /login (ayni sunucu; test ortaminda hermes.duosis.com)
 *   Indir  → #indir: macOS Apple Silicon / Intel (.dmg), Windows (.exe),
 *            Web. Dosya ve surum `/downloads/manifest.json`dan
 *            (features/landing/downloads.js); olmayan platform "Yakinda".
 * Gorseller CSS ile cizilmis urun maketleridir (aria-hidden, sus) —
 * gercek veri gostermez. Yasal: KVKK + cerez sayfalari, cerez bildirimi.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import dayjs from 'dayjs'
import { Link } from 'react-router-dom'
import {
    AppleFilled, CalendarOutlined, CheckSquareOutlined, ClockCircleOutlined,
    CustomerServiceOutlined, DownloadOutlined, DownOutlined, GlobalOutlined,
    HomeOutlined, LockOutlined, PlusOutlined, SearchOutlined, WindowsFilled,
} from '@ant-design/icons'

import LiquidBackdrop from '../../components/layout/LiquidBackdrop'
import { detectPlatform, fetchManifest, sizeInMb } from '../../features/landing/downloads'
import { CookieNotice, LandingFooter, LandingIsland } from './LandingChrome'
import { useT } from '../../i18n'
import './LandingPage.css'

/** Hero'daki uygulama penceresi maketi (ana sayfanin kucuk kopyasi). */
function AppMock() {
    const t = useT()
    return (
        <div className="ld-mock" aria-hidden="true">
            <div className="ld-mock__chrome"><i /><i /><i /></div>
            <div className="ld-mock__island">
                <span className="ld-mark ld-mark--xs"><i /></span>
                <span className="ld-mock__nav is-on" />
                <span className="ld-mock__nav" />
                <span className="ld-mock__nav" />
                <span className="ld-mock__nav" />
                <span className="ld-mock__pill" />
            </div>
            <div className="ld-mock__hello">
                <span className="ld-mark ld-mark--md"><i /></span>
                <b>{t('landing.mockGreeting')}</b>
            </div>
            <div className="ld-mock__grid">
                <div className="ld-mock__card ld-mock__card--week">
                    <small>{t('landing.mockWeek')}</small>
                    <div className="ld-mock__week">
                        <svg viewBox="0 0 64 64" className="ld-ring"><circle cx="32" cy="32" r="25" /><circle cx="32" cy="32" r="25" /></svg>
                        <div className="ld-mock__bars">
                            {[8, 7, 8, 5, 2].map((h, i) => <i key={i} style={{ '--h': `${(h / 8) * 100}%`, animationDelay: `${300 + i * 80}ms` }} />)}
                        </div>
                    </div>
                </div>
                <div className="ld-mock__card ld-mock__card--att">
                    <small>{t('landing.mockAttention')}</small>
                    <span className="ld-mock__row"><i className="is-bad">2</i>{t('landing.mockOverdue')}</span>
                    <span className="ld-mock__row"><i className="is-warn">1</i>{t('landing.mockToday')}</span>
                </div>
                <div className="ld-mock__card ld-mock__card--work">
                    <small>{t('landing.mockWork')}</small>
                    <div className="ld-mix"><i className="is-bad" /><i className="is-warn" /><i className="is-info" /></div>
                    <span className="ld-mock__line" /><span className="ld-mock__line ld-mock__line--short" />
                </div>
                <div className="ld-mock__card ld-mock__card--cal">
                    <small>{t('landing.mockCalendar')}</small>
                    <div className="ld-mock__next"><b>{t('landing.mockNext')}</b><span>14:00</span></div>
                </div>
            </div>
            <div className="ld-mock__dock">
                {['blue', 'green', 'violet', 'amber', 'ink'].map((c) => <i key={c} className={`is-${c}`} />)}
            </div>
            <div className="ld-toast ld-toast--a"><ClockCircleOutlined /> {t('landing.mockLogged')}</div>
            <div className="ld-toast ld-toast--b"><CheckSquareOutlined /> {t('landing.mockAssigned')}</div>
        </div>
    )
}

/** Ozellik karti ici kucuk gorseller. */
function FeatureVisual({ kind }) {
    if (kind === 'time') {
        return (
            <div className="ld-fv ld-fv--time" aria-hidden="true">
                {[8, 6, 8, 7, 3].map((h, i) => (
                    <span key={i}>
                        <i style={{ '--h': `${(h / 8) * 100}%`, animationDelay: `${i * 70}ms` }} />
                        {/* Gun kisaltmasi etkin dilden (dayjs yereli). */}
                        <small>{dayjs().day(i + 1).format('dd')}</small>
                    </span>
                ))}
            </div>
        )
    }
    if (kind === 'work') {
        return (
            <div className="ld-fv ld-fv--work" aria-hidden="true">
                {[3, 2, 2].map((n, c) => (
                    <span key={c} className="ld-fv__col">{Array.from({ length: n }, (_, i) => <i key={i} className={c === 0 && i === 0 ? 'is-hot' : undefined} />)}</span>
                ))}
            </div>
        )
    }
    if (kind === 'meet') {
        return (
            <div className="ld-fv ld-fv--meet" aria-hidden="true">
                <span className="is-past">09:30</span><span className="is-now">14:00</span><span>16:30</span>
            </div>
        )
    }
    if (kind === 'ticket') {
        return (
            <div className="ld-fv ld-fv--ticket" aria-hidden="true">
                <i className="is-new" /><i className="is-open" /><i className="is-done" /><i className="is-done" />
            </div>
        )
    }
    if (kind === 'home') {
        return (
            <div className="ld-fv ld-fv--home" aria-hidden="true">
                <svg viewBox="0 0 64 64" className="ld-ring"><circle cx="32" cy="32" r="25" /><circle cx="32" cy="32" r="25" /></svg>
                <span><i /><i /><i /></span>
            </div>
        )
    }
    return (
        <div className="ld-fv ld-fv--sec" aria-hidden="true">
            <LockOutlined />
        </div>
    )
}

const FEATURES = [
    ['time', <ClockCircleOutlined key="i" />, 'green'],
    ['work', <CheckSquareOutlined key="i" />, 'blue'],
    ['meet', <CalendarOutlined key="i" />, 'violet'],
    ['ticket', <CustomerServiceOutlined key="i" />, 'red'],
    ['home', <HomeOutlined key="i" />, 'amber'],
    ['sec', <LockOutlined key="i" />, 'ink'],
]
const FEATURE_KEYS = { time: 'Time', work: 'Work', meet: 'Meet', ticket: 'Ticket', home: 'Home', sec: 'Sec' }

const DOWNLOADS = [
    ['mac-arm64', <AppleFilled key="i" />, 'dlMacArm', 'dlMacArmHint'],
    ['mac-x64', <AppleFilled key="i" />, 'dlMacIntel', 'dlMacIntelHint'],
    ['win-x64', <WindowsFilled key="i" />, 'dlWin', 'dlWinHint'],
]

function DownloadSection() {
    const t = useT()
    const [manifest, setManifest] = useState(null)
    const [mine, setMine] = useState(null)
    useEffect(() => {
        let live = true
        fetchManifest().then((m) => { if (live) setManifest(m) })
        detectPlatform().then((p) => { if (live) setMine(p) })
        return () => { live = false }
    }, [])
    return (
        <section id="indir" className="ld-section ld-dl" aria-labelledby="ld-dl-title">
            <h2 id="ld-dl-title" className="ld-h2">{t('landing.dlTitle')}</h2>
            <p className="ld-lead">{t('landing.dlSub')}</p>
            <div className="ld-dl__grid">
                {DOWNLOADS.map(([key, icon, title, hint]) => {
                    const file = manifest?.files?.[key]
                    const size = sizeInMb(file?.size)
                    return (
                        <article key={key} className={`ld-dl__card${mine === key ? ' is-mine' : ''}`} data-platform={key}>
                            {mine === key && <span className="ld-dl__badge">{t('landing.dlRecommended')}</span>}
                            <span className="ld-dl__icon" aria-hidden="true">{icon}</span>
                            <b>{t(`landing.${title}`)}</b>
                            <small>{t(`landing.${hint}`)}</small>
                            <span className="ld-dl__meta">
                                {file && manifest?.version ? t('landing.dlVersion', { version: manifest.version }) : ''}
                                {file && size ? ` · ${t('landing.dlSize', { size })}` : ''}
                            </span>
                            {file ? (
                                <a className="ld-btn ld-btn--primary" href={file.href} download>
                                    <DownloadOutlined aria-hidden="true" />{t('landing.dlButton')}
                                </a>
                            ) : (
                                <span className="ld-btn ld-btn--ghost is-disabled" aria-disabled="true">{t('landing.dlSoon')}</span>
                            )}
                        </article>
                    )
                })}
                <article className="ld-dl__card" data-platform="web">
                    <span className="ld-dl__icon" aria-hidden="true"><GlobalOutlined /></span>
                    <b>{t('landing.dlWeb')}</b>
                    <small>{t('landing.dlWebHint')}</small>
                    <span className="ld-dl__meta" />
                    <Link className="ld-btn ld-btn--ghost" to="/login">{t('landing.dlOpenWeb')}</Link>
                </article>
            </div>
            <p className="ld-dl__note">{t('landing.dlNote')}</p>
        </section>
    )
}

function Faq() {
    const t = useT()
    const [open, setOpen] = useState(0)
    return (
        <section id="sss" className="ld-section ld-faq" aria-labelledby="ld-faq-title">
            <h2 id="ld-faq-title" className="ld-h2">{t('landing.faqTitle')}</h2>
            <div className="ld-faq__list">
                {[1, 2, 3, 4, 5].map((n, i) => (
                    <div key={n} className={`ld-faq__item${open === i ? ' is-open' : ''}`}>
                        <button
                            type="button"
                            aria-expanded={open === i}
                            aria-controls={`ld-faq-${n}`}
                            onClick={() => setOpen(open === i ? -1 : i)}
                        >
                            <span>{t(`landing.q${n}`)}</span>
                            <DownOutlined aria-hidden="true" />
                        </button>
                        <p id={`ld-faq-${n}`} hidden={open !== i}>{t(`landing.a${n}`)}</p>
                    </div>
                ))}
            </div>
        </section>
    )
}

function LandingPage() {
    const t = useT()
    const [cookieOpen, setCookieOpen] = useState(false)
    return (
        <div className="ld-page">
            <LiquidBackdrop />
            <LandingIsland sections={[['ozellikler', t('landing.navFeatures')], ['indir', t('landing.navApps')], ['sss', t('landing.navFaq')]]} />

            <main>
                {/* Hero */}
                <section className="ld-hero" aria-labelledby="ld-hero-title">
                    <div className="ld-hero__text">
                        <span className="ld-eyebrow">{t('landing.heroEyebrow')}</span>
                        <h1 id="ld-hero-title" className="ld-h1">{t('landing.heroTitle')}</h1>
                        <p className="ld-lead">{t('landing.heroSub')}</p>
                        <div className="ld-hero__cta">
                            <Link to="/login" className="ld-btn ld-btn--primary ld-btn--lg">{t('landing.tryCta')}</Link>
                            <a href="#indir" className="ld-btn ld-btn--ghost ld-btn--lg"><DownloadOutlined aria-hidden="true" />{t('landing.downloadCta')}</a>
                        </div>
                        <small className="ld-hero__meta">{t('landing.heroMeta')}</small>
                    </div>
                    <AppMock />
                </section>

                {/* Ozellikler */}
                <section id="ozellikler" className="ld-section" aria-labelledby="ld-feat-title">
                    <h2 id="ld-feat-title" className="ld-h2">{t('landing.featuresTitle')}</h2>
                    <p className="ld-lead">{t('landing.featuresSub')}</p>
                    <div className="ld-features">
                        {FEATURES.map(([kind, icon, tone]) => (
                            <article key={kind} className={`ld-feature ld-feature--${kind}`}>
                                <span className={`ld-feature__icon is-${tone}`} aria-hidden="true">{icon}</span>
                                <h3>{t(`landing.f${FEATURE_KEYS[kind]}Title`)}</h3>
                                <p>{t(`landing.f${FEATURE_KEYS[kind]}Text`)}</p>
                                <FeatureVisual kind={kind} />
                            </article>
                        ))}
                    </div>
                </section>

                {/* Her yerde: ada + dock */}
                <section className="ld-section ld-every" aria-labelledby="ld-every-title">
                    <div className="ld-every__text">
                        <h2 id="ld-every-title" className="ld-h2">{t('landing.everyTitle')}</h2>
                        <p className="ld-lead">{t('landing.everySub')}</p>
                        <ul className="ld-every__points">
                            <li>{t('landing.everyPoint1')}</li>
                            <li>{t('landing.everyPoint2')}</li>
                            <li>{t('landing.everyPoint3')}</li>
                        </ul>
                    </div>
                    <div className="ld-every__visual" aria-hidden="true">
                        <div className="ld-demo-island">
                            <span className="ld-mark ld-mark--xs"><i /></span>
                            <b>Hermes</b>
                            <span className="ld-demo-island__live"><i />14:00</span>
                            <SearchOutlined />
                        </div>
                        <div className="ld-devices">
                            <span><AppleFilled /> macOS</span>
                            <span><WindowsFilled /> Windows</span>
                            <span><GlobalOutlined /> Web</span>
                        </div>
                        <div className="ld-demo-dock">
                            {[['blue', <HomeOutlined key="i" />], ['green', <ClockCircleOutlined key="i" />], ['violet', <CalendarOutlined key="i" />], ['red', <CustomerServiceOutlined key="i" />], ['ink', <CheckSquareOutlined key="i" />]].map(([c, icon]) => (
                                <i key={c} className={`is-${c}`}>{icon}</i>
                            ))}
                            <span className="ld-demo-dock__sep" />
                            <i className="is-plus"><PlusOutlined /></i>
                        </div>
                    </div>
                </section>

                <DownloadSection />
                <Faq />

                {/* Son cagri */}
                <section className="ld-final" aria-labelledby="ld-final-title">
                    <span className="ld-mark ld-mark--lg" aria-hidden="true"><i /></span>
                    <h2 id="ld-final-title" className="ld-h2">{t('landing.finalTitle')}</h2>
                    <p className="ld-lead">{t('landing.finalSub')}</p>
                    <div className="ld-hero__cta">
                        <Link to="/login" className="ld-btn ld-btn--primary ld-btn--lg">{t('landing.tryCta')}</Link>
                        <a href="#indir" className="ld-btn ld-btn--ghost ld-btn--lg"><DownloadOutlined aria-hidden="true" />{t('landing.downloadCta')}</a>
                    </div>
                </section>
            </main>

            <LandingFooter onCookiePrefs={() => setCookieOpen(true)} />
            <CookieNotice forceOpen={cookieOpen} onClose={() => setCookieOpen(false)} />
        </div>
    )
}

export default LandingPage
