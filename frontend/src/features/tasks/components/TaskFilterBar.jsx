/**
 * =============================================================================
 * HERMES - Capraz filtre cubugu (Sprint 5C)
 * =============================================================================
 * Status / Priority / Customer / Project / Sub Project. Hiyerarsi
 * kilitlidir: musteri secilmeden proje, proje secilmeden alt proje
 * secilemez — kararin kendisi useTaskFilters'ta (secim temizleme
 * kurali orada), burada yalnizca sunumu vardir.
 *
 * Etiketsiz kontroller: her Select acik bir erisilebilir ad tasir (§8);
 * placeholder erisilebilir ad DEGILDIR.
 * =============================================================================
 */
import { Button, Card, Select, Space } from 'antd'
import { FilterOutlined } from '@ant-design/icons'

import { PRIORITY_OPTIONS, STATUS_OPTIONS } from '../model/constants'

function TaskFilterBar({
    filters, customers, projects, subProjects,
    onStatusChange, onPriorityChange, onCustomerChange, onProjectChange,
    onSubProjectChange, onClear,
}) {
    return (
        <Card
            size="small"
            style={{
                marginBottom: 16,
                background: 'var(--c-surface-raised)',
                borderColor: 'var(--c-border)',
            }}
        >
            <Space wrap>
                <FilterOutlined style={{ color: 'var(--c-text-muted)' }} />
                <Select
                    allowClear
                    aria-label="Filter by status"
                    placeholder="Status"
                    style={{ width: 140 }}
                    value={filters.status}
                    onChange={onStatusChange}
                    options={STATUS_OPTIONS}
                />
                <Select
                    allowClear
                    aria-label="Filter by priority"
                    placeholder="Priority"
                    style={{ width: 140 }}
                    value={filters.priority}
                    onChange={onPriorityChange}
                    options={PRIORITY_OPTIONS}
                />
                <Select
                    allowClear
                    showSearch
                    aria-label="Filter by customer"
                    placeholder="Customer"
                    style={{ width: 200 }}
                    value={filters.customer}
                    onChange={onCustomerChange}
                    optionFilterProp="label"
                    options={customers.map((c) => ({ value: c.id, label: c.name }))}
                />
                <Select
                    allowClear
                    showSearch
                    aria-label="Filter by project"
                    placeholder="Project"
                    style={{ width: 200 }}
                    value={filters.project}
                    disabled={!filters.customer}
                    onChange={onProjectChange}
                    optionFilterProp="label"
                    options={projects.map((p) => ({ value: p.id, label: p.name }))}
                />
                <Select
                    allowClear
                    showSearch
                    aria-label="Filter by sub project"
                    placeholder="Sub Project"
                    style={{ width: 200 }}
                    value={filters.subProject}
                    disabled={!filters.project}
                    onChange={onSubProjectChange}
                    optionFilterProp="label"
                    options={subProjects.map((s) => ({ value: s.id, label: s.name }))}
                />
                <Button onClick={onClear}>Clear</Button>
            </Space>
        </Card>
    )
}

export default TaskFilterBar
