/**
 * =============================================================================
 * HERMES - Danger Confirm Modal
 * =============================================================================
 * Reusable centered modal that mirrors the dark delete-confirmation
 * dialog used by Time Entry and Tasks. Replaces Ant Design's default
 * Popconfirm in any flow that performs a destructive-looking action.
 *
 * Hermes Liquid: ortak pencere kabugu (cam sayfa + ModalHead + alt cubuk).
 *   - ortada, 460px
 *   - ikon kutusu: tehlikeli islemde kirmizi, olumlu islemde mavi
 *   - istege bagli kayit onizlemesi (ad + ikincil metin)
 *   - aciklama paragrafi
 *   - Vazgec + onay dugmesi (tehlikede kirmizi)
 * =============================================================================
 */

import { Button, Modal } from 'antd'
import {
    DeleteOutlined,
    ExclamationCircleOutlined,
} from '@ant-design/icons'
import { useT } from '../../i18n'
import { ModalHead } from '../liquid'

function DangerConfirmModal({
    open,
    title,
    subtitle,
    body,
    itemName,
    itemSubtitle,
    confirmLabel,
    cancelLabel,
    confirmIcon = <DeleteOutlined />,
    onConfirm,
    onCancel,
    loading = false,
    // 'danger' (red, destructive) or 'primary' (indigo, affirmative).
    tone = 'danger',
    // Icon shown in the badge; defaults to the warning glyph.
    badgeIcon = <ExclamationCircleOutlined />,
}) {
    const t = useT()
    // Varsayilan metinler PARAMETREDE verilemez (ceviri hook'a bagli);
    // burada cozulur ve cagiranin gecirdigi deger AYNEN korunur.
    const heading = title ?? t('errors.confirmAction')
    const confirmText = confirmLabel ?? t('common.delete')
    const cancelText = cancelLabel ?? t('common.cancel')
    const isDanger = tone === 'danger'
    return (
        <Modal
            open={open}
            onCancel={onCancel}
            footer={null}
            width={460}
            centered
            closable={false}
            className="lq-confirm"
            title={(
                <ModalHead
                    icon={badgeIcon}
                    tone={isDanger ? 'red' : 'blue'}
                    title={heading}
                    subtitle={subtitle}
                />
            )}
            /* Pending'te kapanma kilidi (§7). */
            maskClosable={!loading}
            keyboard={!loading}
            /* AntD 5.x: destroyOnClose deprecated → destroyOnHidden. */
            destroyOnHidden
        >
            {(itemName || itemSubtitle) && (
                <div className="lq-confirm__item">
                    {itemName && <b>{itemName}</b>}
                    {itemSubtitle && <small>{itemSubtitle}</small>}
                </div>
            )}
            {body && <p className="lq-confirm__body">{body}</p>}
            <div className="lq-mf">
                <Button onClick={onCancel}>{cancelText}</Button>
                <Button
                    type="primary"
                    danger={isDanger}
                    icon={confirmIcon}
                    onClick={onConfirm}
                    loading={loading}
                >
                    {confirmText}
                </Button>
            </div>
        </Modal>
    )
}

export default DangerConfirmModal
