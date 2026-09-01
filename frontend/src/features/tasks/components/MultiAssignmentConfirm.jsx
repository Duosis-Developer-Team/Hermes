/**
 * =============================================================================
 * HERMES - Coklu atama onay penceresi (§11)
 * =============================================================================
 * Hangi kisinin hangi status'ten hedefe gececegi ACIKCA gorunur.
 * Kullanici secim yapmadan onay dugmesi CALISMAZ — sessiz toplu
 * guncelleme mumkun degildir.
 * =============================================================================
 */
import { Checkbox, Modal } from 'antd'

import { userLabel } from '../model/grouping'
import { useT } from '../../../i18n'

const label = (status) => (status === 'in_progress' ? 'In Progress' : status)

function MultiAssignmentConfirm({ pending, userMap, onToggle, onCancel, onConfirm }) {
    const t = useT()
    return (
        <Modal
            open={!!pending}
            title={t('explorer.whichAssignments')}
            okText={`Move ${pending?.selected.length || 0} to ${label(pending?.newStatus || '')}`}
            okButtonProps={{ disabled: !pending?.selected.length }}
            onOk={onConfirm}
            onCancel={onCancel}
            destroyOnHidden
        >
            <p style={{ marginTop: 0, color: 'var(--h-text-secondary)' }}>
                This work item has more than one assignment you can change.
                Nothing is updated until you pick the assignments below.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {(pending?.candidates || []).map((t) => (
                    <Checkbox
                        key={t.id}
                        checked={pending.selected.includes(t.id)}
                        onChange={(e) => onToggle(t.id, e.target.checked)}
                    >
                        {userLabel(t.assignee_user_id, userMap)}
                        {' — '}{label(t.status)}{' → '}{label(pending.newStatus)}
                    </Checkbox>
                ))}
            </div>
        </Modal>
    )
}

export default MultiAssignmentConfirm
