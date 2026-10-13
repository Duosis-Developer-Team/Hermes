/**
 * HERMES - Kayitli talep gorunumleri (Dalga B).
 *
 * Gorunum = hub filtre kombinasyonu (kuyruk, durum, oncelik, ekip, etiket,
 * siralama). ERISIM VERMEZ: sonuc yine sunucudaki gorunurluk kuralindan
 * gecer. Kisisel gorunumu sahibi, paylasilani yapilandirma yetkilisi kaydeder.
 */
import { useState } from 'react'
import { Input, Modal, Switch } from 'antd'
import { CloseOutlined, SaveOutlined, TeamOutlined } from '@ant-design/icons'

import { Button } from '../../components/ui'
import { useT } from '../../i18n'

export default function SavedViews({ views = [], activeId, onApply, onSave, onDelete, canShare, canSave }) {
    const t = useT()
    const [open, setOpen] = useState(false)
    const [name, setName] = useState('')
    const [shared, setShared] = useState(false)
    if (!views.length && !canSave) return null
    return (
        <div className="ticket-views" role="group" aria-label={t('hub.views')}>
            {views.map((view) => (
                <span key={view.id} className={`lq-chip ticket-view${view.id === activeId ? ' is-on' : ''}`}>
                    <button type="button" aria-pressed={view.id === activeId} onClick={() => onApply(view)}>
                        {view.is_shared && <TeamOutlined aria-label={t('hub.sharedView')} />} {view.name}
                    </button>
                    {view.is_mine && (
                        <button type="button" className="ticket-view__remove" aria-label={t('hub.deleteView', { name: view.name })}
                                onClick={() => onDelete(view)}>
                            <CloseOutlined />
                        </button>
                    )}
                </span>
            ))}
            {canSave && (
                <Button size="small" icon={<SaveOutlined />} onClick={() => { setName(''); setShared(false); setOpen(true) }}>
                    {t('hub.saveView')}
                </Button>
            )}
            <Modal
                open={open}
                title={t('hub.saveView')}
                okText={t('common.save')}
                okButtonProps={{ disabled: !name.trim() }}
                onCancel={() => setOpen(false)}
                onOk={() => { onSave({ name: name.trim(), is_shared: shared }); setOpen(false) }}
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
        </div>
    )
}
