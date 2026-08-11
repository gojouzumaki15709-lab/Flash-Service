-- ============================================================================
-- migration_v11_xof_integer_amounts.sql
--
-- Objectif :
--   Migrer les montants monétaires XOF de numeric(10,2) vers integer.
--
-- À exécuter APRÈS :
--   migration_v11_vendor_active_order.sql
--
-- Cette migration :
--   1. sauvegarde les vues dépendantes des colonnes monétaires ;
--   2. supprime temporairement ces vues ;
--   3. convertit les colonnes monétaires en integer ;
--   4. recrée les vues ;
--   5. met à jour les fonctions RPC concernées ;
--   6. supprime les anciennes signatures numeric.
--
-- XOF / FCFA :
--   Les montants sont désormais stockés en FCFA entiers.
--   Exemple :
--       1500 XOF => 1500
--       1500.50 XOF => arrondi à 1501
--
-- ============================================================================

BEGIN;

-- ============================================================================
-- 0. Sauvegarde temporaire des vues dépendantes
--
-- PostgreSQL interdit :
--
--   ALTER COLUMN amount TYPE integer
--
-- lorsqu'une vue dépend directement de cette colonne.
--
-- On sauvegarde donc automatiquement les définitions des vues concernées.
-- ============================================================================

DROP TABLE IF EXISTS pg_temp.migration_v11_views;

CREATE TEMP TABLE migration_v11_views (
    view_oid        oid PRIMARY KEY,
    schema_name     text NOT NULL,
    view_name       text NOT NULL,
    view_definition text NOT NULL
) ON COMMIT DROP;


-- ----------------------------------------------------------------------------
-- Recherche des vues dépendant des tables monétaires.
--
-- On récupère également les vues qui dépendent indirectement d'une première
-- vue concernée, afin de ne pas casser une chaîne de vues.
-- ----------------------------------------------------------------------------

WITH RECURSIVE dependent_views AS (

    -- Vues dépendant directement des tables concernées
    SELECT DISTINCT
        c.oid AS view_oid
    FROM pg_depend d
    JOIN pg_rewrite r
        ON r.oid = d.objid
    JOIN pg_class c
        ON c.oid = r.ev_class
    WHERE c.relkind = 'v'
      AND d.refobjid IN (
          'public.products'::regclass,
          'public.orders'::regclass,
          'public.order_items'::regclass,
          'public.debts'::regclass,
          'public.debt_repayments'::regclass
      )

    UNION

    -- Vues dépendant de ces vues
    SELECT DISTINCT
        c.oid AS view_oid
    FROM pg_depend d
    JOIN pg_rewrite r
        ON r.oid = d.objid
    JOIN pg_class c
        ON c.oid = r.ev_class
    JOIN dependent_views dv
        ON d.refobjid = dv.view_oid
    WHERE c.relkind = 'v'
)

INSERT INTO migration_v11_views (
    view_oid,
    schema_name,
    view_name,
    view_definition
)
SELECT
    dv.view_oid,
    n.nspname,
    c.relname,
    pg_get_viewdef(c.oid, true)
FROM dependent_views dv
JOIN pg_class c
    ON c.oid = dv.view_oid
JOIN pg_namespace n
    ON n.oid = c.relnamespace
WHERE n.nspname NOT IN ('pg_catalog', 'information_schema');


-- ============================================================================
-- 0.1 Affichage des vues qui seront temporairement supprimées
-- ============================================================================

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT schema_name, view_name
        FROM migration_v11_views
        ORDER BY schema_name, view_name
    LOOP
        RAISE NOTICE
            'migration_v11: vue temporairement supprimée : %.%',
            r.schema_name,
            r.view_name;
    END LOOP;
END
$$;


-- ============================================================================
-- 0.2 Suppression des vues dépendantes
--
-- DROP ... CASCADE permet de supprimer proprement toute chaîne de vues.
-- Les définitions ont déjà été sauvegardées ci-dessus.
-- ============================================================================

DO $$
DECLARE
    r record;
BEGIN
    FOR r IN
        SELECT schema_name, view_name
        FROM migration_v11_views
        ORDER BY schema_name, view_name
    LOOP
        EXECUTE format(
            'DROP VIEW IF EXISTS %I.%I CASCADE',
            r.schema_name,
            r.view_name
        );
    END LOOP;
