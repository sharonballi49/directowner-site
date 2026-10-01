const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {PGlite}=require('@electric-sql/pglite');
const read=file=>fs.readFileSync(file,'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const answers={owner_status:'yes',title_status:'clean',lien_status:'unknown',damage_status:'known',damage_details:'Rear bumper repaired after an accident.',mechanical_status:'none_known',mechanical_details:'',records_status:'some',inspection_status:'discuss'};
const seller='11111111-1111-4111-8111-111111111111',buyer='22222222-2222-4222-8222-222222222222',reviewer='33333333-3333-4333-8333-333333333333';
function ui(file='sell.html'){
 const dom=new JSDOM(read(file),{url:'https://example.com/'+file+'?id=44444444-4444-4444-8444-444444444444',runScripts:'outside-only'});const w=dom.window;w.eval(read('disclosures.js'));return w;
}
function fill(w,values=answers){
 for(const [key,value] of Object.entries(values)){const input=w.document.getElementById('disclosure-'+key);input.value=value;input.dispatchEvent(new w.Event('change'));}
}
test('Disclosure form requires explicit answers, reveals known-issue details, and preserves unknown',()=>{
 const w=ui();const box=w.document.getElementById('seller-disclosure-form');assert.throws(()=>w.DirectOwnerDisclosures.collect(box),/Please answer/);
 fill(w);assert.deepEqual(JSON.parse(JSON.stringify(w.DirectOwnerDisclosures.collect(box))),answers);
 assert.equal(w.document.getElementById('disclosure-damage_details').required,true);
 const select=w.document.getElementById('disclosure-damage_status');select.value='unknown';select.dispatchEvent(new w.Event('change'));
 assert.equal(w.document.getElementById('disclosure-damage_details').disabled,true);assert.equal(w.DirectOwnerDisclosures.collect(box).damage_details,'');
 select.value='known';select.dispatchEvent(new w.Event('change'));w.document.getElementById('disclosure-damage_details').value='short';assert.throws(()=>w.DirectOwnerDisclosures.collect(box),/10–1,000/);w.close();
});
test('Public disclosure rendering never claims verification and escapes seller notes',()=>{
 const w=ui();const empty=w.DirectOwnerDisclosures.render({});assert.equal([...empty.querySelectorAll('dd')].filter(n=>n.textContent==='Not provided').length,7);
 const panel=w.DirectOwnerDisclosures.render({...answers,damage_details:'<img src=x onerror=alert(1)>'});assert.equal(panel.querySelector('img'),null);assert.match(panel.textContent,/Seller reported—not independently verified/);assert.match(panel.textContent,/Unknown \/ not sure/);assert.equal(w.DirectOwnerDisclosures.summary({title_status:'toString'},'title_status'),'Not provided');w.close();
});
test('Listing creation stores the validated seller answers in the same insert',async()=>{
 const w=ui();for(const src of ['https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2','supabase-config.js']){const node=w.document.createElement('script');node.src=src;node.dataset.loaded='true';w.document.head.append(node);}
 w.DIRECTOWNER_SUPABASE_URL='https://example.com';w.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY='test';let inserted;
 w.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:seller}},error:null})},from:()=>({insert(payload){inserted=payload;return {select:()=>({single:async()=>({data:{id:'new-id'},error:null})})};}})})};
 w.eval(read('script.js'));await tick();fill(w);
 for(const [id,value] of Object.entries({year:'2020',make:'Honda',model:'Civic',price:'15000',sellerName:'Test Owner',location:'Austin, TX',description:'A sufficiently detailed description of the vehicle.',email:'test@example.com'}))w.document.getElementById(id).value=value;
 w.document.getElementById('listing-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(inserted.seller_disclosures.damage_details,answers.damage_details);assert.equal(inserted.status,'draft');assert.match(w.document.getElementById('status').textContent,/saved as a draft/);w.close();
});
test('Owner editor loads disclosures, uses one atomic save, and retains entries after failure',async()=>{
 const w=ui('edit-listing.html');const item={id:'44444444-4444-4444-8444-444444444444',title:'2020 Honda Civic',vehicle_type:'car',year:2020,make:'Honda',model:'Civic',price_cents:1500000,description:'A sufficiently detailed vehicle description.',mileage:45000,seller_location:'Austin',status:'active',photo_paths:[],seller_disclosures:answers};const requests=[];const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:item,error:null})};
 w.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:seller}}})},from:()=>q,rpc:async(name,args)=>{requests.push({name,args});return {error:{message:'Save unavailable'}};}})};
 w.eval([...w.document.scripts].find(s=>!s.src&&s.textContent.includes('async function loadListing')).textContent);await tick();
 assert.equal(w.document.getElementById('disclosure-title_status').value,'clean');w.document.getElementById('disclosure-title_status').value='rebuilt';w.document.getElementById('editor-form').dispatchEvent(new w.Event('submit',{cancelable:true}));await tick();
 assert.equal(requests.length,1);assert.equal(requests[0].name,'update_listing_with_disclosures');assert.equal(requests[0].args.p_seller_disclosures.title_status,'rebuilt');assert.equal(w.document.getElementById('disclosure-title_status').value,'rebuilt');assert.match(w.document.getElementById('message').textContent,/Save unavailable/);assert.equal(w.document.getElementById('save-button').disabled,false);w.close();
});
test('Database validates disclosure content, enforces ownership, saves atomically, and re-reviews edits',async()=>{
 const db=new PGlite();const admin=()=>db.exec('reset role');const as=async(id)=>db.exec(`reset role;select set_config('request.jwt.claim.sub','${id||''}',false);set role ${id?'authenticated':'anon'};`);
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;grant usage on schema auth,public to anon,authenticated;grant execute on function auth.uid() to anon,authenticated;insert into auth.users values('${seller}'),('${buyer}'),('${reviewer}');`);
 await db.exec(read('supabase/migrations/20260921000100_initial_marketplace.sql').split('-- Storage bucket')[0].replace('create extension if not exists pgcrypto;',''));
 await db.exec('alter table public.listings add column mileage integer, add column seller_location text;grant select,insert,update,delete on public.listings to authenticated;grant select on public.listings to anon;create schema storage;create table storage.objects(bucket_id text,name text);');
 await db.exec(read('supabase/migrations/20260930000100_keep_test_listing_private.sql'));await db.exec(read('supabase/migrations/20260930000200_listing_review.sql'));
 await db.exec(`insert into public.listing_reviewers(user_id) values('${reviewer}');`);
 const id=(await db.query(`insert into public.listings(owner_id,title,description,vehicle_type,year,make,model,price_cents) values($1,'2020 Honda Civic','A sufficiently detailed description','car',2020,'Honda','Civic',1000000) returning id`,[seller])).rows[0].id;
 await db.exec('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
 await db.exec(read('supabase/migrations/20261001000100_seller_disclosures.sql'));
 assert.deepEqual((await db.query('select seller_disclosures from public.listings where id=$1',[id])).rows[0].seller_disclosures,{});
 for(const bad of [null,[],{...answers,title_status:'verified'}, {...answers,verified:true}, {...answers,lien_status:null}, {...answers,damage_details:'short'}, {...answers,damage_details:' '.repeat(1001)+'Long damage description'}, {...answers,mechanical_details:'Contradiction'}, {owner_status:'yes'}]){
  assert.equal((await db.query('select public.valid_seller_disclosures($1::jsonb) as ok',[JSON.stringify(bad)])).rows[0].ok,false);
  await assert.rejects(db.query('update public.listings set seller_disclosures=$1::jsonb where id=$2',[JSON.stringify(bad),id]),/constraint/);
 }
 const save=(values=answers,title='2020 Honda Civic')=>db.query('select public.update_listing_with_disclosures($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb)',[id,title,'car',2020,'Honda','Civic',1000000,'A sufficiently detailed description',45000,'Austin, TX',JSON.stringify(values)]);
 await as();await assert.rejects(save(),/permission denied/);
 await as(buyer);await assert.rejects(save(),/do not own/);
 await as(seller);await save();
 await admin();await db.query("update public.listings set status='active' where id=$1",[id]);
 const approve=async()=>{await as(reviewer);const row=(await db.query('select * from public.review_queue()')).rows.find(r=>r.id===id);assert.equal(row.seller_disclosures.owner_status,'yes');await db.query("select public.review_listing($1,$2,'approved')",[id,row.review_revision]);};
 await approve();await as();assert.equal((await db.query('select * from public.listings where id=$1',[id])).rows.length,1);
 await as(seller);await assert.rejects(save({...answers,damage_details:'bad'},'Changed title should not save'),/Answer every/);await assert.rejects(save(answers,'bad'),/Title must/);
 const unchanged=(await db.query('select * from public.listings where id=$1',[id])).rows[0];assert.equal(unchanged.title,'2020 Honda Civic');assert.equal(unchanged.moderation_status,'approved');
 await save({...answers,title_status:'rebuilt'});const changed=(await db.query('select * from public.listings where id=$1',[id])).rows[0];assert.equal(changed.moderation_status,'pending');assert.ok(changed.review_revision>unchanged.review_revision);assert.equal(changed.plan,'free');
 await as();assert.equal((await db.query('select * from public.listings where id=$1',[id])).rows.length,0);
 await admin();await db.query("update public.listings set status='sold' where id=$1",[id]);await as(seller);await assert.rejects(save(),/not available/);
 }finally{await db.close();}
});
test('Public detail and reviewer queue display the stored seller disclosures',async()=>{
 const item={id:'44444444-4444-4444-8444-444444444444',title:'2020 Honda Civic',vehicle_type:'car',year:2020,make:'Honda',model:'Civic',price_cents:1500000,description:'A sufficiently detailed vehicle description.',mileage:45000,seller_location:'Austin',status:'active',moderation_status:'approved',review_revision:4,photo_paths:[],created_at:'2026-10-01',seller_disclosures:{...answers,title_status:'rebuilt'}};
 for(const file of ['active-listing.html','review.html']){
  const w=ui(file);const q={select(){return q;},eq(){return q;},maybeSingle:async()=>({data:item,error:null})};
  w.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:{id:reviewer}}})},from:()=>q,rpc:async name=>({data:name==='is_listing_reviewer'?true:name==='review_queue'?[item]:[],error:null})})};
  if(file==='active-listing.html'){w.eval(read('inventory.js'));w.eval([...w.document.scripts].find(s=>!s.src&&s.textContent.includes('async function load')).textContent);}else w.eval(read('review.js'));
  await tick();assert.match(w.document.querySelector('.disclosure-summary').textContent,/Rebuilt \/ reconstructed/);assert.match(w.document.querySelector('.disclosure-summary').textContent,/Rear bumper repaired/);w.close();
 }
});
