/**
 * =============================================================================
 * HERMES - Arsivleme onayi
 * =============================================================================
 * SILME DEGIL: metin bunu acikca soyler. Kayit korunur, geri alinabilir.
 * Hata durumunda modal ACIK kalir (mutation onError kapatmaz) — kapanmasi
 * "arsivlendi" izlenimi verirdi.
 * =============================================================================
 */
import { InboxOutlined } from '@ant-design/icons'
import { Modal } from 'antd'

import { ModalHead } from '../../../components/liquid'
import { typeMeta } from '../../../utils/workItemType'
import { useT } from '../../../i18n'

function TaskArchiveModal({ item, loading, onCancel, onConfirm }) {
    const t = useT()
    const kind = typeMeta(item?.kind || item?.representative?.task_type).lower
    const n = { noun: t(`review.noun.${kind}`), Noun: t(`review.nounCap.${kind}`) }
    const count = item?.assignments?.length || 0
    return (
        <Modal
            open={!!item}
            title={(
                <ModalHead
                    icon={<InboxOutlined />}
                    tone="amber"
                    title={t('lifecycle.archiveTitle', n)}
                    subtitle={t('lifecycle.archiveSubtitle', n)}
                />
            )}
            okText={t('lifecycle.archiveNow')}
            okButtonProps={{ icon: <InboxOutlined />, loading }}
            cancelButtonProps={{ disabled: loading }}
            closable={!loading}
            maskClosable={!loading}
            onOk={onConfirm}
            onCancel={onCancel}
            destroyOnHidden
        >
            <div className="lq-confirm__item"><b>{item?.title}</b></div>
            <p className="lq-confirm__body">{t('lifecycle.archiveBody')}</p>
            {count > 1 && (
                <p className="lq-confirm__body">{t('lifecycle.archiveGroup', { count })}</p>
            )}
        </Modal>
    )
}

export default TaskArchiveModal
