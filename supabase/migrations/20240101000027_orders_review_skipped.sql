alter table orders add column if not exists review_skipped boolean not null default false;
