# Hermes Frontend Baseline (Sprint 0)

> Uretici: `node scripts/frontend/measure-baseline.mjs` — tekrar
> calistirilabilir; sayilar guncel HEAD uzerinden yeniden uretilir.

- Olculen HEAD: `f6882f1`
- Node: `v23.9.0` / npm: `10.9.2`
- Dependencies: 12 runtime, 9 dev
- Scripts: dev, build, preview, lint, test

## Kaynak metrikleri

| Metrik | Deger |
|---|---:|
| Toplam kaynak dosya (.js/.jsx/.ts/.tsx/.css) | 107 |
| Toplam LOC | 29744 |
| Route sayisi (App.jsx path=) | 25 |
| Lazy route | 0 (0 = tum route'lar statik import) |
| Inline style (style={{) | 379 |
| !important | 421 |
| transition: all | 8 |
| Benzersiz ham hex renk | 113 |
| Eski dizi-bicimli invalidateQueries([...]) | 29 |
| Test dosyasi | 1 |
| Dis host referansi (fonts/cdn) | 1 adet / host'lar: fonts.googleapis.com, www.w3.org |

## En buyuk 20 kaynak dosya

| Dosya | LOC |
|---|---:|
| src/pages/admin/ApiManagementPage.jsx | 1519 |
| src/pages/TasksPage.jsx | 1512 |
| src/services/api.js | 1315 |
| src/pages/TimeEntryPage.jsx | 875 |
| src/index.css | 821 |
| src/pages/developer/DeveloperPortalPage.css | 767 |
| src/pages/admin/TaskManagementPage.jsx | 753 |
| src/pages/admin/AssignmentHierarchyTab.jsx | 724 |
| src/pages/admin/TaskAccessByGroupTab.jsx | 722 |
| src/components/modals/LogTimeModal.jsx | 621 |
| src/pages/admin/UserGroupsTab.jsx | 585 |
| src/pages/ReportsPage.jsx | 565 |
| src/components/modals/CreateTaskModal.jsx | 555 |
| src/pages/BillableHoursPage.jsx | 530 |
| src/components/modals/TaskReviewModal.jsx | 526 |
| src/pages/TasksPage.css | 482 |
| src/pages/developer/sections/McpSection.jsx | 408 |
| src/components/tasks/TasksBoardView.jsx | 400 |
| src/pages/MeetingsPage.jsx | 394 |
| src/pages/admin/ContractStatusPage.jsx | 371 |

## API servis katmani

| Dosya | LOC |
|---|---:|
| src/services/api.js | 1315 |

## Production build

| Metrik | Raw | Gzip |
|---|---:|---:|
| JS toplam | 2069.2 KB | 615.4 KB |
| CSS toplam | 90.6 KB | 15.6 KB |
| Chunk sayisi | 2 | |

### En buyuk 10 chunk

| Asset | Raw | Gzip |
|---|---:|---:|
| index-<hash>.js | 2069.2 KB | 615.4 KB |
| index-<hash>.css | 90.6 KB | 15.6 KB |

## Lint / test durumu (durust)

- `npm run lint`: script tanimli fakat ESLint CONFIG DOSYASI YOK — komut hata verir (Sprint 1 kapsaminda kurulacak).
- `npm test` (vitest): 1 test dosyasi mevcut (Developer Portal gercek-durum kilitleri).
- Kritik is akislari (Time Entry, Tasks, RBAC) icin frontend testi YOK — Sprint 1+ plani.

