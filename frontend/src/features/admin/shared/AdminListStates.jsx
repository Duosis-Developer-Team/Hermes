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
    if (!isFetching || !hasData) return null
    return (
        <div
            role="status"
            style={{ marginTop: 8, fontSize: 12, color: 'var(--c-text-muted)' }}
        >
            Refreshing…
        </div>
    )
}
