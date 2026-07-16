/**
 * Developer Portal — Rate Limits (Stage 4B).
 */
import CodeBlock from '../CodeBlock'

const HEADERS = `X-RateLimit-Limit: 60        # requests allowed in the current window
X-RateLimit-Remaining: 42    # requests left
X-RateLimit-Reset: 1784245260  # window end (unix epoch seconds)

# and only on 429:
Retry-After: 18              # seconds to wait`

const RETRY = `# Pseudo-code for a polite client
response = call_api()
if response.status == 429:
    wait(response.headers["Retry-After"])   # honour the server's number
    retry_with_same_idempotency_key()
elif response.status >= 500:
    exponential_backoff_then_retry()        # 1s, 2s, 4s… + jitter`

function RateLimitsSection() {
    return (
        <div className="dp-section">
            <h2>Rate Limits</h2>
            <p className="dp-lead">
                Requests are limited per token per minute. Every
                authenticated response tells you where you stand, so a
                well-behaved client never has to guess.
            </p>

            <CodeBlock title="response headers" code={HEADERS} />

            <h3>When you hit the limit</h3>
            <ul className="dp-list">
                <li>
                    You get <code>429 rate_limit_exceeded</code> (standard
                    error envelope) plus a <code>Retry-After</code> header —{' '}
                    <b>honour it</b> rather than hammering.
                </li>
                <li>
                    Combine retries with an <code>Idempotency-Key</code> on
                    POSTs so a retried write can never duplicate.
                </li>
                <li>
                    Idempotent replays still count against the limit — cache
                    responses on your side where possible.
                </li>
            </ul>
            <CodeBlock title="retry pattern" code={RETRY} />

            <h3>Staying under the limit</h3>
            <ul className="dp-list">
                <li>
                    Prefer <code>updated_after</code> delta syncs over full
                    re-reads, and the maximum <code>limit=100</code> page
                    size over many small pages.
                </li>
                <li>
                    Watch <code>X-RateLimit-Remaining</code> and slow down
                    before hitting zero.
                </li>
                <li>
                    If your integration legitimately needs more, ask a
                    Hermes administrator — limits are configurable per API
                    client, no code changes needed.
                </li>
            </ul>
        </div>
    )
}

export default RateLimitsSection
