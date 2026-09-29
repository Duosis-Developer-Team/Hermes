/**
 * =============================================================================
 * HERMES - Admin liste durumlari (Sprint 6B.2 completion)
 * =============================================================================
 * NEDEN PRIMITIVE OLDU: ayni sorumluluk ve ayni davranis sozlesmesi
 * ONDAN FAZLA admin yuzeyinde tekrarlandi — sozluk kabugu, Roles, User
 * Groups, Assignment Hierarchy, PM Configurations, Contract Status,
 * Users, Customers, Projects, Work Types. Kural buydu: bir primitive
 * ancak en az iki gercek yuzey ayni isi ayni sozlesmeyle yapiyorsa
 * cikarilir.
 *
 * Uc kucuk sey standartlasir:
 *   - Kurtarilabilir yukleme hatasi: teknik olmayan mesaj + RETRY.
 *   - Arkaplan yenilemesi: mevcut veri KAYBOLMADAN bildirilir.
 *   - Bosluk: ILK KULLANIM boslugu ile FILTRE sonucu yoklugu ayri
 *     konusur. Ikisini ayni mesajla anlatmak kullaniciya "veri yok"
 *     dedirtir, oysa yalnizca filtre daraltmistir.
 *
 * Domain kurallari BURAYA TASINMAZ; bunlar yalnizca sunum.
 * =============================================================================
 */
import { Alert, Button } from 'antd'
import { InboxOutlined, PlusOutlined, SearchOutlined } from '@ant-design/icons'

import { normalizeApiError } from './normalizeApiError'
import { useT } from '../../../i18n'

/**
 * Kurtarilabilir yukleme hatasi bandi. `error` yoksa hicbir sey cizmez.
 * @param {object} props
 * @param {unknown} props.error   Yakalanan hata (normalize edilir)
 * @param {Function} props.onRetry
 * @param {string} [props.context] Neyin eksik kaldigini anlatan ek cumle
 */
export function AdminErrorAlert({ error, onRetry, context, style }) {
    const t = useT()
    if (!error) return null
    const normalized = normalizeApiError(error)
    return (
        <Alert
            type="error"
            showIcon
            style={{ marginBottom: 16, ...style }}
            message={context ? `${normalized.message} ${context}` : normalized.message}
            action={
                onRetry ? (
                    <Button size="small" onClick={() => onRetry()}>{t('common.retry')}</Button>
                ) : undefined
            }
        />
    )
}

/**
 * Arkaplan yenilemesi gostergesi — ILK yukleme ile karistirilmaz.
 * Ilk yuklemede tablo kendi spinner'ini gosterir; burada yalnizca
 * "elimizde veri var ve tazeleniyor" hali anlatilir.
 */
export function AdminRefreshHint({ isFetching, hasData }) {
    const t = useT()
    if (!isFetching || !hasData) return null
    return (
        <div role="status" className="admin-refresh-hint">{t('admin.refreshing')}</div>
    )
}

/**
 * Tablo boslugu (Liquid): ortali ikon + tek cumle + istege bagli birincil
 * eylem. ILK KULLANIM boslugu ile FILTRE sonucu yoklugu AYRI konusur
 * (adminEmptyText ile ayni kural, ama dil duyarli). `entityKey` cogul
 * varlik ceviri anahtari (orn. 'entity.customers').
 */
export function AdminEmptyState({ filtered, term, entityKey, entityLabel, createLabel, onCreate }) {
    const t = useT()
    const entity = (entityLabel ?? t(entityKey)).toLocaleLowerCase()
    const text = filtered
        ? (term
            ? t('admin.empty.filteredTerm', { entity, term })
            : t('admin.empty.filtered', { entity }))
        : t('admin.empty.none', { entity })
    return (
        <div className="admin-empty">
            <span className="admin-empty__icon" aria-hidden="true">
                {filtered ? <SearchOutlined /> : <InboxOutlined />}
            </span>
            <p className="admin-empty__text">{text}</p>
            {!filtered && createLabel && onCreate && (
                <Button type="primary" icon={<PlusOutlined />} onClick={onCreate}>{createLabel}</Button>
            )}
        </div>
    )
}
