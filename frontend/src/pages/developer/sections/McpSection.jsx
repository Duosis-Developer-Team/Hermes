/**
 * Developer Portal — MCP (AI asistanlari).
 *
 * Durum ayrimi (CTO karari, 17.07.2026): SERVIS aktiftir; eksik olan tek
 * sey OAuth tabanli NATIVE CONNECTOR destegidir. Bu yuzden OAuth'un
 * yoklugu tum MCP urununu "beta" gostermek icin KULLANILMAZ — ayri bir
 * yetenek karti olarak durur ve durustce "not yet available" der.
 *
 * Client matrisi ../mcpClients.js icinde versiyonlu VERI olarak yasar:
 * test kanitidir, runtime metadata degil. "Verified" yalnizca gercekten
 * denenmis client'lar icindir. Tool listesi ../mcpTools.js (registry ile
 * testte birebir kilitli). Metin: devPortal.mcp.*, devPortal.tools.*,
 * devPortal.clients.*
 */
import { CheckCircleFilled, ExclamationCircleFilled, LockOutlined } from '@ant-design/icons'

import { useT } from '../../../i18n'
import CodeBlock from '../CodeBlock'
import { MCP_CLIENTS } from '../mcpClients'
import { MCP_READ_TOOLS, MCP_WRITE_TOOLS } from '../mcpTools'
import { Bullets, Fold, Rich, SectionHead } from '../parts'

const CONFIG_EXAMPLE = `{
  "mcpServers": {
    "hermes": {
      "url": "https://<your-hermes-host>/mcp",
      "headers": {
        "Authorization": "Bearer hms_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"
      }
    }
  }
}`

const SMOKE = `# 1) Unauthenticated challenge (expected: 401 + WWW-Authenticate)
curl -si -X POST https://<your-hermes-host>/mcp \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"0"}}}' | head -3

# 2) Authenticated tools/list
curl -s -X POST https://<your-hermes-host>/mcp \\
  -H 'Content-Type: application/json' \\
  -H 'Accept: application/json, text/event-stream' \\
  -H "Authorization: Bearer $HERMES_API_TOKEN" \\
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}'`

const GROUP_CALL = `{
  "name": "hermes_create_task_for_group",
  "arguments": {
    "title": "Rotate staging credentials",
    "description": "Every team member rotates their own staging token.",
    "customer_id": "3f1c0b6e-0000-4000-8000-000000000001",
    "project_id": "3f1c0b6e-0000-4000-8000-000000000002",
    "assignee_group_id": "3f1c0b6e-0000-4000-8000-000000000003",
    "scheduled_date": "2026-08-01",
    "due_date": "2026-08-15",
    "priority": "high"
  }
}`

const GROUP_RESULT = `{
  "assignment_batch_id": "9b2f7a10-0000-4000-8000-00000000000a",
  "group_id": "3f1c0b6e-0000-4000-8000-000000000003",
  "group_name": "Platform Team",
  "created_count": 5,
  "skipped_count": 1,
  "created_tasks": [
    { "task_code": "TASK-101", "assignee_user_id": "…", "status": "pending" }
  ]
}`

// Client durumu → sozluk anahtari + ton. Durum DEGERI veriden gelir.
const CLIENT_STATUS = {
    Verified: { key: 'statusVerified', tone: 'ok' },
    Limited: { key: 'statusLimited', tone: 'warn' },
    'Not yet tested': { key: 'statusUntested', tone: '' },
}

function Capability({ ok, label, value, children }) {
    return (
        <div className={`dp-cap${ok ? ' is-ok' : ' is-warn'}`}>
            <span className="dp-cap__icon" aria-hidden="true">
                {ok ? <CheckCircleFilled /> : <ExclamationCircleFilled />}
            </span>
            <div>
                <span className="dp-cap__label">{label}</span>
                <span className={`lq-tag ${ok ? 'lq-tag--ok' : 'lq-tag--warn'}`}>{value}</span>
                <p>{children}</p>
            </div>
        </div>
    )
}

