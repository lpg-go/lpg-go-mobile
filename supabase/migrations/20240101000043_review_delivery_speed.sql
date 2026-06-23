-- Optional delivery-speed rating attached to a customer review.
-- Values map to UI labels: 'very_fast' = "Very Fast", 'fast' = "Fast",
-- 'average' = "Average", 'slow' = "Slow".
-- Nullable on purpose: existing reviews have none, and customers may skip the
-- speed question entirely — the 1-5 star rating remains the primary, required
-- review signal; speed is a separate, optional signal.

alter table public.reviews add column delivery_speed text;

alter table public.reviews
  add constraint reviews_delivery_speed_check
  check (delivery_speed is null or delivery_speed in ('very_fast', 'fast', 'average', 'slow'));
