create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id    uuid;
  v_provider_id    uuid;
  v_recipient_id   uuid;
  v_sender_name    text;
  v_preview        text;
begin
  select customer_id, selected_provider_id
    into v_customer_id, v_provider_id
    from public.orders
   where id = new.order_id;

  if new.sender_id = v_customer_id then
    v_recipient_id := v_provider_id;
  elsif new.sender_id = v_provider_id then
    v_recipient_id := v_customer_id;
  end if;

  if v_recipient_id is null then
    return new;
  end if;

  select coalesce(full_name, 'New message')
    into v_sender_name
    from public.profiles
   where id = new.sender_id;

  v_preview := case
    when length(new.content) > 120 then substr(new.content, 1, 117) || '...'
    else new.content
  end;

  insert into public.notifications (user_id, title, body, type, order_id)
  values (
    v_recipient_id,
    v_sender_name || ' sent a message',
    v_preview,
    'new_message',
    new.order_id
  );

  return new;
end;
$$;

drop trigger if exists trg_notify_new_message on public.messages;
create trigger trg_notify_new_message
  after insert on public.messages
  for each row execute function public.notify_new_message();
