/**
 * =============================================================================
 * HERMES - Proje formu: logo alani (ozel logo YA DA jenerik logo)
 * =============================================================================
 * Iki yol, tek sonuc:
 *   - "Logo ekle": projeye ozgu gorsel yuklenir (PNG/JPEG/WEBP, 256 KB).
 *     Rengi ne ise odur; tur rengi ona DOKUNMAZ.
 *   - "Logo sec": jenerik glif secilir. Gorsel saklanmaz; logo projenin
 *     TURUNUN renginde cizilir — tur rengi degisince logo da degisir.
 * Ikisi birbirini dislar: yukleme glifi temizler, glif secimi yuklenmis
 * logoyu kaldirir (taslak, form kaydedilince uygulanir).
 *
 * draft: { file, previewUrl, remove, glyph }
 *   glyph === undefined → degismedi; null → temizlendi; anahtar → secildi.
 * =============================================================================
 */
import { useEffect, useRef, useState } from 'react'
import { Button, Modal, message } from 'antd'
import { AppstoreOutlined, DeleteOutlined, UploadOutlined } from '@ant-design/icons'

import { GenericLogo, ModalHead } from '../../components/liquid'
import { projectLogoUrl } from '../../stores/customerLogoStore'
import { LOGO_GLYPH_KEYS } from '../../features/projectTypes/glyphs'
import { LOGO_MAX_BYTES, LOGO_TYPES } from './CustomerLogoField'
import { useT } from '../../i18n'
import './ProjectTypesPage.css'

export const EMPTY_PROJECT_LOGO_DRAFT = { file: null, previewUrl: null, remove: false, glyph: undefined }

/** Formdaki logonun su anki durumu (taslak + kayit). */
export function resolveProjectLogo(record, draft) {
    const hasUpload = !!record?.has_logo && !draft.remove
    const glyph = draft.glyph !== undefined ? draft.glyph : (record?.logo_glyph || null)
    if (draft.previewUrl) return { kind: 'file' }
    if (hasUpload) return { kind: 'upload' }
    if (glyph) return { kind: 'generic', glyph }
    return { kind: 'none' }
}

function ProjectLogoField({ record, draft, onChange, typeColor, typeName }) {
    const t = useT()
    const inputRef = useRef(null)
    const [over, setOver] = useState(false)
    const [picking, setPicking] = useState(false)

    useEffect(() => () => {
        if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl)
    }, [draft.previewUrl])

    const hadUpload = !!record?.has_logo
    const current = resolveProjectLogo(record, draft)

    const acceptFile = (file) => {
        if (!file) return
        if (!LOGO_TYPES.includes(file.type)) { message.error(t('admin.logoBadType')); return }
        if (file.size > LOGO_MAX_BYTES) { message.error(t('admin.logoTooLarge')); return }
        // Ozel logo yuklenince jenerik glif temizlenir.
        onChange({ file, previewUrl: URL.createObjectURL(file), remove: false, glyph: null })
    }
    const pickGlyph = (glyph) => {
        // Jenerik logo secilince yuklenmis ozel logo kaldirilir.
        onChange({ file: null, previewUrl: null, remove: hadUpload, glyph })
        setPicking(false)
    }
    const clear = () => onChange({ file: null, previewUrl: null, remove: hadUpload, glyph: null })

    return (
        <div
            className={`customer-logo-field${over ? ' is-over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setOver(true) }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => { e.preventDefault(); setOver(false); acceptFile(e.dataTransfer?.files?.[0]) }}
        >
            <button
                type="button"
                className="customer-logo-field__drop"
                onClick={() => setPicking(true)}
                aria-label={t('projectTypes.logoPick')}
            >
                {current.kind === 'file' || current.kind === 'upload' ? (
                    <span className="lq-clogo lq-clogo--img customer-logo-field__preview" aria-hidden="true">
                        <img src={draft.previewUrl || projectLogoUrl(record.id, record.logo_etag)} alt="" />
                    </span>
                ) : current.kind === 'generic' ? (
                    <span className="customer-logo-field__preview" data-testid="project-logo-generic" data-glyph={current.glyph}>
                        <GenericLogo glyph={current.glyph} color={typeColor} size={72} />
                    </span>
                ) : (
                    <span className="customer-logo-field__empty" aria-hidden="true"><AppstoreOutlined /></span>
                )}
            </button>
            <div className="customer-logo-field__body">
                <b>{t('admin.logoLabel')}</b>
                <small>{current.kind === 'generic' ? t('projectTypes.logoGeneric') : t('admin.logoHint')}</small>
                <small className="customer-logo-field__drop-hint">{t('admin.logoDrop')}</small>
                <div className="customer-logo-field__actions">
                    <Button size="small" icon={<UploadOutlined />} onClick={() => inputRef.current?.click()}>
                        {t('admin.logoUpload')}
                    </Button>
                    <Button size="small" icon={<AppstoreOutlined />} onClick={() => setPicking(true)}>
                        {t('projectTypes.logoPick')}
                    </Button>
                    {current.kind !== 'none' && (
                        <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label={t('admin.logoRemove')} onClick={clear}>
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
                onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; acceptFile(f) }}
                data-testid="project-logo-input"
            />

            <Modal
                title={<ModalHead icon={<AppstoreOutlined />} tone="violet" title={t('projectTypes.logoPickTitle')} />}
                open={picking}
                onCancel={() => setPicking(false)}
                footer={null}
                width={640}
            >
                <p className="plf-hint">
                    {typeName ? t('projectTypes.logoPickHint', { type: typeName }) : t('projectTypes.logoPickNoType')}
                </p>
                <div className="plf-glyphs" role="listbox" aria-label={t('projectTypes.logoPickTitle')}>
                    {LOGO_GLYPH_KEYS.map((key) => {
                        const on = current.kind === 'generic' && current.glyph === key
                        return (
                            <button
                                key={key}
                                type="button"
                                role="option"
                                aria-selected={on}
                                className={`plf-glyph${on ? ' is-on' : ''}`}
                                onClick={() => pickGlyph(key)}
                            >
                                <GenericLogo glyph={key} color={typeColor} size={52} />
                                <span>{t(`projectTypes.glyph.${key}`)}</span>
                            </button>
                        )
                    })}
                </div>
            </Modal>
        </div>
    )
}

export default ProjectLogoField
