/**
 * Developer Portal — MCP client uyumluluk matrisi (versiyonlu VERI).
 *
 * Bu dosya TEST KANITIDIR, runtime metadata DEGIL — bu yuzden
 * capabilities/OpenAPI'den turetilmez ve bilerek elle yonetilir; PR'da
 * icerik olarak review edilir.
 *
 * DEGISMEZ KURAL: bir satir ancak o client FIILEN denendikten sonra
 * "Verified" olur (baglan → tools/list → okuma → onayli yazma). Tahmin,
 * beklenti veya "calismasi lazim" YAZILMAZ. Denenmemis her client
 * "Not yet tested" kalir — bu bir eksiklik degil, durustluktur.
 *
 * `evidence` alani her satirin dayanagini acikca soyler, boylece
 * "bunu nereden biliyoruz?" sorusunun cevabi kaybolmaz.
 */

export const STATUS_TONE = {
    Verified: 'green',
    'Not yet tested': 'default',
    Limited: 'orange',
}

export const MCP_CLIENTS = [
    {
        key: 'claude-code',
        client: 'Claude Code',
        status: 'Verified',
        transport: 'Streamable HTTP',
        auth: 'Bearer header',
        notes: 'Read and write tools exercised against live Hermes.',
        evidence:
            'Live hermes-test session, 17.07.2026: connect, scope-filtered ' +
            'tools/list, directory resolve, task creation.',
    },
    {
        key: 'cursor',
        client: 'Cursor',
        status: 'Verified',
        transport: 'Streamable HTTP',
        auth: 'Bearer header',
        notes: 'MCP JSON config verified.',
        evidence: 'Operator-run client test, 17.07.2026.',
    },
    {
        key: 'codex',
        client: 'Codex',
        status: 'Verified',
        transport: 'Streamable HTTP',
        auth: 'Bearer header',
        notes: 'Tool discovery and calls verified.',
        evidence: 'Operator-run client test, 17.07.2026.',
    },
    {
        key: 'claude-desktop-native',
        client: 'Claude Desktop — native connector',
        status: 'Limited',
        transport: 'Remote MCP',
        auth: 'OAuth expected',
        notes:
            'The native connector expects an OAuth flow; Hermes does not ' +
            'run an authorization server yet, so this path is unavailable.',
        evidence:
            'Follows from the absent OAuth authorization server (a known ' +
            'gap), not from a client test.',
    },
    {
        key: 'claude-desktop-bridge',
        client: 'Claude Desktop — via mcp-remote bridge',
        status: 'Not yet tested',
        transport: 'stdio bridge → HTTP',
        auth: 'Bearer header',
        notes:
            'The expected route for Desktop until native OAuth lands; not ' +
            'yet exercised end-to-end, so not claimed.',
        evidence: 'No test run recorded.',
    },
    {
        key: 'openai-mcp',
        client: 'OpenAI MCP tooling (Agents SDK / hosted MCP)',
        status: 'Not yet tested',
        transport: 'Streamable HTTP',
        auth: 'Bearer header',
        notes: 'No end-to-end run recorded; nothing claimed.',
        evidence: 'No test run recorded.',
    },
]

export const VERIFIED_CLIENTS = MCP_CLIENTS.filter(
    (c) => c.status === 'Verified'
).map((c) => c.client)
