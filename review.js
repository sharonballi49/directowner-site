(() => {
  let sessionVersion = 0;
  const client = window.supabase.createClient(window.DIRECTOWNER_SUPABASE_URL, window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY);
  const message = document.getElementById('review-message');
  const workspace = document.getElementById('review-workspace');
  const list = document.getElementById('review-list');
  const view = document.getElementById('review-view');
  const refresh = document.getElementById('review-refresh');
  let listings = [], reports = [], busy = false;
  const el = (tag, text, className) => { const n = document.createElement(tag); if(text!=null)n.textContent=text; if(className)n.className=className; return n; };
  function notice(text, error=false) { message.textContent=text; message.classList.toggle('error',error); }
  function lock(value) { busy=value; workspace.querySelectorAll('button,select,textarea,input').forEach(n=>n.disabled=value); }
  function cardFor(item, report) {
    const card=el('article',null,'review-card');
    card.append(el('span',report?'Buyer report':'Awaiting content review','review-badge'),el('h2',item.title));
    card.append(el('p',`${item.year} ${item.make} ${item.model} · ${item.vehicle_type} · $${(item.price_cents/100).toLocaleString('en-US')} · ${item.plan} plan`));
    card.append(el('p',`${item.mileage==null?'Mileage not provided':Number(item.mileage).toLocaleString('en-US')+' miles'} · ${item.seller_location||'Location not provided'} · ${item.status} · ${item.moderation_status}`));
    card.append(el('p',item.description));
    if(window.DirectOwnerDisclosures)card.append(window.DirectOwnerDisclosures.render(item.seller_disclosures));
    const photos=el('div',null,'review-photos');
    (item.photo_paths||[]).forEach((path,i)=>{
      const url=client.storage.from('vehicle-photos').getPublicUrl(path).data.publicUrl;
      const link=el('a'); link.href=url; link.target='_blank'; link.rel='noopener noreferrer';
      const img=el('img'); img.src=url; img.alt=`${item.title}, photo ${i+1} (opens full size)`;
      img.addEventListener('error',()=>{img.replaceWith(el('span',`Photo ${i+1} unavailable — do not approve without reviewing it.`));});
      link.append(img); photos.append(link);
    });
    card.append(photos,el('p',`${(item.photo_paths||[]).length} photos · Listing ${item.id} · Version ${item.review_revision}`,'review-help'));
    if(report) {
      card.append(el('h3','Reported concern'),el('p',`${report.reason.replaceAll('_',' ')} · ${new Date(report.reported_at).toLocaleString()}`),el('p',report.details));
    }
    const form=el('form');
    const checklist=el('label',null,'review-check'); const checked=el('input'); checked.type='checkbox';
    checklist.append(checked,el('span','I reviewed the vehicle details, seller disclosures, and every available photo for misleading claims, prohibited content, and scam warning signs.'));
    if(!report)form.append(checklist);
    const label=el('label',report?'Decision notes':'Reason if rejecting (shown to seller)');
    const feedback=el('textarea'); feedback.id=`feedback-${report?.report_id||item.id}`; feedback.maxLength=1000; feedback.rows=3; label.htmlFor=feedback.id;
    const inline=el('p','','review-help'); inline.setAttribute('role','status');
    form.append(label,feedback,el('p',report?'A removal reason is shown to the seller. A resolution note stays with the report.':'Explain what needs correcting. Approval is not identity or ownership verification.','review-help'));
    const actions=el('div',null,'review-actions');
    function action(text, decision, primary=false) {
      const button=el('button',text,primary?'btn btn-primary':'btn btn-secondary'); button.type='button';
      button.addEventListener('click',async()=>{
        if(busy)return;
        if(decision==='approved'&&!checked.checked){inline.textContent='Complete the review checklist before approving.';checked.focus();return;}
        if(decision!=='approved'&&feedback.value.trim().length<10){inline.textContent='Please add at least 10 characters explaining your decision.';feedback.focus();return;}
        lock(true); inline.textContent='Saving decision...';
        try {
          const {error}=decision==='resolved'
            ?await client.rpc('resolve_listing_report',{p_report_id:report.report_id,p_resolution:feedback.value.trim()})
            :await client.rpc('review_listing',{p_listing_id:item.id,p_revision:item.review_revision,p_decision:decision,p_feedback:decision==='rejected'?feedback.value.trim():null});
          if(error)throw error;
          await load(); notice(decision==='approved'?'Listing approved. Active listings are now visible to buyers.':decision==='rejected'?'Listing rejected and hidden from buyers. The seller can see your reason.':'Report resolved.');
        }catch(error){inline.textContent=error.message||'Decision could not be saved. Refresh and try again.';}
        finally{lock(false);}
      }); actions.append(button);
    }
    if(!report){action('Approve Listing','approved',true);action('Reject Listing','rejected');}
    else {
      if(['active','paused'].includes(item.status)&&['pending','approved'].includes(item.moderation_status)&&!item.is_test)action('Reject and Hide Listing','rejected');
      action('Resolve Report','resolved',true);
    }
    form.append(actions,inline); form.addEventListener('submit',e=>e.preventDefault()); card.append(form); return card;
  }
  function render() {
    list.replaceChildren(); const isReports=view.value==='reports'; const items=isReports?reports:listings;
    if(!items.length){list.append(el('div',isReports?'No open reports.':'No listings awaiting review.','review-empty'));return;}
    items.forEach(item=>list.append(cardFor(isReports?item.listing:item,isReports?item:null)));
  }
  async function load() {
    const version = sessionVersion;
    lock(true); document.getElementById('review-retry').hidden=true; notice('Loading review workspace...');
    try {
      const {data:{user},error:authError}=await client.auth.getUser();
      if(version!==sessionVersion)return;
      if(authError||!user){workspace.hidden=true;list.replaceChildren();document.getElementById('review-sign-in').hidden=false;notice('Sign in with your approved reviewer account.');return;}
      const {data:allowed,error:roleError}=await client.rpc('is_listing_reviewer');
      if(roleError)throw new Error('The review service is unavailable. Please try again later.');
      if(!allowed){workspace.hidden=true;list.replaceChildren();notice('This account does not have reviewer access.',true);return;}
      const [pending,open]=await Promise.all([client.rpc('review_queue'),client.rpc('review_reports')]);
      if(version!==sessionVersion)return;
      if(pending.error||open.error)throw pending.error||open.error;
      listings=pending.data||[];reports=open.data||[];workspace.hidden=false;document.getElementById('review-sign-in').hidden=true;render();
      notice(`${listings.length} awaiting review · ${reports.length} open reports. Up to 100 oldest items per queue; refresh after decisions.`);
    } catch(error){workspace.hidden=true;list.replaceChildren();notice(error.message||'Unable to load reviews.',true);document.getElementById('review-retry').hidden=false;throw error;}
    finally{lock(false);}
  }
  document.getElementById('review-retry').addEventListener('click',()=>load().catch(()=>{}));
  view.addEventListener('change',render);refresh.addEventListener('click',()=>load().catch(()=>{}));
  client.auth.onAuthStateChange?.((event)=>{if(event==='SIGNED_OUT'){sessionVersion++;workspace.hidden=true;list.replaceChildren();notice('You have signed out.');document.getElementById('review-sign-in').hidden=false;}});
  load().catch(()=>{});
})();
