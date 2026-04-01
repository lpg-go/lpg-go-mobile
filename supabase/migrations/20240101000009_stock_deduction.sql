-- ============================================================
-- Migration: stock deduction on order delivery
-- Updates handle_order_delivered to deduct provider stock.
-- Availability is determined purely by stock > 0; is_available
-- is no longer updated by this trigger.
-- ============================================================

CREATE OR REPLACE FUNCTION public.handle_order_delivered()
RETURNS TRIGGER AS $$
DECLARE
  item RECORD;
BEGIN
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN

    -- ── 1. Deduct stock for each order item ────────────────────
    FOR item IN
      SELECT oi.product_id, oi.quantity, oi.provider_product_id
      FROM public.order_items oi
      WHERE oi.order_id = NEW.id
    LOOP
      UPDATE public.provider_products
        SET stock = GREATEST(stock - item.quantity, 0)
        WHERE id = item.provider_product_id;
    END LOOP;

    -- ── 2. Deduct admin fee from provider balance ──────────────
    IF NEW.admin_fee > 0 AND NEW.selected_provider_id IS NOT NULL THEN
      UPDATE public.profiles
        SET balance = balance - NEW.admin_fee
        WHERE id = NEW.selected_provider_id;

      INSERT INTO public.transactions (provider_id, order_id, type, amount)
        VALUES (NEW.selected_provider_id, NEW.id, 'fee_deduction', NEW.admin_fee);
    END IF;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
