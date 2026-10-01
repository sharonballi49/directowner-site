-- Additive: no existing listing answers are invented or overwritten.
begin;
create function public.valid_seller_disclosures(value jsonb) returns boolean
language plpgsql immutable security invoker set search_path = '' as $$
declare k text; v jsonb;
begin
  if value is null or jsonb_typeof(value)<>'object' then return false; end if;
  if value='{}'::jsonb then return true; end if; -- Legacy listings remain explicitly unanswered.
  if not value ?& array['owner_status','title_status','lien_status','damage_status','damage_details','mechanical_status','mechanical_details','records_status','inspection_status'] then return false; end if;
  for k,v in select * from jsonb_each(value) loop
    if k not in ('owner_status','title_status','lien_status','damage_status','damage_details','mechanical_status','mechanical_details','records_status','inspection_status')
      or jsonb_typeof(v)<>'string' then return false; end if;
  end loop;
  if value->>'owner_status' not in ('yes','no','unknown')
    or value->>'title_status' not in ('clean','salvage','rebuilt','bonded','other','unknown')
    or value->>'lien_status' not in ('none_known','yes','unknown')
    or value->>'damage_status' not in ('known','none_known','unknown')
    or value->>'mechanical_status' not in ('known','none_known','unknown')
    or value->>'records_status' not in ('yes','some','no','unknown')
    or value->>'inspection_status' not in ('yes','discuss','no','unknown') then return false; end if;
  foreach k in array array['damage','mechanical'] loop
    if value->>(k||'_status')='known' then
      if char_length(value->>(k||'_details'))>1000 or char_length(trim(value->>(k||'_details'))) not between 10 and 1000 then return false; end if;
    elsif value->>(k||'_details')<>'' then return false;
    end if;
  end loop;
  return true;
end;
$$;
-- This pure validation helper exposes no listing or account data.
revoke all on function public.valid_seller_disclosures(jsonb) from public;
grant execute on function public.valid_seller_disclosures(jsonb) to anon,authenticated,service_role;
alter table public.listings add column seller_disclosures jsonb not null default '{}'::jsonb
  constraint listings_seller_disclosures_valid check(public.valid_seller_disclosures(seller_disclosures));
comment on column public.listings.seller_disclosures is 'Public seller statements, not independent verification. Empty object means unanswered.';

-- One atomic owner edit keeps details and disclosures together. Existing callers stay compatible.
create function public.update_listing_with_disclosures(
  p_listing_id uuid,p_title text,p_vehicle_type text,p_year integer,p_make text,p_model text,
  p_price_cents integer,p_description text,p_mileage integer,p_seller_location text,p_seller_disclosures jsonb
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Sign in before editing a listing' using errcode='42501'; end if;
  if not public.valid_seller_disclosures(p_seller_disclosures) or p_seller_disclosures='{}'::jsonb then
    raise exception 'Answer every seller disclosure question and describe known issues using 10 to 1000 characters';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 5 and 160 then raise exception 'Title must be between 5 and 160 characters'; end if;
  if p_vehicle_type is null or p_vehicle_type not in ('car','rv','truck','van','other') then raise exception 'Invalid vehicle type'; end if;
  if p_year is null or p_year<1900 or p_year>extract(year from now())::integer+2 then raise exception 'Invalid vehicle year'; end if;
  if p_make is null or char_length(trim(p_make)) not between 1 and 80 then raise exception 'Make is required'; end if;
  if p_model is null or char_length(trim(p_model)) not between 1 and 80 then raise exception 'Model is required'; end if;
  if p_price_cents is null or p_price_cents<0 then raise exception 'Price must be zero or greater'; end if;
  if p_description is null or char_length(trim(p_description)) not between 20 and 5000 then raise exception 'Description must be between 20 and 5000 characters'; end if;
  if p_mileage is not null and p_mileage<0 then raise exception 'Mileage must be zero or greater'; end if;
  if p_seller_location is not null and char_length(trim(p_seller_location))>120 then raise exception 'Location must be 120 characters or fewer'; end if;
  update public.listings set title=trim(p_title),vehicle_type=p_vehicle_type,year=p_year,make=trim(p_make),model=trim(p_model),
    price_cents=p_price_cents,description=trim(p_description),mileage=p_mileage,seller_location=nullif(trim(p_seller_location),''),
    seller_disclosures=p_seller_disclosures
  where id=p_listing_id and owner_id=auth.uid() and status in ('draft','pending_payment','active','paused');
  if not found then raise exception 'Listing is not available for editing or you do not own it' using errcode='42501'; end if;
  -- Existing enforce_listing_review trigger invalidates approval for disclosure edits.
end;
$$;
revoke all on function public.update_listing_with_disclosures(uuid,text,text,integer,text,text,integer,text,integer,text,jsonb) from public, anon;
grant execute on function public.update_listing_with_disclosures(uuid,text,text,integer,text,text,integer,text,integer,text,jsonb) to authenticated;
notify pgrst, 'reload schema';
commit;
