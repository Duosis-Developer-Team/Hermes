/**
 * HERMES - Talep gorunumu kaydetme penceresi (Dalga B).
 *
 * Gorunum = hub filtre kombinasyonu (kuyruk, durum, oncelik, ekip, etiket,
 * siralama). ERISIM VERMEZ: sonuc yine sunucudaki gorunurluk kuralindan
 * gecer. Kisisel gorunumu sahibi, paylasilani yapilandirma yetkilisi kaydeder.
 * Kayitli gorunumler sol kolonda listelenir (TicketViewsSidebar).
 */
import { useState } from 'react'
import { Input, Modal, Switch } from 'antd'
import { SaveOutlined } from '@ant-design/icons'

import { ModalHead } from '../../components/liquid'
import { useT } from '../../i18n'

export default function SaveViewModal({ open, onCancel, onSave, canShare }) {
    const t = useT()
    const [name, setName] = useState('')
    const [shared, setShared] = useState(false)
    return (
        <Modal
            open={open}
            title={<ModalHead icon={<SaveOutlined />} title={t('hub.saveView')} />}
            okText={t('common.save')}
            okButtonProps={{ disabled: !name.trim() }}
            onCancel={onCancel}
            onOk={() => { onSave({ name: name.trim(), is_shared: shared }); setName(''); setShared(false) }}
            afterOpenChange={(visible) => { if (!visible) { setName(''); setShared(false) } }}
            destroyOnHidden
        >
            <div className="ticket-view-form">
                <label htmlFor="ticket-view-name">{t('hub.viewName')}</label>
                <Input id="ticket-view-name" autoFocus maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
                {canShare && (
                    <label className="ticket-view-form__shared">
                        <Switch checked={shared} onChange={setShared} aria-label={t('hub.shareWithTeam')} />
                        <span>{t('hub.shareWithTeam')}</span>
                    </label>
                )}
                <p className="lq-note">{t('hub.viewHint')}</p>
            </div>
        </Modal>
    )
}
