/**
 * Developer Portal — Authentication (Stage 4A).
 * Token prefix'leri gibi canli degerler capabilities'ten okunur.
 */
import { Table, Tag } from 'antd'
import CodeBlock from '../CodeBlock'

const AUTH_HEADER = `curl -s "$HERMES_BASE/api/public/v1/tasks" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

function AuthenticationSection({ capabilities }) {
    const prefixes = capabilities?.authentication?.token_prefixes || [
        'hms_dev_',
        'hms_live_',
    ]

    const clientTypeRows = [
        {
            key: 'user',
            type: 'User-bound',
            actsAs: 'The bound Hermes user (their permissions apply)',
            reads: 'Ceiling: never beyond what the bound user can see',
            writes: 'Yes — the only client type that can write in v1',
        },
        {
            key: 'service',
            type: 'Service',
            actsAs: 'No user identity',
            reads: 'Whatever its data-access bindings grant',
            writes: 'No — read-only in v1 (writes return 403)',
        },
    ]

    return (
        <div className="dp-section">
            <h2>Authentication</h2>
            <p className="dp-lead">
                Every request authenticates with an API token in the{' '}
                <code>Authorization</code> header. Tokens are never accepted
                via query parameters or cookies, and your Hermes browser
                session is never used by the Public API.
            </p>
            <CodeBlock title="every request" code={AUTH_HEADER} />

            <h3>Token format and environments</h3>
            <ul className="dp-list">
                <li>
                    Tokens start with{' '}
                    {prefixes.map((p) => (
                        <Tag key={p}>
                            <code>{p}…</code>
                        </Tag>
                    ))}
                    — the prefix encodes the environment, and a token only
                    works against the matching environment.
                </li>
                <li>
                    The token value is shown <b>once</b>, at creation. Hermes
                    stores only a SHA-256 hash; nobody — including
                    administrators — can recover a lost token. Losing one
                    means rotating it.
                </li>
                <li>
                    Tokens may carry an expiry date. Expired tokens return{' '}
                    <Tag>401 expired_token</Tag>.
                </li>
            </ul>

            <h3>Rotation and revocation</h3>
            <ul className="dp-list">
                <li>
                    <b>Rotate</b> issues a new token and kills the old one in
                    the same operation — plan for a brief switchover in your
                    deployment.
                </li>
                <li>
                    <b>Revoke</b> stops a token immediately —{' '}
                    <Tag>401 revoked_token</Tag> from that moment on.
                </li>
                <li>
                    Disabling an API client stops <b>all</b> of its tokens at
                    once.
                </li>
                <li>
                    If a token ever leaks (a log line, a screenshot, a
                    repository), treat it as compromised: ask an
                    administrator to rotate it immediately.
                </li>
            </ul>

            <h3>Client types</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    { title: 'Type', dataIndex: 'type', width: 130 },
                    { title: 'Acts as', dataIndex: 'actsAs' },
                    { title: 'Reads', dataIndex: 'reads' },
                    { title: 'Writes', dataIndex: 'writes' },
                ]}
                dataSource={clientTypeRows}
                scroll={{ x: 'max-content' }}
            />
            <p>
                Scopes and data-access bindings are two <b>separate</b>{' '}
                authorization layers on the client: scopes gate operations
                (e.g. <code>tasks:read</code>), bindings gate records (e.g.
                “only customer X”). A request must pass both. The full
                catalog lives in the Scopes &amp; Data Access section
                (arriving with the next portal update) and in the{' '}
                <a
                    href="/api/public/v1/docs"
                    target="_blank"
                    rel="noreferrer"
                >
                    API reference
                </a>
                .
            </p>

            <h3>Good hygiene</h3>
            <ul className="dp-list">
                <li>One client per integration — never share tokens.</li>
                <li>
                    Request the minimum scopes; extending them later is one
                    admin action.
                </li>
                <li>
                    Send <code>X-Request-ID</code> values from error
                    responses when reporting problems — they let
                    administrators find your exact request in the audit log.
                </li>
            </ul>
        </div>
    )
}

export default AuthenticationSection
