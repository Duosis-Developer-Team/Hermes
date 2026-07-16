/**
 * Developer Portal — Pagination, Filtering & Sorting (Stage 4B).
 * Limitler canli capabilities'ten.
 */
import CodeBlock from '../CodeBlock'

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
    const p = capabilities?.pagination || {
        default_limit: 25,
        max_limit: 100,
    }
    return (
        <div className="dp-section">
            <h2>Pagination, Filtering &amp; Sorting</h2>
            <p className="dp-lead">
                Every list endpoint shares one contract, so code written for
                one resource paginates them all.
            </p>

            <h3>The page envelope</h3>
            <CodeBlock title="every list response" lang="json" code={ENVELOPE} />
            <ul className="dp-list">
                <li>
                    <code>limit</code> 1–{p.max_limit} (default{' '}
                    {p.default_limit}), <code>offset</code> ≥ 0.
                </li>
                <li>
                    <code>has_more</code> tells you whether another page
                    exists. There is deliberately <b>no total count</b> — it
                    keeps large listings fast.
                </li>
                <li>
                    Page until <code>has_more</code> is <code>false</code>:
                </li>
            </ul>
            <CodeBlock title="paging" code={PAGING} />

            <h3>Filtering conventions</h3>
            <ul className="dp-list">
                <li>
                    Ranges are <code>&lt;field&gt;_from</code> /{' '}
                    <code>&lt;field&gt;_to</code> — e.g.{' '}
                    <code>due_from/due_to</code> (tasks),{' '}
                    <code>date_from/date_to</code> (work logs),{' '}
                    <code>start_from/start_to</code> (meetings).
                </li>
                <li>
                    Exact matches use the field name:{' '}
                    <code>customer_id</code>, <code>project_id</code>,{' '}
                    <code>status</code>, <code>priority</code>,{' '}
                    <code>task_type</code>…
                </li>
                <li>
                    Name search on reference data is <code>q</code>{' '}
                    (contains, case-insensitive).
                </li>
                <li>
                    Delta sync: <code>updated_after</code> on tasks returns
                    only items changed since a timestamp — poll with it
                    instead of re-reading everything:
                </li>
            </ul>
            <CodeBlock title="delta sync" code={DELTA} />

            <h3>Sorting</h3>
            <ul className="dp-list">
                <li>
                    <code>sort=field</code> ascending,{' '}
                    <code>sort=-field</code> descending (e.g.{' '}
                    <code>-updated_at</code>, <code>-date_worked</code>,{' '}
                    <code>-start_datetime</code>).
                </li>
                <li>
                    Allowed values are enumerated per endpoint (see the API
                    Explorer) — an unknown value is a{' '}
                    <code>422 validation_error</code>, never silently
                    ignored.
                </li>
            </ul>
        </div>
    )
}

export default PaginationSection
