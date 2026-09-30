(() => {
  let sessionVersion = 0;
  const client=window.supabase.createClient(window.DIRECTOWNER_SUPABASE_URL,window.DIRECTOWNER_SUPABASE_PUBLISHABLE_KEY);
  const id=new URLSearchParams(location.search).get('id');
  const form=document.getElementById('report-form'),message=document.getElementById('report-message'),button=document.getElementById('report-submit');
  function notice(text,error=false){message.textContent=text;message.classList.toggle('error',error);}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(button.disabled)return;button.disabled=true;notice('Sending your report...');
    try{
      const {data,error}=await client.rpc('report_listing',{p_listing_id:id,p_reason:document.getElementById('report-reason').value,p_details:document.getElementById('report-details').value.trim()});
      if(error)throw error;
      form.hidden=true;notice(`Report received. Your reference is ${data}. Thank you for helping our team review this listing.`);
    }catch(error){notice(error.message||'Report could not be sent. Please try again.',true);button.disabled=false;}
  });
  async function load(){
    const version = sessionVersion;
    if(!id||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)){notice('Open this page using Report This Listing on a vehicle page.',true);document.getElementById('report-title').textContent='No listing selected';return;}
    const back=document.getElementById('report-back');back.href=`active-listing.html?id=${encodeURIComponent(id)}`;back.textContent='Back to vehicle';
    const {data:{user},error:authError}=await client.auth.getUser();
    if(version!==sessionVersion)return;
    if(authError && authError.name !== 'AuthSessionMissingError')throw new Error('We could not check your sign-in. Please try again.');
    if(!user){const link=document.getElementById('report-sign-in');link.href=`auth.html?mode=login&next=${encodeURIComponent('report-listing.html?id='+id)}`;link.hidden=false;document.getElementById('report-title').textContent='Sign in to send a private report.';notice('Signing in helps limit duplicate reports and misuse.');return;}
    const {data,error}=await client.from('listings').select('id,title,owner_id').eq('id',id).eq('status','active').eq('moderation_status','approved').eq('is_test',false).maybeSingle();
    if(version!==sessionVersion)return;
    if(error)throw new Error('We could not load this listing. Please try again.');
    if(!data||data.owner_id===user.id){document.getElementById('report-title').textContent='Listing unavailable for reporting';notice('The listing may no longer be public. You can manage your own listings from My Listings.',true);return;}
    document.getElementById('report-title').textContent=data.title;notice('Choose a reason and describe your concern.');form.hidden=false;
  }
  client.auth.onAuthStateChange?.((event)=>{if(event==='SIGNED_OUT'){sessionVersion++;form.hidden=true;notice('You have signed out. Sign in again to submit a report.');}});
  load().catch(error=>notice(error.message||'Unable to load reporting.',true));
})();
