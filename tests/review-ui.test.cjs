const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const tick=()=>new Promise(r=>setImmediate(r));
const item={id:'44444444-4444-4444-4444-444444444444',title:'Honda Civic <img src=x onerror=alert(1)>',description:'Owner supplied description with enough detail.',year:2020,make:'Honda',model:'Civic',vehicle_type:'car',price_cents:1200000,plan:'free',status:'active',moderation_status:'pending',review_revision:4,photo_paths:[],created_at:'2026-09-30'};
function page(name,{allowed=true,user={id:'reviewer',email:'test@example.com'},rows=[item],fail=false,authError=null}={}){
 const dom=new JSDOM(fs.readFileSync(name,'utf8'),{url:'https://example.com/'+name+'?id='+item.id,runScripts:'outside-only'}),w=dom.window;
 const calls=[];let authChange;const query={};
 for(const key of ['select','eq','order'])query[key]=()=>query;
 query.then=resolve=>Promise.resolve({data:rows,error:null}).then(resolve);
 query.maybeSingle=async()=>({data:{...item,owner_id:'seller'},error:null});
 const client={auth:{getUser:async()=>({data:{user},error:authError}),onAuthStateChange:fn=>{authChange=fn;}},from:()=>query,storage:{from:()=>({getPublicUrl:p=>({data:{publicUrl:'https://example.com/'+p}})})},rpc:async(name,args)=>{
   calls.push({name,args});
   if(name==='is_listing_reviewer')return {data:allowed,error:fail?{message:'offline'}:null};
   if(name==='review_queue')return {data:rows,error:null};
   if(name==='review_reports')return {data:[],error:null};
   if(name==='report_listing')return fail?{error:{message:'Report service offline'}}:{data:'report-123'};
   return {data:null,error:fail?{message:'Listing changed. Refresh and review the latest version.'}:null};
 }};
 w.supabase={createClient:()=>client};
 w.eval(fs.readFileSync(name.replace('.html','.js'),'utf8'));
 return {w,calls,client,signOut:()=>authChange?.('SIGNED_OUT')};
}
test('Private review workspace denies ordinary and signed-out accounts without querying queues',async()=>{
 for(const options of [{allowed:false},{user:null}]){
  const {w,calls}=page('review.html',options);await tick();
  assert.equal(w.document.getElementById('review-workspace').hidden,true);
  assert.ok(!calls.some(c=>c.name==='review_queue'));
  assert.match(w.document.getElementById('review-message').textContent,/reviewer|Sign in/);w.close();
 }
});
test('Reviewer checks details before approval; decisions include revision; text is safely rendered; sign-out clears data',async()=>{
 const {w,calls,signOut}=page('review.html');await tick();
 assert.equal(w.document.querySelector('.review-card h2').textContent,item.title);
 assert.equal(w.document.querySelector('.review-card h2 img'),null);
 let approve=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Approve Listing');
 approve.click();await tick();assert.ok(!calls.some(c=>c.name==='review_listing'));
 w.document.querySelector('.review-check input').checked=true;approve.click();await tick();
 const request=calls.find(c=>c.name==='review_listing');assert.equal(request.args.p_revision,4);assert.equal(request.args.p_decision,'approved');
 signOut();assert.equal(w.document.getElementById('review-workspace').hidden,true);assert.equal(w.document.getElementById('review-list').children.length,0);w.close();
});
test('Rejection requires meaningful feedback and stale decisions remain visibly unsuccessful',async()=>{
 const {w,calls,client}=page('review.html');await tick();
 const reject=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Reject Listing');
 reject.click();await tick();assert.ok(!calls.some(c=>c.name==='review_listing'));
 w.document.querySelector('textarea').value='Please clarify the conflicting vehicle details.';
 client.rpc=async()=>({error:{message:'Listing changed. Refresh and review the latest version.'}});
 reject.click();await tick();assert.match(w.document.getElementById('review-list').textContent,/Listing changed/);assert.equal(reject.disabled,false);w.close();
});
test('Review service failure offers retry without exposing cached listings',async()=>{
 const {w}=page('review.html',{fail:true});await tick();assert.equal(w.document.getElementById('review-workspace').hidden,true);assert.equal(w.document.getElementById('review-retry').hidden,false);w.close();
});
test('Report form preserves content on failure, confirms success, and requires sign-in',async()=>{
 for(const fail of [true,false]){
  const {w,calls}=page('report-listing.html',{fail});await tick();
  const form=w.document.getElementById('report-form');assert.equal(form.hidden,false);
  w.document.getElementById('report-reason').value='suspected_scam';w.document.getElementById('report-details').value='Seller requested payment using gift cards.';
  form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();
  assert.equal(calls.find(c=>c.name==='report_listing').args.p_listing_id,item.id);
  assert.equal(form.hidden,!fail);assert.match(w.document.getElementById('report-message').textContent,fail?/offline/:/Report received/);
  if(fail)assert.equal(w.document.getElementById('report-details').value,'Seller requested payment using gift cards.');w.close();
 }
 const {w}=page('report-listing.html',{user:null,authError:{name:'AuthSessionMissingError'}});await tick();assert.equal(w.document.getElementById('report-form').hidden,true);assert.match(decodeURIComponent(w.document.getElementById('report-sign-in').href),/next=report-listing.html\?id=/);w.close();
});
test('Seller dashboard labels pending and rejected listings, keeps public links hidden, and gates reviewer link',async()=>{
 for(const allowed of [false,true]){
  const {w}=page('dashboard.html',{allowed,rows:[item,{...item,id:'rejected',moderation_status:'rejected',review_feedback:'Please clarify the vehicle details.'}]});await tick();
  assert.equal(w.document.getElementById('review-dashboard-link').hidden,!allowed);
  assert.match(w.document.getElementById('listing-list').textContent,/Awaiting review — hidden/);
  assert.match(w.document.getElementById('listing-list').textContent,/Changes needed — hidden/);
  assert.equal(w.document.querySelectorAll('a[href^="active-listing.html"]').length,0);w.close();
 }
});
