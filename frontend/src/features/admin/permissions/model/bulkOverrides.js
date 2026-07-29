/**
 * =============================================================================
 * HERMES - Uye override'larini TOPLU uygulama surucusu (Sprint 6B.1)
 * =============================================================================
 * NEDEN VAR (ve neden `classifyBulkResult` tek basina yetmedi):
 *
 * Grup DEFAULT'unu degistirmek ATOMIK bir backend islemidir — tek bir PUT,
 * sunucu tarafinda o grubun butun override satirlarini ayni islemde
 * yeniden yazar (`upsert_task_group_permission`). Orada per-uye kismi
 * basarisizlik YOKTUR; istek ya tumden basarili ya tumden basarisizdir.
 * 6B'de eklenen `classifyBulkResult` bu yuzden bagli DEGILDI: var olmayan
 * bir fan-out icin yazilmisti. Bu, durustce kaydedilen bir asiri
 * tasarim hatasidir.
 *
 * GERCEK fan-out sudur: ayni override'i BIRDEN COK UYEYE uygulamak. Uye
 * override ucu TEK UYELIKtir (PUT .../member-overrides/{userId}), yani N
 * uye = N istek ve islem ATOMIK DEGILDIR. Bu durumda arayuz atomikmis
 * gibi davranamaz: her uyenin GERCEK sonucu korunur.
 *
 * Surucunun garantileri:
 *   - Istekler SIRAYLA gider (sunucuyu N es zamanli yazmayla dovmez ve
 *     ilerleme anlamli olarak sayilabilir).
 *   - Her adimda ilerleme bildirilir: toplam / tamamlanan / basarili /
 *     basarisiz.
 *   - Basarisiz uye akisi DURDURMAZ; kalanlar denenmeye devam eder ve
 *     her sonuc tek tek saklanir.
 *   - Iptal (`signal`) desteklenir — panel kapanirsa surucu susar,
 *     unmount sonrasi state guncellemesi olmaz.
 * =============================================================================
 */

/**
 * Verilen uyelere ayni override yamasini SIRAYLA uygular.
 *
 * @param {object}   opts
 * @param {Array}    opts.targets   Uygulanacak uyeler (en az { user_id }).
 * @param {Function} opts.apply     async ({ userId, data }) => void; hata FIRLATIR.
 * @param {object}   opts.data      Her uyeye uygulanacak override yamasi.
 * @param {Function} [opts.onProgress] Her adimdan sonra ilerleme.
 * @param {{aborted: boolean}} [opts.signal] Iptal bayragi.
 * @returns {Promise<{results: Array, aborted: boolean}>}
 *   results: [{ user_id, ok, error? }] — GIRDI SIRASINDA.
 */
export async function runBulkOverrides({
    targets, apply, data, onProgress, signal,
} = {}) {
    const list = Array.isArray(targets) ? targets : []
    const results = []
    let succeeded = 0
    let failed = 0

    const report = () => {
        onProgress?.({
            total: list.length,
            completed: results.length,
            succeeded,
            failed,
        })
    }
    // Baslamadan once hedef sayisi bilinir (0 hedef de bildirilir).
    report()

    for (const target of list) {
        if (signal?.aborted) return { results, aborted: true }
        try {
            await apply({ userId: target.user_id, data })
            results.push({ user_id: target.user_id, ok: true })
            succeeded += 1
        } catch (error) {
            // Bir uyenin hatasi digerlerini ENGELLEMEZ; gercek sonuc saklanir.
            results.push({ user_id: target.user_id, ok: false, error })
            failed += 1
        }
        report()
    }
    return { results, aborted: false }
}

/**
 * Yalnizca BASARISIZ olanlari yeniden denemek icin hedef listesi.
 *
 * Basarili uyeler DISARIDA BIRAKILIR — tekrar denemek onlarda ikinci
 * (gereksiz) bir mutation uretirdi. Sira ve kimlikler korunur.
 */
export function failedTargets(results, membersById) {
    return (Array.isArray(results) ? results : [])
        .filter((r) => r && r.ok === false)
        .map((r) => membersById?.[r.user_id] || { user_id: r.user_id })
}

/** Bir hatadan kullaniciya gosterilecek mesaji cikarir. */
export const errorText = (error, fallback = 'Failed.') =>
    error?.response?.data?.detail || error?.message || fallback
