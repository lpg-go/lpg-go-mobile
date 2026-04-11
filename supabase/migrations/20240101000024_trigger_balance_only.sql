-- Stock deduction is now handled exclusively by the Edge Function via
-- the deduct_provider_stock() RPC (migration 0023).
-- The trigger was also deducting stock, causing double deduction.
-- Strip stock logic from the trigger — keep only balance + transaction.

CREATE OR REPLACE FUNCTION public.handle_order_delivered()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'delivered' AND OLD.status IS DISTINCT FROM 'delivered' THEN

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
$$;
