(function () {
  'use strict';
  const fields = [
    {key:'owner_status', label:'Is your name on the title?', values:{yes:'Yes — my name is on the title',no:'No — my name is not on the title',unknown:'Unknown / not sure'}},
    {key:'title_status', label:'Title status', values:{clean:'Clean / no known title brand',salvage:'Salvage',rebuilt:'Rebuilt / reconstructed',bonded:'Bonded title',other:'Other title status',unknown:'Unknown / not sure'}},
    {key:'lien_status', label:'Outstanding loan or lien', values:{none_known:'No loan or lien known to me',yes:'A loan or lien is outstanding',unknown:'Unknown / not sure'}},
    {key:'damage_status', label:'Accident, flood, or other damage history', values:{known:'Known damage history',none_known:'No damage history known to me',unknown:'Unknown / not sure'}, details:'damage_details', detailsLabel:'Describe the known damage history'},
    {key:'mechanical_status', label:'Current mechanical or electrical issues', values:{known:'Known issues',none_known:'No issues known to me',unknown:'Unknown / not sure'}, details:'mechanical_details', detailsLabel:'Describe the known issues'},
    {key:'records_status', label:'Maintenance records available', values:{yes:'Records available',some:'Some records available',no:'No records available',unknown:'Unknown / not sure'}},
    {key:'inspection_status', label:'Independent inspection before purchase', values:{yes:'Open to an inspection arranged by the buyer',discuss:'Discuss arrangements with me first',no:'Not offering an independent inspection',unknown:'Not decided yet'}}
  ];
  const el=(tag,text,className)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(className)n.className=className;return n;};
  function labelFor(field,value){return Object.hasOwn(field.values,value)?field.values[value]:'Not provided';}
  function mount(container, data={}) {
    container.replaceChildren();
    const section=el('fieldset',undefined,'disclosure-form');section.append(el('legend','Seller disclosures'));
    section.append(el('p','These answers will be public. Answer from your own knowledge and choose “Unknown” when you are unsure. These are your statements, not verification by DirectOwner.','disclosure-help'));
    const grid=el('div',undefined,'disclosure-grid');
    for(const field of fields){
      const wrap=el('div',undefined,'disclosure-field');const select=el('select');select.id='disclosure-'+field.key;select.name=field.key;select.required=true;
      const label=el('label',field.label+' *');label.htmlFor=select.id;const blank=el('option','Choose an answer');blank.value='';select.append(blank);
      for(const [value,text] of Object.entries(field.values)){const option=el('option',text);option.value=value;select.append(option);}
      select.value=Object.hasOwn(field.values,data?.[field.key])?data[field.key]:'';wrap.append(label,select);
      if(field.details){
        const detailWrap=el('div',undefined,'disclosure-detail-field');const textarea=el('textarea');textarea.id='disclosure-'+field.details;textarea.name=field.details;textarea.minLength=10;textarea.maxLength=1000;textarea.rows=3;textarea.value=typeof data?.[field.details]==='string'?data[field.details]:'';
        const detailLabel=el('label',field.detailsLabel+' *');detailLabel.htmlFor=textarea.id;
        const help=el('p','Use 10–1,000 characters. Do not include addresses, account numbers, or private documents.','disclosure-help');help.id=textarea.id+'-help';textarea.setAttribute('aria-describedby',help.id);
        detailWrap.append(detailLabel,textarea,help);wrap.append(detailWrap);
        const update=()=>{const known=select.value==='known';detailWrap.hidden=!known;textarea.required=known;textarea.disabled=!known;};select.addEventListener('change',update);update();
      }
      grid.append(wrap);
    }
    section.append(grid,el('p','Disclose known issues even if repaired. Do not upload IDs, title documents, or loan statements. Changes to submitted answers require another content review.','disclosure-help'));container.append(section);
  }
  function collect(container){
    if(!container?.querySelector('.disclosure-form'))throw new Error('Seller disclosure questions are unavailable. Refresh before saving.');
    const result={};
    for(const field of fields){
      const select=container.querySelector('#disclosure-'+field.key);const value=select.value;
      if(!Object.hasOwn(field.values,value)){select.focus();throw new Error('Please answer: '+field.label);}
      result[field.key]=value;
      if(field.details){const input=container.querySelector('#disclosure-'+field.details);result[field.details]=value==='known'?input.value.trim():'';
        if(value==='known'&&(result[field.details].length<10||result[field.details].length>1000)){input.focus();throw new Error(field.detailsLabel+' using 10–1,000 characters.');}}
    }
    return result;
  }
  function render(data){
    const section=el('section',undefined,'disclosure-summary');section.append(el('h2','Seller disclosures'),el('p','Seller reported—not independently verified.','disclosure-label'),el('p','Confirm these answers with the owner, relevant documents, and an independent inspection before buying.','disclosure-help'));
    const list=el('dl',undefined,'disclosure-facts');
    for(const field of fields){const group=el('div');group.append(el('dt',field.label),el('dd',labelFor(field,data?.[field.key])));
      if(field.details&&data?.[field.key]==='known'&&typeof data[field.details]==='string'){const detail=el('dd',data[field.details],'disclosure-notes');group.append(detail);}list.append(group);}
    section.append(list);return section;
  }
  function summary(data,key){const field=fields.find(f=>f.key===key);return field?labelFor(field,data?.[key]):'Not provided';}
  window.DirectOwnerDisclosures={mount,collect,render,summary};
  document.querySelectorAll('[data-disclosure-form]').forEach(node=>mount(node));
})();
