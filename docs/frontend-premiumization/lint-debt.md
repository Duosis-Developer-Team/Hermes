# Lint Borc Kaydi (Sprint 1, CTO paketi §3)

Kapı: `npm run lint` = eslint `--max-warnings 9` (RATCHET). Yeni uyari
CI'yi kirar; sayi sprint'ler icinde YALNIZCA asagi iner. `--max-warnings 0`
nihai hedeftir.

## Baslangic → Sprint 1 sonu

| Kategori | Baslangic | Sprint 1 sonu |
|---|---:|---:|
| no-unused-vars (hata) | 66 | **0** (tamami temizlendi) |
| react-hooks/exhaustive-deps (uyari) | 8 | 8 (davranis riski — mekanik fix yasak) |
| react-refresh/only-export-components | 1 | 1 |
| **Ratchet tavani** | — | **9** |

## Acik borclar (9)

exhaustive-deps (8): `App.jsx` bootstrap/permissions effect'leri (2),
`useTaskPermissions` (1), `TimeEntryPage` logs/useMemo zinciri (3),
`MeetingsPage` (1), `RolesTab` catalog memo (1) — her biri davranis
degistirmeden kapatilamaz; ilgili sayfalarin refactor sprintinde
(Sprint 4/5/6) testli olarak cozulur.
react-refresh (1): `App.jsx` icindeki `CenteredLoader` — Sprint 3 shell
calismasi ayri dosyaya tasiyacak.

## Kapali kurallar (borc olarak izlenir)

- `react/prop-types`: off — TS/PropTypes karari Sprint 2+ (yuzlerce ihlal).
- `react/no-unescaped-entities`: off — Turkce metin kacis churn'u.

`eslint-disable` politikasi: yeni disable yalniz gerekce yorumuyla;
`--report-unused-disable-directives` islevsizleri CI'da yakalar
(Sprint 1'de 1 adet bulunup silindi).
