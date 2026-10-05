/**
 * =============================================================================
 * HERMES - Musteri / proje formu: marka logosu alani (opsiyonel)
 * =============================================================================
 * Dosya SECILIR ama hemen yuklenmez: taslak (file / remove) formla birlikte
 * kaydedilir — musteri once olusur/guncellenir, sonra logo PUT/DELETE.
 * Istemci on kontrolu sunucuyla ayni: PNG/JPEG/WEBP, en fazla 256 KB
 * (sunucu yine de icerigi kokler ve 413/415 doner).
 *
 * Duzen (05.10): solda buyuk onizleme, sagda baslik + ipucu + dugmeler;
 * gorsel alanin ustune SURUKLE-BIRAK ile de birakilabilir. Dosya secici
 * `display: none` ile gizli (yalniz `hidden` niteligi genel input
 * stilleriyle ezilip satiri daraltiyordu — harf harf metin hatasi).
 * =============================================================================
 */
import { useEffect, useRef, useState } from 'react'
import { Button, message } from 'antd'
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'

import { CustomerLogo } from '../../components/liquid'
import { useT } from '../../i18n'

export const LOGO_MAX_BYTES = 256 * 1024
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const EMPTY_LOGO_DRAFT = { file: null, previewUrl: null, remove: false }

/** draft: { file, previewUrl, remove }; record: duzenlenen musteri (ya da null).
 *  Proje formu kendi alanini kullanir (ProjectLogoField: ozel ya da jenerik). */
function CustomerLogoField({ record, name, draft, onChange }) {
    const t = useT()
    const inputRef = useRef(null)

    // Onizleme URL'si taslak degisince/bilesen kapaninca serbest birakilir.
    useEffect(() => () => {
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl)
    }, [draft.previewUrl])

    const [over, setOver] = useState(false)
    const accept = (file) => {
        if (!file) return
        if (!LOGO_TYPES.includes(file.type)) { message.error(t('admin.logoBadType')); return }
        if (file.size > LOGO_MAX_BYTES) { message.error(t('admin.logoTooLarge')); return }
        onChange({ file, previewUrl: URL.createObjectURL(file), remove: false })
    }
    const pick = (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        accept(file)
    }
    const onDrop = (e) => {
        e.preventDefault()
        setOver(false)
        accept(e.dataTransfer?.files?.[0])
    }

    const hasCurrent = !!record?.has_logo && !draft.remove
    const showing = draft.previewUrl || hasCurrent

    return (
        <div
            className={`customer-logo-field${over ? ' is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={onDrop}
        >
            <button
                type="button"
                className="customer-logo-field__drop"
                onClick={() => inputRef.current?.click()}
                aria-label={showing ? t('admin.logoChange') : t('admin.logoUpload')}
            >
                {draft.previewUrl ? (
                    <span className="lq-clogo lq-clogo--img customer-logo-field__preview" aria-hidden="true">
                        <img src={draft.previewUrl} alt="" />
                    </span>
                ) : !hasCurrent && !(name || record?.name) ? (
                    // Ad yokken "?" yerine yukleme simgesi.
                    <span className="customer-logo-field__empty" aria-hidden="true"><UploadOutlined /></span>
                ) : (
                    <CustomerLogo
                        id={record?.id}
                        name={name || record?.name}
                        size={72}
                        etag={hasCurrent ? record.logo_etag : null}
                        className="customer-logo-field__preview"
                    />
                )}
            </button>
            <div className="customer-logo-field__body">
                <b>{t('admin.logoLabel')}</b>
                <small>{t('admin.logoHint')}</small>
                <small className="customer-logo-field__drop-hint">{t('admin.logoDrop')}</small>
                <div className="customer-logo-field__actions">
                    <Button size="small" icon={<UploadOutlined />} onClick={() => inputRef.current?.click()}>
                        {showing ? t('admin.logoChange') : t('admin.logoUpload')}
                    </Button>
                    {showing && (
                        <Button
                            size="small"
                            type="text"
                            danger
                            icon={<DeleteOutlined />}
                            aria-label={t('admin.logoRemove')}
                            onClick={() => onChange({ file: null, previewUrl: null, remove: hasCurrent })}
                        >
                            {t('admin.logoRemove')}
                        </Button>
                    )}
                </div>
            </div>
            <input
                ref={inputRef}
                type="file"
                accept={LOGO_TYPES.join(',')}
                style={{ display: 'none' }}
                onChange={pick}
                data-testid="customer-logo-input"
            />
        </div>
    )
}

export default CustomerLogoField
