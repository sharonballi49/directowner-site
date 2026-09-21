-- DirectOwner marketplace foundation
-- Run this migration in the Supabase SQL editor before enabling production payments.

create extension if not exists pgcrypto;

create type public.listing_plan as enum ('free', 'featured', 'premium');
create type public.listing_status as enum ('draft', 'pending_payment', 'active', 'paused', 'sold', 'rejected');
create type public.payment_status as enum ('pending', 'paid', 'failed', 'refunded');

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 5 and 160),
  description text not null check (char_length(description) between 20 and 5000),
  vehicle_type text not null check (vehicle_type in ('car', 'rv', 'truck', 'van', 'other')),
  year integer not null check (year between 1900 and extract(year from now())::integer + 2),
  make text not null check (char_length(make) between 1 and 80),
  model text not null check (char_length(model) between 1 and 80),
  price_cents integer not null check (price_cents >= 0),
  plan listing_plan not null default 'free',
  status listing_status not null default 'draft',
  photo_paths text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.payments (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  plan listing_plan not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd' check (currency = 'usd'),
  status payment_status not null default 'pending',
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index listings_owner_id_idx on public.listings(owner_id);
create index listings_status_idx on public.listings(status);
create index payments_owner_id_idx on public.payments(owner_id);
create index payments_listing_id_idx on public.payments(listing_id);

alter table public.listings enable row level security;
alter table public.payments enable row level security;

create policy "Public can view active listings"
  on public.listings for select
  using (status = 'active');

create policy "Owners can view their listings"
  on public.listings for select
  to authenticated
  using (auth.uid() = owner_id);

create policy "Owners can create their listings"
  on public.listings for insert
  to authenticated
  with check (auth.uid() = owner_id);

create policy "Owners can update their draft listings"
  on public.listings for update
  to authenticated
  using (auth.uid() = owner_id and status in ('draft', 'pending_payment'))
  with check (auth.uid() = owner_id);

create policy "Owners can delete their draft listings"
  on public.listings for delete
  to authenticated
  using (auth.uid() = owner_id and status = 'draft');

create policy "Owners can view their payments"
  on public.payments for select
  to authenticated
  using (auth.uid() = owner_id);

-- Payment rows are created and updated only by trusted Edge Functions.
-- No client insert/update policy is intentionally provided.

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger listings_set_updated_at
before update on public.listings
for each row execute function public.set_updated_at();

create trigger payments_set_updated_at
before update on public.payments
for each row execute function public.set_updated_at();

-- Storage bucket for private seller uploads. Use signed URLs from trusted code.
insert into storage.buckets (id, name, public)
values ('vehicle-photos', 'vehicle-photos', false)
on conflict (id) do nothing;

create policy "Owners can upload to their own photo folder"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners can view their own photo folder"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Owners can delete their own photo folder"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'vehicle-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
