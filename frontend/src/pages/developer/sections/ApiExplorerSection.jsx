/**
 * Developer Portal — API Explorer (Stage 4B, onayli UX istegi).
 * Swagger IFRAME DEGIL: Hermes-native kartlarla uc erisim yolu.
 */
import {
    ApiOutlined,
    DownloadOutlined,
    FileTextOutlined,
} from '@ant-design/icons'

function ApiExplorerSection() {
    return (
        <div className="dp-section">
            <h2>API Explorer</h2>
            <p className="dp-lead">
                Three ways to explore the same contract — pick the one that
                fits your workflow. All of them describe every endpoint,
                schema, scope requirement and error code.
            </p>

            <div className="dp-explorer">
                <a
                    className="dp-explorer-card"
                    href="/api/public/v1/docs"
                    target="_blank"
                    rel="noreferrer"
                >
                    <ApiOutlined className="dp-card-icon" />
                    <span className="dp-card-title">Open Swagger UI</span>
                    <span className="dp-card-sub">
                        Interactive reference. Authorize with your bearer
                        token and try requests directly from the browser —
                        best for exploring an endpoint before writing code.
                    </span>
                </a>
                <a
                    className="dp-explorer-card"
                    href="/api/public/v1/openapi.json"
                    target="_blank"
                    rel="noreferrer"
                >
                    <FileTextOutlined className="dp-card-icon" />
                    <span className="dp-card-title">Open OpenAPI JSON</span>
                    <span className="dp-card-sub">
                        The raw machine-readable spec in a new tab — best for
                        checking exact field types, enums and response
                        envelopes.
                    </span>
                </a>
                <a
                    className="dp-explorer-card"
                    href="/api/public/v1/openapi.json"
                    download="hermes-public-api-v1.json"
                >
                    <DownloadOutlined className="dp-card-icon" />
                    <span className="dp-card-title">
                        Download OpenAPI JSON
                    </span>
                    <span className="dp-card-sub">
                        Save the spec as a file — best for importing into
                        IDEs, Postman/Insomnia collections, or client-code
                        generators (openapi-generator, orval, Kiota…).
                    </span>
                </a>
            </div>

            <div className="dp-note">
                <span>
                    The spec is generated from the running API, so it is
                    always current. Import it after each Hermes release to
                    pick up additive changes; breaking changes only ever
                    ship under a new version prefix.
                </span>
            </div>
        </div>
    )
}

export default ApiExplorerSection
