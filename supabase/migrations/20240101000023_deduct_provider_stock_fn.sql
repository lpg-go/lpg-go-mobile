-- Called from the order-notifications Edge Function after delivery is confirmed.
-- Using a SECURITY DEFINER function guarantees RLS is bypassed regardless of
-- the caller's role, and GREATEST(..., 0) prevents negative stock.

CREATE OR REPLACE FUNCTION public.deduct_provider_stock(
  p_provider_id UUID,
  p_product_id  UUID,
  p_quantity    INTEGER
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.provider_products
    SET stock = GREATEST(stock - p_quantity, 0)
    WHERE provider_id = p_provider_id
      AND product_id  = p_product_id;
END;
$$;
