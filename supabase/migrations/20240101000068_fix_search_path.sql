-- M5: add SET search_path = public to SECURITY DEFINER functions missing it.
-- Defense-in-depth against search_path hijack.
ALTER FUNCTION public.assign_all_products_to_provider(provider_uuid uuid) SET search_path = public;
ALTER FUNCTION public.assign_display_id_trigger() SET search_path = public;
ALTER FUNCTION public.assign_new_product_to_all_providers() SET search_path = public;
ALTER FUNCTION public.assign_products_on_approval() SET search_path = public;
ALTER FUNCTION public.auto_approve_provider_when_doc_not_required() SET search_path = public;
ALTER FUNCTION public.auto_online_provider_on_signup() SET search_path = public;
ALTER FUNCTION public.expire_pending_orders() SET search_path = public;
ALTER FUNCTION public.handle_new_user() SET search_path = public;
ALTER FUNCTION public.reset_expiry_on_withdraw() SET search_path = public;
ALTER FUNCTION public.set_accepted_order_expiry() SET search_path = public;
