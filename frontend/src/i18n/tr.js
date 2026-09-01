/**
 * =============================================================================
 * HERMES - Turkce sozluk
 * =============================================================================
 * ANLAM ODAKLI cevrilir, kelime kelime DEGIL. Hermes'in kendi is
 * sozlugunu kullanir:
 *
 *   work log      -> is kaydi        (is'in kendisi; "zaman kaydi" degil)
 *   billable      -> faturalanabilir
 *   work type     -> is turu
 *   work line     -> is kolu
 *   requester     -> talep eden
 *   ticket        -> talep           (destek baglaminda; "bilet" DEGIL)
 *   scope         -> kapsam
 *
 * BU DOSYA, urun kaynaginda Turkce karakter yasaginin BILINCLI ve TEK
 * istisnasidir (bkz. test/hardening/sprint8Polish.test.js). Yasak
 * "kullaniciya Ingilizce metin goster" demek icin vardi; artik metin
 * sozlukten geliyor, dolayisiyla kural ceviri dosyasinda ANLAMSIZ olur
 * ama geri kalan tum kaynakta AYNEN gecerli kalir.
 *
 * Eksik anahtar Ingilizce'ye duser: buraya bir sey eklememek ekrani
 * KIRMAZ, yalnizca o metin Ingilizce kalir.
 */

export default {
    nav: {
        dashboard: 'Panel',
        billableHours: 'Faturalanabilir Saatler',
        reports: 'Raporlar',
        contractStatus: 'Sözleşme Durumu',
        pmConfigurations: 'Proje Yönetimi Ayarları',
        apiManagement: 'API Yönetimi',
        ticketIntegrations: 'Talep Entegrasyonları',
        customers: 'Müşteriler',
        projects: 'Projeler',
        workTypes: 'İş Türleri',
        activityTypes: 'Faaliyet Türleri',
        platforms: 'Platformlar',
        workLines: 'İş Kolları',
        users: 'Kullanıcılar',
        timeEntry: 'Zaman Girişi',
        projectManagement: 'Proje Yönetimi',
        meetings: 'Toplantılar',
        developer: 'Geliştirici',
        tickets: 'Talepler',
        support: 'Destek',
        groupManagement: 'YÖNETİM',
        groupConfiguration: 'YAPILANDIRMA',
        logout: 'Çıkış Yap',
    },

    shell: {
        switchToDark: 'Koyu temaya geç',
        switchToLight: 'Açık temaya geç',
        language: 'Dil',
        switchToTurkish: 'Türkçe\'ye geç',
        switchToEnglish: 'İngilizce\'ye geç',
    },

    common: {
        save: 'Kaydet',
        cancel: 'Vazgeç',
        create: 'Oluştur',
        edit: 'Düzenle',
        delete: 'Sil',
        close: 'Kapat',
        submit: 'Gönder',
        confirm: 'Onayla',
        search: 'Ara',
        clear: 'Temizle',
        refresh: 'Yenile',
        loading: 'Yükleniyor…',
        actions: 'İşlemler',
        status: 'Durum',
        name: 'Ad',
        description: 'Açıklama',
        active: 'Aktif',
        inactive: 'Pasif',
        yes: 'Evet',
        no: 'Hayır',
        all: 'Tümü',
        none: 'Yok',
        required: 'Bu alan zorunludur',
        saved: 'Kaydedildi',
        created: 'Oluşturuldu',
        updated: 'Güncellendi',
        deleted: 'Silindi',
        genericError: 'Bir sorun oluştu. Lütfen tekrar deneyin.',
        retry: 'Tekrar dene',
    },
}
