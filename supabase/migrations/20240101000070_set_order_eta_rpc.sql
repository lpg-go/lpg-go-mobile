-- set_order_eta RPC
-- Best-effort ETA calculation for express rider orders. Called when a rider is
-- in transit. Computes distance via haversine (with a road factor), applies the
-- admin-configured speed + mercy buffer, and stores eta_minutes / eta_deadline.
--
-- Design note: this must NEVER break the order flow. It raises only when the
-- order is missing or in the wrong state; any missing data (non-rider, no
-- location, non-express) results in a silent RETURN rather than an error.

create or replace function public.set_order_eta(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delivery_lat        double precision;
  v_delivery_lng        double precision;
  v_selected_provider   uuid;
  v_is_express          boolean;
  v_status              public.order_status;

  v_provider_type       text;
  v_rider_lat           double precision;
  v_rider_lng           double precision;

  v_speed_kmh           numeric;
  v_mercy_minutes       integer;

  v_dlat                double precision;
  v_dlng                double precision;
  v_a                   double precision;
  v_c                   double precision;
  v_distance_km         double precision;
  v_eta_minutes         integer;
begin
  -- 1. Load and lock the order.
  select delivery_lat, delivery_lng, selected_provider_id, is_express, status
    into v_delivery_lat, v_delivery_lng, v_selected_provider, v_is_express, v_status
    from public.orders
    where id = p_order_id
    for update;

  if not found then
    raise exception 'Order not found';
  end if;

  -- Non-express orders skip ETA entirely.
  if not coalesce(v_is_express, false) then
    return;
  end if;

  -- Only set ETA after the provider is selected and the order is moving.
  if v_status is distinct from 'in_transit' then
    raise exception 'Order is not in transit';
  end if;

  -- No delivery coordinates → can't calculate. Best-effort: bail quietly.
  if v_delivery_lat is null or v_delivery_lng is null or v_selected_provider is null then
    return;
  end if;

  -- 2. Only riders get an ETA (dealers do not).
  select provider_type into v_provider_type
    from public.profiles
    where id = v_selected_provider;

  if v_provider_type is distinct from 'rider' then
    return;
  end if;

  -- 3. Rider's last known location. No row → bail quietly.
  select lat, lng into v_rider_lat, v_rider_lng
    from public.provider_locations
    where provider_id = v_selected_provider;

  if not found or v_rider_lat is null or v_rider_lng is null then
    return;
  end if;

  -- 4. Admin settings.
  select eta_average_speed_kmh, eta_mercy_minutes
    into v_speed_kmh, v_mercy_minutes
    from public.platform_settings
    where id = 1;

  if coalesce(v_speed_kmh, 0) <= 0 then
    return;
  end if;

  -- 5. Haversine distance (km), scaled by a 1.3 road factor.
  v_dlat := radians(v_delivery_lat - v_rider_lat);
  v_dlng := radians(v_delivery_lng - v_rider_lng);
  v_a := sin(v_dlat / 2) ^ 2
       + cos(radians(v_rider_lat)) * cos(radians(v_delivery_lat)) * sin(v_dlng / 2) ^ 2;
  v_c := 2 * asin(sqrt(v_a));
  v_distance_km := 6371 * v_c * 1.3;

  -- 6. ETA in minutes: travel time + mercy buffer, rounded up.
  v_eta_minutes := ceil((v_distance_km / v_speed_kmh) * 60 + coalesce(v_mercy_minutes, 0));

  -- 7. Store ETA and deadline.
  update public.orders
    set eta_minutes  = v_eta_minutes,
        eta_deadline = now() + (v_eta_minutes * interval '1 minute')
    where id = p_order_id;
end;
$$;

-- 8. Allow authenticated clients to invoke.
grant execute on function public.set_order_eta(uuid) to authenticated;
