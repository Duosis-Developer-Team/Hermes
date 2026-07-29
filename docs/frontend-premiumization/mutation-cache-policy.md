# Mutation / Cache Politikasi (Sprint 1, CTO paketi §9)

Genel kurallar: v5 object-syntax zorunlu (`invalidateQueries({ queryKey })`);
eski dizi bicimi YASAK — v5'te tum cache'i invalid ediyordu (bkz.
`src/test/characterization/invalidation.test.js`, bug kaydi testle sabit).
Refetch tum uygulamayi titretmez; pending sirasinda ayni eylem tekrar
gonderilmez; optimistic update yalniz rollback'le birlikte.

Mevcut mutasyon envanteri (Sprint 1 itibariyla gozlenen davranis):

| Mutation | Optimistic? | Cache update | Invalidation (hedefli) | Rollback |
|---|---:|---|---|---|
| Work log create/edit/delete | Hayir | — | `workLogs` (+ period status ekrani kendi query'siyle) | — |
| Plan time create/respond | Hayir | — | `planTimes`, `workLogs` | — |
| Task create/edit/status/complete | Hayir | — | `tasks` ailesi | — |
| Log Time (task'tan) | Hayir | — | `workLogs` + `tasks` detail | — |
| User create/update (+roller) | Hayir | — | `users`, `rbac-roles`, `rbac-roles-active` | — |
| Rol CRUD | Hayir | — | `rbac-roles` ailesi | — |
| Referans CRUD (customer/project/workType/…) | Hayir | — | ilgili tek aile | — |

Sprint 4-5 hedefi: kritik akislarda (Time Entry karti, task status)
hedefli cache update + optimistic + rollback'e gecis — bu tablo o
sprintlerde satir satir guncellenir; "Optimistic: Hayir" satirlari
bilinçli mevcut durumu belgeler, hedef degil.
