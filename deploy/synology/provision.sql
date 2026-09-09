-- One-time provisioning on the DiskStation Postgres (homenas.lan:5400).
-- Run as a superuser / admin role, e.g.:
--
--   psql -h homenas.lan -p 5400 -U postgres \
--        -v owner_password='...' -v app_password='...' -f provision.sql
--
-- Two roles, least privilege:
--
--   storyboard      owns the database and runs migrations (CREATE TABLE / TYPE). Used only
--                   by the migration step (MIGRATION_DATABASE_URL).
--   storyboard_app  what the running API connects as (DATABASE_URL). Data access only:
--                   SELECT / INSERT / UPDATE / DELETE on the app tables. It cannot alter the
--                   schema, and it cannot connect to any other database on the server.
--
-- Tables, enums and indexes come from the Drizzle migrations in apps/api/drizzle, applied by
-- the container on start (RUN_MIGRATIONS=true) or by hand with MIGRATION_DATABASE_URL.
--
-- Re-runnable: it skips anything that already exists and re-applies passwords and grants.

\set ON_ERROR_STOP on

-- ---------- owner / migration role ----------
SELECT 'CREATE ROLE storyboard LOGIN PASSWORD ' || quote_literal(:'owner_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storyboard') \gexec
ALTER ROLE storyboard WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  PASSWORD :'owner_password';

-- ---------- runtime role ----------
SELECT 'CREATE ROLE storyboard_app LOGIN PASSWORD ' || quote_literal(:'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'storyboard_app') \gexec
ALTER ROLE storyboard_app WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT
  CONNECTION LIMIT 20 PASSWORD :'app_password';

-- ---------- database ----------
SELECT 'CREATE DATABASE storyboard OWNER storyboard ENCODING ''UTF8'''
WHERE NOT EXISTS (SELECT 1 FROM pg_database WHERE datname = 'storyboard') \gexec

-- Only these two roles may connect to it.
REVOKE CONNECT ON DATABASE storyboard FROM PUBLIC;
GRANT CONNECT ON DATABASE storyboard TO storyboard, storyboard_app;

-- Optional hardening, NOT run here because it affects every non-superuser role on the
-- server: by default any role may connect to the maintenance database "postgres" (via the
-- PUBLIC grant), where storyboard_app owns nothing and sees only the catalog. To close it:
--   REVOKE CONNECT ON DATABASE postgres FROM PUBLIC;
-- and then GRANT CONNECT back to the roles that legitimately need it.

\connect storyboard

-- The owner role owns the schema, so migrations run without superuser rights.
ALTER SCHEMA public OWNER TO storyboard;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO storyboard_app;

-- Data access on everything that exists now...
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO storyboard_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO storyboard_app;

-- ...and on everything future migrations (run as storyboard) will create.
ALTER DEFAULT PRIVILEGES FOR ROLE storyboard IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO storyboard_app;
ALTER DEFAULT PRIVILEGES FOR ROLE storyboard IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO storyboard_app;

-- The migration ledger belongs to the migrator only; the API never reads it.
-- (Schema "drizzle" is created by the first migration run, so this is conditional.)
SELECT 'REVOKE ALL ON SCHEMA drizzle FROM storyboard_app'
WHERE EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'drizzle') \gexec

-- gen_random_uuid() is built into Postgres 13+; nothing else is required.
