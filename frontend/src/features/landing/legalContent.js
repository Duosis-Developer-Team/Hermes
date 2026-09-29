/**
 * =============================================================================
 * HERMES - KVKK aydinlatma metni ve cerez politikasi (YAPI)
 * =============================================================================
 * Metinler i18n sozluklerinde (`legal.*`, tr.js / en.js) — Turkce metin
 * yalniz tr.js'te durur (sprint8Polish kurali). Burada yalniz bolum
 * duzeni ve anahtarlar var; LegalPage bunlari t() ile cozer.
 *
 * Icerik YALNIZ sistemde gercekten olan islemeleri anlatir (koddan
 * dogrulandi): HttpOnly oturum cerezi, tarayici depolamasi (tema, dil,
 * gorunum tercihleri), Microsoft kimlik dogrulamasi + profil fotografi,
 * is/efor/toplanti kayitlari, API istek kayitlari (90 gun), okunmus
 * bildirimler (90 gun). Reklam/analitik cerezi YOKTUR.
 *
 * HUKUKI GOZDEN GECIRME GEREKIR: veri sorumlusunun tam unvani, adresi ve
 * basvuru kanali (KEP / e-posta) `CONTROLLER` icinde tamamlanmalidir;
 * bu bilgiler uydurulmadi (bos alan sayfada gosterilmez).
 * =============================================================================
 */

export const LEGAL_UPDATED = '2026-09-30'

export const CONTROLLER = {
    address: '',
    contact: '',
}

export const LEGAL_DOCS = {
    'kvkk': {
        'title': 'legal.kvkkTitle',
        'intro': 'legal.kvkkIntro',
        'sections': [
            {
                'h': 'legal.kvkkS1H',
                'p': [
                    'legal.kvkkS1P1'
                ]
            },
            {
                'h': 'legal.kvkkS2H',
                'list': [
                    'legal.kvkkS2L1',
                    'legal.kvkkS2L2',
                    'legal.kvkkS2L3',
                    'legal.kvkkS2L4',
                    'legal.kvkkS2L5',
                    'legal.kvkkS2L6'
                ]
            },
            {
                'h': 'legal.kvkkS3H',
                'list': [
                    'legal.kvkkS3L1',
                    'legal.kvkkS3L2',
                    'legal.kvkkS3L3',
                    'legal.kvkkS3L4'
                ]
            },
            {
                'h': 'legal.kvkkS4H',
                'p': [
                    'legal.kvkkS4P1'
                ]
            },
            {
                'h': 'legal.kvkkS5H',
                'p': [
                    'legal.kvkkS5P1'
                ]
            },
            {
                'h': 'legal.kvkkS6H',
                'p': [
                    'legal.kvkkS6P1'
                ]
            },
            {
                'h': 'legal.kvkkS7H',
                'list': [
                    'legal.kvkkS7L1',
                    'legal.kvkkS7L2',
                    'legal.kvkkS7L3'
                ]
            },
            {
                'h': 'legal.kvkkS8H',
                'p': [
                    'legal.kvkkS8P1'
                ]
            },
            {
                'h': 'legal.kvkkS9H',
                'p': [
                    'legal.kvkkS9P1'
                ]
            }
        ]
    },
    'cookies': {
        'title': 'legal.cookiesTitle',
        'intro': 'legal.cookiesIntro',
        'sections': [
            {
                'h': 'legal.cookiesS1H',
                'table': [
                    [
                        'legal.cookiesS1R1C1',
                        'legal.cookiesS1R1C2',
                        'legal.cookiesS1R1C3'
                    ],
                    [
                        'legal.cookiesS1R2C1',
                        'legal.cookiesS1R2C2',
                        'legal.cookiesS1R2C3'
                    ]
                ]
            },
            {
                'h': 'legal.cookiesS2H',
                'table': [
                    [
                        'legal.cookiesS2R1C1',
                        'legal.cookiesS2R1C2',
                        'legal.cookiesS2R1C3'
                    ],
                    [
                        'legal.cookiesS2R2C1',
                        'legal.cookiesS2R2C2',
                        'legal.cookiesS2R2C3'
                    ],
                    [
                        'legal.cookiesS2R3C1',
                        'legal.cookiesS2R3C2',
                        'legal.cookiesS2R3C3'
                    ]
                ]
            },
            {
                'h': 'legal.cookiesS3H',
                'p': [
                    'legal.cookiesS3P1'
                ]
            },
            {
                'h': 'legal.cookiesS4H',
                'p': [
                    'legal.cookiesS4P1'
                ]
            }
        ]
    }
}

export const LEGAL_TABLE_HEAD = ['legal.th1', 'legal.th2', 'legal.th3']
