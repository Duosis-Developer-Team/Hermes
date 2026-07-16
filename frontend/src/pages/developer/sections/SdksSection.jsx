/**
 * Developer Portal — Future SDKs (Stage 4 final polish, CTO istegi).
 * Simdilik "Coming Soon" — bugunku resmi yol OpenAPI-tabanli uretim.
 */
import { Tag } from 'antd'

const SDKS = [
    { key: 'python', name: 'Python', hint: 'pip install hermes-sdk' },
    { key: 'ts', name: 'TypeScript', hint: 'npm install @hermes/sdk' },
    { key: 'csharp', name: 'C#', hint: 'dotnet add package Hermes.Sdk' },
    { key: 'go', name: 'Go', hint: 'go get hermes-sdk' },
    { key: 'java', name: 'Java', hint: 'maven: hermes-sdk' },
]

function SdksSection({ goTo }) {
    return (
        <div className="dp-section">
            <h2>
                SDKs <Tag color="purple">coming soon</Tag>
            </h2>
            <p className="dp-lead">
                Official client libraries are planned. Until they ship, the
                supported path is generating a client from the OpenAPI
                schema — it covers every endpoint and stays current
                automatically.
            </p>

            <div className="dp-cards">
                {SDKS.map((s) => (
                    <div key={s.key} className="dp-card is-static dp-sdk">
                        <span className="dp-card-title">{s.name}</span>
                        <span className="dp-card-sub">
                            <code>{s.hint}</code>
                        </span>
                        <Tag>Coming Soon</Tag>
                    </div>
                ))}
            </div>

            <h3>Today: generate from OpenAPI</h3>
            <ul className="dp-list">
                <li>
                    Download the schema from the{' '}
                    <button
                        type="button"
                        className="dp-inline-link"
                        onClick={() => goTo('api-explorer')}
                    >
                        API Explorer
                    </button>{' '}
                    and feed it to openapi-generator, orval, Kiota, or your
                    stack's equivalent.
                </li>
                <li>
                    Generated clients inherit the compatibility guarantees —
                    additive API changes will not break them (see the
                    Compatibility Policy).
                </li>
                <li>
                    When official SDKs ship, they will be announced in the
                    Changelog with migration notes.
                </li>
            </ul>
        </div>
    )
}

export default SdksSection
