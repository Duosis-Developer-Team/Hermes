/**
 * Developer Portal — Sayfalama, filtreleme, siralama.
 * Limitler canli capabilities'ten. Metin: devPortal.paging.*
 */
import { useT } from '../../../i18n'
import CodeBlock from '../CodeBlock'
import { Bullets, Rich, SectionHead } from '../parts'

const ENVELOPE = `{
  "data": [ … ],
  "pagination": { "limit": 25, "offset": 0, "count": 25, "has_more": true }
}`

const PAGING = `# Page 1
curl -s "$HERMES_BASE/api/public/v1/work-logs?limit=50&offset=0" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"
# Next page while pagination.has_more is true
curl -s "$HERMES_BASE/api/public/v1/work-logs?limit=50&offset=50" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

const DELTA = `# Everything that changed since your last sync (tasks):
curl -s "$HERMES_BASE/api/public/v1/tasks?updated_after=2026-07-01T00:00:00Z&sort=updated_at" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

function PaginationSection({ capabilities }) {
    const t = useT()
    const p = capabilities?.pagination || { default_limit: 25, max_limit: 100 }
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.paging.eyebrow')}
                title={t('devPortal.paging.title')}
                lead={t('devPortal.paging.lead')}
            />

            <div className="dp-facts">
                <div className="dp-fact">
                    <b>{t('devPortal.paging.limitTitle')}</b>
                    <p><Rich text={t('devPortal.paging.limitText', { max: p.max_limit, def: p.default_limit })} /></p>
                </div>
                <div className="dp-fact">
                    <b>{t('devPortal.paging.moreTitle')}</b>
                    <p><Rich text={t('devPortal.paging.moreText')} /></p>
                </div>
                <div className="dp-fact">
                    <b>{t('devPortal.paging.deltaTitle')}</b>
                    <p><Rich text={t('devPortal.paging.deltaText')} /></p>
                </div>
            </div>

            <div className="dp-codegrid">
                <CodeBlock title={t('devPortal.paging.envelopeTitle')} lang="json" code={ENVELOPE} />
                <CodeBlock title={t('devPortal.paging.pagingTitle')} code={PAGING} />
            </div>

            <div className="lq-grp">{t('devPortal.paging.filterTitle')}</div>
            <dl className="lq-kv dp-kv">
                <dt>{t('devPortal.paging.ranges')}</dt><dd><Rich text={t('devPortal.paging.rangesText')} /></dd>
                <dt>{t('devPortal.paging.exact')}</dt><dd><Rich text={t('devPortal.paging.exactText')} /></dd>
                <dt>{t('devPortal.paging.search')}</dt><dd><Rich text={t('devPortal.paging.searchText')} /></dd>
                <dt>{t('devPortal.paging.sort')}</dt><dd><Rich text={t('devPortal.paging.sortText')} /></dd>
            </dl>

            <div className="lq-grp">{t('devPortal.paging.deltaTitle')}</div>
            <CodeBlock title={t('devPortal.paging.deltaCode')} code={DELTA} />
            <Bullets items={[t('devPortal.paging.unknownSort')]} />
        </div>
    )
}

export default PaginationSection
