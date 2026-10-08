-- Resolve an Asaas payment reference without exposing tenant tables to the
-- restricted webhook database role.
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saasfood_webhook_resolver') THEN
        RAISE EXCEPTION 'Provision saasfood_webhook_resolver NOLOGIN BYPASSRLS before applying this migration';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'saasfood_webhook') THEN
        RAISE EXCEPTION 'Provision the restricted saasfood_webhook runtime role before applying this migration';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'saasfood_webhook_resolver'
          AND (rolcanlogin OR NOT rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'saasfood_webhook_resolver must be NOLOGIN BYPASSRLS';
    END IF;
    IF EXISTS (
        SELECT 1 FROM pg_roles
        WHERE rolname = 'saasfood_webhook'
          AND (NOT rolcanlogin OR rolbypassrls)
    ) THEN
        RAISE EXCEPTION 'saasfood_webhook must be LOGIN without BYPASSRLS';
    END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO saasfood_webhook_resolver;
GRANT CREATE ON SCHEMA public TO saasfood_webhook_resolver;
GRANT SELECT ON TABLE public.pagamentos TO saasfood_webhook_resolver;
GRANT USAGE ON SCHEMA public TO saasfood_webhook;

CREATE OR REPLACE FUNCTION public.resolve_asaas_webhook_payment(p_reference text)
RETURNS TABLE (restaurante_id uuid, pagamento_id uuid)
LANGUAGE sql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
    SELECT p.restaurante_id, p.id
    FROM public.pagamentos AS p
    WHERE p.provedor = 'ASAAS'::public.provedor_pagamento
      AND p.referencia_externa = p_reference
    LIMIT 1
$function$;

ALTER FUNCTION public.resolve_asaas_webhook_payment(text)
    OWNER TO saasfood_webhook_resolver;
REVOKE CREATE ON SCHEMA public FROM saasfood_webhook_resolver;
REVOKE ALL ON FUNCTION public.resolve_asaas_webhook_payment(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_asaas_webhook_payment(text)
    TO saasfood_webhook;
GRANT SELECT, INSERT, UPDATE ON TABLE public.webhook_inbox
    TO saasfood_webhook;

CREATE UNIQUE INDEX pagamentos_provedor_referencia_global_key
    ON public.pagamentos (provedor, referencia_externa)
    WHERE referencia_externa IS NOT NULL;
