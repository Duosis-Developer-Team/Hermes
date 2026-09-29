/**
 * =============================================================================
 * HERMES - Musteri formu: marka logosu alani (opsiyonel)
 * =============================================================================
 * Dosya SECILIR ama hemen yuklenmez: taslak (file / remove) formla birlikte
 * kaydedilir — musteri once olusur/guncellenir, sonra logo PUT/DELETE.
 * Istemci on kontrolu sunucuyla ayni: PNG/JPEG/WEBP, en fazla 256 KB
 * (sunucu yine de icerigi kokler ve 413/415 doner).
 * =============================================================================
 */
import { useEffect, useRef } from 'react'
import { Button, message } from 'antd'
import { DeleteOutlined, UploadOutlined } from '@ant-design/icons'

import { CustomerLogo } from '../../components/liquid'
import { useT } from '../../i18n'

export const LOGO_MAX_BYTES = 256 * 1024
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp']
export const EMPTY_LOGO_DRAFT = { file: null, previewUrl: null, remove: false }

/** draft: { file, previewUrl, remove }; record: duzenlenen musteri (ya da null). */
function CustomerLogoField({ record, name, draft, onChange }) {
    const t = useT()
    const inputRef = useRef(null)

    // Onizleme URL'si taslak degisince/bilesen kapaninca serbest birakilir.
    useEffect(() => () => {
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl)
    }, [draft.previewUrl])

    const pick = (e) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (!file) return
        if (!LOGO_TYPES.includes(file.type)) { message.error(t('admin.logoBadType')); return }
        if (file.size > LOGO_MAX_BYTES) { message.error(t('admin.logoTooLarge')); return }
        onChange({ file, previewUrl: URL.createObjectURL(file), remove: false })
    }

    const hasCurrent = !!record?.has_logo && !draft.remove
    const showing = draft.previewUrl || hasCurrent

    return (
        <div className="customer-logo-field">
            {draft.previewUrl ? (
                <span className="lq-clogo lq-clogo--img customer-logo-field__preview" aria-hidden="true">
                    <img src={draft.previewUrl} alt="" />
                </span>
            ) : (
                <CustomerLogo
                    id={record?.id}
                    name={name || record?.name}
                    size={56}
                    etag={hasCurrent ? record.logo_etag : null}
                    className="customer-logo-field__preview"
                />
            )}
            <div className="customer-logo-field__text">
                <b>{t('admin.logoLabel')}</b>
                <small>{t('admin.logoHint')}</small>
            </div>
            <div className="customer-logo-field__actions">
                <input
                    ref={inputRef}
                    type="file"
                    accept={LOGO_TYPES.join(',')}
                    hidden
                    onChange={pick}
                    data-testid="customer-logo-input"
                />
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
                    />
                )}
            </div>
        </div>
    )
}

export default CustomerLogoField
