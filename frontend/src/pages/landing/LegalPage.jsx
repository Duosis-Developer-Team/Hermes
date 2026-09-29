/**
 * =============================================================================
 * HERMES - Yasal sayfalar: KVKK aydinlatma metni, cerez politikasi
 * =============================================================================
 * Oturumdan bagimsiz, herkese acik (/kvkk, /cerez-politikasi). Bolum
 * duzeni features/landing/legalContent.js'ten, metinler i18n `legal.*`.
 * =============================================================================
 */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeftOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'

import LiquidBackdrop from '../../components/layout/LiquidBackdrop'
import { CONTROLLER, LEGAL_DOCS, LEGAL_TABLE_HEAD, LEGAL_UPDATED } from '../../features/landing/legalContent'
import { CookieNotice, LandingFooter, LandingIsland } from './LandingChrome'
import { useT } from '../../i18n'
import './LandingPage.css'

function LegalPage({ kind }) {
    const t = useT()
    const doc = LEGAL_DOCS[kind]
    const [cookieOpen, setCookieOpen] = useState(false)
    useEffect(() => { window.scrollTo(0, 0) }, [kind])
    return (
        <div className="ld-page">
            <LiquidBackdrop />
            <LandingIsland />
            <main className="ld-legal">
                <Link to="/" className="ld-back"><ArrowLeftOutlined aria-hidden="true" />{t('landing.backHome')}</Link>
                <article className="ld-legal__doc">
                    <h1 className="ld-h2">{t(doc.title)}</h1>
                    <p className="ld-legal__updated">{t('landing.updated', { date: dayjs(LEGAL_UPDATED).format('D MMMM YYYY') })}</p>
                    <p className="ld-lead">{t(doc.intro)}</p>
                    {kind === 'kvkk' && (CONTROLLER.address || CONTROLLER.contact) && (
                        <dl className="ld-legal__controller">
                            {CONTROLLER.address && (<><dt>{t('legal.controllerAddress')}</dt><dd>{CONTROLLER.address}</dd></>)}
                            {CONTROLLER.contact && (<><dt>{t('legal.controllerContact')}</dt><dd>{CONTROLLER.contact}</dd></>)}
                        </dl>
                    )}
                    {doc.sections.map((sec) => (
                        <section key={sec.h}>
                            <h2>{t(sec.h)}</h2>
                            {sec.p?.map((key) => <p key={key}>{t(key)}</p>)}
                            {sec.list && <ul>{sec.list.map((key) => <li key={key}>{t(key)}</li>)}</ul>}
                            {sec.table && (
                                <div className="ld-legal__table">
                                    <table>
                                        <thead><tr>{LEGAL_TABLE_HEAD.map((key) => <th key={key} scope="col">{t(key)}</th>)}</tr></thead>
                                        <tbody>{sec.table.map((row) => <tr key={row[0]}>{row.map((key) => <td key={key}>{t(key)}</td>)}</tr>)}</tbody>
                                    </table>
                                </div>
                            )}
                        </section>
                    ))}
                </article>
            </main>
            <LandingFooter onCookiePrefs={() => setCookieOpen(true)} />
            <CookieNotice forceOpen={cookieOpen} onClose={() => setCookieOpen(false)} />
        </div>
    )
}

export default LegalPage