END
$$;


-- ============================================================================
-- 1. Colonnes monétaires : numeric(10,2) -> integer
--
-- Conversion :
--
--   numeric -> round() -> integer
--
-- Exemple :
--   1250.00 -> 1250
--   1250.40 -> 1250
--   1250.60 -> 1251
--
-- Les ALTER ne sont exécutés que si le type actuel n'est pas integer.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- products.price
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'products'
          AND column_name = 'price'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.products
        ALTER COLUMN price TYPE integer
        USING round(price)::integer;

    END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- orders.total
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'total'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.orders
        ALTER COLUMN total TYPE integer
        USING round(total)::integer;

    END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- orders.cash_amount_received
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'orders'
          AND column_name = 'cash_amount_received'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.orders
        ALTER COLUMN cash_amount_received TYPE integer
        USING round(cash_amount_received)::integer;

    END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- order_items.unit_price
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'order_items'
          AND column_name = 'unit_price'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.order_items
        ALTER COLUMN unit_price TYPE integer
        USING round(unit_price)::integer;

    END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- debts.amount
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'debts'
          AND column_name = 'amount'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.debts
        ALTER COLUMN amount TYPE integer
        USING round(amount)::integer;

    END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- debt_repayments.amount
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'debt_repayments'
          AND column_name = 'amount'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.debt_repayments
        ALTER COLUMN amount TYPE integer
        USING round(amount)::integer;

    END IF;
END
$$;


-- ----------------------------------------------------------------------------
-- debt_repayments.cash_amount_received
-- ----------------------------------------------------------------------------

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'debt_repayments'
          AND column_name = 'cash_amount_received'
          AND udt_name <> 'int4'
    ) THEN

        ALTER TABLE public.debt_repayments
        ALTER COLUMN cash_amount_received TYPE integer
        USING round(cash_amount_received)::integer;

    END IF;
END
$$;


-- ============================================================================
-- 1.1 Commentaires
-- ============================================================================

COMMENT ON COLUMN public.products.price IS
    'Prix en FCFA (XOF, entier — pas de décimales).';

COMMENT ON COLUMN public.orders.total IS
    'Total en FCFA (XOF, entier).';

COMMENT ON COLUMN public.orders.cash_amount_received IS
    'Montant reçu en espèces en FCFA (XOF, entier).';

COMMENT ON COLUMN public.order_items.unit_price IS
    'Prix unitaire en FCFA au moment de l''achat (XOF, entier).';

COMMENT ON COLUMN public.debts.amount IS
    'Montant de la dette en FCFA (XOF, entier).';

COMMENT ON COLUMN public.debt_repayments.amount IS
    'Montant du remboursement en FCFA (XOF, entier).';

COMMENT ON COLUMN public.debt_repayments.cash_amount_received IS
    'Montant reçu en espèces en FCFA (XOF, entier).';


-- ============================================================================
-- 1.2 Recréation des vues
--
-- Les vues ont été sauvegardées avant le changement de type.
--
-- Comme une vue peut dépendre d'une autre vue, on tente plusieurs passes.
-- Une vue n'est recréée que lorsque les relations dont elle dépend existent.
-- ============================================================================

DO $$
DECLARE
    r record;
    recreated_count integer;
    remaining_count integer;
    pass_count integer := 0;
