-- Previous stock deduction used:
--   UPDATE provider_products WHERE id = order_items.provider_product_id
--
-- provider_product_id records the cheapest listing at cart time, not the
-- provider who actually delivered. When a different provider is selected,
-- the WHERE clause matches zero rows and stock is silently not deducted.
--
-- Fix: join on (provider_id = selected_provider_id, product_id) so stock
-- is always deducted from whoever actually fulfilled the order.
-- Also drops and recreates the trigger to clear any disabled/stale state.

CREATE OR REPLACE FUNCTION public.handle_order_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  item RECORD;
  rows_affected INTEGER;
BEGIN
  IF NEW.status = 'delivered' AND OLD.status != 'delivered' THEN

    -- 1. Deduct stock from the SELECTED provider's inventory for each product
    IF NEW.selected_provider_id IS NOT NULL THEN
      FOR item IN
        SELECT oi.product_id, oi.quantity
        FROM public.order_items oi
        WHERE oi.order_id = NEW.id
      LOOP
        UPDATE public.provider_products
          SET stock = GREATEST(stock - item.quantity, 0)
          WHERE provider_id = NEW.selected_provider_id
            AND product_id = item.product_id;

        GET DIAGNOSTICS rows_affected = ROW_COUNT;
        RAISE NOTICE '[handle_order_delivered] order=% provider=% product=% qty=% rows_updated=%',
          NEW.id, NEW.selected_provider_id, item.product_id, item.quantity, rows_affected;
      END LOOP;
    END IF;

    -- 2. Deduct admin fee from provider balance
    IF NEW.admin_fee > 0 AND NEW.selected_provider_id IS NOT NULL THEN
      UPDATE public.profiles
        SET balance = balance - NEW.admin_fee
        WHERE id = NEW.selected_provider_id;

      INSERT INTO public.transactions (provider_id, order_id, type, amount)
        VALUES (NEW.selected_provider_id, NEW.id, 'fee_deduction', NEW.admin_fee);

      RAISE NOTICE '[handle_order_delivered] balance deducted admin_fee=% provider=%',
        NEW.admin_fee, NEW.selected_provider_id;
    END IF;

  END IF;
  RETURN NEW;
END;
$$;

-- Drop and recreate to clear any disabled or stale state
DROP TRIGGER IF EXISTS on_order_delivered ON public.orders;

CREATE TRIGGER on_order_delivered
  AFTER UPDATE ON public.orders
  FOR EACH ROW
  WHEN (NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered')
  EXECUTE FUNCTION public.handle_order_delivered();
