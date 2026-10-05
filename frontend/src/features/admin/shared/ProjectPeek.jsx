/**
 * =============================================================================
 * HERMES - Satira tikla → altinda projeler (yalniz goruntuleme)
 * =============================================================================
 * Musteriler ve Proje turleri tablolarinda: satira tiklayinca altinda o
 * kayda ait projeler acilir, tekrar tiklayinca kapanir. Islem YOK (projeler
 * Projeler sayfasinda yonetilir). Satirdaki dugme/baglanti/girdi tiklamalari
 * paneli ACMAZ — duzenle/sil eskisi gibi calisir.
 * =============================================================================
 */
import { useState } from 'react'
import { RightOutlined } from '@ant-design/icons'

import { BrandLogos } from '../../../components/liquid'
import { toneOf } from '../../projectTypes/palette'
import { useT } from '../../../i18n'
import '../../../pages/admin/ProjectTypesPage.css'

const INTERACTIVE = 'button, a, input, textarea, select, label, [role="switch"], .ant-dropdown-trigger'

/** Tablo icin kontrollu acilir satir: `<Table {...rowDisclosure(render)} />`. */
export function useRowDisclosure() {
    const [open, setOpen] = useState([])
    const toggle = (id) => setOpen((keys) => (keys.includes(id) ? keys.filter((k) => k !== id) : [...keys, id]))
    return (renderRow) => ({
        onRow: (record) => ({
            onClick: (e) => {
                if (e.target.closest?.(INTERACTIVE)) return
                toggle(record.id)
            },
            className: 'peek-row',
        }),
        expandable: {
            expandedRowKeys: open,
            expandedRowRender: renderRow,
            rowExpandable: () => true,
            expandIcon: ({ expanded, record }) => (
                <button
                    type="button"
                    className={`groups-expand${expanded ? ' is-open' : ''}`}
                    aria-expanded={expanded}
                    aria-label={record.name}
                    onClick={(e) => { e.stopPropagation(); toggle(record.id) }}
                >
                    <RightOutlined aria-hidden="true" />
                </button>
            ),
        },
    })
}

/**
 * Projelerin listesi. `meta`: satirin ikincil bilgisi —
 * 'type' (musteri satirinda proje turu) | 'customer' (tur satirinda musteri).
 */
export function ProjectPeek({ projects = [], meta = 'type', loading = false }) {
    const t = useT()
    if (loading) return <p className="peek-empty">…</p>
    if (!projects.length) return <p className="peek-empty">{t('admin.peekNoProjects')}</p>
    const sorted = [...projects].sort((a, b) => (b.is_active - a.is_active) || a.name.localeCompare(b.name, 'tr'))
    return (
        <ul className="peek-list" aria-label={t('entity.projects')}>
            {sorted.map((p) => {
                const tone = p.project_type_color ? toneOf(p.project_type_color) : null
                return (
                    <li key={p.id} className={`peek-item${p.is_active ? '' : ' is-inactive'}`}>
                        <BrandLogos
                            customerId={meta === 'customer' ? p.customer_id : undefined}
                            customerName={p.customer_name}
                            projectId={p.has_logo || p.logo_glyph ? p.id : undefined}
                            projectName={p.name}
                            size={26}
                        />
                        <span className="peek-item__text">
                            <b>{p.name}</b>
                            <small>
                                {meta === 'customer'
                                    ? (p.customer_name || t('admin.internalProject'))
                                    : (p.project_type_name ? (
                                        <span className="pt-chip">
                                            <i style={{ background: `linear-gradient(135deg, ${tone.from}, ${tone.to})` }} aria-hidden="true" />
                                            {p.project_type_name}
                                        </span>
                                    ) : t('projectTypes.untyped'))}
                            </small>
                        </span>
                        {!p.is_active && <span className="lq-tag">{t('common.inactive')}</span>}
                    </li>
                )
            })}
        </ul>
    )
}
