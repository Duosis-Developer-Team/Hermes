# State Ownership Matrisi (Sprint 1, CTO paketi §11)

| State | Owner | Not |
|---|---|---|
| Auth/session user + permissions | `stores/authStore` (Zustand) — boot'ta `/me` + `/rbac/me` doldurur | Persist YOK (KRİTİK-6); token HttpOnly cookie'de |
| Server koleksiyon/detaylari (work logs, tasks, users, roller, referans veriler) | TanStack Query — anahtarlar `src/query/queryKeys.js` | Server verisi Zustand'a KOPYALANMAZ |
| Task izin projeksiyonu | `useTaskPermissions` (React Query, 5 dk stale) | Backend tek otorite |
| Route/filtre durumu | Bugun: sayfa-ici useState. Hedef: URL search params — kademeli, Sprint 4-5'te sayfa bazinda | Ayni sprintte toplu donusum YAPILMAZ (§11 kurali) |
| Modal/gecici form | Bileşen-yerel state / AntD Form | |
| Sidebar collapsed / tema | `stores/themeStore` (persist'li client ayari) | |
| Clipboard task snapshot | Tasks feature'inin kendi hook/store'u | Sprint 5 kapsaminda korunacak davranis |

Kurallar: server state ikinci kez client store'a yazilmaz; yeni global
client state eklemeden once bu tabloya satir eklenip gerekcelenir.
