create table public.notifications (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references public.profiles(id) on delete cascade,
  title      text        not null,
  body       text        not null,
  type       text        not null,
  order_id   uuid        references public.orders(id) on delete set null,
  is_read    boolean     not null default false,
  created_at timestamptz not null default now()
);

create index idx_notifications_user_id_created_at
  on public.notifications(user_id, created_at desc);

alter table public.notifications enable row level security;

create policy "Users can view own notifications"
  on public.notifications
  for select
  using (auth.uid() = user_id);

create policy "Users can update own notifications"
  on public.notifications
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Service role can insert notifications"
  on public.notifications
  for insert
  with check (true);

alter publication supabase_realtime add table notifications;
