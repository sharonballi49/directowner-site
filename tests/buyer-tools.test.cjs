const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(require('node:path').join(__dirname,'..',name),'utf8');
const KEY='directowner-buyer-tools-v1';
const id='11111111-1111-4111-8111-111111111111';
const id2='22222222-2222-4222-8222-222222222222';
const id3='33333333-3333-4333-8333-333333333333';
const id4='44444444-4444-4444-8444-444444444444';
const item={id,title:'2019 Honda Civic',vehicle_type:'car',price_cents:1500000,mileage:40000,seller_location:'Austin, TX',status:'active',moderation_status:'approved',is_test:false,review_revision:2};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(search='',data={[id]:item},saved=null,options={}){
 const dom=new JSDOM(read('buyer-tools.html'),{url:'https://example.com/buyer-tools.html'+search,runScripts:'outside-only'});const w=dom.window;const calls=[];
 if(saved!==null)w.localStorage.setItem(KEY,typeof saved==='string'?saved:JSON.stringify(saved));
 if(options.blockStorage)Object.defineProperty(w,'localStorage',{get(){throw Error('blocked');}});
 w.supabase={createClient:()=>({from:()=>{
   let target;const query={select(){return query;},eq(key,value){calls.push([key,value]);if(key==='id')target=value;return query;},async maybeSingle(){return {data:data[target]||null,error:options.error?{message:'offline'}:null};}};return query;
 }})};
 w.eval(read('inventory.js'));w.eval(read('buyer-tools.js'));return {w,calls};
}
test('Per-listing budget uses cents, distinguishes unknown from zero, and saves checks',async()=>{
 const {w}=fixture('?id='+id);await tick();const d=w.document;
 assert.match(d.querySelector('.tools-total').textContent,/\$15,000.00 · 4 costs still unknown/);
 for(const [name,value] of [['tax','1200.25'],['inspection','125.10'],['repairs','0'],['transport','0']]){const input=d.querySelector('input[name="'+name+'"]');input.value=value;input.dispatchEvent(new w.Event('input'));}
 assert.match(d.querySelector('.tools-total').textContent,/\$16,325.35 · all four estimates entered/);
 const input=d.querySelector('input[name="repairs"]');input.value='-10';input.dispatchEvent(new w.Event('input'));
 assert.equal(input.getAttribute('aria-invalid'),'true');assert.match(d.querySelector('.tools-total').textContent,/1 cost still unknown/);
 d.querySelector('input[name="owner"]').click();assert.match(d.querySelector('.tools-progress').textContent,/1 of 6/);
 assert.equal(JSON.parse(w.localStorage.getItem(KEY)).plans[id].checks.owner,true);w.close();
});
test('New listing revision resets checks and preserves clearly labelled estimates',async()=>{
 const {w}=fixture('?id='+id,undefined,{ids:[id],plans:{[id]:{revision:1,checks:{owner:true,vin:true},costs:{repairs:'250'}}}});await tick();
 assert.match(w.document.getElementById('buyer-workspace').textContent,/listing changed/);
 assert.match(w.document.querySelector('.tools-progress').textContent,/0 of 6/);
 assert.equal(w.document.querySelector('input[name="repairs"]').value,'250');w.close();
});
test('Compare never exposes hidden, unapproved, test or unavailable vehicle details',async()=>{
 for(const bad of [{...item,status:'sold'},{...item,moderation_status:'pending'},{...item,is_test:true},null]){
 const {w,calls}=fixture('?view=compare',{[id]:bad},{ids:[id],plans:{}});await tick();
 const text=w.document.getElementById('buyer-workspace').textContent;assert.match(text,/no longer publicly available/);assert.doesNotMatch(text,/Honda/);
 assert.ok(calls.some(([key,value])=>key==='moderation_status'&&value==='approved'));w.close();}
});
test('Malformed and known-test ids are never queried; storage errors remain usable',async()=>{
 for(const value of ['bad','3dcae366-5b6a-4a34-93a7-a7605c526925']){const {w,calls}=fixture('?id='+value);await tick();assert.equal(calls.length,0);assert.match(w.document.getElementById('buyer-workspace').textContent,/not available/);w.close();}
 const {w}=fixture('',{},null,{blockStorage:true});await tick();assert.match(w.document.getElementById('local-status').textContent,/unavailable/);w.document.querySelector('input[name="owner"]').click();assert.match(w.document.querySelector('.tools-progress').textContent,/1 of 6/);w.close();
});
test('API failures keep the shortlist and do not imply a vehicle was sold',async()=>{
 const {w}=fixture('?view=compare',undefined,{ids:[id],plans:{}},{error:true});await tick();
 assert.match(w.document.getElementById('buyer-workspace').textContent,/Could not check this listing/);assert.equal(JSON.parse(w.localStorage.getItem(KEY)).ids[0],id);w.close();
});
test('Comparison limit, removal, and clearing work without deleting unrelated site data',async()=>{
 const {w}=fixture('',{}, {ids:[id,id2,id3],plans:{}});await tick();w.localStorage.setItem('unrelated-auth','keep');
 const button=w.DirectOwnerBuyerTools.saveButton({...item,id:id4});w.document.body.append(button);button.click();assert.match(w.document.getElementById('buyer-save-status').textContent,/three vehicles/);
 const remove=w.DirectOwnerBuyerTools.saveButton(item);w.document.body.append(remove);remove.click();button.click();assert.ok(JSON.parse(w.localStorage.getItem(KEY)).ids.includes(id4));
 w.document.getElementById('clear-buyer-data').click();await tick();assert.equal(JSON.parse(w.localStorage.getItem(KEY)).ids.length,0);assert.equal(w.localStorage.getItem('unrelated-auth'),'keep');w.close();
});
test('Seller-controlled text is rendered safely and inquiry selections change only the draft',async()=>{
 const title='<img src=x onerror=alert(1)>';const {w}=fixture('?id='+id,{[id]:{...item,title}});await tick();const d=w.document;
 assert.equal(d.getElementById('workspace-title').textContent,title);assert.equal(d.getElementById('workspace-title').querySelector('img'),null);
 const preview=d.querySelector('.tools-request');assert.match(preview.value,/Are you the titled owner/);d.querySelector('.tools-question input').click();assert.doesNotMatch(preview.value,/Are you the titled owner/);
 assert.match(d.querySelector('a[href^="mailto:"]').href,/^mailto:support@getdirectowner.com/);assert.ok(preview.value.includes(id));w.close();
});
test('Corrupt storage recovers and an empty comparison makes no database requests',async()=>{
 const {w,calls}=fixture('?view=compare',{},'{broken');await tick();assert.match(w.document.getElementById('buyer-workspace').textContent,/shortlist is empty/);assert.equal(calls.length,0);w.close();
});
