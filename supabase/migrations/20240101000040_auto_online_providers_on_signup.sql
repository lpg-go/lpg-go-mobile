-- Auto-set is_online = true for new providers so they start receiving order
-- broadcasts immediately upon signup (after admin approval). Without this,
-- providers default to is_online = false (column default) and must manually
-- toggle online via the Profile screen, which is friction at onboarding.

create or replace function auto_online_provider_on_signup()
returns trigger as $$
begin
  if NEW.role = 'provider' and NEW.is_online = false then
    update public.profiles
    set is_online = true
    where id = NEW.id;
  end if;
  return NEW;
end;
$$ language plpgsql security definer;

drop trigger if exists trg_auto_online_provider on public.profiles;

create trigger trg_auto_online_provider
after insert on public.profiles
for each row
execute function auto_online_provider_on_signup();
