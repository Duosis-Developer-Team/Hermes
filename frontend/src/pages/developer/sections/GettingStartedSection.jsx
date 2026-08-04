/**
 * Developer Portal — Getting Started (Stage 4A).
 *
 * Bes adimli onboarding. Admin olmayan kullanici token OLUSTURAMAZ —
 * "contact an administrator" yonlendirmesi gosterilir (onayli D1).
 * Tum ornekler kurgusaldir; gercek token/veri ASLA gosterilmez.
 */
import { Alert, Button, Tag } from 'antd'
import { ApiOutlined } from '@ant-design/icons'
import { Link } from 'react-router-dom'
import CodeBlock from '../CodeBlock'

const STEP1_ENV = `# Keep the base URL and token out of your code:
export HERMES_BASE="https://<your-hermes-host>"
export HERMES_API_TOKEN="hms_dev_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"`

const STEP3_CURL = `curl -s "$HERMES_BASE/api/public/v1/me" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

const STEP3_RESPONSE = `{
  "client": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "name": "Example Integration",
    "type": "user",
    "environment": "dev",
    "status": "active",
    "bound_user_id": "9c858901-8a57-4791-81fe-4c455b099bc9"
  },
  "token": { "prefix": "hms_dev_x", "expires_at": null },
  "scopes": ["tasks:read", "work-logs:read"],
  "access": [{ "access_type": "user", "target_id": "9c85…" }]
}`

const STEP4_CURL = `curl -s "$HERMES_BASE/api/public/v1/tasks?limit=5&sort=-updated_at" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

const STEP4_RESPONSE = `{
  "data": [
    {
      "task_code": "TASK-12",
      "task_type": "task",
      "title": "Renew TLS certificate",
      "status": "in_progress",
      "priority": "high",
      "customer": { "id": "…", "name": "Example Customer" },
      "project": { "id": "…", "name": "Example Project" }
    }
  ],
  "pagination": { "limit": 5, "offset": 0, "count": 1, "has_more": false }
}`

const STEP5_CURL = `curl -s -X POST "$HERMES_BASE/api/public/v1/tasks/TASK-12/comments" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: first-comment-0001" \\
  -d '{"body": "Deployed to staging, please verify."}'`

function GettingStartedSection({ isAdmin, goTo }) {
    return (
        <div className="dp-section">
            <h2>Getting Started</h2>
            <p className="dp-lead">
                Five steps from zero to a working integration. Every snippet
                uses fictional data — replace the placeholders with your own
                values.
            </p>

            <ol className="dp-steps">
                <li>
                    <h3>1 · Get an API client and token</h3>
                    <p>
                        API clients and tokens are created by Hermes
                        administrators in <b>API Management</b>. For most
                        integrations you want a <b>user-bound</b> client (it
                        acts as you, with your permissions and it is the only
                        type that can write). <b>Service</b> clients are
                        read-only in v1. Ask for the smallest set of scopes
                        your integration needs.
                    </p>
                    {isAdmin ? (
                        /* Kullanici bulgusu: aksiyon metne yapisikti ve
                           parlak maviydi. Artik kendi nefes payi olan bir
                           aksiyon satirinda ve ortak premium dilde. */
                        <div className="dp-step-actions">
                            <Link to="/api-management">
                                <Button className="h-create-action" icon={<ApiOutlined />}>
                                    Open API Management
                                </Button>
                            </Link>
                        </div>
                    ) : (
                        <Alert
                            type="info"
                            showIcon
                            message="You need an administrator for this step"
                            description={
                                'Contact a Hermes administrator and tell ' +
                                'them which resources you need (for ' +
                                'example: read tasks, create work logs). ' +
                                'They will create an API client bound to ' +
                                'your user and hand you the token.'
                            }
                        />
                    )}
                </li>

                <li>
                    <h3>2 · Store the token securely</h3>
                    <p>
                        The token is shown <b>exactly once</b> when it is
                        created — Hermes stores only a hash and can never
                        show it again. Keep it in an environment variable or
                        a secret manager; never commit it, never log it.
                    </p>
                    <CodeBlock title="shell" code={STEP1_ENV} />
                </li>

                <li>
                    <h3>3 · Verify the token</h3>
                    <p>
                        <code>GET /v1/me</code> needs no scopes and answers
                        “who am I, what may I do” in one call:
                    </p>
                    <CodeBlock title="curl" code={STEP3_CURL} />
                    <CodeBlock title="response (fictional)" lang="json" code={STEP3_RESPONSE} />
                </li>

                <li>
                    <h3>4 · Read your first data</h3>
                    <p>
                        List endpoints share one pagination envelope:{' '}
                        <code>data</code> plus <code>pagination</code> with{' '}
                        <code>limit / offset / count / has_more</code>. Sort
                        with <code>field</code> or <code>-field</code>.
                    </p>
                    <CodeBlock title="curl" code={STEP4_CURL} />
                    <CodeBlock title="response (fictional)" lang="json" code={STEP4_RESPONSE} />
                </li>

                <li>
                    <h3>5 · Optional: your first write</h3>
                    <p>
                        Writes require a <b>user-bound</b> client and the
                        matching write scope (here <code>tasks:comment</code>).
                        The <code>Idempotency-Key</code> header makes retries
                        safe: the same key replays the original response for
                        24 hours instead of creating a duplicate.
                    </p>
                    <CodeBlock title="curl" code={STEP5_CURL} />
                </li>
            </ol>

            <h3>If something fails</h3>
            <ul className="dp-list">
                <li>
                    <Tag>401 invalid_token</Tag> missing/mistyped{' '}
                    <code>Authorization: Bearer</code> header, or a revoked/
                    expired token — see{' '}
                    <button
                        type="button"
                        className="dp-inline-link"
                        onClick={() => goTo('authentication')}
                    >
                        Authentication
                    </button>
                    .
                </li>
                <li>
                    <Tag>403 insufficient_scope</Tag> the token lacks the
                    scope the endpoint requires — ask an administrator to
                    extend the client's scopes.
                </li>
                <li>
                    <Tag>403 resource_access_denied</Tag> a write attempted
                    with a service client (read-only in v1).
                </li>
                <li>
                    <Tag>404 resource_not_found</Tag> the record does not
                    exist <i>or</i> is outside your token's data access —
                    the API deliberately does not reveal which.
                </li>
            </ul>
        </div>
    )
}

export default GettingStartedSection
