/**
 * HERMES - Talep musterisinin logosu (is yonetimindeki musteri logolari gibi).
 *
 * Talep musterisi bir musteri kaydina bagliysa (0027 — sirket hesabi
 * musteriden secilir) o musterinin logosu gelir: kabuk musteri listesini
 * tek sorguyla okuyup logo deposuna yazar, burada ayrica istek yok. Bagli
 * degilse (calisma alani, entegrasyon) ad bas harfli renkli karo.
 */
import { CustomerLogo } from '../../components/liquid'

export default function TicketCustomerLogo({ source, size = 28, className = '' }) {
    const name = source?.display_name || ''
    return (
        <CustomerLogo
            id={source?.customer_id || source?.id}
            // Bagli musteride etag depodan; bagsizda yalniz bas harf karosu.
            etag={source?.customer_id ? undefined : null}
            name={name}
            size={size}
            className={className}
            title={name}
        />
    )
}
