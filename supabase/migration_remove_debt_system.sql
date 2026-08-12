-- ============================================================================
-- migration_remove_debt_system.sql
--
-- Objectif : retirer complètement le système de dette/crédit client.
--
-- À exécuter APRÈS :
--   migration_v11_xof_integer_amounts.sql
--
-- Cette migration :
--   1. supprime les fonctions RPC liées aux remboursements de dette ;
--   2. redéfinit create_order_atomic() et confirm_vendor_order_atomic()
--      sans aucune logique de dette (le paiement devient obligatoire) ;
--   3. supprime la vue client_current_debt ;
--   4. supprime les tables debts et debt_repayments ;
--   5. supprime la colonne orders.is_debt et l'index associé.
--
-- Rejouable : toutes les instructions DROP utilisent IF EXISTS / CASCADE
-- là où c'est nécessaire.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. Fonctions RPC de remboursement de dette : plus utilisées, on les retire.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_debt_repayment_atomic(uuid, uuid[], uuid);
DROP FUNCTION IF EXISTS public.confirm_debt_repayment_atomic(uuid, uuid, integer);
DROP FUNCTION IF EXISTS public.confirm_debt_repayment_atomic(uuid, uuid, numeric);
DROP FUNCTION IF EXISTS public.reject_debt_repayment_atomic(uuid);
DROP FUNCTION IF EXISTS public.mark_debts_repaid_atomic(uuid, uuid[], integer);
DROP FUNCTION IF EXISTS public.mark_debts_repaid_atomic(uuid, uuid[], numeric);

-- ----------------------------------------------------------------------------
-- 2. create_order_atomic() : nouvelle signature sans p_is_debt / p_debt_limit.
--    Un moyen de paiement (cash ou wave) est désormais toujours obligatoire.
-- ----------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.create_order_atomic(
    uuid,
    uuid,
    jsonb,
    uuid,
    boolean,
    integer,
    text
);

CREATE OR REPLACE FUNCTION public.create_order_atomic(
    p_client_id uuid,
    p_vendor_id uuid,
    p_items jsonb,
    p_payment_method_id uuid,
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


    IF p_payment_method_id IS NULL THEN
        RAISE EXCEPTION 'PAYMENT_METHOD_NOT_FOUND';
    END IF;


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


    IF v_payment_type = 'cash' THEN

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


    INSERT INTO orders (
        client_id,
        vendor_id,
        payment_method_id,
        total,
        status,
        client_room
    )
    VALUES (
        p_client_id,
        p_vendor_id,
        p_payment_method_id,
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
    text
)
FROM public, anon, authenticated;

-- ----------------------------------------------------------------------------
-- 3. confirm_vendor_order_atomic() : retire toute la logique de dette.
-- ----------------------------------------------------------------------------

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
        pm.type,
        pm.api_key_encrypted
    INTO
        v_status,
        v_order_vendor_id,
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

-- ----------------------------------------------------------------------------
-- 4. Vue dépendant de la table debts : à supprimer avant la table.
-- ----------------------------------------------------------------------------

DROP VIEW IF EXISTS public.client_current_debt;

-- ----------------------------------------------------------------------------
-- 5. Tables de dette : plus aucune fonction ni route ne les utilise.
-- ----------------------------------------------------------------------------

DROP INDEX IF EXISTS public.idx_debts_client;
DROP INDEX IF EXISTS public.idx_debt_repayments_client;
DROP INDEX IF EXISTS public.idx_debt_repayments_status;

DROP TABLE IF EXISTS public.debt_repayments;
DROP TABLE IF EXISTS public.debts;

-- ----------------------------------------------------------------------------
-- 6. Colonne orders.is_debt : plus aucune commande n'est à crédit.
-- ----------------------------------------------------------------------------

ALTER TABLE public.orders
    DROP COLUMN IF EXISTS is_debt;

COMMIT;

-- ============================================================================
-- FIN migration_remove_debt_system.sql
-- ============================================================================
