/**
 * HERMES - Talep musterisinin logosu (is yonetimindeki musteri logolari gibi).
 *
 * Sirket hesabi musterisi (`company:<hesap>`) Ayarlar → Kullanicilar →
 * Sirketler'de yuklenen logoyu gosterir; digerleri (calisma alani,
 * entegrasyon) ad bas harfli renkli karo. Logo etag listesi tek sorgu
 * (Sirketler sekmesiyle ayni onbellek anahtari).
 */
import { useQuery } from '@tanstack/react-query'

import { companyService } from '../../api/companyApi'
import { CompanyLogo, CustomerLogo } from '../../components/liquid'

export const COMPANY_LOGOS_KEY = ['admin-company-logos']
const PREFIX = 'company:'

export const companyAccountOf = (source) => {
    const id = source?.source_tenant_id
    return typeof id === 'string' && id.startsWith(PREFIX) ? id.slice(PREFIX.length) : null
}

export default function TicketCustomerLogo({ source, size = 28, className = '' }) {
    const accountId = companyAccountOf(source)
    const logos = useQuery({
        queryKey: COMPANY_LOGOS_KEY,
        queryFn: companyService.logos,
        enabled: Boolean(accountId),
        staleTime: 300_000,
        retry: false,
    })
    const name = source?.display_name || ''
    if (accountId) {
        return (
            <CompanyLogo id={accountId} name={name} etag={logos.data?.logos?.[accountId] ?? null}
                         size={size} className={className} title={name} />
        )
    }
    return <CustomerLogo id={source?.id} name={name} etag={null} size={size} className={className} title={name} />
}
