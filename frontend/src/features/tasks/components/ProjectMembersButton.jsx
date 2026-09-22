/**
 * =============================================================================
 * HERMES - Explorer'da "Uyeler" dugmesi (PM rework P2.1 / B2)
 * =============================================================================
 * Secili projenin uyelerini yonetebilen kullaniciya (lead ya da
 * projects.manage) dugme gosterir; drawer'i acar. Yetki karari sunucudan
 * (`can_manage`) — burada kural yok.
 *
 * SINIR: `components/tasks` ve `features/tasks/components` testlerde
 * QueryClientProvider OLMADAN da render edilir. Bu yuzden sorgu, provider
 * VARSA calisan bir ic bilesende durur; provider yoksa dugme cizilmez.
 * =============================================================================
 */
import { useContext, useState } from 'react'
import { Button } from 'antd'
import { TeamOutlined } from '@ant-design/icons'
import { QueryClientContext, useQuery } from '@tanstack/react-query'

import { projectService } from '../../../services/api'
import { queryKeys } from '../../../query/queryKeys'
import ProjectMembersDrawer from '../../../components/projects/ProjectMembersDrawer'
import { useT } from '../../../i18n'

function Inner({ projectId, projectName }) {
    const t = useT()
    const [open, setOpen] = useState(false)
    const members = useQuery({
        queryKey: queryKeys.projectMembers.byProject(projectId),
        queryFn: () => projectService.listMembers(projectId),
        enabled: Boolean(projectId),
        staleTime: 60 * 1000,
    })
    if (!members.data?.can_manage) return null
    return (
        <>
            <Button
                size="small"
                icon={<TeamOutlined />}
                className="tx-members-btn"
                onClick={() => setOpen(true)}
            >{t('projects.members')}</Button>
            <ProjectMembersDrawer
                open={open}
                projectId={projectId}
                projectName={projectName}
                onClose={() => setOpen(false)}
            />
        </>
    )
}

function ProjectMembersButton({ projectId, projectName }) {
    const client = useContext(QueryClientContext)
    if (!client || !projectId) return null
    return <Inner projectId={projectId} projectName={projectName} />
}

export default ProjectMembersButton
