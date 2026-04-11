create table public.otp_verifications (
  id         uuid        primary key default gen_random_uuid(),
  phone      text        not null,
  code       text        not null,
  expires_at timestamptz not null,
  used       boolean     not null default false,
  created_at timestamptz not null default now()
);

create index idx_otp_verifications_phone on public.otp_verifications(phone);

alter table public.otp_verifications enable row level security;

-- Only service-role (Edge Functions) may read/write this table
create policy "otp: service role only"
  on public.otp_verifications
  using (false)
  with check (false);
