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

import DangerConfirmModal from './DangerConfirmModal'
import { useT } from '../../i18n'

/**
 * Liquid (29.09): ortak cam onay penceresi (DangerConfirmModal) uzerinde.
 * Iki mod ayni: aktif kayit → Arsivle/Pasiflestir, pasif kayit → Kalici sil.
 * `scope="workspace"`: kullanicilar icin — kayit CALISMA ALANINDAN
 * kaldirilir; baska calisma alanlarina uyeyse orada hesabi surer (auth
 * DELETE kurali, 51ab60d).
 */
const DeleteModal = ({
    open,
    isActive = false,
    itemName,
    onConfirm,
    onCancel,
    loading = false,
    scope = 'record',
}) => {
    const t = useT()
    const isDeactivateMode = isActive === true
    const k = scope === 'workspace' ? 'deleteModal.workspace' : 'deleteModal.record'

    return (
        <DangerConfirmModal
            open={open}
            loading={loading}
            tone={isDeactivateMode ? 'primary' : 'danger'}
            badgeIcon={isDeactivateMode ? <StopOutlined /> : <DeleteOutlined />}
            confirmIcon={null}
            title={t(`${k}.${isDeactivateMode ? 'archiveTitle' : 'deleteTitle'}`)}
            body={t(`${k}.${isDeactivateMode ? 'archiveBody' : 'deleteBody'}`)}
            itemName={itemName}
            confirmLabel={t(`${k}.${isDeactivateMode ? 'archiveConfirm' : 'deleteConfirm'}`)}
            cancelLabel={t('common.cancel')}
            onConfirm={onConfirm}
            onCancel={onCancel}
        />
    )
}

export default DeleteModal
