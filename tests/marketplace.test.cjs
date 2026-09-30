const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');
const root = path.resolve(__dirname, '..');
const source = file => fs.readFileSync(path.join(root, file), 'utf8');
const testId = '3dcae366-5b6a-4a34-93a7-a7605c526925';
const real = { id:'real-vehicle', title:'2019 Honda Civic', vehicle_type:'car', status:'active', moderation_status:'approved', price_cents:1500000, mileage:40000, seller_location:'Austin, TX', make:'Honda', model:'Civic', year:2019, description:'An owner supplied vehicle description.', created_at:'2026-09-20', photo_paths:[] };
function fixture(page, data = [], search = '', error = null) {
  const dom = new JSDOM(source(page), { url:`https://example.com/${page}${search}`, runScripts:'outside-only' });
  const { window:w } = dom;
  const calls = [];
  const query = {};
  for (const method of ['select','eq','neq','order']) query[method] = (...args) => { calls.push([method,...args]); return query; };
  query.then = resolve => Promise.resolve({data,error}).then(resolve);
  query.maybeSingle = async () => ({data:data[0] || null,error});
  const client = { from:() => query, storage:{from:() => ({getPublicUrl:p => ({data:{publicUrl:`https://example.com/photo/${p}`}})})} };
  w.supabase = {createClient:() => client};
  w.eval(source('inventory.js'));
  return { dom, w, calls, client };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
test('Public inventory excludes tests, drafts, and sold vehicles; price filters use dollars', () => {
  const {w}=fixture('browse.html'); const rules=w.DirectOwnerInventory;
  assert.equal(rules.isPublic(real),true);
  for(const item of [{...real,id:testId},{...real,is_test:true},{...real,status:'draft'},{...real,status:'sold'},{...real,moderation_status:'pending'},{...real,moderation_status:'rejected'},{...real,moderation_status:undefined}]) assert.equal(rules.isPublic(item),false);
  assert.equal(rules.matches(real,{minPrice:'20000'}),false);
  assert.equal(rules.matches(real,{maxPrice:'14000'}),false);
  assert.equal(rules.matches(real,{type:'car',minPrice:'10000',maxPrice:'15000',query:'HONDA',location:'austin'}),true);
  assert.equal(rules.matches(real,{location:'Dallas'}),false);
});
test('Homepage displays coming-soon message when only test inventory exists', async () => {
  const {w,calls}=fixture('index.html',[{...real,id:testId}]); w.eval(source('public-listings.js')); await tick();
  assert.match(w.document.getElementById('public-listings').textContent,/Listings coming soon/);
  assert.equal(w.document.querySelectorAll('.listing-card').length,0);
  assert.ok(calls.some(c => c[0]==='neq' && c[1]==='id' && c[2]===testId));
  assert.equal(w.document.querySelector('.search-panel').getAttribute('action'),'browse.html');
});
test('Homepage uses live detail links and limits preview to three vehicles',async()=>{
  const {w}=fixture('index.html',Array.from({length:4},(_,i)=>({...real,id:`real-${i}`})));
  w.eval(source('public-listings.js')); await tick();
  assert.equal(w.document.querySelectorAll('.listing-card').length,3);
  assert.equal(w.document.querySelector('.listing-card a').getAttribute('href'),'active-listing.html?id=real-0');
});
test('Browse applies homepage URL filters, maximum budget, and clear filters',async()=>{
  const {w}=fixture('browse.html',[real,{...real,id:'truck',vehicle_type:'truck',seller_location:'Dallas',price_cents:3000000}], '?type=car&query=Honda&location=Austin');
  w.eval(source('public-listings.js')); await tick();
  assert.equal(w.document.querySelectorAll('.listing-card').length,1);
  const max=w.document.getElementById('filter-max-price'); max.value='10000'; max.dispatchEvent(new w.Event('input'));
  assert.match(w.document.getElementById('public-listings').textContent,/Try another search/);
  w.document.getElementById('clear-filters').click();
  assert.equal(w.document.querySelectorAll('.listing-card').length,2);
  assert.equal(w.location.search,'');
});
test('Inventory failures do not masquerade as an empty marketplace',async()=>{
  const {w}=fixture('index.html',[], '', {message:'database error'}); w.eval(source('public-listings.js')); await tick();
  assert.match(w.document.getElementById('inventory-status').textContent,/could not load/);
  assert.doesNotMatch(w.document.getElementById('public-listings').textContent,/Listings coming soon/);
  assert.equal(w.document.querySelector('#public-listings button').textContent,'Try Again');
});
function loadDetail(w) { const script=[...w.document.scripts].find(s=>!s.src && s.textContent.includes('async function load')); w.eval(script.textContent); }
test('Direct BMW test URL is unavailable and is not queried',async()=>{
  const {w,calls}=fixture('active-listing.html',[{...real,id:testId}],`?id=${testId}`); loadDetail(w); await tick();
  assert.match(w.document.getElementById('message').textContent,/not available for sale/);
  assert.equal(w.document.getElementById('layout').hidden,true);
  assert.equal(calls.length,0);
});
test('Seller text cannot inject HTML; inquiry and report identify the listing',async()=>{
  const title='<img src=x onerror="alert(1)">';
  const {w}=fixture('active-listing.html',[{...real,title,make:'<script>alert(1)</script>'}],'?id=real-vehicle'); loadDetail(w); await tick();
  assert.equal(w.document.querySelector('#card h1').textContent,title);
  assert.equal(w.document.querySelector('#card h1 img'),null);
  assert.equal(w.document.querySelector('#card script'),null);
  assert.equal(w.document.getElementById('layout').hidden,false);
  assert.match(w.document.getElementById('ask-link').href,/^mailto:support@getdirectowner.com/);
  assert.match(decodeURIComponent(w.document.getElementById('report-link').href),/real-vehicle/);
});
test('Unavailable listing never exposes a contact action',async()=>{
  const {w}=fixture('active-listing.html',[],'?id=missing'); loadDetail(w); await tick();
  assert.equal(w.document.getElementById('layout').hidden,true);
  assert.match(w.document.getElementById('message').textContent,/unavailable/);
});
test('Mobile menu opens, updates accessible state, and closes with Escape on every page',()=>{
  for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){
    const {w}=fixture(file); const button=w.document.querySelector('.menu-toggle'); if(!button)continue;
    w.eval(source('navigation.js')); button.click();
    assert.equal(button.getAttribute('aria-expanded'),'true',file);
    assert.ok(w.document.querySelector('.site-nav').classList.contains('is-open'),file);
    button.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    assert.equal(button.getAttribute('aria-expanded'),'false',file);
  }
});
test('Local page and script links resolve; old sample listing links are gone',()=>{
  for(const file of fs.readdirSync(root).filter(f=>f.endsWith('.html'))){
    const {w}=fixture(file);
    for(const node of w.document.querySelectorAll('a[href],script[src],link[rel="stylesheet"]')){
      const value=node.getAttribute('href')||node.getAttribute('src');
      if(!value || /^(https?:|mailto:|#|data:)/.test(value))continue;
      const target=value.split(/[?#]/)[0];
      assert.ok(fs.existsSync(path.join(root,target)),`${file}: ${target}`);
    }
  }
  assert.doesNotMatch(source('index.html'),/listing-f150|listing-airstream|listing-tacoma|via.placeholder/);
});

test('Free activation uses the trusted server function and handles failures',async()=>{
  for (const fail of [false,true]) {
    const {w,client}=fixture('choose-plan.html',[{...real,status:'draft'}],'?id=real-vehicle');
    client.auth={getUser:async()=>({data:{user:{id:'owner'}},error:null})};
    const requests=[];
    client.functions={invoke:async(name,args)=>{requests.push({name,args});return fail?{data:null,error:{message:'Activation unavailable'}}:{data:{free:true},error:null}}};
    // A client-side table update is deliberately not available on the mock.
    const script=[...w.document.scripts].find(s=>!s.src && s.textContent.includes('async function checkListing'));
    w.eval(script.textContent); await tick();
    w.document.querySelector('[data-plan="free"]').click(); await tick();
    assert.equal(requests.length,1);
    assert.equal(requests[0].name,'create-checkout-session');
    assert.equal(requests[0].args.body.plan,'free');
    assert.equal(requests[0].args.body.listingId,'real-vehicle');
    const message=w.document.getElementById('message');
    assert.match(message.textContent,fail?/Activation unavailable/:/submitted for review/);
    assert.equal(message.classList.contains('error'),fail);
    w.close();
  }
});
