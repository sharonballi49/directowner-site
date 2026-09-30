-- Apply before deploying the review UI. No reviewer accounts are granted here.
begin;
create table public.listing_reviewers (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.listing_reviewers enable row level security;
revoke all on public.listing_reviewers from anon, authenticated;

create function public.is_listing_reviewer() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.listing_reviewers where user_id = (select auth.uid()));
$$;
revoke all on function public.is_listing_reviewer() from public;
grant execute on function public.is_listing_reviewer() to authenticated;

alter table public.listings
  add column moderation_status text not null default 'not_submitted'
    check (moderation_status in ('not_submitted','pending','approved','rejected')),
  add column review_revision integer not null default 1,
  add column review_feedback text,
  add column reviewed_at timestamptz;
-- Existing live listings enter review too. Test records remain private.
update public.listings set moderation_status='pending' where status in ('active','paused');

create policy "Only approved inventory is public" on public.listings
as restrictive for select to public using (
  (status='active' and moderation_status='approved' and not is_test)
  or owner_id=(select auth.uid())
);
-- Reviewer reads go through narrowly scoped SECURITY DEFINER RPCs below.
create policy "Clients cannot submit review decisions" on public.listings
as restrictive for insert to authenticated with check (
  moderation_status='not_submitted' and review_revision=1
  and review_feedback is null and reviewed_at is null
);

create table public.listing_review_events (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reviewer_id uuid not null references auth.users(id),
  decision text not null check(decision in ('approved','rejected')),
  revision integer not null,
  feedback text,
  created_at timestamptz not null default now()
);
alter table public.listing_review_events enable row level security;
revoke all on public.listing_review_events from anon, authenticated;

create function public.enforce_listing_review() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare changed boolean;
begin
  if TG_OP='INSERT' then
    if current_user in ('anon','authenticated') and
       (new.moderation_status<>'not_submitted' or new.review_revision<>1
        or new.review_feedback is not null or new.reviewed_at is not null) then
      raise exception 'Review decisions are managed by DirectOwner reviewers';
    end if;
    if new.status in ('active','paused') then new.moderation_status:='pending'; end if;
    return new;
  end if;
  if current_user in ('anon','authenticated') and (
    old.moderation_status is distinct from new.moderation_status
    or old.review_revision is distinct from new.review_revision
    or old.review_feedback is distinct from new.review_feedback
    or old.reviewed_at is distinct from new.reviewed_at
  ) then raise exception 'Review decisions are managed by DirectOwner reviewers'; end if;
  -- Includes future public columns by excluding only control and timestamp fields.
  changed := (to_jsonb(old)-array['moderation_status','review_revision','review_feedback','reviewed_at','updated_at','status','plan','is_test'])
    is distinct from (to_jsonb(new)-array['moderation_status','review_revision','review_feedback','reviewed_at','updated_at','status','plan','is_test']);
  if changed or old.status is distinct from new.status or old.plan is distinct from new.plan or old.is_test is distinct from new.is_test then
    new.review_revision := old.review_revision+1;
  end if;
  if (changed and old.moderation_status in ('pending','approved','rejected'))
     or (new.status in ('active','paused') and old.moderation_status='not_submitted') then
    new.moderation_status:='pending'; new.review_feedback:=null; new.reviewed_at:=null;
  end if;
  return new;
end;
$$;
create trigger enforce_listing_review before insert or update on public.listings
for each row execute function public.enforce_listing_review();

create function public.review_queue() returns setof public.listings
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_listing_reviewer() then raise exception 'Reviewer access required' using errcode='42501'; end if;
  return query select * from public.listings where not is_test and moderation_status='pending'
    and status in ('active','paused') order by updated_at,id limit 100;
end;
$$;

