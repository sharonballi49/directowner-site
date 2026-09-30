-- Review against the live database, then apply through Supabase's SQL editor/CLI.
-- Preserves the BMW record and owners' access to their own listings.
begin;
alter table public.listings add column if not exists is_test boolean not null default false;
update public.listings
set is_test = true
where id = '3dcae366-5b6a-4a34-93a7-a7605c526925';

-- Restrictive policies intersect existing permissions, including live policies
-- not checked into this repository. They do not grant access on their own.
create policy "Test listings are visible only to their owner"
on public.listings as restrictive for select to public
using (not is_test or (select auth.uid()) = owner_id);

create policy "Client listings start as unpaid drafts"
on public.listings as restrictive for insert to authenticated
with check (owner_id = (select auth.uid()) and status = 'draft' and plan = 'free' and not is_test);

-- RLS ownership alone does not protect individual columns. Publication, payment
-- plans and test flags are controlled by trusted server functions/admins.
create function public.protect_listing_control_fields()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if current_user in ('anon', 'authenticated') and (
    old.id is distinct from new.id
    or old.owner_id is distinct from new.owner_id
    or old.status is distinct from new.status
    or old.plan is distinct from new.plan
    or old.is_test is distinct from new.is_test
  ) then
    raise exception 'Listing publication, plans and test flags are managed by DirectOwner server functions';
  end if;
  return new;
end;
$$;
create trigger protect_listing_control_fields
before update on public.listings
for each row execute function public.protect_listing_control_fields();
commit;
