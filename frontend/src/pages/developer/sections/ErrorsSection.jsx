/**
 * Developer Portal — Errors (Stage 4B, onayli D2).
 * Katalog CANLI /v1/capabilities.errors'tan render edilir — backend'le
 * drift YAPISAL olarak imkansiz (kalici hizalama testleri backend'de).
 */
import { Table, Tag } from 'antd'
import CodeBlock from '../CodeBlock'

const ENVELOPE = `{
  "error": {
    "code": "resource_not_found",
    "message": "Task not found.",
    "request_id": "req_a1b2c3d4e5"
  }
}`

function statusColor(status) {
    if (status >= 500) return 'red'
    if (status === 429) return 'orange'
    if (status >= 400) return 'gold'
    return 'default'
}

function ErrorsSection({ capabilities }) {
    const rows = (capabilities?.errors || []).map((e) => ({
        key: e.code,
        ...e,
    }))

    return (
        <div className="dp-section">
            <h2>Errors</h2>
            <p className="dp-lead">
                Every failure — auth, validation, permissions, rate limits,
                server errors — uses one envelope. Branch on{' '}
                <code>error.code</code> (stable, machine-readable), show{' '}
                <code>error.message</code> to humans, and log{' '}
                <code>error.request_id</code>.
            </p>

            <CodeBlock title="the only error shape" lang="json" code={ENVELOPE} />

            <h3>Error catalog (live)</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    {
                        title: 'Code',
                        dataIndex: 'code',
                        width: 260,
                        render: (v) => <code>{v}</code>,
                    },
                    {
                        title: 'HTTP',
                        dataIndex: 'status',
                        width: 80,
                        render: (v) => <Tag color={statusColor(v)}>{v}</Tag>,
                    },
                    { title: 'Meaning', dataIndex: 'description' },
                ]}
                dataSource={rows}
                scroll={{ x: 'max-content' }}
            />

            <h3>Working with errors</h3>
            <ul className="dp-list">
                <li>
                    <b>404 is not proof of absence</b> — records outside your
                    data access return the same envelope as nonexistent ones
                    (deliberate non-disclosure).
                </li>
                <li>
                    Codes are a stable contract: new codes may be added
                    (with a changelog entry), existing ones never change
                    meaning. Messages are human wording and may improve —
                    never parse them.
                </li>
                <li>
                    When reporting a problem to your Hermes administrators,
                    include the <code>request_id</code> (also present in the{' '}
                    <code>X-Request-ID</code> response header) — it locates
                    your exact request in the audit log.
                </li>
            </ul>
        </div>
    )
}

export default ErrorsSection
