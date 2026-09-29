/**
 * Developer Portal — Kapsamlar ve veri erisimi.
 * Scope katalogu CANLI /v1/capabilities'ten gelir (drift yok); scope
 * aciklamalari da backend katalogunun kendi metnidir (API dili Ingilizce).
 * Metin: devPortal.scopes.*
 */
import { useT } from '../../../i18n'
import { Bullets, Rich, SectionHead } from '../parts'

const BINDINGS = ['global', 'user', 'group', 'customer', 'project']

function ScopesSection({ capabilities }) {
    const t = useT()
    const scopeRows = Object.entries(capabilities?.scopes || {}).map(
        ([scope, description]) => ({
            scope,
            description,
            reserved: String(description).startsWith('Reserved'),
        }),
    )

    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.scopes.eyebrow')}
                title={t('devPortal.scopes.title')}
                lead={t('devPortal.scopes.lead')}
            />

            <div className="dp-compare">
                <div className="dp-compare__card is-primary">
                    <div className="dp-compare__head">
                        <b>{t('devPortal.scopes.layerScopes')}</b>
                        <span className="lq-tag lq-tag--info">{t('devPortal.scopes.layerScopesQ')}</span>
                    </div>
                    <p><Rich text={t('devPortal.scopes.layerScopesText')} /></p>
                </div>
                <div className="dp-compare__card">
                    <div className="dp-compare__head">
                        <b>{t('devPortal.scopes.layerBindings')}</b>
                        <span className="lq-tag lq-tag--violet">{t('devPortal.scopes.layerBindingsQ')}</span>
                    </div>
                    <p><Rich text={t('devPortal.scopes.layerBindingsText')} /></p>
                </div>
            </div>

            <div className="lq-grp">{t('devPortal.scopes.catalogTitle')}</div>
            {scopeRows.length === 0 ? (
                <p className="dp-empty" role="status">{t('devPortal.common.loadingCatalog')}</p>
            ) : (
                <ul className="dp-scopes">
                    {scopeRows.map((r) => (
                        <li key={r.scope} className={r.reserved ? 'is-reserved' : ''}>
                            <code>{r.scope}</code>
                            {r.reserved && <span className="lq-tag">{t('devPortal.scopes.reserved')}</span>}
                            <span>{r.description}</span>
                        </li>
                    ))}
                </ul>
            )}
            <p className="dp-muted"><Rich text={t('devPortal.scopes.directoryNote')} /></p>

            <div className="lq-grp">{t('devPortal.scopes.bindingsTitle')}</div>
            <ul className="dp-rows">
                {BINDINGS.map((b) => (
                    <li key={b}>
                        <code>{b}</code>
                        <b>{t(`devPortal.scopes.b.${b}.grants`)}</b>
                        <span>{t(`devPortal.scopes.b.${b}.note`)}</span>
                    </li>
                ))}
            </ul>

            <div className="lq-grp">{t('devPortal.scopes.rulesTitle')}</div>
            <Bullets items={[
                t('devPortal.scopes.rule1'), t('devPortal.scopes.rule2'),
                t('devPortal.scopes.rule3'), t('devPortal.scopes.rule4'),
            ]} />
        </div>
    )
}

export default ScopesSection
