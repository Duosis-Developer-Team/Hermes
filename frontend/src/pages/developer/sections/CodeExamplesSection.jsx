/**
 * Developer Portal — Kod ornekleri.
 * curl / Python / JavaScript sekmeleri; TAMAMI kurgusal veri.
 * Ornek kod dizeleri BU dosyada kalir (frontendDebt'in console.log
 * taramasi bu dosyayi bilerek haric tutar). Metin: devPortal.examples.*
 */
import { useT } from '../../../i18n'
import CodeBlock, { CodeTabs } from '../CodeBlock'
import { Rich, SectionHead } from '../parts'

const LIST_CURL = `curl -s "$HERMES_BASE/api/public/v1/tasks?status=in_progress&limit=25" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN"`

const LIST_PY = `import os
import requests

BASE = os.environ["HERMES_BASE"]
TOKEN = os.environ["HERMES_API_TOKEN"]
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

tasks, offset = [], 0
while True:
    r = requests.get(
        f"{BASE}/api/public/v1/tasks",
        headers=HEADERS,
        params={"status": "in_progress", "limit": 100, "offset": offset},
        timeout=30,
    )
    r.raise_for_status()
    page = r.json()
    tasks.extend(page["data"])
    if not page["pagination"]["has_more"]:
        break
    offset += page["pagination"]["limit"]

print(f"{len(tasks)} open items")`

const LIST_JS = `const BASE = process.env.HERMES_BASE
const TOKEN = process.env.HERMES_API_TOKEN
const headers = { Authorization: \`Bearer \${TOKEN}\` }

const tasks = []
let offset = 0
while (true) {
    const url = new URL(\`\${BASE}/api/public/v1/tasks\`)
    url.searchParams.set('status', 'in_progress')
    url.searchParams.set('limit', '100')
    url.searchParams.set('offset', String(offset))

    const res = await fetch(url, { headers })
    if (!res.ok) throw new Error(\`HTTP \${res.status}\`)
    const page = await res.json()

    tasks.push(...page.data)
    if (!page.pagination.has_more) break
    offset += page.pagination.limit
}
console.log(\`\${tasks.length} open items\`)`

const CREATE_CURL = `curl -s -X POST "$HERMES_BASE/api/public/v1/work-logs" \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -H "Content-Type: application/json" \\
  -H "Idempotency-Key: sync-2026-07-15-row42" \\
  -d '{
    "customer_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "project_id":  "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "work_type_id":"9c858901-8a57-4791-81fe-4c455b099bc9",
    "date_worked": "2026-07-15",
    "duration_hours": 1.5,
    "description": "Reviewed integration test results.",
    "task_code": "TASK-12"
  }'`

const CREATE_PY = `import os
import requests

BASE = os.environ["HERMES_BASE"]
TOKEN = os.environ["HERMES_API_TOKEN"]

payload = {
    "customer_id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "project_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
    "work_type_id": "9c858901-8a57-4791-81fe-4c455b099bc9",
    "date_worked": "2026-07-15",
    "duration_hours": 1.5,
    "description": "Reviewed integration test results.",
    "task_code": "TASK-12",
}

r = requests.post(
    f"{BASE}/api/public/v1/work-logs",
    headers={
        "Authorization": f"Bearer {TOKEN}",
        # Anahtari ISIN kimliginden turet — retry ayni anahtari yollar.
        "Idempotency-Key": "sync-2026-07-15-row42",
    },
    json=payload,
    timeout=30,
)

if r.status_code == 201:
    log = r.json()
    replayed = r.headers.get("Idempotency-Replayed") == "true"
    print(f"work log #{log['id']} {'(replayed)' if replayed else 'created'}")
else:
    err = r.json()["error"]
    print(f"{err['code']}: {err['message']} (request {err['request_id']})")`

const CREATE_JS = `const res = await fetch(\`\${BASE}/api/public/v1/work-logs\`, {
    method: 'POST',
    headers: {
        Authorization: \`Bearer \${TOKEN}\`,
        'Content-Type': 'application/json',
        // Anahtari isin kimliginden turet — retry ayni anahtari yollar.
        'Idempotency-Key': 'sync-2026-07-15-row42',
    },
    body: JSON.stringify({
        customer_id: '3fa85f64-5717-4562-b3fc-2c963f66afa6',
        project_id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
        work_type_id: '9c858901-8a57-4791-81fe-4c455b099bc9',
        date_worked: '2026-07-15',
        duration_hours: 1.5,
        description: 'Reviewed integration test results.',
        task_code: 'TASK-12',
    }),
})

if (res.status === 201) {
    const log = await res.json()
    const replayed = res.headers.get('Idempotency-Replayed') === 'true'
    console.log(\`work log #\${log.id} \${replayed ? '(replayed)' : 'created'}\`)
} else {
    const { error } = await res.json()
    console.error(\`\${error.code}: \${error.message} (\${error.request_id})\`)
}`

const ERRORS_PY = `def call_hermes(fn, *, max_attempts=4):
    """Retry pattern: honour Retry-After on 429, back off on 5xx,
    surface everything else. Pair with Idempotency-Key on POSTs."""
    import time

    for attempt in range(1, max_attempts + 1):
        r = fn()
        if r.status_code == 429:
            time.sleep(int(r.headers.get("Retry-After", "5")))
            continue
        if r.status_code >= 500 and attempt < max_attempts:
            time.sleep(2 ** attempt)  # 2s, 4s, 8s…
            continue
        return r
    return r`

function Example({ title, text, children }) {
    return (
        <section className="dp-example">
            <h3>{title}</h3>
            {text && <p className="dp-muted"><Rich text={text} /></p>}
            {children}
        </section>
    )
}

function CodeExamplesSection() {
    const t = useT()
    const lang = t('devPortal.common.language')
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.examples.eyebrow')}
                title={t('devPortal.examples.title')}
                lead={t('devPortal.examples.lead')}
            />

            <Example title={t('devPortal.examples.listTitle')} text={t('devPortal.examples.listText')}>
                <CodeTabs
                    ariaLabel={lang}
                    samples={[
                        { key: 'curl', label: 'curl', lang: 'bash', code: LIST_CURL },
                        { key: 'py', label: 'Python', lang: 'python', code: LIST_PY },
                        { key: 'js', label: 'JavaScript', lang: 'js', code: LIST_JS },
                    ]}
                />
            </Example>

            <Example title={t('devPortal.examples.createTitle')} text={t('devPortal.examples.createText')}>
                <CodeTabs
                    ariaLabel={lang}
                    samples={[
                        { key: 'curl', label: 'curl', lang: 'bash', code: CREATE_CURL },
                        { key: 'py', label: 'Python', lang: 'python', code: CREATE_PY },
                        { key: 'js', label: 'JavaScript', lang: 'js', code: CREATE_JS },
                    ]}
                />
            </Example>

            <Example title={t('devPortal.examples.retryTitle')} text={t('devPortal.examples.retryText')}>
                <CodeBlock title="python" lang="python" code={ERRORS_PY} />
            </Example>
        </div>
    )
}

export default CodeExamplesSection
