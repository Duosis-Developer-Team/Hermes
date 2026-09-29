/**
 * Developer Portal — MCP tool listesi (VERI).
 *
 * `write: true` = registry'de `write=True` (readOnlyHint:false → client
 * insan onayi ister; user-bound olmayan token'a listelenmez bile).
 * Kisa aciklamalar sozlukte: `devPortal.tools.<name>`.
 *
 * portalReality testi bu listeyi mcp-service registry'siyle BIREBIR
 * kilitler (ad kumesi + yazma bayragi) — elle drift imkansiz.
 */

export const MCP_TOOLS = [
    { name: 'hermes_whoami', write: false },
    { name: 'hermes_list_tasks', write: false },
    { name: 'hermes_get_task', write: false },
    { name: 'hermes_get_task_activity', write: false },
    { name: 'hermes_list_task_comments', write: false },
    { name: 'hermes_list_customers', write: false },
    { name: 'hermes_get_customer', write: false },
    { name: 'hermes_list_projects', write: false },
    { name: 'hermes_get_project', write: false },
    { name: 'hermes_list_work_logs', write: false },
    { name: 'hermes_get_work_log', write: false },
    { name: 'hermes_list_meetings', write: false },
    { name: 'hermes_get_meeting', write: false },
    { name: 'hermes_list_users', write: false },
    { name: 'hermes_get_user', write: false },
    { name: 'hermes_list_groups', write: false },
    { name: 'hermes_get_group', write: false },
    { name: 'hermes_create_task', write: true },
    { name: 'hermes_create_task_for_group', write: true },
    { name: 'hermes_update_task', write: true },
    { name: 'hermes_add_task_comment', write: true },
    { name: 'hermes_complete_task', write: true },
    { name: 'hermes_change_task_status', write: true },
    { name: 'hermes_log_time', write: true },
]

export const MCP_READ_TOOLS = MCP_TOOLS.filter((x) => !x.write)
export const MCP_WRITE_TOOLS = MCP_TOOLS.filter((x) => x.write)
