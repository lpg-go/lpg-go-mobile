CREATE OR REPLACE FUNCTION assign_products_on_approval()
RETURNS TRIGGER AS $$
BEGIN
  -- Only fire when is_approved changes from false to true
  IF NEW.is_approved = true AND OLD.is_approved = false AND NEW.role = 'provider' THEN
    INSERT INTO public.provider_products (provider_id, product_id, price, stock)
    SELECT NEW.id, p.id, 0.00, 0
    FROM public.products p
    WHERE p.is_active = true
    ON CONFLICT (provider_id, product_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_assign_products_on_approval ON public.profiles;
CREATE TRIGGER trg_assign_products_on_approval
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION assign_products_on_approval();
