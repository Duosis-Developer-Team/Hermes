/**
 * Developer Portal — Idempotency (Stage 4B).
 * Politika degerleri canli capabilities.writes.idempotency'den.
 */
import { Table } from 'antd'
import CodeBlock from '../CodeBlock'

const EXAMPLE = `curl -s -X POST "$HERMES_BASE/api/public/v1/work-logs" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: worklog-2026-07-15-a1b2c3" \\
  -d '{
    "customer_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "project_id":  "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "work_type_id":"9c858901-8a57-4791-81fe-4c455b099bc9",
    "date_worked": "2026-07-15",
    "duration_hours": 2.5,
    "description": "API integration support call."
  }'`

function IdempotencySection({ capabilities }) {
    const idem = capabilities?.writes?.idempotency || {
        header: 'Idempotency-Key',
        retention_hours: 24,
        replay_header: 'Idempotency-Replayed',
        in_progress_error_code: 'idempotency_request_in_progress',
    }

    const rows = [
        {
            key: '1',
            scenario: 'Same key + same payload (within retention)',
            result: `Stored response replayed with ${idem.replay_header}: true — no duplicate is created`,
        },
        {
            key: '2',
            scenario: 'Same key + different payload',
            result: '409 conflict — pick a new key for new work',
        },
        {
            key: '3',
            scenario: 'Same key while the original is still running',
            result: `409 ${idem.in_progress_error_code} — safe to retry after the original completes; the stored response is then replayed`,
        },
        {
            key: '4',
            scenario: `Key older than ${idem.retention_hours}h`,
            result: 'Treated as new — the key can be reused',
        },
        {
            key: '5',
            scenario: 'No header at all',
            result: 'Request works, but retries are NOT protected against duplicates',
        },
    ]

    return (
        <div className="dp-section">
            <h2>Idempotency</h2>
            <p className="dp-lead">
                Networks fail mid-request. Send an{' '}
                <code>{idem.header}</code> header on every POST and a retry
                can never create a duplicate: Hermes reserves the key{' '}
                <i>before</i> running your request, so even two racing
                requests with the same key produce at most one record.
            </p>

            <CodeBlock title="idempotent create" code={EXAMPLE} />

            <h3>Semantics ({idem.retention_hours}-hour retention)</h3>
            <Table
                className="dp-table"
                size="small"
                pagination={false}
                columns={[
                    { title: 'Scenario', dataIndex: 'scenario' },
                    { title: 'Result', dataIndex: 'result' },
                ]}
                dataSource={rows}
                scroll={{ x: 'max-content' }}
            />

            <h3>Practical guidance</h3>
            <ul className="dp-list">
                <li>
                    Key format: 8–128 characters of{' '}
                    <code>[A-Za-z0-9_-.]</code>, scoped to your API client.
                </li>
                <li>
                    Derive the key from <i>your</i> business identity of the
                    operation (order id, sync batch + row), not from a random
                    value generated per attempt — a fresh random key per
                    retry protects nothing.
                </li>
                <li>
                    On timeouts and 5xx: retry with the <b>same</b> key. On{' '}
                    <code>409 {idem.in_progress_error_code}</code>: wait
                    briefly, retry with the same key.
                </li>
                <li>
                    Detect replays via the{' '}
                    <code>{idem.replay_header}: true</code> response header
                    when you need to distinguish them.
                </li>
            </ul>
        </div>
    )
}

export default IdempotencySection
