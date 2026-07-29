# Hermes Frontend Baseline (Sprint 0)

> Uretici: `node scripts/frontend/measure-baseline.mjs` — tekrar
> calistirilabilir; sayilar guncel HEAD uzerinden yeniden uretilir.

- Olculen HEAD: `3811520`
- Node: `v23.9.0` / npm: `10.9.2`
- Dependencies: 12 runtime, 13 dev
- Scripts: dev, build, preview, lint, test

## Kaynak metrikleri

| Metrik | Deger |
|---|---:|
| Toplam kaynak dosya (.js/.jsx/.ts/.tsx/.css) | 122 |
| Toplam LOC | 30242 |
| Route sayisi (App.jsx path=) | 25 |
| Lazy route | 19 (0 = tum route'lar statik import) |
| Inline style (style={{) | 383 |
| !important | 421 |
| transition: all | 8 |
| Benzersiz ham hex renk | 112 |
| Eski dizi-bicimli invalidateQueries([...]) | 2 |
| Test dosyasi | 4 |
| Dis host referansi (fonts/cdn) | 0 adet / host'lar: www.w3.org |

## En buyuk 20 kaynak dosya

| Dosya | LOC |
|---|---:|
| src/pages/admin/ApiManagementPage.jsx | 1519 |
| src/pages/TasksPage.jsx | 1511 |
| src/services/api.js | 1124 |
| src/pages/TimeEntryPage.jsx | 868 |
| src/index.css | 824 |
| src/pages/developer/DeveloperPortalPage.css | 767 |
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
| src/pages/developer/sections/McpSection.jsx | 408 |
| src/components/tasks/TasksBoardView.jsx | 400 |
| src/pages/MeetingsPage.jsx | 394 |
| src/pages/admin/ContractStatusPage.jsx | 371 |

## API servis katmani

| Dosya | LOC |
|---|---:|
| src/services/api.js | 1124 |

## Production build

| Metrik | Raw | Gzip |
|---|---:|---:|
| JS toplam | 2125.8 KB | 674.9 KB |
| CSS toplam | 90.6 KB | 21.3 KB |
| Chunk sayisi | 67 | |

### En buyuk 10 chunk

| Asset | Raw | Gzip |
|---|---:|---:|
| index-<hash>.js | 765.9 KB | 247.3 KB |
| DashboardPage-<hash>.js | 368.6 KB | 101.8 KB |
| Table-<hash>.js | 180.0 KB | 56.9 KB |
| TasksPage-<hash>.js | 104.1 KB | 31.8 KB |
| index-<hash>.js | 103.3 KB | 33.3 KB |
| index-<hash>.js | 95.1 KB | 30.7 KB |
| DeveloperPortalPage-<hash>.js | 87.5 KB | 25.8 KB |
| TimeEntryPage-<hash>.js | 38.5 KB | 11.4 KB |
| index-<hash>.js | 35.7 KB | 11.5 KB |
| TaskManagementPage-<hash>.js | 33.8 KB | 9.1 KB |

## Lint / test durumu (durust)

- `npm run lint`: script tanimli fakat ESLint CONFIG DOSYASI YOK — komut hata verir (Sprint 1 kapsaminda kurulacak).
- `npm test` (vitest): 4 test dosyasi mevcut (Developer Portal gercek-durum kilitleri).
- Kritik is akislari (Time Entry, Tasks, RBAC) icin frontend testi YOK — Sprint 1+ plani.

