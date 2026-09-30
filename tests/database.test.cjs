const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { PGlite } = require('@electric-sql/pglite');
test('Database preserves owner test access and rejects client publication or paid-plan spoofing',async()=>{
  const db=new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      grant usage on schema public,auth to anon,authenticated;
      grant execute on function auth.uid() to anon,authenticated;
      create table public.listings(id uuid primary key,owner_id uuid,title text,status text default 'draft',plan text default 'free');
      alter table public.listings enable row level security;
      grant select on public.listings to anon;
      grant select,insert,update on public.listings to authenticated;
      create policy public_active on public.listings for select using(status='active');
      create policy owner_select on public.listings for select to authenticated using(owner_id=auth.uid());
      create policy owner_insert on public.listings for insert to authenticated with check(owner_id=auth.uid());
      create policy owner_update on public.listings for update to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
      insert into public.listings values
      ('3dcae366-5b6a-4a34-93a7-a7605c526925','11111111-1111-1111-1111-111111111111','BMW test','active','free'),
      ('22222222-2222-2222-2222-222222222222','11111111-1111-1111-1111-111111111111','Real vehicle','active','free');
    `);
    await db.exec(fs.readFileSync('supabase/migrations/20260930000100_keep_test_listing_private.sql','utf8'));
    await db.exec('set role anon');
    assert.equal((await db.query('select * from public.listings')).rows.length,1);
    await db.exec("reset role; set role authenticated; select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false)");
    assert.equal((await db.query('select * from public.listings')).rows.length,2);
    await assert.rejects(db.exec("update public.listings set is_test=false where title='BMW test'"),/managed by DirectOwner/);
    await assert.rejects(db.exec("update public.listings set plan='premium' where title='Real vehicle'"),/managed by DirectOwner/);
    await assert.rejects(db.exec("update public.listings set status='sold' where title='Real vehicle'"),/managed by DirectOwner/);
    await assert.rejects(db.exec("insert into public.listings(id,owner_id,title,status,plan) values('33333333-3333-3333-3333-333333333333',auth.uid(),'Fake paid','active','premium')"),/row-level security/);
    await db.exec("insert into public.listings(id,owner_id,title) values('33333333-3333-3333-3333-333333333333',auth.uid(),'Valid draft')");
    await db.exec("update public.listings set title='Updated draft' where title='Valid draft'");
    await db.exec("select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false)");
    assert.equal((await db.query('select * from public.listings')).rows.length,1);
    await db.exec("reset role; update public.listings set status='active',plan='premium' where title='Updated draft'");
    assert.equal((await db.query("select status from public.listings where title='Updated draft'")).rows[0].status,'active');
  } finally { await db.close(); }
});
