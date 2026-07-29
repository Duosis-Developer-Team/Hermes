# Hermes Frontend Baseline (Sprint 0)

> Uretici: `node scripts/frontend/measure-baseline.mjs` — tekrar
> calistirilabilir; sayilar guncel HEAD uzerinden yeniden uretilir.

- Olculen HEAD: `f367815`
- Node: `v23.9.0` / npm: `10.9.2`
- Dependencies: 12 runtime, 13 dev
- Scripts: dev, build, preview, lint, test

## Kaynak metrikleri

| Metrik | Deger |
|---|---:|
| Toplam kaynak dosya (.js/.jsx/.ts/.tsx/.css) | 139 |
| Toplam LOC | 32577 |
| Route sayisi (App.jsx path=) | 25 |
| Lazy route | 19 (0 = tum route'lar statik import) |
| Inline style (style={{) | 388 |
| !important | 411 |
| transition: all | 6 |
| Benzersiz ham hex renk (toplam) | 135 |
| Benzersiz ham hex renk (TOKEN KAYNAGI HARIC = borc) | 111 |
| Eski dizi-bicimli invalidateQueries([...]) | 2 |
| Test dosyasi | 12 |
| Dis host referansi (fonts/cdn) | 0 adet / host'lar: www.w3.org |

## En buyuk 20 kaynak dosya

| Dosya | LOC |
|---|---:|
| src/pages/TasksPage.jsx | 1521 |
| src/pages/admin/ApiManagementPage.jsx | 1519 |
| src/services/api.js | 1124 |
| src/index.css | 830 |
| src/pages/developer/DeveloperPortalPage.css | 767 |
| src/pages/TimeEntryPage.jsx | 766 |
| src/pages/admin/TaskManagementPage.jsx | 753 |
| src/pages/admin/TaskAccessByGroupTab.jsx | 722 |
| src/pages/admin/AssignmentHierarchyTab.jsx | 713 |
| src/components/modals/LogTimeModal.jsx | 600 |
| src/pages/admin/UserGroupsTab.jsx | 585 |
| src/pages/ReportsPage.jsx | 562 |
| src/components/modals/CreateTaskModal.jsx | 554 |
| src/pages/BillableHoursPage.jsx | 528 |
| src/components/modals/TaskReviewModal.jsx | 526 |
| src/pages/TasksPage.css | 482 |
| src/components/layout/MainLayout.jsx | 467 |
| src/components/layout/MainLayout.css | 456 |
| src/pages/developer/sections/McpSection.jsx | 408 |
| src/components/tasks/TasksBoardView.jsx | 400 |

## API servis katmani

| Dosya | LOC |
|---|---:|
| src/services/api.js | 1124 |

## Production build

| Metrik | Raw | Gzip |
|---|---:|---:|
| JS toplam | 2131.1 KB | 675.9 KB |
| CSS toplam | 102.0 KB | 23.3 KB |
| Chunk sayisi | 65 | |

### En buyuk 10 chunk

| Asset | Raw | Gzip |
|---|---:|---:|
| index-<hash>.js | 794.0 KB | 256.0 KB |
| DashboardPage-<hash>.js | 368.6 KB | 101.8 KB |
| Table-<hash>.js | 180.0 KB | 56.9 KB |
| TasksPage-<hash>.js | 105.0 KB | 32.2 KB |
| index-<hash>.js | 103.3 KB | 33.3 KB |
| index-<hash>.js | 95.1 KB | 30.7 KB |
| DeveloperPortalPage-<hash>.js | 87.4 KB | 25.8 KB |
| TimeEntryPage-<hash>.js | 39.5 KB | 11.8 KB |
| index-<hash>.js | 35.7 KB | 11.5 KB |
| TaskManagementPage-<hash>.js | 33.8 KB | 9.1 KB |

## Lint / test durumu (durust)

- `npm run lint`: script tanimli fakat ESLint CONFIG DOSYASI YOK — komut hata verir (Sprint 1 kapsaminda kurulacak).
- `npm test` (vitest): 12 test dosyasi mevcut (Developer Portal gercek-durum kilitleri).
- Kritik is akislari (Time Entry, Tasks, RBAC) icin frontend testi YOK — Sprint 1+ plani.

