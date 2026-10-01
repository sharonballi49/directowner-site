/* Buyer-owned planning data stays on this browser. Public listings are fetched afresh. */
(function () {
  'use strict';
  const KEY = 'directowner-buyer-tools-v1';
  const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  const validId = value => uuid(value) && !window.DirectOwnerInventory.isTestId(value);
  const money = cents => new Intl.NumberFormat('en-US', {style:'currency', currency:'USD'}).format(cents / 100);
  const costs = [ ['tax', 'Estimated taxes, title & registration'], ['inspection', 'Independent inspection'], ['repairs', 'Initial repairs & maintenance'], ['transport', 'Travel or vehicle transport'] ];
  const checks = [
    ['owner', 'Match the owner and documents', 'Compare the seller’s identity with the title and ask about any lien. Do not upload ID or title images here.', 'Are you the titled owner, and is there a lien or loan to pay off?'],
    ['vin', 'Match the VIN', 'Compare the VIN on the vehicle, title, and history report. Resolve any mismatch before proceeding.', 'Can I check the VIN against the vehicle and title before paying?'],
    ['history', 'Review title and vehicle history', 'Use a history provider you choose. Reports can be incomplete and do not replace an inspection.', 'What is the title status? Has the vehicle had accidents, flood damage, or an odometer discrepancy?'],
    ['recalls', 'Check open recalls', 'Look up the vehicle with NHTSA and discuss unresolved recalls with a qualified repair professional.', 'Are there any outstanding recalls or known safety issues?'],
    ['mechanic', 'Arrange an independent inspection', 'Choose a qualified mechanic, review the findings, and budget for repairs before committing.', 'Will you allow an independent inspection? What known problems or recent repairs should I know about?'],
    ['closing', 'Plan the meeting and transfer', 'Agree on a safe meeting and confirm payment and title-transfer steps with your bank and state motor vehicle agency.', 'Can we arrange a daytime meeting and confirm the title-transfer and payment steps before exchanging money?']
  ];
  const fresh = () => ({ids:[], plans:{}});
  let state = fresh();
  let persistent = true;
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (raw && typeof raw === 'object') {
      state.ids = [...new Set(Array.isArray(raw.ids) ? raw.ids.filter(validId) : [])].slice(0,3);
      const plans = raw.plans && typeof raw.plans === 'object' ? raw.plans : {};
      for (const [id, plan] of Object.entries(plans).slice(-50)) {
        if ((id === 'general' || validId(id)) && plan && typeof plan === 'object') {
          state.plans[id] = {checks:{}, costs:{}, revision:Number.isInteger(plan.revision) ? plan.revision : null};
          for (const [key] of checks) state.plans[id].checks[key] = plan.checks?.[key] === true;
          for (const [key] of costs) {
            const value = plan.costs?.[key];
            state.plans[id].costs[key] = typeof value === 'string' && /^\d{1,7}(\.\d{1,2})?$/.test(value) ? value : '';
          }
        }
      }
    }
  } catch (_) { persistent = false; }
  function persist() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); persistent = true; }
    catch (_) { persistent = false; }
    const notice = document.getElementById('local-status');
    if (notice) notice.textContent = persistent ? 'Saved on this browser only. Not synced to your account. Anyone using this browser can see it.' : 'Browser storage is unavailable. Changes last only while this page is open.';
    return persistent;
  }
  function el(tag, className, text) {
    const node = document.createElement(tag); node.className = className || '';
    if (text !== undefined) node.textContent = text;
    return node;
  }
  function link(text, href, className='') { const node=el('a',className,text); node.href=href; return node; }
  function planFor(id) {
    if (!state.plans[id]) {
      const keys = Object.keys(state.plans);
      if (keys.length >= 50) delete state.plans[keys.find(key => !state.ids.includes(key)) || keys[0]];
      state.plans[id] = {checks:{},costs:{},revision:null};
    }
    return state.plans[id];
  }
  function updateSaveButtons() {
    document.querySelectorAll('[data-save-vehicle]').forEach(button => {
      const saved = state.ids.includes(button.dataset.saveVehicle);
      button.textContent = saved ? 'Remove from comparison' : 'Save to compare';
      button.setAttribute('aria-pressed', String(saved));
    });
    document.querySelectorAll('[data-compare-count]').forEach(node => { node.textContent = `Compare vehicles (${state.ids.length}/3)`; });
  }
  function saveButton(item) {
    const button=el('button','btn btn-secondary'); button.type='button'; button.dataset.saveVehicle=item.id;
    button.addEventListener('click', () => {
      const notice = document.getElementById('buyer-save-status');
      if (!validId(item.id)) { if(notice) notice.textContent='This vehicle cannot be saved.'; return; }
      if (state.ids.includes(item.id)) state.ids = state.ids.filter(id => id !== item.id);
      else if(state.ids.length < 3) state.ids.push(item.id);
      else { if(notice) notice.textContent='Your comparison has three vehicles. Remove one on the comparison page before adding another.'; return; }
      persist(); updateSaveButtons();
      if(notice) notice.textContent=persistent ? 'Comparison updated on this browser.' : 'Browser storage is unavailable. Your selection cannot be kept for another page.';
    });
    button.textContent=state.ids.includes(item.id)?'Remove from comparison':'Save to compare';
    button.setAttribute('aria-pressed',String(state.ids.includes(item.id)));
    return button;
  }
  window.DirectOwnerBuyerTools = {saveButton, updateSaveButtons};
  updateSaveButtons();
  const root=document.getElementById('buyer-workspace');
  if(!root)return;
  persist();
  let client;
  const fields='id,title,vehicle_type,year,make,model,price_cents,mileage,seller_location,description,status,moderation_status,is_test,review_revision,seller_disclosures';
  async function getListing(id) {
    if(!validId(id))return null;
    if(!client) {
      if(!window.supabase)throw new Error('Service unavailable');
      client=window.supabase.createClient(window.DIRECTOWNER_SUPABASE_URL,window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY);
    }
    const {data,error}=await client.from('listings').select(fields).eq('id',id).eq('status','active').eq('moderation_status','approved').maybeSingle();
    if(error)throw error;
    return data && window.DirectOwnerInventory.isPublic(data) ? data : null;
  }
  function syncRevision(item) {
    const plan=planFor(item.id);
    const changed=plan.revision !== null && plan.revision !== item.review_revision;
    if(changed)plan.checks={};
    plan.revision=item.review_revision; persist();
    return changed;
  }
  function costTotal(item,plan) {
    let total=Number.isSafeInteger(item?.price_cents) && item.price_cents >= 0 ? item.price_cents : 0;
    let missing=0;
    for(const [key] of costs) {
      const value=plan.costs[key];
      if(typeof value !== 'string' || !/^\d{1,7}(\.\d{1,2})?$/.test(value))missing++;
      else total+=Math.round(Number(value)*100);
    }
    return {total,missing};
  }
  function summary(item,plan) {
    const {total,missing}=costTotal(item,plan);
    return `${money(total)}${missing ? ` · ${missing} cost${missing===1?'':'s'} still unknown` : ' · all four estimates entered'}`;
  }
  function renderPlan(item) {
    const id=item?.id || 'general';
    const changed=item ? syncRevision(item) : false;
    const plan=planFor(id);
    document.getElementById('workspace-title').textContent=item ? item.title : 'Your vehicle buying plan';
    root.replaceChildren();
    if(changed)root.append(el('p','tools-notice','This listing changed since your last visit. Your checks have been reset; review the current details and update your cost estimates.'));
    if(item) {
      const overview=el('section','tools-panel vehicle-overview');
      overview.append(el('p','tools-eyebrow','Seller-provided listing details'), el('h2','',money(item.price_cents)), el('p','',`${item.mileage == null ? 'Mileage not provided' : Number(item.mileage).toLocaleString()+' miles'} • ${item.seller_location || 'Location not provided'}`));
      overview.append(el('p','tools-muted','Title, ownership, liens, history, and condition are not independently verified by DirectOwner. Content review is not a vehicle inspection.'));
      const actions=el('div','tools-actions'); actions.append(link('View current listing',`active-listing.html?id=${encodeURIComponent(id)}`,'btn btn-secondary'),saveButton(item),link('Compare vehicles', 'buyer-tools.html?view=compare','btn btn-secondary'));
      overview.append(actions); root.append(overview);
      if(window.DirectOwnerDisclosures)root.append(window.DirectOwnerDisclosures.render(item.seller_disclosures));
    } else root.append(el('p','tools-notice','This is a general planning checklist. Open Buyer tools on a current listing for its asking price, comparison, and a seller-specific inquiry.'));
    const grid=el('div','tools-grid'); const checklist=el('section','tools-panel');
    checklist.append(el('p','tools-eyebrow','01 / Check before you commit'),el('h2','','Keep track of your checks'),el('p','tools-muted','Tick an item only after you have done the check yourself. Completion does not certify a vehicle or guarantee a safe purchase.'));
    const progress=el('p','tools-progress'); progress.setAttribute('role','status');
    const updateProgress=()=>{ progress.textContent=`${checks.filter(([key])=>plan.checks[key]).length} of ${checks.length} checks marked done by you`; };
    updateProgress(); checklist.append(progress);
    for(const [key,title,help] of checks) {
      const label=el('label','tools-check');const input=el('input');input.type='checkbox';input.checked=!!plan.checks[key];input.name=key;
      const copy=el('span');copy.append(el('strong','',title),el('span','tools-muted',help));label.append(input,copy);
      input.addEventListener('change',()=>{plan.checks[key]=input.checked;persist();updateProgress();}); checklist.append(label);
    }
    const reset=el('button','tools-text-button','Reset my checks');reset.type='button';reset.addEventListener('click',()=>{plan.checks={};persist();checklist.querySelectorAll('input').forEach(input=>{input.checked=false;});updateProgress();}); checklist.append(reset);
    const budget=el('section','tools-panel');budget.append(el('p','tools-eyebrow','02 / Look beyond the asking price'),el('h2','','Plan your purchase budget'));
    budget.append(el('p','tools-muted','Enter your own estimates in US dollars. Leave unknown costs blank; enter 0 only when you expect no cost. These are not quotes or a tax calculation.'));
    budget.append(el('p','',item ? `Asking price: ${money(item.price_cents)}` : 'General worksheet: no vehicle asking price included.'));
    const total=el('p','tools-total');total.setAttribute('role','status');
    const updateTotal=()=>{total.textContent=`${item ? 'Planned purchase subtotal' : 'Additional-cost subtotal'}: ${summary(item,plan)}`;};
    for(const [key,title] of costs) {
      const label=el('label','tools-field',title+' ($)');const input=el('input');input.type='number';input.min='0';input.max='9999999.99';input.step='0.01';input.inputMode='decimal';input.name=key;input.placeholder='Unknown';input.value=plan.costs[key] || '';
      input.addEventListener('input',()=>{plan.costs[key]=input.validity.valid ? input.value : '';input.setAttribute('aria-invalid',String(!input.validity.valid));persist();updateTotal();});label.append(input);budget.append(label);
    }
    updateTotal();budget.append(total,el('p','tools-muted','This subtotal excludes insurance, financing charges, fuel, and ongoing ownership costs. Confirm taxes and fees with the relevant agency.'));
    grid.append(checklist,budget);root.append(grid);
    const request=el('section','tools-panel');request.append(el('p','tools-eyebrow','03 / Ask specific questions'),el('h2','','Prepare your seller questions'),el('p','tools-muted','Choose what you want to ask. Review and copy the text, or open your email app to request an introduction through DirectOwner support. Nothing is sent automatically.'));
    const options=el('div','tools-questions');const selected=new Set(checks.map(([key])=>key));
    const preview=el('textarea','tools-request');preview.readOnly=true;preview.rows=12;preview.setAttribute('aria-label','Prepared seller questions');
    const email=link('Open email to support','#','btn btn-primary');
    const buildRequest=()=>{
      preview.value=`Hello DirectOwner Support,\n\n${item ? `Please help me connect with the owner of ${item.title}.\nListing ID: ${id}\n${new URL('active-listing.html?id='+encodeURIComponent(id),location.href).href}\n\n` : 'I would like help preparing for a private-owner vehicle purchase.\n\n'}Questions I would like to ask:\n${checks.filter(([key])=>selected.has(key)).map(([, , ,question])=>'• '+question).join('\n')}\n\nThank you.`;
      email.href=`mailto:support@getdirectowner.com?subject=${encodeURIComponent(item ? 'Vehicle questions: '+item.title : 'Vehicle buying questions')}&body=${encodeURIComponent(preview.value)}`;
    };
    for(const [key,title] of checks) {
      const label=el('label','tools-question');const input=el('input');input.type='checkbox';input.checked=true;input.addEventListener('change',()=>{input.checked?selected.add(key):selected.delete(key);buildRequest();});label.append(input,el('span','',title));options.append(label);
    }
    buildRequest();const actions=el('div','tools-actions');const copy=el('button','btn btn-secondary','Copy questions');copy.type='button';const copied=el('p','tools-muted');copied.setAttribute('role','status');
    copy.addEventListener('click',async()=>{try {await navigator.clipboard.writeText(preview.value);copied.textContent='Questions copied. You choose where to send them.';}catch(_){preview.focus();preview.select();copied.textContent='Select and copy the prepared text using your browser.';}});
    actions.append(copy,email);request.append(options,preview,actions,copied);root.append(request);updateSaveButtons();
  }
  async function renderCompare() {
    document.getElementById('workspace-title').textContent='Compare your shortlist';
    root.replaceChildren();
    root.append(el('p','tools-notice','Compare up to three current listings. Prices and descriptions come from sellers; cost estimates and completed checks are your own. Listings are checked again whenever you open or refresh this page.'));
    if(!state.ids.length) { root.append(el('section','tools-panel','Your shortlist is empty. Choose “Save to compare” on a listing.'),link('Find a vehicle','browse.html','btn btn-primary'));return; }
    const ids=[...state.ids]; const results=await Promise.allSettled(ids.map(getListing));
    const grid=el('div','tools-compare-grid');
    results.forEach((result,index)=>{
      const id=ids[index];const panel=el('section','tools-panel');
      const item=result.status==='fulfilled'?result.value:null;
      if(item) {
        const changed=syncRevision(item); const plan=planFor(id);
        panel.append(el('p','tools-eyebrow',item.vehicle_type),el('h2','',item.title));
        const facts=el('dl','tools-facts');
        for(const [label,value] of [['Asking price',money(item.price_cents)],['Mileage',item.mileage == null?'Not provided':Number(item.mileage).toLocaleString()+' miles'],['Location',item.seller_location||'Not provided'],['Your purchase subtotal',summary(item,plan)],['Your checks',`${checks.filter(([key])=>plan.checks[key]).length} of ${checks.length} marked done`],['Title / ownership / condition','Not verified by DirectOwner']]){facts.append(el('dt','',label),el('dd','',value));}
        if(window.DirectOwnerDisclosures){
          for(const [label,key] of [['Title (seller reported)','title_status'],['Lien (seller reported)','lien_status'],['Inspection (seller reported)','inspection_status']])facts.append(el('dt','',label),el('dd','',window.DirectOwnerDisclosures.summary(item.seller_disclosures,key)));
        }
        panel.append(facts);if(changed)panel.append(el('p','tools-notice','Listing changed. Checks reset; review your estimates.'));
        panel.append(link('Open buying plan',`buyer-tools.html?id=${encodeURIComponent(id)}`,'btn btn-primary'));
      } else {
        panel.append(el('h2','',`Saved vehicle ${index+1}`),el('p','',result.status==='rejected'?'Could not check this listing. Refresh to try again; your saved selection has been kept.':'This listing is no longer publicly available. It may be paused, sold, or awaiting review.'));
      }
      const remove=el('button','tools-text-button','Remove from comparison');remove.type='button';remove.addEventListener('click',()=>{state.ids=state.ids.filter(value=>value!==id);persist();updateSaveButtons();load();});panel.append(remove);grid.append(panel);
    });
    root.append(grid);
  }
  async function load() {
    root.textContent='Loading buyer tools…';
    const params=new URLSearchParams(location.search);
    try {
      if(params.get('view')==='compare')await renderCompare();
      else if(params.has('id')) {
        const item=await getListing(params.get('id'));
        if(!item) {root.replaceChildren(el('p','tools-notice','This listing is not available. Buyer tools only show current, approved, non-test listings.'),link('Browse current vehicles','browse.html','btn btn-primary'));return;}
        renderPlan(item);
      }else renderPlan(null);
    }catch(_) {root.replaceChildren(el('p','tools-notice','We could not load this listing. Your saved plan has been kept. Please try again.'));const retry=el('button','btn btn-primary','Try again');retry.type='button';retry.addEventListener('click',load);root.append(retry);}
  }
  document.getElementById('print-plan').addEventListener('click',()=>window.print());
  document.getElementById('clear-buyer-data').addEventListener('click',()=>{
    state=fresh();persist();updateSaveButtons();load();
    document.getElementById('buyer-save-status').textContent=persistent?'Buyer tools data cleared from this browser.':'Could not clear browser storage. Use your browser settings to remove site data.';
  });
  load();
})();
