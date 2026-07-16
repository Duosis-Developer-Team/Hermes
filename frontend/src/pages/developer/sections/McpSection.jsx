/**
 * Developer Portal — MCP Preparation (Stage 4C).
 * Onayli mesaj: Hermes MCP AYNI token/scope/binding/izin modelini
 * kullanacak; ayri bir kimlik dogrulama modeli YOK. MCP, Public API
 * uzerinde bilinclice INCE bir katmandir.
 */
import { Table, Tag } from 'antd'

function McpSection({ goTo }) {
    const mappingRows = [
        {
            key: '1',
            mcp: 'Server credential',
            api: 'The same Hermes API token (hms_…) you use today',
        },
        {
            key: '2',
            mcp: 'What tools may do',
            api: 'The token\'s scopes — identical catalog, identical checks',
        },
        {
            key: '3',
            mcp: 'What data tools see',
            api: 'The token\'s data-access bindings, unchanged',
        },
        {
            key: '4',
            mcp: 'Who writes act as',
            api: 'The bound Hermes user — user-bound rule carries over',
        },
        {
            key: '5',
            mcp: 'Errors, limits, retention',
            api: 'Same error envelope, rate limits and idempotency layer',
        },
    ]

    return (
        <div className="dp-section">
            <h2>
                MCP Preparation <Tag color="purple">coming later</Tag>
            </h2>
            <p className="dp-lead">
                A Hermes <b>MCP server</b> (Model Context Protocol) is on the
                roadmap: it will let AI tools — Claude, IDE agents and other
                MCP clients — read tasks, log time and manage work items by
                talking to Hermes natively.
            </p>

            <h3>One security model — not two</h3>
            <p>
                MCP will use <b>exactly</b> the same token model, the same
                scopes, the same data-access bindings and the same
                permissions as the Public API. There is <b>no separate
                authentication model</b>: connecting an AI tool to Hermes
                means giving it a Hermes API token, and everything you know
                from the{' '}
                <button
                    type="button"
                    className="dp-inline-link"
                    onClick={() => goTo('authentication')}
                >
                    Authentication
                </button>{' '}
                and{' '}
                <button
                    type="button"
                    className="dp-inline-link"
                    onClick={() => goTo('scopes')}
                >
                    Scopes &amp; Data Access
                </button>{' '}
                sections applies unchanged.
            </p>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    { title: 'MCP concern', dataIndex: 'mcp', width: 220 },
                    { title: 'Answered by (existing)', dataIndex: 'api' },
                ]}
                dataSource={mappingRows}
                scroll={{ x: 'max-content' }}
            />

            <h3>A thin layer, by design</h3>
            <ul className="dp-list">
                <li>
                    Every MCP tool will map to a <b>documented Public API
                    endpoint</b> — nothing bypasses the API, its permission
                    checks, its audit log or its rate limits.
                </li>
                <li>
                    That means this documentation stays authoritative: if
                    you understand the API reference, you understand what
                    the MCP tools can and cannot do.
                </li>
                <li>
                    Revoking a token disconnects the AI tool instantly —
                    the same operational controls administrators already
                    have.
                </li>
            </ul>

            <h3>How to prepare today</h3>
            <ul className="dp-list">
                <li>
                    Integrate against the Public API now — nothing is
                    throwaway; MCP rides on the same surface.
                </li>
                <li>
                    Use <b>user-bound</b> clients with <b>minimal scopes</b>{' '}
                    for anything an AI agent will eventually drive — the
                    least-privilege habits transfer directly.
                </li>
                <li>
                    Watch the Changelog: the MCP server will arrive as a
                    regular versioned release with its own portal section.
                </li>
            </ul>
        </div>
    )
}

export default McpSection
