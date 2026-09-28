/**
 * =============================================================================
 * HERMES - Filtre paneli (drawer)
 * =============================================================================
 * Sayfadan cikarildi: TasksPage bir ORKESTRASYON dosyasidir ve yapisal
 * kilit onu <450 satirda tutar. Hermes Liquid: kenardan kopuk yuzen cam
 * panel (`lq-sheet`), ikonlu baslik. Davranis birebir aynidir.
 * =============================================================================
 */
import { Drawer } from 'antd'
import { FilterOutlined } from '@ant-design/icons'

import { ModalHead } from '../../../components/liquid'
import TaskFilterBar from './TaskFilterBar'
import { useT } from '../../../i18n'

function TaskFiltersDrawer({
    open, onClose, placement, filters, customers, projects, subProjects,
    assigneeOptions, onStatusChange, onPriorityChange, onCustomerChange,
    onProjectChange, onSubProjectChange, onAssigneeChange, onClear,
}) {
    const t = useT()
    return (
        <Drawer
            title={(
                <ModalHead
                    icon={<FilterOutlined />}
                    title={t('tasks.filters')}
                    subtitle={t('taskUi.filtersHint')}
                />
            )}
            open={open}
            onClose={onClose}
            placement={placement}
            height="auto"
            width={360}
            className="task-filters-drawer"
            rootClassName="lq-sheet"
        >
            <TaskFilterBar
                filters={filters}
                customers={customers}
                projects={projects}
                subProjects={subProjects}
                assigneeOptions={assigneeOptions}
                onStatusChange={onStatusChange}
                onPriorityChange={onPriorityChange}
                onCustomerChange={onCustomerChange}
                onProjectChange={onProjectChange}
                onSubProjectChange={onSubProjectChange}
                onAssigneeChange={onAssigneeChange}
                onClear={onClear}
            />
        </Drawer>
    )
}

export default TaskFiltersDrawer
