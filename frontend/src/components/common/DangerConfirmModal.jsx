/**
 * =============================================================================
 * HERMES - Danger Confirm Modal
 * =============================================================================
 * Reusable centered modal that mirrors the dark delete-confirmation
 * dialog used by Time Entry and Tasks. Replaces Ant Design's default
 * Popconfirm in any flow that performs a destructive-looking action.
 *
 * Visuals are intentionally identical to the inline delete modals in
 * TimeEntryPage / TasksPage:
 *   - centered, 420px, no header chrome
 *   - dark panel #1e1e1e with subtle border
 *   - red icon badge + bold title + small subtitle
 *   - optional item preview card (name + secondary text)
 *   - paragraph body
 *   - Cancel + danger primary button
 * =============================================================================
 */

import { Button, Modal } from 'antd'
import {
    DeleteOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons'

function DangerConfirmModal({
    open,
    title = 'Confirm action',
    subtitle,
    body,
    itemName,
    itemSubtitle,
    confirmLabel = 'Delete',
    cancelLabel = 'Cancel',
    confirmIcon = <DeleteOutlined />,
    onConfirm,
    onCancel,
    loading = false,
}) {
    return (
        <Modal
            open={open}
            onCancel={onCancel}
            footer={null}
            width={420}
            centered
            closable={false}
            destroyOnClose
            styles={{
                content: {
                    background: '#1e1e1e',
                    border: '1px solid #303030',
                    borderRadius: 12,
                    padding: '28px 28px 24px',
                },
            }}
        >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                        style={{
                            width: 40,
                            height: 40,
                            borderRadius: 10,
                            background: 'rgba(239,68,68,0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                        }}
                    >
                        <ExclamationCircleOutlined
                            style={{ color: '#ef4444', fontSize: 20 }}
                        />
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>
                            {title}
                        </div>
                        {subtitle && (
                            <div style={{ fontSize: 12, color: '#888', marginTop: 2 }}>
                                {subtitle}
                            </div>
                        )}
                    </div>
                </div>

                {(itemName || itemSubtitle) && (
                    <div
                        style={{
                            background: '#2a2a2a',
                            border: '1px solid #383838',
                            borderRadius: 8,
                            padding: '10px 14px',
                        }}
                    >
                        {itemName && (
                            <div
                                style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: '#e0e0e0',
                                }}
                            >
                                {itemName}
                            </div>
                        )}
                        {itemSubtitle && (
                            <div style={{ fontSize: 12, color: '#888', marginTop: 3 }}>
                                {itemSubtitle}
                            </div>
                        )}
                    </div>
                )}

                {body && (
                    <p style={{ margin: 0, color: '#aaa', fontSize: 14, lineHeight: 1.6 }}>
                        {body}
                    </p>
                )}

                <div
                    style={{
                        display: 'flex',
                        gap: 10,
                        justifyContent: 'flex-end',
                        marginTop: 4,
                    }}
                >
                    <Button
                        onClick={onCancel}
                        style={{
                            background: 'transparent',
                            borderColor: '#444',
                            color: '#ccc',
                            borderRadius: 8,
                        }}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        type="primary"
                        danger
                        icon={confirmIcon}
                        onClick={onConfirm}
                        loading={loading}
                        style={{ borderRadius: 8 }}
                    >
                        {confirmLabel}
                    </Button>
                </div>
            </div>
        </Modal>
    )
}

export default DangerConfirmModal
