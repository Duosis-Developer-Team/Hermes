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
    login: {
        signInToHermes: 'Hermes\'e giriş yap',
        email: 'E-posta',
        password: 'Parola',
        emailPlaceholder: 'siz@sirket.com',
        passwordPlaceholder: 'Parolanızı girin',
        signIn: 'Giriş Yap',
        signInWithMicrosoft: 'Microsoft ile giriş yap',
        microsoftHint: 'Devam etmek için Microsoft iş hesabınızı kullanın',
        loginSuccess: 'Giriş başarılı!',
        signedInToPlatform: 'Platform Yönetimi\'ne giriş yapıldı',
        emailRequired: 'Lütfen e-posta adresinizi girin',
        emailInvalid: 'Lütfen geçerli bir e-posta adresi girin',
        passwordRequired: 'Lütfen parolanızı girin',
        azureMisconfigured: 'Web yapılandırmasında Azure Client ID tanımlı değil',
        toggleTheme: 'Açık ve koyu tema arasında geçiş yap',
    },

    timeEntry: {
        timeLogged: 'Süre kaydedildi',
        timeUpdated: 'Süre güncellendi',
        logEntryDeleted: 'İş kaydı silindi',
        planUpdated: 'Plan güncellendi',
        planDeleted: 'Plan silindi',
        deletePlan: 'Planı Sil',
        deletePlanFailed: 'Plan silinemedi',
        confirmDeletion: 'Silmeyi Onayla',
        cannotBeUndone: 'Bu işlem geri alınamaz',
        assignmentsWillBeRemoved: 'Tüm atamalar kaldırılacak',
        selectTargetDay: 'Önce hedef günü seçin, sonra yapıştırın',
        reportDownloaded: 'Haftalık rapor (CSV) indirildi',
        reportFailed: 'Rapor indirilemedi',
        meetingInviteSent: 'Toplantı daveti gönderildi',
        respondFailed: 'Yanıt gönderilemedi',
    },

    tasks: {
        filters: 'Filtreler',
        noAccess: 'Görevler modülüne erişiminiz yok.',
        statusNotAllowed: 'Bu görevin durumunu değiştirme yetkiniz yok.',
    },

    meetings: {
        previousWeek: 'Önceki hafta',
        nextWeek: 'Sonraki hafta',
        today: 'Bugün',
        allUsers: 'Tüm kullanıcılar',
        noMeetings: 'Bu hafta için toplantı yok.',
    },

    dashboard: {
        title: 'Panel',
        subtitle: 'Ekip performansı ve zaman dağılımı',
        summaryMetrics: 'Özet göstergeler',
        totalHours: 'Toplam Saat',
        activeMembers: 'Aktif Üye',
        customers: 'Müşteriler',
        projects: 'Projeler',
        byUser: 'Kullanıcıya Göre',
        byCustomer: 'Müşteriye Göre',
        byProject: 'Projeye Göre',
        previousMonth: 'Önceki ay',
        nextMonth: 'Sonraki ay',
        today: 'Bugün',
    },

    billableHours: {
        title: 'Faturalanabilir Saatler',
        subtitle: 'Kullanıcıların faturalanabilir sürelerini yönetin',
        selectUser: 'Kullanıcı seçin',
        currentWeek: 'Bu Hafta',
        previousWeek: 'Önceki hafta',
        nextWeek: 'Sonraki hafta',
        save: 'Faturalanabilir saatleri kaydet',
        hoursUpdated: 'Saatler güncellendi',
        minuteIncrement: 'Dakika 15\'in katları olmalıdır (0, 15, 30, 45).',
        accessDenied: 'Erişim Reddedildi',
    },
}