BEGIN

    LOOP

        pass_count := pass_count + 1;
        recreated_count := 0;

        FOR r IN
            SELECT
                v.schema_name,
                v.view_name,
                v.view_definition
            FROM migration_v11_views v
            WHERE NOT EXISTS (
                SELECT 1
                FROM pg_class c
                JOIN pg_namespace n
                    ON n.oid = c.relnamespace
                WHERE n.nspname = v.schema_name
                  AND c.relname = v.view_name
                  AND c.relkind = 'v'
            )
            ORDER BY v.schema_name, v.view_name
        LOOP

            BEGIN

                EXECUTE format(
                    'CREATE VIEW %I.%I AS %s',
                    r.schema_name,
                    r.view_name,
                    r.view_definition
                );

                recreated_count := recreated_count + 1;

                RAISE NOTICE
                    'migration_v11: vue recréée : %.%',
                    r.schema_name,
                    r.view_name;

            EXCEPTION
                WHEN undefined_table
                  OR undefined_column
                  OR undefined_object
                  OR invalid_table_definition
                THEN

                    -- Une vue dépendante n'est pas encore recréable.
                    -- Elle sera tentée lors de la prochaine passe.
                    NULL;

            END;

        END LOOP;

        SELECT count(*)
        INTO remaining_count
        FROM migration_v11_views v
        WHERE NOT EXISTS (
            SELECT 1
            FROM pg_class c
            JOIN pg_namespace n
                ON n.oid = c.relnamespace
            WHERE n.nspname = v.schema_name
              AND c.relname = v.view_name
              AND c.relkind = 'v'
        );

        EXIT WHEN remaining_count = 0;

        IF recreated_count = 0 OR pass_count >= 20 THEN
            RAISE EXCEPTION
                'migration_v11: impossible de recréer toutes les vues. % vue(s) restante(s).',
                remaining_count;
        END IF;

    END LOOP;

END
$$;


-- ============================================================================
-- 2. create_order_atomic()
--
-- Signature :
--   numeric -> integer pour p_debt_limit
--
-- On supprime explicitement l'ancienne surcharge numeric.
-- ============================================================================

DROP FUNCTION IF EXISTS public.create_order_atomic(
    uuid,
    uuid,
    jsonb,
    uuid,
    boolean,
    numeric,
    text
);


