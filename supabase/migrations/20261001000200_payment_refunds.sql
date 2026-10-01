begin;
alter table public.payments add column refunded_amount_cents integer not null default 0
  check (refunded_amount_cents >= 0 and refunded_amount_cents <= amount_cents);

-- One transaction for payment and listing state. Only the verified server handler may call it.
create or replace function public.sync_stripe_payment(
  p_payment_id uuid, p_listing_id uuid, p_owner_id uuid, p_plan text,
  p_session_id text, p_intent_id text, p_amount integer, p_currency text,
  p_refunded integer
) returns void language plpgsql security definer set search_path = '' as $$
declare payment public.payments; listing public.listings; refunded integer;
begin
  select * into listing from public.listings where id=p_listing_id for update;
  if not found then raise exception 'Listing not found'; end if;
  select * into payment from public.payments where id=p_payment_id for update;
  if not found then raise exception 'Payment not found'; end if;
  if p_owner_id is null or p_plan is null or p_session_id is null or p_intent_id is null
    or p_amount is null or p_currency is null or p_refunded is null
    or payment.listing_id<>listing.id or payment.owner_id<>p_owner_id or listing.owner_id<>p_owner_id
    or payment.plan::text<>p_plan or p_plan not in ('featured','premium')
    or payment.amount_cents<>p_amount or p_amount<=0 or payment.currency<>p_currency
    or payment.stripe_checkout_session_id is distinct from p_session_id
    or p_intent_id not like 'pi_%'
    or (payment.stripe_payment_intent_id is not null and payment.stripe_payment_intent_id<>p_intent_id)
    or p_refunded<0 or p_refunded>p_amount then
    raise exception 'Stripe payment does not match stored checkout';
  end if;
  -- Only succeeded refunds are passed in. They cannot be undone by older event snapshots.
  refunded:=greatest(payment.refunded_amount_cents,p_refunded);
  if payment.status='refunded' then refunded:=payment.amount_cents; end if;
  update public.payments set stripe_payment_intent_id=p_intent_id,
    refunded_amount_cents=refunded,
    status=case when refunded=amount_cents then 'refunded'::public.payment_status else 'paid'::public.payment_status end
    where id=payment.id;
  if refunded=payment.amount_cents then
    -- Do not remove a newer purchase or an independently paid package.
    if listing.plan=payment.plan and not exists (
      select 1 from public.payments other where other.listing_id=listing.id and other.id<>payment.id
      and other.status='paid' and other.plan=listing.plan and other.refunded_amount_cents<other.amount_cents
    ) and not exists (
      select 1 from public.payments newer where newer.listing_id=listing.id and newer.id<>payment.id
      and newer.status='pending' and newer.created_at>payment.created_at
    ) then
      update public.listings set plan='free',
        status=case when status in ('active','pending_payment') then 'paused'::public.listing_status else status end
        where id=listing.id;
    end if;
  elsif payment.status in ('pending','failed') and listing.status='pending_payment' and listing.plan=payment.plan then
    update public.listings set status='active' where id=listing.id;
  end if;
end;
$$;
revoke all on function public.sync_stripe_payment(uuid,uuid,uuid,text,text,text,integer,text,integer) from public,anon,authenticated;
grant execute on function public.sync_stripe_payment(uuid,uuid,uuid,text,text,text,integer,text,integer) to service_role;
notify pgrst,'reload schema';
commit;
