/**
 * Developer Portal — Known Limitations (Stage 4C).
 * Onayli ilke: ASIRI seffaflik. E-posta cumlesi CTO onayli birebir metin.
 */
import { Tag } from 'antd'

function KnownLimitationsSection() {
    return (
        <div className="dp-section">
            <h2>Known Limitations</h2>
            <p className="dp-lead">
                We document limitations as plainly as features — plan your
                integration around these, and check the Changelog as they
                are lifted.
            </p>

            <ul className="dp-limits">
                <li>
                    <Tag color="orange">E-mail</Tag>
                    <div>
                        <b>
                            API-triggered task lifecycle actions currently
                            preserve Hermes activity and notification
                            records, but email delivery parity with
                            browser-triggered actions is not yet guaranteed.
                        </b>{' '}
                        In practice: creating/completing tasks through the
                        API records the same in-app activity and honours the
                        same admin notification rules, but recipients may not
                        receive e-mails for API-triggered events yet.
                        E-mails keep flowing for actions performed in the
                        Hermes web app.
                    </div>
                </li>
                <li>
                    <Tag color="orange">Rate limiter</Tag>
                    <div>
                        Rate limiting is currently enforced <b>in-memory,
                        per running instance</b>. Limits are accurate in the
                        current single-instance deployment; a shared
                        (Redis-backed) limiter is planned before horizontal
                        scaling. Always drive retry behaviour from the
                        response headers, not from assumptions about the
                        limiter.
                    </div>
                </li>
                <li>
                    <Tag>Directory</Tag>
                    <div>
                        <code>/v1/users</code> and <code>/v1/groups</code>{' '}
                        resolve identities with <b>least-privilege
                        visibility</b> — they are not a company directory
                        for non-global tokens. The backend directory
                        service requires an operations step (S2S
                        credential) on each deployment; until it is
                        enabled there, these endpoints return a temporary{' '}
                        <code>internal_error</code>. Work-log and task
                        payloads intentionally keep raw{' '}
                        <code>user_id</code> values — resolve them via the
                        directory when your token has{' '}
                        <code>users:read</code>.
                    </div>
                </li>
                <li>
                    <Tag color="orange">MCP — OAuth</Tag>
                    <div>
                        The MCP server itself is <b>active</b> and
                        bearer-token integrations are supported. What is
                        missing is an <b>OAuth 2.1 authorization server</b>:
                        MCP clients that require the full OAuth discovery
                        flow — such as Claude Desktop&apos;s native connector
                        — <b>cannot connect directly</b>, and no such
                        compatibility is claimed. The Protected Resource
                        Metadata document says this machine-readably rather
                        than implying support. Clients that send a custom{' '}
                        <code>Authorization</code> header are unaffected.
                        When OAuth arrives it will change the credential{' '}
                        <i>transport</i> only: the same API client, scopes,
                        bindings, environment, revocation and audit identity
                        stay authoritative — never a second permission model.
                    </div>
                </li>
                <li>
                    <Tag>Work logs</Tag>
                    <div>
                        <code>work_type_id</code> is <b>required</b> when
                        creating a work log (current Hermes business rule) —
                        ask your administrator for the valid work type ids
                        for your use case. A default-work-type fallback is
                        on the roadmap.
                    </div>
                </li>
                <li>
                    <Tag>Retention</Tag>
                    <div>
                        Operational data is not kept forever: API request
                        logs are retained for <b>90 days</b>; idempotency
                        keys for <b>25 hours</b> (the 24-hour replay window
                        plus a safety margin). Neither affects business data
                        — tasks, work logs, meetings, customers and projects
                        are never touched by cleanup.
                    </div>
                </li>
            </ul>
        </div>
    )
}

export default KnownLimitationsSection
