-- =============================================================================
-- HERMES — Migrator / runtime rol ayrimi (WS1, RLS onkosulu)
-- =============================================================================
-- NEDEN: PostgreSQL'de SUPERUSER ve BYPASSRLS yetkili roller satir
-- guvenligini asar. `FORCE ROW LEVEL SECURITY` tablo SAHIBINI de
-- politikaya tabi kilar, ama superuser'i ETMEZ. Bugun uygulama pod'lari
-- veritabani superuser'i (`hermes`) ile baglaniyor — bu haliyle RLS
-- yazsak bile hicbir sey korumaz. Once rol ayrimi, sonra RLS.
--
-- Bu betik iki rol kurar:
--
--   <prefix>_migrator : sema sahibi; migration Job'i bunu kullanir.
--                       BYPASSRLS'tir — backfill'in tenant context'i
--                       olmadan satir yazabilmesi gerekir.
--   <prefix>_app      : uygulama pod'lari; NOSUPERUSER, NOBYPASSRLS,
--                       TABLO SAHIBI DEGIL, yalnizca DML.
--
-- KULLANIM (her veritabaninda AYRI, superuser ile):
--
--   psql -v ON_ERROR_STOP=1 -d core_db \
--        -v prefix=hermes_core \
--        -v migrator_password="'<secret>'" \
--        -v app_password="'<secret>'" \
--        -f 00_roles.sql
--
--   psql -v ON_ERROR_STOP=1 -d auth_db -v prefix=hermes_auth ... -f 00_roles.sql
--
-- Sifreler ASLA repoya/loga/ConfigMap'e yazilmaz; K8s Secret'tan gelir.
-- Betik IDEMPOTENT'tir.
--
-- NOT: `\gexec` kullaniyoruz. psql degisken ikamesi dollar-quoted
-- ($$...$$) blok ICINDE calismaz; DO blogu bu yuzden kullanilamaz.
-- =============================================================================

\set ON_ERROR_STOP on
\set migrator_role :prefix '_migrator'
\set app_role :prefix '_app'

-- -----------------------------------------------------------------------------
-- 1) Roller (varsa sifre guncellenir, yoksa yaratilir)
-- -----------------------------------------------------------------------------
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L',
              :'migrator_role', :'migrator_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L',
              :'migrator_role', :'migrator_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'migrator_role')
\gexec

SELECT format('CREATE ROLE %I LOGIN PASSWORD %L',
              :'app_role', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

SELECT format('ALTER ROLE %I LOGIN PASSWORD %L',
              :'app_role', :'app_password')
WHERE EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

-- Migrator: sema sahibi + backfill icin RLS muafiyeti. Bu kimlik
-- YALNIZCA migration Job'ina verilir; uygulama pod'lari kullanmaz.
ALTER ROLE :"migrator_role" NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;

-- Uygulama: RLS'ten kacis YOK. Tum tenant izolasyonunun dayandigi
-- tek DB-seviyesi taahhut bu satirdir.
ALTER ROLE :"app_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- -----------------------------------------------------------------------------
-- 2) Sema sahipligi migrator'a devredilir
-- -----------------------------------------------------------------------------
-- Mevcut nesneler bootstrap superuser'i tarafindan yaratilmis. Sahipligi
-- migrator'a tasiyoruz ki uygulama rolu hicbir tablonun sahibi OLMASIN
-- (RLS envanter testi bunu makine ile dogrular).
SELECT format('GRANT %I TO %I', :'migrator_role', current_user)
WHERE NOT pg_has_role(current_user, :'migrator_role', 'MEMBER')
\gexec

-- Migrator'in RLS yardimci semasini (hermes_sec) yaratabilmesi icin
-- veritabani duzeyinde CREATE gerekir. Uygulama rolune VERILMEZ.
SELECT format('GRANT CREATE, CONNECT ON DATABASE %I TO %I',
              current_database(), :'migrator_role')
\gexec

ALTER SCHEMA public OWNER TO :"migrator_role";

SELECT format('ALTER TABLE public.%I OWNER TO %I', c.relname,
              :'migrator_role')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
\gexec

SELECT format('ALTER SEQUENCE public.%I OWNER TO %I', c.relname,
              :'migrator_role')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'S'
  -- Kimlik/serial sequence'lari sahibi tabloyla birlikte devrolur.
  AND NOT EXISTS (
      SELECT 1 FROM pg_depend d
      WHERE d.objid = c.oid AND d.deptype = 'a'
  )
\gexec

SELECT format('ALTER VIEW public.%I OWNER TO %I', c.relname,
              :'migrator_role')
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind = 'v'
\gexec

-- -----------------------------------------------------------------------------
-- 3) Uygulama rolune EN AZ yetki (DML evet, DDL hayir)
-- -----------------------------------------------------------------------------
SELECT format('GRANT CONNECT ON DATABASE %I TO %I',
              current_database(), :'app_role')
\gexec

GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE
    ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- Bundan sonra migrator'in yarattigi nesneler icin de ayni yetki.
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"migrator_role" IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- Uygulama rolu sema nesnesi YARATAMAZ.
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM :"app_role";

-- -----------------------------------------------------------------------------
-- 4) Dogrulama ciktisi (sifre icermez)
-- -----------------------------------------------------------------------------
\echo '--- rol nitelikleri ---'
SELECT rolname,
       rolsuper     AS is_superuser,
       rolbypassrls AS bypasses_rls,
       rolcreatedb,
       rolcreaterole
FROM pg_roles
WHERE rolname IN (:'migrator_role', :'app_role')
ORDER BY rolname;

\echo '--- uygulama rolunun sahip oldugu tablo sayisi (0 OLMALI) ---'
SELECT count(*) AS tables_owned_by_app_role
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_roles r ON r.oid = c.relowner
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
  AND r.rolname = :'app_role';