create function public.review_listing(p_listing_id uuid,p_revision integer,p_decision text,p_feedback text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare item public.listings;
begin
  if not public.is_listing_reviewer() then raise exception 'Reviewer access required' using errcode='42501'; end if;
  if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
  if p_decision='rejected' and (p_feedback is null or length(trim(p_feedback)) not between 10 and 1000) then
    raise exception 'Give the seller a reason between 10 and 1000 characters';
  end if;
  select * into item from public.listings where id=p_listing_id for update;
  if not found or item.is_test or item.status not in ('active','paused') then raise exception 'Listing is not eligible for review'; end if;
  if item.review_revision is distinct from p_revision then raise exception 'Listing changed. Refresh and review the latest version.'; end if;
  if item.moderation_status<>'pending' and not (item.moderation_status='approved' and p_decision='rejected') then
    raise exception 'This listing has already been reviewed. Refresh the queue.';
  end if;
  update public.listings set moderation_status=p_decision,
    review_feedback=case when p_decision='rejected' then trim(p_feedback) else null end,
    reviewed_at=now(),review_revision=review_revision+1 where id=p_listing_id;
  insert into public.listing_review_events(listing_id,reviewer_id,decision,revision,feedback)
  values(p_listing_id,auth.uid(),p_decision,p_revision,case when p_decision='rejected' then trim(p_feedback) else null end);
end;
$$;

create table public.listing_reports (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check(reason in ('suspected_scam','misleading_details','duplicate','unsafe_content','other')),
  details text not null check(length(details) between 10 and 2000),
  status text not null default 'open' check(status in ('open','resolved')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id),
  resolution text,
  unique(listing_id,reporter_id)
);
create index listing_reports_queue on public.listing_reports(status,created_at);
create index listing_reports_rate on public.listing_reports(reporter_id,created_at);
alter table public.listing_reports enable row level security;
revoke all on public.listing_reports from anon, authenticated;

create function public.report_listing(p_listing_id uuid,p_reason text,p_details text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare report_id uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in to report a listing' using errcode='42501'; end if;
  if p_reason is null or p_reason not in ('suspected_scam','misleading_details','duplicate','unsafe_content','other')
     or p_details is null or length(trim(p_details)) not between 10 and 2000 then raise exception 'Choose a reason and add 10 to 2000 characters'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(auth.uid()::text));
  select id into report_id from public.listing_reports where listing_id=p_listing_id and reporter_id=auth.uid() and status='open';
  if found then return report_id; end if;
  if exists(select 1 from public.listing_reports where listing_id=p_listing_id and reporter_id=auth.uid()) then
    raise exception 'Your earlier report was reviewed. Contact support if you have new information.';
  end if;
  if not exists(select 1 from public.listings where id=p_listing_id and status='active'
      and moderation_status='approved' and not is_test and owner_id<>auth.uid()) then
    raise exception 'This listing is not available for reporting';
  end if;
  if (select count(*) from public.listing_reports where reporter_id=auth.uid() and created_at>now()-interval '24 hours')>=5 then
    raise exception 'Report limit reached. Please contact support for additional concerns.';
  end if;
  insert into public.listing_reports(listing_id,reporter_id,reason,details)
    values(p_listing_id,auth.uid(),p_reason,trim(p_details)) returning id into report_id;
  return report_id;
end;
$$;

create function public.review_reports() returns table(
  report_id uuid,reason text,details text,reported_at timestamptz,listing jsonb
) language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_listing_reviewer() then raise exception 'Reviewer access required' using errcode='42501'; end if;
  return query select r.id,r.reason,r.details,r.created_at,to_jsonb(l)
  from public.listing_reports r join public.listings l on l.id=r.listing_id
  where r.status='open' order by r.created_at,r.id limit 100;
end;
$$;
create function public.resolve_listing_report(p_report_id uuid,p_resolution text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.is_listing_reviewer() then raise exception 'Reviewer access required' using errcode='42501'; end if;
  if p_resolution is null or length(trim(p_resolution)) not between 10 and 1000 then raise exception 'Add a resolution between 10 and 1000 characters'; end if;
  update public.listing_reports set status='resolved',resolved_at=now(),resolved_by=auth.uid(),resolution=trim(p_resolution)
    where id=p_report_id and status='open';
  if not found then raise exception 'Report is already resolved or unavailable'; end if;
end;
$$;

revoke all on function public.review_queue(),public.review_listing(uuid,integer,text,text),
  public.report_listing(uuid,text,text),public.review_reports(),public.resolve_listing_report(uuid,text) from public;
grant execute on function public.review_queue(),public.review_listing(uuid,integer,text,text),
  public.report_listing(uuid,text,text),public.review_reports(),public.resolve_listing_report(uuid,text) to authenticated;
-- Files referenced by listings cannot be overwritten or removed behind a reviewer's back.
-- The UI removes a photo reference first, which invalidates review, then deletes the file.
create function public.can_change_vehicle_photo(p_name text) returns boolean
language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null and split_part(p_name,'/',1)=auth.uid()::text
    and not exists(select 1 from public.listings where p_name=any(photo_paths));
$$;
revoke all on function public.can_change_vehicle_photo(text) from public;
grant execute on function public.can_change_vehicle_photo(text) to authenticated;
create policy "Vehicle photos use unreferenced paths" on storage.objects
as restrictive for insert to authenticated with check (
  bucket_id<>'vehicle-photos' or public.can_change_vehicle_photo(name)
);
create policy "Detach vehicle photos before deletion" on storage.objects
as restrictive for delete to authenticated using (
  bucket_id<>'vehicle-photos' or public.can_change_vehicle_photo(name)
);
create policy "Vehicle photos cannot be overwritten" on storage.objects
as restrictive for update to authenticated using (bucket_id<>'vehicle-photos')
with check (bucket_id<>'vehicle-photos');
commit;
