const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const seller='11111111-1111-1111-1111-111111111111', reviewer='22222222-2222-2222-2222-222222222222', buyer='33333333-3333-3333-3333-333333333333';
test('Review gate enforces privacy, authorization, stale-decision checks, edit re-review, payment gating, and report limits',async()=>{
 const db=new PGlite();
 const as=async(id)=>db.exec(`reset role; select set_config('request.jwt.claim.sub','${id||''}',false); set role ${id?'authenticated':'anon'};`);
 const admin=async()=>db.exec('reset role');
 const row=async(id)=>(await db.query('select * from public.listings where id=$1',[id])).rows[0];
 const approve=async(id)=>{await as(reviewer); const q=(await db.query('select * from public.review_queue()')).rows.find(r=>r.id===id); await db.query("select public.review_listing($1,$2,'approved')",[id,q.review_revision]);};
 try{
  await db.exec(`create role anon; create role authenticated; create schema auth; create table auth.users(id uuid primary key);
  create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  grant usage on schema auth,public to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
  insert into auth.users values('${seller}'),('${reviewer}'),('${buyer}');`);
  await db.exec(fs.readFileSync('supabase/migrations/20260921000100_initial_marketplace.sql','utf8').split('-- Storage bucket')[0].replace('create extension if not exists pgcrypto;',''));
  await db.exec('grant select,insert,update,delete on public.listings to authenticated; grant select on public.listings to anon;');
  await db.exec(fs.readFileSync('supabase/migrations/20260930000100_keep_test_listing_private.sql','utf8'));
  await db.exec(`create schema storage; create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text); alter table storage.objects enable row level security; grant usage on schema storage to authenticated; grant select,insert,update,delete on storage.objects to authenticated; create policy owner_storage on storage.objects to authenticated using(split_part(name,'/',1)=auth.uid()::text) with check(split_part(name,'/',1)=auth.uid()::text);`);
  await db.exec(fs.readFileSync('supabase/migrations/20260930000200_listing_review.sql','utf8'));
  await db.exec(`insert into public.listing_reviewers(user_id) values('${reviewer}');`);
  await as(seller);
  await assert.rejects(db.exec(`insert into public.listing_reviewers values('${seller}',now())`),/permission denied/);
  await assert.rejects(db.exec('select * from public.review_queue()'),/Reviewer access required/);
  await assert.rejects(db.exec('select * from public.listing_reports'),/permission denied/);
  const listing=(await db.query(`insert into public.listings(owner_id,title,description,vehicle_type,year,make,model,price_cents)
  values(auth.uid(),'Honda owner vehicle','A sufficiently detailed owner description','car',2020,'Honda','Civic',1000000) returning id`)).rows[0].id;
  await assert.rejects(db.query("update public.listings set moderation_status='approved' where id=$1",[listing]),/Review decisions/);
  await admin(); await db.query("update public.listings set status='active' where id=$1",[listing]);
  assert.equal((await row(listing)).moderation_status,'pending');
  await as(); assert.equal(await row(listing),undefined);
  await as(seller); assert.equal((await row(listing)).moderation_status,'pending');
  await assert.rejects(db.query("select public.review_listing($1,2,'approved')",[listing]),/Reviewer access required/);
  await as(seller); await db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[seller+'/photo.jpg']);
  await admin(); await db.query('update public.listings set photo_paths=array[$1] where id=$2',[seller+'/photo.jpg',listing]);
  await approve(listing);
  await as(seller); assert.equal((await db.query("delete from storage.objects where name=$1 returning name",[seller+'/photo.jpg'])).rows.length,0);
  assert.equal((await db.query("update storage.objects set name=$1 where name=$1 returning name",[seller+'/photo.jpg'])).rows.length,0);
  await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('vehicle-photos',$1)",[seller+'/photo.jpg']),/row-level security/);
  await as(); assert.equal((await row(listing)).moderation_status,'approved');
  await as(reviewer); await assert.rejects(db.query("select public.review_listing($1,2,'approved')",[listing]),/changed/);
  // Mimic the existing SECURITY DEFINER seller edit RPC. Trigger must re-review it too.
  await admin(); await db.exec(`create function public.test_edit(p_id uuid) returns void language sql security definer as $$update public.listings set title='Changed vehicle details' where id=p_id and owner_id=auth.uid()$$;`);
  await as(seller); await db.query('select public.test_edit($1)',[listing]);
  assert.equal((await row(listing)).moderation_status,'pending');
  await as(); assert.equal(await row(listing),undefined);
  await approve(listing);
  await as(buyer);
  await assert.rejects(db.query("select public.report_listing($1,'other','short')",[listing]),/10 to 2000/);
  const report=(await db.query("select public.report_listing($1,'suspected_scam','Seller asks for gift card payment') as id",[listing])).rows[0].id;
  assert.equal((await db.query("select public.report_listing($1,'other','Another concern about this listing') as id",[listing])).rows[0].id,report);
  await assert.rejects(db.exec('select * from public.review_reports()'),/Reviewer access required/);
  await as(seller); await assert.rejects(db.query("select public.report_listing($1,'other','Reporting my own listing test')",[listing]),/not available/);
  await as(reviewer); const reports=(await db.query('select * from public.review_reports()')).rows; assert.equal(reports.length,1);
  await db.query("select public.review_listing($1,$2,'rejected','Please remove the request for gift cards.')",[listing,reports[0].listing.review_revision]);
  await db.query("select public.resolve_listing_report($1,'Listing removed after reviewing the concern.')",[report]);
  assert.equal((await db.query('select * from public.review_reports()')).rows.length,0);
  await as(seller); assert.match((await row(listing)).review_feedback,/gift cards/);
  await as(); assert.equal(await row(listing),undefined);
  await admin(); assert.equal((await db.query('select * from public.listing_review_events')).rows.length,3);
  await db.query("update public.listings set photo_paths=array['new-photo.jpg'] where id=$1",[listing]);
  assert.equal((await row(listing)).moderation_status,'pending'); assert.equal((await row(listing)).review_feedback,null);
  await approve(listing);
  // Pause/resume does not bypass or unnecessarily invalidate an existing review.
  await admin(); await db.query("update public.listings set status='paused' where id=$1",[listing]);
  await db.query("update public.listings set status='active' where id=$1",[listing]);
  assert.equal((await row(listing)).moderation_status,'approved');
  // Payment completion cannot publish an unreviewed listing.
  for(let i=0;i<5;i++){
    await admin();
    const id=(await db.query(`insert into public.listings(owner_id,title,description,vehicle_type,year,make,model,price_cents,status,plan)
      values($1,'Paid listing vehicle','Sufficient description for paid listing','car',2020,'Honda','Civic',1000000,'pending_payment','premium') returning id`,[seller])).rows[0].id;
    await db.query("update public.listings set status='active' where id=$1",[id]); assert.equal((await row(id)).moderation_status,'pending');
    await approve(id); await as(buyer);
    const request=db.query("select public.report_listing($1,'misleading_details','Vehicle information does not match the photos')",[id]);
    if(i<4)await request;else await assert.rejects(request,/Report limit reached/);
  }
  await admin(); await db.query("update public.listings set is_test=true where id=$1",[listing]);
  await as(); assert.equal(await row(listing),undefined);
  await as(reviewer); await assert.rejects(db.query("select public.review_listing($1,999,'approved')",[listing]),/not eligible/);
 }finally{await db.close();}
});