CREATE OR REPLACE FUNCTION public.create_order_atomic(
    p_client_id uuid,
    p_vendor_id uuid,
    p_items jsonb,
    p_payment_method_id uuid,
    p_is_debt boolean,
    p_debt_limit integer,
    p_client_room text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_vendor_open boolean;
    v_vendor_active boolean;
    v_item jsonb;
    v_product_id uuid;
    v_qty int;
    v_price integer;
    v_stock_id uuid;
    v_stock_qty int;
    v_total integer := 0;
    v_payment_type text;
    v_api_key text;
    v_merchant_link text;
    v_is_active boolean;
    v_order_id uuid;
    v_status text;
    v_current_debt integer;
    v_order_items jsonb := '[]'::jsonb;
    v_client_room text;
BEGIN

    IF p_items IS NULL
       OR jsonb_array_length(p_items) = 0
    THEN
        RAISE EXCEPTION 'EMPTY_ORDER';
    END IF;


    v_client_room := nullif(trim(p_client_room), '');

    IF v_client_room IS NULL THEN
        RAISE EXCEPTION 'CLIENT_ROOM_REQUIRED';
    END IF;


    SELECT is_open, is_active
    INTO v_vendor_open, v_vendor_active
    FROM vendors
    WHERE id = p_vendor_id
    FOR UPDATE;


    IF v_vendor_active IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'VENDOR_INACTIVE';
    END IF;


    IF v_vendor_open IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'VENDOR_CLOSED';
    END IF;


    IF p_payment_method_id IS NOT NULL THEN

        SELECT
            type,
            api_key_encrypted,
            merchant_link,
            is_active
        INTO
            v_payment_type,
            v_api_key,
            v_merchant_link,
            v_is_active
        FROM payment_methods
        WHERE id = p_payment_method_id;


        IF v_payment_type IS NULL THEN
            RAISE EXCEPTION 'PAYMENT_METHOD_NOT_FOUND';
        END IF;


        IF NOT v_is_active THEN
            RAISE EXCEPTION 'PAYMENT_METHOD_INACTIVE';
        END IF;

    END IF;


    IF p_is_debt THEN

        IF p_payment_method_id IS NOT NULL THEN
            RAISE EXCEPTION 'DEBT_CANNOT_HAVE_PAYMENT_METHOD';
        END IF;

        v_status := 'confirmed';

    ELSIF v_payment_type = 'cash' THEN

        v_status := 'pending';

    ELSIF v_payment_type = 'wave' THEN

        v_status := 'pending';

    ELSE

        RAISE EXCEPTION 'UNSUPPORTED_PAYMENT_METHOD';

    END IF;


    FOR v_item IN
        SELECT *
        FROM jsonb_array_elements(p_items)
    LOOP

        v_product_id := (v_item->>'product_id')::uuid;
        v_qty := (v_item->>'quantity')::int;


        IF v_qty IS NULL OR v_qty <= 0 THEN
            RAISE EXCEPTION 'INVALID_QUANTITY';
        END IF;


        SELECT
            vs.id,
            vs.quantity,
            p.price
        INTO
            v_stock_id,
            v_stock_qty,
            v_price
        FROM vendor_stock vs
        JOIN products p
            ON p.id = vs.product_id
        WHERE vs.vendor_id = p_vendor_id
          AND vs.product_id = v_product_id
          AND p.is_archived = false
        FOR UPDATE OF vs;


        IF v_stock_id IS NULL
           OR v_stock_qty < v_qty
        THEN
            RAISE EXCEPTION 'INSUFFICIENT_STOCK:%', v_product_id;
        END IF;


        UPDATE vendor_stock
        SET
            quantity = quantity - v_qty,
            updated_at = now()
        WHERE id = v_stock_id;


        v_total := v_total + v_price * v_qty;


        v_order_items :=
            v_order_items ||
            jsonb_build_object(
                'product_id', v_product_id,
                'quantity', v_qty,
                'unit_price', v_price
            );

    END LOOP;


    IF p_is_debt THEN

        PERFORM pg_advisory_xact_lock(
            hashtext(p_client_id::text)
        );


        SELECT coalesce(sum(amount), 0)
        INTO v_current_debt
        FROM debts
        WHERE client_id = p_client_id
          AND is_repaid = false;


        IF v_current_debt + v_total > p_debt_limit THEN
            RAISE EXCEPTION 'DEBT_LIMIT_EXCEEDED';
        END IF;

    END IF;


    INSERT INTO orders (
        client_id,
        vendor_id,
        payment_method_id,
        is_debt,
        total,
        status,
        client_room
    )
    VALUES (
        p_client_id,
        p_vendor_id,
        p_payment_method_id,
        p_is_debt,
        v_total,
        v_status,
        v_client_room
    )
    RETURNING id INTO v_order_id;


    INSERT INTO order_items (
        order_id,
        product_id,
        quantity,
        unit_price
    )
    SELECT
        v_order_id,
        (elem->>'product_id')::uuid,
        (elem->>'quantity')::int,
        (elem->>'unit_price')::integer
    FROM jsonb_array_elements(v_order_items) elem;


    IF p_is_debt THEN

        INSERT INTO debts (
            client_id,
            order_id,
            amount
        )
        VALUES (
            p_client_id,
            v_order_id,
            v_total
        );

    END IF;


    RETURN jsonb_build_object(
        'order_id', v_order_id,
        'status', v_status,
        'total', v_total,
        'payment_type', v_payment_type,
        'api_key', v_api_key,
        'merchant_link', v_merchant_link
    );

END;
$$;


REVOKE EXECUTE ON FUNCTION public.create_order_atomic(
    uuid,
    uuid,
    jsonb,
    uuid,
    boolean,
    integer,
    text
)
FROM public, anon, authenticated;


-- ============================================================================
-- 3. confirm_vendor_order_atomic()
--
-- cash_amount_received : numeric -> integer
-- ============================================================================

DROP FUNCTION IF EXISTS public.confirm_vendor_order_atomic(
    uuid,
    uuid,
    jsonb,
    numeric
);


CREATE OR REPLACE FUNCTION public.confirm_vendor_order_atomic(
    p_order_id uuid,
    p_vendor_id uuid,
    p_items jsonb,
    p_cash_amount_received integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_status text;
    v_order_vendor_id uuid;
    v_is_debt boolean;
    v_payment_type text;
    v_api_key text;
    v_item record;
    v_final_qty int;
    v_diff int;
    v_new_total integer := 0;
    v_amount_received integer;
BEGIN

    SELECT
        o.status,
        o.vendor_id,
        o.is_debt,
        pm.type,
        pm.api_key_encrypted
    INTO
        v_status,
        v_order_vendor_id,
        v_is_debt,
        v_payment_type,
        v_api_key
    FROM orders o
    LEFT JOIN payment_methods pm
        ON pm.id = o.payment_method_id
    WHERE o.id = p_order_id
    FOR UPDATE OF o;


    IF v_order_vendor_id IS NULL
       OR v_order_vendor_id <> p_vendor_id
    THEN
        RAISE EXCEPTION 'ORDER_NOT_FOUND';
    END IF;


    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'ORDER_NOT_PENDING';
    END IF;


    IF v_payment_type = 'wave'
       AND v_api_key IS NOT NULL
    THEN
        RAISE EXCEPTION
            'WAVE_API_ORDER_CANNOT_BE_MANUALLY_CONFIRMED';
    END IF;


    FOR v_item IN
        SELECT
            id,
            product_id,
            quantity,
            unit_price
        FROM order_items
        WHERE order_id = p_order_id
    LOOP

        SELECT
            coalesce(
                (elem->>'quantity')::int,
                v_item.quantity
            )
        INTO v_final_qty
        FROM jsonb_array_elements(
            coalesce(p_items, '[]'::jsonb)
        ) elem
        WHERE (elem->>'order_item_id')::uuid = v_item.id;


        IF v_final_qty IS NULL THEN
            v_final_qty := v_item.quantity;
        END IF;


        v_final_qty :=
            greatest(
                0,
                least(v_final_qty, v_item.quantity)
            );


        v_diff := v_item.quantity - v_final_qty;


        IF v_diff > 0 THEN

            UPDATE vendor_stock
            SET
                quantity = quantity + v_diff,
                updated_at = now()
            WHERE vendor_id = p_vendor_id
              AND product_id = v_item.product_id;

        END IF;


        UPDATE order_items
        SET quantity_taken = v_final_qty
        WHERE id = v_item.id;


        v_new_total :=
            v_new_total +
            v_final_qty * v_item.unit_price;

    END LOOP;


    v_amount_received :=
        coalesce(
            p_cash_amount_received,
            v_new_total
        );


    IF v_payment_type = 'cash'
       AND v_amount_received < v_new_total
    THEN
        RAISE EXCEPTION 'INSUFFICIENT_AMOUNT_RECEIVED';
    END IF;


    UPDATE orders
    SET
        status = 'confirmed',
        confirmed_by_vendor = true,
        cash_amount_received = v_amount_received,
        total = v_new_total
    WHERE id = p_order_id;


    IF v_is_debt THEN

        UPDATE debts
        SET amount = v_new_total
        WHERE order_id = p_order_id
          AND is_repaid = false;

    END IF;


    RETURN jsonb_build_object(
        'order_id', p_order_id,
        'new_total', v_new_total,
        'amount_received', v_amount_received
    );

END;
$$;


REVOKE EXECUTE ON FUNCTION public.confirm_vendor_order_atomic(
    uuid,
    uuid,
    jsonb,
    integer
)
FROM public, anon, authenticated;


-- ============================================================================
-- 4. create_debt_repayment_atomic()
-- ============================================================================

CREATE OR REPLACE FUNCTION public.create_debt_repayment_atomic(
    p_client_id uuid,
    p_debt_ids uuid[],
    p_payment_method_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_amount integer;
    v_count int;
    v_conflict_count int;
    v_repayment_id uuid;
BEGIN

    PERFORM pg_advisory_xact_lock(
        hashtext(p_client_id::text)
    );


    SELECT
        count(*),
        coalesce(sum(amount), 0)
    INTO
        v_count,
        v_amount
    FROM debts
    WHERE id = ANY(p_debt_ids)
      AND client_id = p_client_id
      AND is_repaid = false;


    IF v_count <> array_length(p_debt_ids, 1) THEN
        RAISE EXCEPTION 'INVALID_DEBT_SELECTION';
    END IF;


    SELECT count(*)
    INTO v_conflict_count
    FROM debt_repayments
    WHERE status = 'pending'
      AND debt_ids && p_debt_ids;


    IF v_conflict_count > 0 THEN
        RAISE EXCEPTION 'REPAYMENT_ALREADY_PENDING';
    END IF;


    INSERT INTO debt_repayments (
        client_id,
        debt_ids,
        amount,
        payment_method_id,
        status
    )
    VALUES (
        p_client_id,
        p_debt_ids,
        v_amount,
        p_payment_method_id,
        'pending'
    )
    RETURNING id INTO v_repayment_id;


    RETURN jsonb_build_object(
        'repayment_id', v_repayment_id,
        'amount', v_amount
    );

END;
$$;


-- ============================================================================
-- 5. confirm_debt_repayment_atomic()
-- ============================================================================

DROP FUNCTION IF EXISTS public.confirm_debt_repayment_atomic(
    uuid,
    uuid,
    numeric
);


CREATE OR REPLACE FUNCTION public.confirm_debt_repayment_atomic(
    p_repayment_id uuid,
    p_vendor_id uuid,
    p_cash_amount_received integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_status text;
    v_amount integer;
    v_debt_ids uuid[];
    v_received integer;
BEGIN

    SELECT
        status,
        amount,
        debt_ids
    INTO
        v_status,
        v_amount,
        v_debt_ids
    FROM debt_repayments
    WHERE id = p_repayment_id
    FOR UPDATE;


    IF v_status IS NULL THEN
        RAISE EXCEPTION 'NOT_FOUND';
    END IF;


    IF v_status <> 'pending' THEN
        RAISE EXCEPTION 'ALREADY_PROCESSED';
    END IF;


    v_received :=
        coalesce(
            p_cash_amount_received,
            v_amount
        );


    IF v_received < v_amount THEN
        RAISE EXCEPTION 'INSUFFICIENT_AMOUNT_RECEIVED';
    END IF;


    UPDATE debts
    SET
        is_repaid = true,
        repaid_at = now()
    WHERE id = ANY(v_debt_ids);


    UPDATE debt_repayments
    SET
        status = 'confirmed',
        confirmed_by_vendor_id = p_vendor_id,
        cash_amount_received = v_received,
        confirmed_at = now()
    WHERE id = p_repayment_id;


    RETURN jsonb_build_object(
        'ok', true
    );

END;
$$;


REVOKE EXECUTE ON FUNCTION public.confirm_debt_repayment_atomic(
    uuid,
    uuid,
    integer
)
FROM public, anon, authenticated;


-- ============================================================================
-- 6. mark_debts_repaid_atomic()
-- ============================================================================

DROP FUNCTION IF EXISTS public.mark_debts_repaid_atomic(
    uuid,
    uuid[],
    numeric
);


CREATE OR REPLACE FUNCTION public.mark_debts_repaid_atomic(
    p_client_id uuid,
    p_debt_ids uuid[],
    p_cash_amount_received integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_expected_total integer;
    v_count int;
    v_received integer;
BEGIN

    PERFORM pg_advisory_xact_lock(
        hashtext(p_client_id::text)
    );


    SELECT
        count(*),
        coalesce(sum(amount), 0)
    INTO
        v_count,
        v_expected_total
    FROM debts
    WHERE id = ANY(p_debt_ids)
      AND client_id = p_client_id
      AND is_repaid = false
    FOR UPDATE;


    IF v_count <> array_length(p_debt_ids, 1) THEN
        RAISE EXCEPTION 'INVALID_DEBT_SELECTION';
    END IF;


    v_received :=
        coalesce(
            p_cash_amount_received,
            v_expected_total
        );


    IF v_received < v_expected_total THEN
        RAISE EXCEPTION 'INSUFFICIENT_AMOUNT_RECEIVED';
    END IF;


    UPDATE debts
    SET
        is_repaid = true,
        repaid_at = now()
    WHERE id = ANY(p_debt_ids);


    RETURN jsonb_build_object(
        'ok', true,
        'amount', v_expected_total
    );

END;
$$;


REVOKE EXECUTE ON FUNCTION public.mark_debts_repaid_atomic(
    uuid,
    uuid[],
    integer
)
FROM public, anon, authenticated;


-- ============================================================================
-- 7. process_wave_webhook_atomic()
--
-- p_wave_amount : integer
--
-- Comparaison stricte :
--
--   v_total = p_wave_amount
--
-- ============================================================================

DROP FUNCTION IF EXISTS public.process_wave_webhook_atomic(
    text,
    text,
    uuid,
    boolean,
    boolean,
    numeric,
    text,
    text,
    text
);


CREATE OR REPLACE FUNCTION public.process_wave_webhook_atomic(
    p_event_id text,
    p_event_type text,
    p_order_id uuid,
    p_payment_succeeded boolean,
    p_payment_failed boolean,
    p_wave_amount integer,
    p_wave_currency text,
    p_wave_checkout_id text,
    p_wave_transaction_id text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
    v_status text;
    v_vendor_id uuid;
    v_total integer;
    v_wave_checkout_id_db text;
    v_item record;
BEGIN

    INSERT INTO wave_webhook_events (
        id,
        type
    )
    VALUES (
        p_event_id,
        p_event_type
    )
    ON CONFLICT (id) DO NOTHING;


    IF NOT FOUND THEN
        RETURN jsonb_build_object(
            'ok', true,
            'duplicate', true
        );
    END IF;


    SELECT
        status,
        vendor_id,
        total,
        wave_checkout_id
    INTO
        v_status,
        v_vendor_id,
        v_total,
        v_wave_checkout_id_db
    FROM orders
    WHERE id = p_order_id
    FOR UPDATE;


    IF v_status IS NULL THEN
        RETURN jsonb_build_object(
            'ok', true,
            'ignored', 'order_not_found'
        );
    END IF;


    IF v_status <> 'pending' THEN
        RETURN jsonb_build_object(
            'ok', true,
            'already_processed', true
        );
    END IF;


    IF p_payment_succeeded THEN

        IF p_wave_amount IS NULL
           OR p_wave_currency IS DISTINCT FROM 'XOF'
           OR p_wave_checkout_id IS NULL
           OR v_wave_checkout_id_db IS NULL
           OR p_wave_checkout_id <> v_wave_checkout_id_db
           OR v_total <> p_wave_amount
        THEN

            RETURN jsonb_build_object(
                'ok', true,
                'ignored', 'mismatch'
            );

        END IF;


        UPDATE orders
        SET
            status = 'confirmed',
            wave_transaction_id = p_wave_transaction_id,
            wave_checkout_id = p_wave_checkout_id
        WHERE id = p_order_id;


        RETURN jsonb_build_object(
            'ok', true,
            'confirmed', true
        );


    ELSIF p_payment_failed THEN

        FOR v_item IN
            SELECT
                product_id,
                quantity
            FROM order_items
            WHERE order_id = p_order_id
        LOOP

            UPDATE vendor_stock
            SET
                quantity = quantity + v_item.quantity,
                updated_at = now()
            WHERE vendor_id = v_vendor_id
              AND product_id = v_item.product_id;

        END LOOP;


        UPDATE orders
        SET status = 'cancelled'
        WHERE id = p_order_id;


        RETURN jsonb_build_object(
            'ok', true,
            'cancelled', true
        );

    END IF;


    RETURN jsonb_build_object(
        'ok', true,
        'ignored', 'unhandled_event_type'
    );

END;
$$;


REVOKE EXECUTE ON FUNCTION public.process_wave_webhook_atomic(
    text,
    text,
    uuid,
    boolean,
    boolean,
    integer,
    text,
    text,
    text
)
FROM public, anon, authenticated;


-- ============================================================================
-- 8. Vérification finale des types
-- ============================================================================

DO $$
DECLARE
    bad_columns integer;
BEGIN

    SELECT count(*)
    INTO bad_columns
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (
          (table_name = 'products'
           AND column_name = 'price')

          OR

          (table_name = 'orders'
           AND column_name IN (
               'total',
               'cash_amount_received'
           ))

          OR

          (table_name = 'order_items'
           AND column_name = 'unit_price')

          OR

          (table_name = 'debts'
           AND column_name = 'amount')

          OR

          (table_name = 'debt_repayments'
           AND column_name IN (
               'amount',
               'cash_amount_received'
           ))
      )
      AND udt_name <> 'int4';


    IF bad_columns > 0 THEN
        RAISE EXCEPTION
            'migration_v11: % colonne(s) monétaire(s) ne sont pas integer.',
            bad_columns;
    END IF;

END
$$;


-- ============================================================================
-- 9. Commit
-- ============================================================================

COMMIT;

-- ============================================================================
-- FIN migration_v11_xof_integer_amounts.sql
-- ============================================================================