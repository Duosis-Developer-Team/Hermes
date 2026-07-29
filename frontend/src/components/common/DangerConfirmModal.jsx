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
 *   - dark panel var(--c-surface-2) with subtle border
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
    // 'danger' (red, destructive) or 'primary' (indigo, affirmative).
    tone = 'danger',
    // Icon shown in the badge; defaults to the warning glyph.
    badgeIcon = <ExclamationCircleOutlined />,
}) {
    const isDanger = tone === 'danger'
    const accent = isDanger ? '#ef4444' : 'var(--color-primary)'
    const accentBadgeBg = isDanger
        ? 'rgba(239,68,68,0.15)'
        : 'rgba(99,102,241,0.15)'
    return (
        <Modal
            open={open}
            onCancel={onCancel}
            footer={null}
            width={420}
            centered
            closable={false}
            /* Diyalog ADI (§8): baslik zaten govdede GORUNUR bicimde
               duruyor; rc-dialog ad icin `title` bekledigi ve dialog
               element'ine aria-* gecirmedigi icin ayni metin gorsel
               olarak gizli bir baslik olarak da verilir. Tasarim
               degismez, diyalogun adi olur. */
            title={<span className="h-sr-only">{title}</span>}
            classNames={{ header: 'h-sr-only' }}
            /* Pending'te kapanma kilidi (§7). */
            maskClosable={!loading}
            keyboard={!loading}
            /* AntD 5.x: destroyOnClose deprecated → destroyOnHidden. */
            destroyOnHidden
            styles={{
                content: {
                    background: 'var(--c-surface-2)',
                    border: '1px solid var(--c-border)',
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
                            background: accentBadgeBg,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            color: accent,
                            fontSize: 20,
                        }}
                    >
                        {badgeIcon}
                    </div>
                    <div>
                        <div style={{ fontWeight: 700, fontSize: 16, color: 'var(--c-text-strong)' }}>
                            {title}
                        </div>
                        {subtitle && (
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 2 }}>
                                {subtitle}
                            </div>
                        )}
                    </div>
                </div>

                {(itemName || itemSubtitle) && (
                    <div
                        style={{
                            background: 'var(--c-border)',
                            border: '1px solid var(--c-border-strong)',
                            borderRadius: 8,
                            padding: '10px 14px',
                        }}
                    >
                        {itemName && (
                            <div
                                style={{
                                    fontSize: 13,
                                    fontWeight: 600,
                                    color: 'var(--c-text)',
                                }}
                            >
                                {itemName}
                            </div>
                        )}
                        {itemSubtitle && (
                            <div style={{ fontSize: 12, color: 'var(--c-text-muted)', marginTop: 3 }}>
                                {itemSubtitle}
                            </div>
                        )}
                    </div>
                )}

                {body && (
                    <p style={{ margin: 0, color: 'var(--c-text-muted)', fontSize: 14, lineHeight: 1.6 }}>
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
                            borderColor: 'var(--c-border-strong)',
                            color: 'var(--c-text)',
                            borderRadius: 8,
                        }}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        type="primary"
                        danger={isDanger}
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
