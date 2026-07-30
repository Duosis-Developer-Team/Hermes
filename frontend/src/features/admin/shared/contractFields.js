/**
 * =============================================================================
 * HERMES - Sozlesme alanlari adaptoru (Sprint 6A/6C completion)
 * =============================================================================
 * BACKEND SOZLESMESI (dogrulandi, uydurulmadi):
 *   schemas/customer.py → CustomerCreate ve CustomerUpdate ikisi de
 *     `contract_start_date: Optional[datetime]` ve
 *     `contract_duration_days: Optional[int]` KABUL EDER.
 *   schemas/project.py  → ProjectCreate ayni iki alani kabul eder;
 *     `contract_duration_days` icin `ge=1` kisiti vardir.
 * Ayri bir "contracts" router'i ya da entity'si YOKTUR — sozlesme verisi
 * Customer ve Project uzerinde iki nullable kolondur.
 *
 * NEDEN ADAPTOR: AntD `DatePicker` dayjs nesnesiyle calisir, backend ise
 * datetime bekler. Iki yuzey (Customers, Projects) AYNI donusumu yapmak
 * zorunda; ayni ise iki kopya yazmak yerine tek yerde duruyor.
 *
 * TIMEZONE KARARI: tarih backend'e GUN olarak (`YYYY-MM-DD`) gonderilir.
 * `toISOString()` kullanmak yerel saat dilimine gore bir gun kaydirabilir
 * (orn. UTC+3'te 01 Ocak 00:00 → 31 Aralik 21:00Z) ve sozlesme baslangici
 * yanlis gune duserdi. Pydantic date-only bir dizeyi gece yarisi
 * datetime'ina cevirir; boylece gorunen gun ile kaydedilen gun AYNI kalir.
 * =============================================================================
 */
import dayjs from 'dayjs'

/** Backend degeri → form degeri (DatePicker icin dayjs). */
export function contractToForm(record) {
    const raw = record?.contract_start_date
    return {
        contract_start_date: raw ? dayjs(raw) : null,
        contract_duration_days:
            record?.contract_duration_days ?? undefined,
    }
}

/**
 * Form degeri → backend payload'i.
 * Bos birakilan alanlar `null` gonderilir: bu, "sozlesmeyi kaldir"
 * anlamina gelir ve alanin hic gonderilmemesinden (degistirme) FARKLIDIR.
 */
export function contractToPayload(values) {
    const start = values?.contract_start_date
    const days = values?.contract_duration_days
    return {
        contract_start_date: start && dayjs.isDayjs(start)
            ? start.format('YYYY-MM-DD')
            : (start || null),
        contract_duration_days:
            days === undefined || days === null || days === '' ? null : Number(days),
    }
}
