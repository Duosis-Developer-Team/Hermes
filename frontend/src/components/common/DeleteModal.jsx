/**
 * =============================================================================
 * HERMES - Delete/Archive onay modali (Sprint 2 PILOT: DS V2 primitive)
 * =============================================================================
 * ConfirmDialog primitive'i uzerine yeniden kuruldu (paket §13 pilot 2).
 * DAVRANIS SOZLESMESI KORUNDU: ayni prop API'si (open, isActive,
 * itemName, onConfirm, onCancel, loading), ayni iki mod (Archive /
 * Delete Permanently), ayni metinler. Kazanimlar: pending'te kapanma
 * kilidi + focus yonetimi primitive'ten; inline #faad14 ham degerleri,
 * <style> blogundaki !important'lar ve 107 satirlik ozel CSS oldu —
 * tokenlar konusuyor.
 */
import { DeleteOutlined, StopOutlined } from '@ant-design/icons'
import { ConfirmDialog, StatusBadge } from '../ui'

const DeleteModal = ({
    open,
    isActive = false,
    itemName,
    onConfirm,
    onCancel,
    loading = false,
}) => {
    const isDeactivateMode = isActive === true

    const title = isDeactivateMode ? 'Archive / Deactivate?' : 'Delete Permanently?'
    const description = isDeactivateMode
        ? 'This item is currently active. Archiving it will preserve existing logs but hide it from future selection.'
        : 'This item is already inactive. Do you want to permanently delete it? This action CANNOT be undone and may fail if data exists.'

    return (
        <ConfirmDialog
            open={open}
            pending={loading}
            danger={!isDeactivateMode}
            title={
                <span className="h-inline" style={{ gap: 'var(--h-space-2)' }}>
                    {isDeactivateMode ? <StopOutlined /> : <DeleteOutlined />}
                    {title}
                </span>
            }
            description={description}
            confirmText={isDeactivateMode ? 'Archive' : 'Delete Permanently'}
            cancelText="Cancel"
            onConfirm={onConfirm}
            onCancel={onCancel}
        >
            {itemName && (
                <p style={{ margin: 'var(--h-space-3) 0 0' }}>
                    <StatusBadge tone={isDeactivateMode ? 'warning' : 'danger'}>
                        {itemName}
                    </StatusBadge>
                </p>
            )}
        </ConfirmDialog>
    )
}

export default DeleteModal
