# Azure AD (Entra ID) Uygulama Kurulum Rehberi

Hermes projesinde "Microsoft ile Giriş Yap" özelliğini kullanabilmek için Microsoft Azure tarafında bir uygulama kaydı oluşturmanız gerekir. Bu işlem ücretsizdir ve yaklaşık 5 dakika sürer.

## Adım 1: Azure Portal'a Giriş
1.  [portal.azure.com](https://portal.azure.com) adresine gidin.
2.  Şirket hesabınızla (veya kişisel Microsoft hesabınızla) oturum açın.
3.  Üstteki arama çubuğuna **"App registrations"** (veya "Uygulama kayıtları") yazın ve seçin.

## Adım 2: Yeni Uygulama Oluşturma
1.  Sol üstteki **"+ New registration"** (Yeni kayıt) butonuna tıklayın.
2.  Açılan formda:
    *   **Name:** Uygulamanıza bir isim verin (Örn: `Hermes Dev`).
    *   **Supported account types:**
        *   Sadece kendi şirketiniz kullansın istiyorsanız: *Accounts in this organizational directory only (Single tenant)*.
        *   Herhangi bir Outlook hesabı girsin istiyorsanız: *Accounts in any organizational directory and personal Microsoft accounts*.
    *   **Redirect URI (Optional):**
        *   Platform: **Web** seçin.
        *   URL: http://localhost:5173/auth/callback (Local geliştirme için).
3.  **Register** butonuna basarak tamamlayın.

## Adım 3: Gerekli ID'leri Alma
Kayıt işlemi bitince sizi uygulamanın **Overview** (Genel Bakış) sayfasına atacak. Buradan şu bilgileri kopyalayın:

1.  **Application (client) ID:** Bu sizin `AZURE_CLIENT_ID` değerinizdir.
2.  **Directory (tenant) ID:** Bu sizin `AZURE_TENANT_ID` değerinizdir.

## Adım 4: Client Secret (Gizli Anahtar) Oluşturma
Backendi'nizin Microsoft ile güvenli konuşabilmesi için bir şifreye ihtiyacı var.

1.  Sol menüden **"Certificates & secrets"** (Sertifikalar ve sırlar) sekmesine tıklayın.
2.  **"Client secrets"** sekmesinde **"+ New client secret"** butonuna basın.
3.  Description: "Backend Secret" gibi bir isim verin.
4.  Expires: Önerilen (180 days) veya istediğinizi seçin.
5.  **Add** butonuna basın.
6.  **ÖNEMLİ:** Oluşan `Value` (Değer) kısmını **HEMEN KOPYALAYIN**. Bu sayfadan çıkınca bir daha göremezsiniz. Bu sizin `AZURE_CLIENT_SECRET` değerinizdir.

## Adım 5: Gerekli İzinler (Opsiyonel Kontrol)
Normalde varsayılan olarak gelir ama kontrol etmek iyidir. Login olmak için sadece `User.Read` izni yeterlidir.

1.  Sol menüden **"API permissions"** sekmesine gidin.
2.  Listede **User.Read** izninin olduğundan emin olun. Yoksa "Add a permission" -> "Microsoft Graph" -> "Delegated" -> "User.Read" yolunu izleyin.

---

## Özet: .env Dosyasına Eklenecekler

Elde ettiğiniz bu 3 bilgiyi projedeki `.env` dosyanıza ekleyin:

**Backend (.env):**
```ini
AZURE_CLIENT_ID=kopyaladıgınız-client-id
AZURE_TENANT_ID=kopyaladıgınız-tenant-id
AZURE_CLIENT_SECRET=kopyaladıgınız-secret-value
```

**Frontend (frontend/.env):**
```ini
VITE_AZURE_CLIENT_ID=kopyaladıgınız-client-id
VITE_AZURE_TENANT_ID=kopyaladıgınız-tenant-id
```
VITE_AZURE_TENANT_ID=kopyaladıgınız-tenant-id
```
*(Frontend secret'a ihtiyaç duymaz, sadece ID yeterlidir.)*

---

## Canlı Ortama (Kubernetes/Production) Geçiş Yaparken

Uygulamanız sunucuya taşındığında (örneğin: `https://hermes.sirketiniz.com`), Azure Portal'da küçük bir güncelleme yapmanız gerekir. Tekrar sıfırdan her şeyi almanıza gerek yoktur (ama güvenlik için Production ve Dev ortamlarını ayırmak önerilir).

**Yapılması Gereken:**
1.  Azure Portal > App Registrations > Uygulamanız > **Authentication** menüsüne gidin.
2.  **Redirect URIs** bölümüne **"Add URI"** diyerek canlı ortam adresini ekleyin.
    *   Örnek: `https://hermes.sirketiniz.com/auth/callback`
3.  Kaydedin.

**Not:** Artık hem `localhost` hem de `canlı domain` üzerinden giriş yapılabilir. Eğer Prod ve Dev ortamlarını tamamen ayırmak isterseniz (önerilen), yeni bir App Registration oluşturup Prod sunucusundaki `.env` dosyasına o yeni keyleri girmeniz daha sağlıklı olur.
