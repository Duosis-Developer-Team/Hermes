-- =============================================================================
-- HERMES — Var olan nesnelerin migrator'a DEVRI (WS1 eki)
-- =============================================================================
-- NEDEN VAR: `00_roles.sql` rolleri kurar ve `public` semasinin sahibini
-- migrator yapar, ama SEMADAN ONCE var olmus nesnelerin sahibini
-- degistirmez. Hermes'in eski surumu semayi uygulama startup'inda,
-- veritabani superuser'i `hermes` adina yaratiyordu. O nesneler hala
-- `hermes`'e aittir.
--
-- Bunun bedeli sessiz degil, ama GEC ortaya cikar: migrator var olan bir
-- nesneyi degistirmeye kalktiginda PostgreSQL "must be owner of ..." der
-- ve migration YARIDA kirilir. Canlida birebir yasandi:
--
--   InsufficientPrivilege: must be owner of function assign_task_type_number
--
-- Rollout fail-closed durdu, veri zarar gormedi — ama devir adimi
-- yapilmadan migration hicbir zaman tamamlanamaz.
--
-- -----------------------------------------------------------------------------
-- EKLENTI NESNELERINE DOKUNULMAZ
-- -----------------------------------------------------------------------------
-- core_db'de TimescaleDB kurulu ve `public` semasinda 100'den fazla
-- fonksiyonu var. Bunlarin sahipligi EKLENTIYE aittir; devredilirse
-- `pg_dump`/eklenti yukseltmesi bozulur ve hicbir faydasi olmaz —
-- migration onlara zaten dokunmaz. Bu yuzden `pg_depend.deptype='e'`
-- (eklenti uyesi) olan her nesne DISARIDA birakilir. Filtre bir
-- iyilestirme degil, dogruluk sartidir.
--
-- KULLANIM (her veritabaninda AYRI, superuser ile):
--
--   psql -v ON_ERROR_STOP=1 -d core_db -v prefix=hermes_core \
--        -f 01_adopt_objects.sql
--
-- Idempotenttir: zaten migrator'a ait nesneler icin hicbir sey uretmez.
-- =============================================================================

\set migrator :prefix '_migrator'
\set migrator_lit '''' :migrator ''''

-- NOT: `\gexec` — asagidaki SELECT'ler calistirilacak DDL METNINI uretir,
-- psql da her satiri sirayla kosar. Dollar-quoted `DO` blogu icinde psql
-- degiskenleri ikame EDILMEDIGI icin bu desen zorunlu.

-- -----------------------------------------------------------------------------
-- 1) Tablolar / sequence'ler / view'lar / materialized view'lar
-- -----------------------------------------------------------------------------
SELECT format('ALTER %s %I.%I OWNER TO %I;',
              CASE c.relkind
                WHEN 'r' THEN 'TABLE'
                WHEN 'p' THEN 'TABLE'
                WHEN 'S' THEN 'SEQUENCE'
                WHEN 'v' THEN 'VIEW'
                WHEN 'm' THEN 'MATERIALIZED VIEW'
              END,
              n.nspname, c.relname, :migrator_lit)
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p', 'S', 'v', 'm')
  AND pg_get_userbyid(c.relowner) <> :migrator_lit
  -- sequence'i sahiplenilen tabloya bagli olanlar (deptype='a') tabloyla
  -- birlikte gelir; eklenti uyeleri (deptype='e') DISARIDA kalir.
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_class'::regclass
                    AND d.objid = c.oid AND d.deptype = 'e')
\gexec

-- -----------------------------------------------------------------------------
-- 2) Fonksiyonlar / prosedurler
-- -----------------------------------------------------------------------------
-- `oid::regprocedure` argüman tiplerini de basar (asiri yuklenmis
-- fonksiyonlar icin sart: `time_bucket` gibi 20+ imzasi olanlar var).
SELECT format('ALTER %s %s OWNER TO %I;',
              CASE p.prokind WHEN 'p' THEN 'PROCEDURE' ELSE 'FUNCTION' END,
              p.oid::regprocedure, :migrator_lit)
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prokind IN ('f', 'p')
  AND pg_get_userbyid(p.proowner) <> :migrator_lit
  AND NOT EXISTS (SELECT 1 FROM pg_depend d
                  WHERE d.classid = 'pg_proc'::regclass
                    AND d.objid = p.oid AND d.deptype = 'e')
\gexec

-- -----------------------------------------------------------------------------
-- 3) Dogrulama — devredilmemis nesne KALMAMALI
-- -----------------------------------------------------------------------------
SELECT 'devredilmeyen nesne' AS kontrol,
       count(*) AS kalan
FROM (
  SELECT c.oid FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('r','p','S','v','m')
    AND pg_get_userbyid(c.relowner) <> :migrator_lit
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_class'::regclass
                      AND d.objid = c.oid AND d.deptype = 'e')
  UNION ALL
  SELECT p.oid FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f','p')
    AND pg_get_userbyid(p.proowner) <> :migrator_lit
    AND NOT EXISTS (SELECT 1 FROM pg_depend d
                    WHERE d.classid = 'pg_proc'::regclass
                      AND d.objid = p.oid AND d.deptype = 'e')
) t;
-- Beklenen: kalan = 0. Sifir degilse migration "must be owner of ..." ile
-- kirilir; devam ETMEYIN.
