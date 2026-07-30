/**
 * =============================================================================
 * HERMES - Platforms Admin Page
 * =============================================================================
 * SOZLUK CRUD: name + code + description + is_active. Ortak kabuk
 * `features/admin/dictionaries/DictionaryCrudPage` icinde yasar; burada
 * yalnizca BU DOMAIN'e ait sozlesme durur.
 *
 * Ortaklastirmanin gerekcesi olculdu: bu dosya ile Platforms/WorkLines
 * arasinda, entity adi normalize edildiginde YALNIZCA iki satir fark
 * vardi (etiket rengi + placeholder). Uc kopya tek deseni anlatiyordu ve
 * ayni bes kusuru tasiyordu (console.error, cift gonderim, Edit A→B'de
 * bayat deger, "Error" mesaji, adsiz ikon butonlari).
 * =============================================================================
 */
import DictionaryCrudPage from '../features/admin/dictionaries/DictionaryCrudPage'
import { platformService } from '../services/api'
import { queryKeys } from '../query/queryKeys'
import './AdminPages.css'

function PlatformsPage() {
    return (
        <DictionaryCrudPage
            title="Platforms"
            singular="Platform"
            description="Manage platforms"
            codeColor="purple"
            service={platformService}
            queryKey={queryKeys.platforms.all}
        />
    )
}

export default PlatformsPage
