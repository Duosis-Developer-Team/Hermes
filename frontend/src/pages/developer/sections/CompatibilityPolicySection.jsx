/**
 * Developer Portal — Compatibility & Deprecation Policy (Stage 4 final
 * polish, CTO istegi). Stripe/GitHub/Slack tarzi acik politika sayfasi.
 */
import { Table, Tag } from 'antd'

function CompatibilityPolicySection() {
    const rows = [
        {
            key: '1',
            change: 'Breaking changes',
            policy: (
                <span>
                    Only ever ship under a <b>new version prefix</b> (v2).
                    Nothing under <code>/v1</code> will break: fields are
                    never removed or retyped, response envelopes never
                    change shape, error codes never change meaning.
                </span>
            ),
        },
        {
            key: '2',
            change: 'Additive changes',
            policy: (
                <span>
                    New endpoints, optional fields, new enum values and new
                    error codes may appear in v1 at any time, always with a
                    Changelog entry. Build clients that ignore unknown
                    fields.
                </span>
            ),
        },
        {
            key: '3',
            change: 'Deprecations',
            policy: (
                <span>
                    Announced in the Changelog and in the affected
                    endpoint's documentation with a{' '}
                    <b>minimum 90-day notice</b> before behaviour changes —
                    and removal still only happens in a new major version.
                </span>
            ),
        },
        {
            key: '4',
            change: 'Security fixes',
            policy: (
                <span>
                    Applied to <b>all supported versions</b> immediately,
                    without notice if necessary. A security fix is never
                    held back for compatibility reasons.
                </span>
            ),
        },
        {
            key: '5',
            change: 'Version support',
            policy: (
                <span>
                    When v2 ships, v1 keeps working during a published
                    migration window (announced with the v2 release — at
                    least the same 90-day floor, expected longer).
                </span>
            ),
        },
    ]

    return (
        <div className="dp-section">
            <h2>Compatibility Policy</h2>
            <p className="dp-lead">
                What you can rely on when you build against{' '}
                <code>/api/public/v1</code>. Current status:{' '}
                <Tag color="green">v1 · Stable</Tag>{' '}
                <Tag>Backward compatible</Tag>{' '}
                <Tag color="default">Next planned: v2 (future)</Tag>
            </p>

            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    { title: 'Change type', dataIndex: 'change', width: 170 },
                    { title: 'Policy', dataIndex: 'policy' },
                ]}
                dataSource={rows}
                scroll={{ x: 'max-content' }}
            />

            <h3>What counts as breaking</h3>
            <ul className="dp-list">
                <li>
                    Removing/renaming a field, endpoint or enum value;
                    changing a field's type or an error code's meaning;
                    tightening validation on existing input; changing
                    pagination or envelope shapes.
                </li>
                <li>
                    <b>Not</b> breaking: new optional request fields, new
                    response fields, new endpoints, new enum values, new
                    error codes, improved human-readable{' '}
                    <code>error.message</code> wording (never parse
                    messages — branch on <code>error.code</code>).
                </li>
            </ul>

            <h3>How to stay compatible</h3>
            <ul className="dp-list">
                <li>Ignore unknown response fields.</li>
                <li>
                    Branch on <code>error.code</code>, never on message
                    text.
                </li>
                <li>
                    Treat enum-like strings (status, priority) as open
                    sets.
                </li>
                <li>
                    Watch the Changelog — additive changes and deprecation
                    notices land there first.
                </li>
            </ul>
        </div>
    )
}

export default CompatibilityPolicySection