function ToolList({ tools, write, t }) {
    return (
        <ul className="dp-tools">
            {tools.map((x) => (
                <li key={x.name}>
                    <code>{x.name}</code>
                    <span>{t(`devPortal.tools.${x.name}`)}</span>
                    {write && <LockOutlined className="dp-tools__lock" aria-label={t('devPortal.mcp.needsApproval')} />}
                </li>
            ))}
        </ul>
    )
}

function McpSection({ goTo }) {
    const t = useT()
    return (
        <div className="dp-section">
            <SectionHead
                eyebrow={t('devPortal.mcp.eyebrow')}
                title={t('devPortal.mcp.title')}
                lead={t('devPortal.mcp.lead')}
                extra={<span className="lq-tag lq-tag--ok">{t('devPortal.mcp.statusActive')}</span>}
            />

            <div className="dp-caps">
                <Capability ok label={t('devPortal.mcp.capService')} value={t('devPortal.mcp.statusActive')}>
                    {t('devPortal.mcp.capServiceText')}
                </Capability>
                <Capability ok label={t('devPortal.mcp.capBearer')} value={t('devPortal.mcp.supported')}>
                    <Rich text={t('devPortal.mcp.capBearerText')} />
                </Capability>
                <Capability label={t('devPortal.mcp.capOauth')} value={t('devPortal.mcp.notYetAvailable')}>
                    <Rich text={t('devPortal.mcp.capOauthText')} />
                </Capability>
            </div>

            <div className="lq-grp">{t('devPortal.mcp.connectTitle')}</div>
            <ol className="dp-steps is-compact">
                {['c1', 'c2', 'c3'].map((k, i) => (
                    <li key={k} className="dp-step">
                        <span className="dp-step__num" aria-hidden="true">{i + 1}</span>
                        <div className="dp-step__body">
                            <div className="dp-step__head"><h3>{t(`devPortal.mcp.${k}.title`)}</h3></div>
                            <p><Rich text={t(`devPortal.mcp.${k}.text`)} /></p>
                            {k === 'c2' && (
                                <CodeBlock title={t('devPortal.mcp.configTitle')} lang="json" code={CONFIG_EXAMPLE} />
                            )}
                        </div>
                    </li>
                ))}
            </ol>

            <div className="lq-grp">
                {t('devPortal.mcp.toolsTitle', { n: MCP_READ_TOOLS.length + MCP_WRITE_TOOLS.length })}
            </div>
            <div className="dp-toolcols">
                <div className="dp-toolcol">
                    <div className="dp-toolcol__head">
                        <span className="lq-tag lq-tag--info">{t('devPortal.mcp.readTools', { n: MCP_READ_TOOLS.length })}</span>
                        <small>{t('devPortal.mcp.readToolsHint')}</small>
                    </div>
                    <ToolList tools={MCP_READ_TOOLS} t={t} />
                </div>
                <div className="dp-toolcol">
                    <div className="dp-toolcol__head">
                        <span className="lq-tag lq-tag--violet">{t('devPortal.mcp.writeTools', { n: MCP_WRITE_TOOLS.length })}</span>
                        <small>{t('devPortal.mcp.writeToolsHint')}</small>
                    </div>
                    <ToolList tools={MCP_WRITE_TOOLS} write t={t} />
                </div>
            </div>

            <div className="lq-grp">{t('devPortal.mcp.clientsTitle')}</div>
            <ul className="dp-clients">
                {MCP_CLIENTS.map((c) => {
                    const st = CLIENT_STATUS[c.status] || CLIENT_STATUS['Not yet tested']
                    return (
                        <li key={c.key} className="dp-client">
                            <div className="dp-client__head">
                                <b>{c.client}</b>
                                <span className={`lq-tag${st.tone ? ` lq-tag--${st.tone}` : ''}`}>
                                    {t(`devPortal.mcp.${st.key}`)}
                                </span>
                            </div>
                            <span className="dp-client__meta">{c.transport} · {c.auth}</span>
                            <p>{t(`devPortal.clients.${c.key}.notes`)}</p>
                            <small>{t('devPortal.mcp.evidence')}: {t(`devPortal.clients.${c.key}.evidence`)}</small>
                        </li>
                    )
                })}
            </ul>
            <p className="dp-muted"><Rich text={t('devPortal.mcp.clientsLegend')} /></p>

            <div className="lq-note" role="note">
                <ExclamationCircleFilled aria-hidden="true" />
                <span><Rich text={t('devPortal.mcp.limitNote')} /></span>
            </div>

            <div className="lq-grp">{t('devPortal.mcp.detailsTitle')}</div>
            <div className="dp-folds">
                <Fold title={t('devPortal.mcp.f.transport.title')} hint={t('devPortal.mcp.f.transport.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.transport.b1'), t('devPortal.mcp.f.transport.b2'), t('devPortal.mcp.f.transport.b3')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.auth.title')} hint={t('devPortal.mcp.f.auth.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.auth.b1'), t('devPortal.mcp.f.auth.b2'), t('devPortal.mcp.f.auth.b3')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.see.title')} hint={t('devPortal.mcp.f.see.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.see.b1'), t('devPortal.mcp.f.see.b2'), t('devPortal.mcp.f.see.b3'), t('devPortal.mcp.f.see.b4')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.writes.title')} hint={t('devPortal.mcp.f.writes.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.writes.b1'), t('devPortal.mcp.f.writes.b2')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.group.title')} hint={t('devPortal.mcp.f.group.hint')}>
                    <p><Rich text={t('devPortal.mcp.f.group.lead')} /></p>
                    <Bullets items={[t('devPortal.mcp.f.group.b1'), t('devPortal.mcp.f.group.b2'), t('devPortal.mcp.f.group.b3'), t('devPortal.mcp.f.group.b4')]} />
                    <CodeBlock title={t('devPortal.mcp.f.group.callTitle')} lang="json" code={GROUP_CALL} />
                    <CodeBlock title={t('devPortal.mcp.f.group.resultTitle')} lang="json" code={GROUP_RESULT} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.idem.title')} hint={t('devPortal.mcp.f.idem.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.idem.b1'), t('devPortal.mcp.f.idem.b2')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.audit.title')} hint={t('devPortal.mcp.f.audit.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.audit.b1'), t('devPortal.mcp.f.audit.b2'), t('devPortal.mcp.f.audit.b3')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.safety.title')} hint={t('devPortal.mcp.f.safety.hint')}>
                    <Bullets items={[t('devPortal.mcp.f.safety.b1'), t('devPortal.mcp.f.safety.b2'), t('devPortal.mcp.f.safety.b3')]} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.smoke.title')} hint={t('devPortal.mcp.f.smoke.hint')}>
                    <CodeBlock title="curl" lang="bash" code={SMOKE} />
                </Fold>
                <Fold title={t('devPortal.mcp.f.trouble.title')} hint={t('devPortal.mcp.f.trouble.hint')}>
                    <Bullets items={[
                        t('devPortal.mcp.f.trouble.b1'), t('devPortal.mcp.f.trouble.b2'),
                        t('devPortal.mcp.f.trouble.b3'), t('devPortal.mcp.f.trouble.b4'),
                        t('devPortal.mcp.f.trouble.b5'),
                    ]} />
                </Fold>
            </div>

            <p className="dp-muted">
                {t('devPortal.mcp.scopesSame')}{' '}
                <button type="button" className="dp-link" onClick={() => goTo('scopes')}>
                    {t('devPortal.nav.scopes')}
                </button>
            </p>
        </div>
    )
}

export default McpSection
