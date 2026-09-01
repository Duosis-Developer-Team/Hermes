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
    entity: {
        customer: 'Müşteri',
        customers: 'Müşteriler',
        project: 'Proje',
        projects: 'Projeler',
        workType: 'İş Türü',
        workTypes: 'İş Türleri',
        activityType: 'Faaliyet Türü',
        activityTypes: 'Faaliyet Türleri',
        platform: 'Platform',
        platforms: 'Platformlar',
        workLine: 'İş Kolu',
        workLines: 'İş Kolları',
        user: 'Kullanıcı',
        users: 'Kullanıcılar',
    },

    admin: {
        entityCount: '{entity} ({n})',
        manageActivityTypes: 'Faaliyet türlerini yönetin',
        managePlatforms: 'Platformları yönetin',
        manageWorkLines: 'İş kollarını yönetin',
        workTypeNameLabel: 'İş Türü Adı',
        newEntity: 'Yeni {entity}',
        searchEntity: '{entity} ara',
        entityCreated: '{entity} oluşturuldu',
        entityUpdated: '{entity} güncellendi',
        entityArchived: '{entity} arşivlendi (geri alınabilir silme)',
        entityDeleted: '{entity} kalıcı olarak silindi',
        nameRequired: '{entity} adı zorunludur',
        createdAt: 'Oluşturulma',
        contract: 'Sözleşme',
        contractStatus: 'Sözleşme Durumu',
        contractStartOptional: 'Sözleşme Başlangıcı — İsteğe bağlı',
        contractDurationOptional: 'Sözleşme Süresi (Gün) — İsteğe bağlı',
        selectStartDate: 'Başlangıç tarihi seçin',
        durationExample: 'örn. 365',
        customerNameLabel: 'Müşteri Adı',
        customerNameExample: 'örn. ABC Teknoloji A.Ş.',
        projectNameLabel: 'Proje Adı',
        projectNameExample: 'örn. E-Ticaret Platformu',
        customerOptional: 'Müşteri (İsteğe bağlı)',
        selectCustomerHint: 'Müşteri seçin (iç projeler için boş bırakın)',
        internalProject: 'İç Proje',
        manageProjects: 'Projeleri yönetin',
        manageWorkTypes: 'İş türlerini yönetin',
        manageUsers: 'Kullanıcıları, rolleri ve grupları yönetin',
        manageCustomers: 'Kullanıcı hesaplarını ve kurum bilgilerini yönetin',
    },

    users: {
        fullName: 'Ad Soyad',
        email: 'E-posta',
        emailExample: 'ornek@sirket.com',
        emailInvalid: 'Geçerli bir e-posta girin',
        password: 'Parola',
        passwordMin: 'Parola en az 6 karakter olmalıdır',
        role: 'Rol',
        roles: 'Roller',
        selectRoles: 'Rolleri seçin',
        groups: 'Gruplar',
        adminBadge: 'Yönetici',
        rolesHint: 'İzinler rollerden gelir. Sahip olmadığınız izinleri içeren bir rolü atayamazsınız (alt küme kuralı); son aktif yönetici yetkisiz bırakılamaz.',
    },
    contracts: {
        title: 'Sözleşme Durumu',
        subtitle: 'Proje sözleşme sürelerini ve yenilemeleri izleyin',
        health: 'Sözleşme sağlığı',
        critical: 'Kritik / Süresi dolmuş',
        remainingTime: 'KALAN SÜRE',
        startDate: 'BAŞLANGIÇ TARİHİ',
        searchPlaceholder: 'Müşteri veya proje adına göre ara…',
        searchLabel: 'Sözleşmeleri müşteri veya projeye göre ara',
    },
}
