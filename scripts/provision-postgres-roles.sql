-- Run as a PostgreSQL superuser or a role with CREATEROLE.
-- This script intentionally does not set passwords. Assign login-role passwords
-- through psql's interactive \password command or your secret manager.
BEGIN;

DO $provision$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saasfood_app') THEN
        CREATE ROLE saasfood_app;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saasfood_worker') THEN
        CREATE ROLE saasfood_worker;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saasfood_webhook') THEN
        CREATE ROLE saasfood_webhook;
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saasfood_webhook_resolver') THEN
        CREATE ROLE saasfood_webhook_resolver;
    END IF;
END
$provision$;

ALTER ROLE saasfood_app
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE saasfood_worker
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE saasfood_webhook
    WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
ALTER ROLE saasfood_webhook_resolver
    WITH NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION BYPASSRLS;

COMMIT;

SELECT rolname, rolcanlogin, rolsuper, rolcreatedb, rolcreaterole,
       rolreplication, rolbypassrls
FROM pg_roles
WHERE rolname IN (
    'saasfood_app',
    'saasfood_worker',
    'saasfood_webhook',
    'saasfood_webhook_resolver'
)
ORDER BY rolname;
