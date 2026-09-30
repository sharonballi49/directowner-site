(() => {
  let sessionVersion = 0;
  const client=window.supabase.createClient(window.DIRECTOWNER_SUPABASE_URL,window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY);
  const message=document.getElementById('dashboard-message'),list=document.getElementById('listing-list');
  const reviewerLink=document.getElementById('review-dashboard-link');
  const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!=null)n.textContent=text;if(cls)n.className=cls;return n;};
  function notice(text,error=false){message.textContent=text;message.className='dashboard-message'+(error?' error':'');}
  function label(item){
    if(item.is_test)return 'Test listing — private';
    if(['sold','draft','pending_payment'].includes(item.status))return {sold:'Sold',draft:'Draft',pending_payment:'Awaiting payment'}[item.status];
    if(item.moderation_status==='pending')return 'Awaiting review — hidden';
    if(item.moderation_status==='rejected')return 'Changes needed — hidden';
    if(item.status==='paused')return 'Paused';
    return item.moderation_status==='approved'?'Published':'Not published';
  }
  function makeCard(item){
    const card=el('article',null,'listing-card-dashboard'),top=el('div',null,'listing-card-top'),details=el('div');
    details.append(el('h2',item.title),el('p',`$${(item.price_cents/100).toLocaleString('en-US')} · ${item.plan} plan · ${(item.photo_paths||[]).length} photos`,'listing-meta'));
    top.append(details,el('span',label(item),'status-badge'));card.append(top);
    if(item.review_feedback)card.append(el('p',`Reviewer feedback: ${item.review_feedback}`,'dashboard-message'));
    if(item.moderation_status==='pending')card.append(el('p','Your listing is hidden while our team reviews it. Changing details or photos requires a new review.','listing-action-note'));
    if(item.moderation_status==='rejected')card.append(el('p','Edit the listing to address the feedback. Saved changes submit it for another review. For payment questions, contact support@getdirectowner.com.','listing-action-note'));
    const actions=el('div',null,'listing-actions listing-card-bottom');
    function link(text,path){const a=el('a',text,'btn btn-secondary');a.href=path;actions.append(a);}
    function button(text,fn){const b=el('button',text,'btn btn-secondary');b.type='button';b.addEventListener('click',()=>fn(b));actions.append(b);}
    if(['draft','pending_payment','active','paused'].includes(item.status))link('Edit Listing',`edit-listing.html?id=${encodeURIComponent(item.id)}`);
    if(['draft','pending_payment'].includes(item.status))link('Choose Plan & Submit',`choose-plan.html?id=${encodeURIComponent(item.id)}`);
    if(item.status==='active')button('Pause Listing',b=>change(item,'pause',b));
    if(item.status==='paused')button('Resume Listing',b=>change(item,'resume',b));
    if(['active','paused'].includes(item.status))button('Mark Sold',b=>change(item,'sold',b));
    if(item.status==='active'&&item.moderation_status==='approved'&&!item.is_test)link('View Public Listing',`active-listing.html?id=${encodeURIComponent(item.id)}`);
    if(item.status==='draft')button('Delete Draft',async b=>{
      if(!window.confirm(`Delete the draft “${item.title}”? This cannot be undone.`))return;
      b.disabled=true;
      try{const {error}=await client.from('listings').delete().eq('id',item.id).eq('status','draft');if(error)throw error;await load();}
      catch(error){notice(error.message||'Unable to delete draft.',true);b.disabled=false;}
    });
    card.append(actions);return card;
  }
  async function change(item,action,button){
    const prompts={pause:'Pause this listing? It will be hidden from buyers.',resume:'Resume this listing? It will be visible only if approved.',sold:'Mark this vehicle as sold? It will be removed from public listings.'};
    if(!window.confirm(prompts[action]))return;button.disabled=true;
    try{const {error}=await client.rpc({pause:'pause_listing',resume:'resume_listing',sold:'mark_listing_sold'}[action],{p_listing_id:item.id});if(error)throw error;await load();}
    catch(error){notice(error.message||'Unable to update listing.',true);button.disabled=false;}
  }
  async function load(){
    const version = sessionVersion;
    reviewerLink.hidden=true;
    const {data:{user},error}=await client.auth.getUser();
    if(version!==sessionVersion)return;
    if(error||!user){list.replaceChildren();notice('Please sign in to manage your listings.',true);const a=el('a','Sign In','btn btn-primary');a.href='auth.html?mode=login';list.append(a);return;}
    document.getElementById('account-line').textContent=`Signed in as ${user.email}`;
    const [own,role]=await Promise.all([
      client.from('listings').select('id,title,price_cents,plan,status,photo_paths,created_at,is_test,moderation_status,review_feedback').eq('owner_id',user.id).order('created_at',{ascending:false}),
      client.rpc('is_listing_reviewer')
    ]);
    if(version!==sessionVersion)return;
    if(own.error)throw own.error;
    reviewerLink.hidden=!!role.error||role.data!==true;
    list.replaceChildren();
    if(!own.data.length){notice('No listings yet. Create your first vehicle draft to get started.');return;}
    own.data.forEach(item=>list.append(makeCard(item)));notice(`${own.data.length} listing${own.data.length===1?'':'s'} in your account. Content review is required before publication.`);
  }
  client.auth.onAuthStateChange?.((event)=>{if(event==='SIGNED_OUT'){sessionVersion++;reviewerLink.hidden=true;list.replaceChildren();document.getElementById('account-line').textContent='';notice('You have signed out.');}});
  document.getElementById('sign-out').addEventListener('click',async()=>{const {error}=await client.auth.signOut();if(error){notice(error.message,true);return;}location.href='auth.html';});
  load().catch(error=>notice(error.message||'Unable to load listings. Please try again.',true));
})();
