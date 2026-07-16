/**
 * Developer Portal — Scopes & Data Access (Stage 4B).
 * Scope katalogu CANLI /v1/capabilities'ten gelir (drift yok).
 */
import { Table, Tag } from 'antd'

function ScopesSection({ capabilities }) {
    const scopeRows = Object.entries(capabilities?.scopes || {}).map(
        ([scope, description]) => ({
            key: scope,
            scope,
            description,
            reserved: description.startsWith('Reserved'),
        })
    )

    const bindingRows = [
        {
            key: 'global',
            type: 'global',
            grants: 'Every record (scopes still apply)',
            note: 'Cannot be combined with other bindings',
        },
        {
            key: 'user',
            type: 'user',
            grants: 'Records belonging to the listed users',
            note: 'Tasks they are assigned/assigner on, their work logs, meetings they attend',
        },
        {
            key: 'group',
            type: 'group',
            grants: 'Records of the group’s active members',
            note: 'Membership is resolved at request time',
        },
        {
            key: 'customer',
            type: 'customer',
            grants: 'Records belonging to the listed customers',
            note: 'Meetings are excluded (they have no customer relation)',
        },
        {
            key: 'project',
            type: 'project',
            grants: 'Records belonging to the listed projects',
            note: 'Meetings are excluded (they have no project relation)',
        },
    ]

    return (
        <div className="dp-section">
            <h2>Scopes &amp; Data Access</h2>
            <p className="dp-lead">
                Authorization has two independent layers, and every request
                must pass both. <b>Scopes</b> answer “which operations may
                this token call?”. <b>Data-access bindings</b> answer “which
                records may it see?”. A token with <code>tasks:read</code>{' '}
                but no bindings gets an empty list — fail-closed, never
                fail-open.
            </p>

            <h3>Scope catalog (live)</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    {
                        title: 'Scope',
                        dataIndex: 'scope',
                        width: 180,
                        render: (v, r) => (
                            <span>
                                <code>{v}</code>{' '}
                                {r.reserved && <Tag>reserved</Tag>}
                            </span>
                        ),
                    },
                    { title: 'Description', dataIndex: 'description' },
                ]}
                dataSource={scopeRows}
                scroll={{ x: 'max-content' }}
            />
            <p>
                <b>Reserved</b> scopes exist in the catalog but have no
                endpoints yet — granting them today gives no additional
                access. They will activate when their endpoints ship (with a
                changelog entry).
            </p>

            <h3>Data-access binding types</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    { title: 'Binding', dataIndex: 'type', width: 110,
                      render: (v) => <code>{v}</code> },
                    { title: 'Grants', dataIndex: 'grants' },
                    { title: 'Notes', dataIndex: 'note' },
                ]}
                dataSource={bindingRows}
                scroll={{ x: 'max-content' }}
            />
            <ul className="dp-list">
                <li>
                    Bindings across categories combine as a <b>union</b>: a
                    customer binding plus a user binding grants records
                    matching either.
                </li>
                <li>
                    <b>User-bound clients have a hard ceiling</b>: whatever
                    the bindings say, they can never see more than the bound
                    Hermes user can see in the app.
                </li>
            </ul>

            <h3>Derived reference visibility</h3>
            <p>
                <code>/v1/customers</code> and <code>/v1/projects</code> do{' '}
                <b>not</b> enumerate the company inventory. With user/group
                bindings you only see customers and projects that are
                actually referenced by tasks or work logs you can already
                access; explicit customer/project bindings expose exactly the
                bound entities; only global bindings see all active records.
            </p>

            <h3>Existence is never disclosed</h3>
            <p>
                A record outside your data access returns the <b>same</b>{' '}
                <code>404 resource_not_found</code> envelope as a record that
                does not exist. Do not treat 404 as proof of absence — it
                only means “not visible to this token”.
            </p>
        </div>
    )
}

export default ScopesSection
