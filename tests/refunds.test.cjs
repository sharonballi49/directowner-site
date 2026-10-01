const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {PGlite}=require('@electric-sql/pglite');
const owner='11111111-1111-1111-1111-111111111111';

test('Refund transactions enforce permissions, match checkout, handle partial/full/replayed events, and protect other purchases',async()=>{
 const db=new PGlite();
 try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$ select null::uuid $$; insert into auth.users values('${owner}'); grant usage on schema public to anon,authenticated,service_role; alter default privileges grant execute on functions to anon,authenticated,service_role;`);
  await db.exec(fs.readFileSync('supabase/migrations/20260921000100_initial_marketplace.sql','utf8').split('-- Storage bucket')[0].replace('create extension if not exists pgcrypto;',''));
  await db.exec(fs.readFileSync('supabase/migrations/20261001000200_payment_refunds.sql','utf8'));
  const create=async(plan='featured',status='pending_payment')=>{
   const l=(await db.query(`insert into listings(owner_id,title,description,vehicle_type,year,make,model,price_cents,plan,status) values($1,'Refund test vehicle','A detailed vehicle description','car',2020,'BMW','Z4',3000000,$2,$3) returning id`,[owner,plan,status])).rows[0].id;
   const p=(await db.query(`insert into payments(owner_id,listing_id,plan,amount_cents,stripe_checkout_session_id) values($1,$2,$3,999,$4) returning id`,[owner,l,plan,'cs_test_'+l])).rows[0].id;
   return {l,p,session:'cs_test_'+l,intent:'pi_'+p};
  };
  const args=(x,n)=>[x.p,x.l,owner,'featured',x.session,x.intent,999,'usd',n];
  const sql='select public.sync_stripe_payment($1,$2,$3,$4,$5,$6,$7,$8,$9)';
  const state=async(x)=>(await db.query('select p.status as payment,p.refunded_amount_cents,l.plan,l.status from payments p join listings l on l.id=p.listing_id where p.id=$1',[x.p])).rows[0];
  const x=await create();
  for(const role of ['anon','authenticated']) {await db.exec('set role '+role);await assert.rejects(db.query(sql,args(x,999)),/permission denied/);await db.exec('reset role');}
  await db.exec('set role service_role');await db.query(sql,args(x,0));await db.exec('reset role');
  assert.deepEqual(await state(x),{payment:'paid',refunded_amount_cents:0,plan:'featured',status:'active'});
  const bad=args(x,200);bad[4]='cs_test_wrong';await assert.rejects(db.query(sql,bad),/does not match/);
  await assert.rejects(db.query(sql,args(x,1000)),/does not match/);
  await db.query(sql,args(x,200));assert.deepEqual(await state(x),{payment:'paid',refunded_amount_cents:200,plan:'featured',status:'active'});
  await db.query(sql,args(x,999));await db.query(sql,args(x,0));await db.query(sql,args(x,999));
  assert.deepEqual(await state(x),{payment:'refunded',refunded_amount_cents:999,plan:'free',status:'paused'});
  // Refund before completion; stale success never activates it.
  const early=await create();await db.query(sql,args(early,999));await db.query(sql,args(early,0));assert.equal((await state(early)).status,'paused');
  // A newer package must not be revoked by refunding an older payment.
  const newer=await create();await db.query(sql,args(newer,0));
  await db.query(`insert into payments(owner_id,listing_id,plan,amount_cents,status) values($1,$2,'featured',999,'paid')`,[owner,newer.l]);
  await db.query(sql,args(newer,999));assert.equal((await state(newer)).plan,'featured');
  const upgrade=await create();await db.query(sql,args(upgrade,0));await db.query("update listings set plan='premium' where id=$1",[upgrade.l]);await db.query(sql,args(upgrade,999));assert.equal((await state(upgrade)).plan,'premium');
  const sold=await create('featured','sold');await db.query(sql,args(sold,999));assert.equal((await state(sold)).status,'sold');
  // The transaction must roll back the payment if listing update fails.
  const fail=await create();await db.exec(`create function reject_refund() returns trigger language plpgsql as $$ begin if new.id='${fail.l}'::uuid and new.plan='free' then raise exception 'listing failure'; end if; return new; end; $$; create trigger reject_refund before update on listings for each row execute function reject_refund();`);
  await assert.rejects(db.query(sql,args(fail,999)),/listing failure/);assert.equal((await state(fail)).payment,'pending');
 }finally {await db.close();}
});

function webhookHarness({refunds=[],rpcError=null,invalidSignature=false,listError=false}={}) {
 let handler;const calls=[];const session={id:'cs_test_one',mode:'payment',payment_status:'paid',amount_total:999,currency:'usd',livemode:false,payment_intent:'pi_one',metadata:{paymentId:'payment',listingId:'listing',ownerId:owner,plan:'featured'}};
 const iterable=(items)=>({async *[Symbol.asyncIterator](){if(listError)throw Error('Stripe unavailable');yield*items;}});
 class Stripe {
  static createSubtleCryptoProvider(){return {};}
  webhooks={constructEventAsync:async(body)=>{if(invalidSignature)throw Error('signature');return JSON.parse(body);}};
  checkout={sessions:{retrieve:async()=>session,list:()=>iterable([session])}};
  paymentIntents={retrieve:async()=>({status:'succeeded',currency:'usd',amount_received:999,livemode:false,latest_charge:'ch_one'})};
  refunds={list:()=>iterable(refunds)};
  charges={retrieve:async()=>({payment_intent:'pi_one'})};
 }
 const admin={rpc:async(name,body)=>{calls.push({name,body});return {error:rpcError};}};
 let source=fs.readFileSync('supabase/functions/stripe-webhook/index.ts','utf8').replace(/^import .*;\n/gm,'');
 source=stripTypeScriptTypes(source);
 vm.runInNewContext(source,{Stripe,createClient:()=>admin,Deno:{env:{get:()=> 'configured'},serve:fn=>handler=fn},Response,console:{error(){}}});
 const send=(type='charge.refunded',object={id:'ch_one',payment_intent:'pi_one'})=>handler(new Request('https://test.local',{method:'POST',headers:{'Stripe-Signature':'test'},body:JSON.stringify({id:'evt_one',type,data:{object}})}));
 return {calls,send,session,handler};
}
test('Verified refund events sum only succeeded refunds and reconcile through one RPC',async()=>{
 const h=webhookHarness({refunds:[{amount:300,status:'succeeded'},{amount:699,status:'succeeded'},{amount:999,status:'pending'},{amount:999,status:'failed'}]});
 assert.equal((await h.send()).status,200);assert.equal(h.calls[0].body.p_refunded,999);
 for(const type of ['refund.created','refund.updated','refund.failed','charge.refund.updated'])assert.equal((await h.send(type,{id:'re_one',charge:'ch_one'})).status,200);
 assert.equal(h.calls.length,5);
});
test('Replayed checkout and asynchronous success fetch current refunds',async()=>{
 const h=webhookHarness({refunds:[{amount:999,status:'succeeded'}]});
 await h.send('checkout.session.completed',{id:'cs_test_one'});await h.send('checkout.session.async_payment_succeeded',{id:'cs_test_one'});
 assert.equal(h.calls.length,2);assert.ok(h.calls.every(c=>c.body.p_refunded===999));
});
test('Invalid signature does not write; Stripe and database failures request retries',async()=>{
 const bad=webhookHarness({invalidSignature:true});assert.equal((await bad.send()).status,400);assert.equal(bad.calls.length,0);
 const db=webhookHarness({rpcError:{message:'unavailable'}});assert.equal((await db.send()).status,500);
 const api=webhookHarness({listError:true});assert.equal((await api.send()).status,500);
 const other=webhookHarness();assert.equal((await other.send('unrelated.event')).status,200);assert.equal(other.calls.length,0);
});
