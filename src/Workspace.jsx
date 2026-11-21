import React, { useEffect, useMemo, useState } from 'react';
import { Building2, Users, Send, CalendarClock, BarChart3, Settings, Plus, Upload, Download, Search, Linkedin, Mail, Globe2, CheckCircle2, Clock3, Sparkles, Copy, X, ShieldCheck, ArrowRight, Menu, Zap } from 'lucide-react';
import * as XLSX from 'xlsx';
import { UserButton } from '@clerk/react';

const EMPTY = {companies:[],contacts:[],messages:[],events:[],profile:null};
const NAV = [{id:'overview',label:'Overview',icon:Building2},{id:'companies',label:'Companies',icon:Building2},{id:'contacts',label:'Contacts',icon:Users},{id:'outreach',label:'Message studio',icon:Send},{id:'queue',label:'Daily queue',icon:CalendarClock},{id:'analytics',label:'Analytics',icon:BarChart3},{id:'profile',label:'My profile',icon:Settings}];
const today = () => new Date().toISOString().slice(0,10);
function scoreContact(c, company) {
 let n=0;
 if(c.first_name)n+=10; if(c.last_name)n+=5; if(c.role)n+=15; if(c.linkedin_url)n+=20;
 if(c.email)n+=15; if(c.email && c.email_verified)n+=15; if(company?.website)n+=10; if(company?.description)n+=10;
 return Math.min(100,n);
}
export function Workspace({supabase,user,getToken}) {
 const [data,setData]=useState(EMPTY),[page,setPage]=useState('overview'),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [search,setSearch]=useState(''),[modal,setModal]=useState(''),[form,setForm]=useState({}),[toast,setToast]=useState(''),[mobile,setMobile]=useState(false);
 const [selected,setSelected]=useState(''),[context,setContext]=useState(''),[channel,setChannel]=useState('LinkedIn'),[variant,setVariant]=useState('A'),[draft,setDraft]=useState(null),[busy,setBusy]=useState(false);
 const notify=m=>{setToast(m);window.setTimeout(()=>setToast(''),3000);};
 const refresh=async()=>{
  setLoading(true);setError('');
  const names=['companies','contacts','outreach_messages','outreach_events','sender_profiles'];
  const results=await Promise.all(names.map(t=>supabase.from(t).select('*').order(t==='outreach_events'?'occurred_at':'created_at',{ascending:false}).limit(1000)));
  const failed=results.find(r=>r.error);
  if(failed){setError(failed.error.message);setLoading(false);return;}
  setData({companies:results[0].data||[],contacts:results[1].data||[],messages:results[2].data||[],events:results[3].data||[],profile:results[4].data?.[0]||null});
  setLoading(false);
 };
 useEffect(()=>{if(supabase&&user?.id)refresh();},[user?.id]);
 const companyFor=id=>data.companies.find(c=>c.id===id);
 const contactFor=id=>data.contacts.find(c=>c.id===id);
 const save=async(table,row)=>{
  const options=table==='sender_profiles'?{onConflict:'owner_id'}:undefined;
  const {data:saved,error:e}=await supabase.from(table).upsert(row,options).select().single();
  if(e){notify(e.message);return null;}
  const key={companies:'companies',contacts:'contacts',outreach_messages:'messages',outreach_events:'events',sender_profiles:'profile'}[table];
  setData(p=>key==='profile'?{...p,profile:saved}:{...p,[key]:[saved,...p[key].filter(x=>x.id!==saved.id)]});
  return saved;
 };
 const addCompany=async e=>{e.preventDefault();if(!form.name?.trim())return;const r=await save('companies',{...form,name:form.name.trim(),owner_id:user.id});if(r){setModal('');setForm({});notify('Company saved');}};
 const addContact=async e=>{
  e.preventDefault();if(!form.first_name||!form.company_id)return;
  const company=companyFor(form.company_id);
  const row={...form,owner_id:user.id,quality_score:scoreContact(form,company)};
  const r=await save('contacts',row);if(r){setModal('');setForm({});notify('Contact saved');}
 };
 const importFile=e=>{
  const file=e.target.files?.[0];if(!file)return;
  const reader=new FileReader();
  reader.onload=async ev=>{
   const wb=XLSX.read(ev.target.result,{type:'array'});const rows=XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]],{defval:''});
   let n=0;
   for(const r of rows){
    const name=r.Company||r['Company Name']||r.Name;if(!name)continue;
    const website=r['Company Website']||r.Website||'';
    const duplicate=data.companies.find(c=>(website&&c.website?.toLowerCase()===String(website).toLowerCase())||c.name.toLowerCase()===String(name).toLowerCase());
    const row={owner_id:user.id,name,website,country:r.Region||r.Country||'',contact_email:r['Support / Contact Email']||r.Email||'',careers_url:r['Hiring / Careers Page']||'',linkedin_url:r['Company LinkedIn']||'',outreach_angle:r['Best Outreach Angle']||'',notes:r.Notes||''};
    if(duplicate)await save('companies',{...duplicate,...row});else await save('companies',row);
    n++;
   }
   notify('Imported or updated '+n+' companies');
  };
  reader.readAsArrayBuffer(file);e.target.value='';
 };
 const exportFile=()=>{
  const wb=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.companies),'Companies');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.contacts),'Contacts');
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(data.messages),'Messages');
  XLSX.writeFile(wb,'founderflow-export.xlsx');
 };
 const recordEvent=async(contact,event_type,extra={})=>{
  if(!contact)return;
  const company=companyFor(contact.company_id);
  const r=await save('outreach_events',{owner_id:user.id,contact_id:contact.id,company_id:company?.id||null,event_type,channel:extra.channel||null,variant:extra.variant||null,message_id:extra.message_id||null,notes:extra.notes||null});
  if(r){
   const status=event_type==='sent'?'contacted':event_type==='replied'?'replied':event_type==='meeting'?'meeting_booked':contact.status;
   await save('contacts',{...contact,status,next_follow_up_at:extra.followup||contact.next_follow_up_at});
   notify(event_type==='sent'?'Marked as sent':event_type==='replied'?'Reply recorded':event_type==='meeting'?'Meeting recorded':'Activity saved');
  }
 };
 const generate=async()=>{
  const person=contactFor(selected),company=companyFor(person?.company_id);
  if(!person||!company){notify('Add a company and contact first');return;}
  if(channel==='Email'&&person.email&&!person.email_verified){notify('Email is unverified. Verify it before using email outreach.');return;}
  if(channel==='Email'&&!person.email){notify('Add an email address first');return;}
  if(context.trim().length<20){notify('Add a specific product detail, news item, job opening or reason to connect');return;}
  setBusy(true);setDraft(null);
  try{
   const token=await getToken();
   const response=await fetch('/api/generate-message',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({contact:person,company,context,channel,profile:data.profile})});
   const result=await response.json();if(!response.ok)throw new Error(result.error||'Could not generate message');
   setDraft(result);
   const saved=await save('outreach_messages',{owner_id:user.id,contact_id:person.id,company_id:company.id,channel,variant,subject:result.subject||null,body:result.message,relevance_score:result.score,improvement:result.improvement||'',research_context:context,status:'draft'});
   if(saved)notify('Draft '+variant+' saved');
  }catch(e){notify(e.message);}finally{setBusy(false);}
 };
 const markSent=async()=>{
  const person=contactFor(selected);if(!draft||!person)return;
  if(channel==='Email'&&!person.email_verified){notify('Email is unverified. Sending is blocked.');return;}
  const message=data.messages.find(m=>m.contact_id===person.id&&m.variant===variant&&m.body===draft.message);
  await recordEvent(person,'sent',{channel,variant,message_id:message?.id||null,followup:new Date(Date.now()+4*86400000).toISOString()});
 };
 const copyDraft=async()=>{if(!draft)return;navigator.clipboard?.writeText((draft.subject?'Subject: '+draft.subject+'\n\n':'')+draft.message);notify('Message copied');};
 const companyFiltered=data.companies.filter(c=>(c.name+' '+(c.website||'')+' '+(c.country||'')+' '+(c.sector||'')).toLowerCase().includes(search.toLowerCase()));
 const queue=useMemo(()=>{
  return [...data.contacts].map(c=>({...c,_company:companyFor(c.company_id)})).sort((a,b)=>{
   const dueA=a.next_follow_up_at?new Date(a.next_follow_up_at).getTime():0;
   const dueB=b.next_follow_up_at?new Date(b.next_follow_up_at).getTime():0;
   const overdueA=dueA&&dueA<Date.now()?1:0,overdueB=dueB&&dueB<Date.now()?1:0;
   return (overdueB-overdueA)||((b.warm_contact?1:0)-(a.warm_contact?1:0))||((b.priority||3)-(a.priority||3))||(dueA-dueB);
  }).slice(0,20);
 },[data.contacts,data.companies]);
 const sent=data.events.filter(e=>e.event_type==='sent').length;
 const replies=data.events.filter(e=>e.event_type==='replied').length;
 const meetings=data.events.filter(e=>e.event_type==='meeting').length;
 const pageTitle=NAV.find(n=>n.id===page)?.label||'Overview';
 const companyFormFields=[['name','Company name'],['website','Website'],['country','Country / region'],['sector','Industry / sector'],['product_type','Product type'],['description','Company description'],['careers_url','Careers page'],['contact_url','Contact page'],['linkedin_url','Company LinkedIn'],['contact_email','Contact email'],['recent_news','Recent news / product update'],['outreach_angle','Best outreach angle'],['priority','Priority (1–5)']];
 const contactFormFields=[['first_name','First name'],['last_name','Last name'],['role','Role / title'],['role_category','Role category'],['linkedin_url','LinkedIn profile URL'],['email','Email'],['phone','Phone'],['priority','Priority (1–5)'],['next_follow_up_at','Next follow-up date'],['notes','Notes']];
 return <div className="app-layout">
  <aside className={'sidebar '+(mobile?'show':'')}>
   <div className="side-brand"><div className="logo-mark">F</div><span>founderflow<small>RELATIONSHIP OS</small></span><button className="mobile-close" onClick={()=>setMobile(false)}><X/></button></div>
   <div className="side-label">WORKSPACE</div><nav>{NAV.map(item=><button key={item.id} className={page===item.id?'nav-active':''} onClick={()=>{setPage(item.id);setMobile(false)}}><item.icon size={17}/>{item.label}{item.id==='queue'&&<b className="nav-count">{queue.length}</b>}</button>)}</nav>
   <div className="sidebar-bottom"><div className="secure-pill"><ShieldCheck size={15}/> Your workspace is private</div><div className="user-meta"><div><b>{user?.fullName||user?.firstName||'Your workspace'}</b><small>{user?.primaryEmailAddress?.emailAddress}</small></div><UserButton/></div></div>
  </aside>
  <main className="main-area">
   <header className="topbar"><button className="mobile-menu" onClick={()=>setMobile(true)}><Menu/></button><div className="crumb">Workspace <span>/</span> {pageTitle}</div><div className="top-actions"><span className="live-dot">Cloud workspace</span></div></header>
   <div className="page-wrap">
    {error&&<div className="research-warning">Workspace sync issue: {error}</div>}
    {page==='overview'&&<>
     <div className="page-heading"><div><div className="eyebrow">YOUR NEXT MOVE STARTS HERE</div><h1>Build relationships.<br/><em>Open doors.</em></h1><p>Your founder outreach command center. Turn thoughtful research into conversations that matter.</p></div><button className="btn btn-dark" onClick={()=>setPage('queue')}>Open today’s queue <ArrowRight size={16}/></button></div>
     <div className="stats-grid">{[['Target companies',data.companies.length,Building2],['People to reach',data.contacts.length,Users],['Messages sent',sent,Send],['Replies',replies,CheckCircle2]].map(([label,value,Icon])=><div className="stat-card" key={label}><div className="stat-top"><span>{label}</span><Icon size={17}/></div><strong>{value}</strong><small>{label==='Messages sent'?'Manually logged outreach':label==='Replies'?'Conversations started':'In your private workspace'}</small></div>)}</div>
     <div className="content-grid"><section className="surface"><div className="section-head"><div><span className="eyebrow">YOUR PIPELINE</span><h2>Relationship snapshot</h2></div><button className="subtle-link" onClick={()=>setPage('companies')}>All companies <ArrowRight size={14}/></button></div>{['researching','ready','contacted','replied','meeting_booked'].map((s,i)=><div className="pipeline-step" key={s}><span className="step-mark">{i+1}</span><div><b>{['Researching','Ready to contact','Contacted','Replied','Meeting booked'][i]}</b><small>{i<2?data.companies.filter(c=>c.status===s).length:data.contacts.filter(c=>c.status===s).length} records</small></div><ArrowRight size={15}/></div>)}</section><section className="surface next-card"><span className="eyebrow">TODAY’S FOCUS</span><div className="sparkle-icon"><Sparkles size={21}/></div><h2>{queue.length} contacts<br/>in your priority queue.</h2><p>Warm contacts, higher-priority people and due follow-ups appear first.</p><button className="btn btn-light" onClick={()=>setPage('queue')}>Open daily queue <ArrowRight size={15}/></button></section></div>
    </>}
    {page==='companies'&&<>
     <div className="page-title-row"><div><span className="eyebrow">YOUR TARGET UNIVERSE</span><h1>Companies</h1><p>Store company research and the reasons you want to connect.</p></div><div className="action-row"><label className="btn btn-light"><Upload size={15}/> Import Excel<input hidden type="file" accept=".xlsx,.xls,.csv" onChange={importFile}/></label><button className="btn btn-dark" onClick={()=>{setForm({priority:3});setModal('company')}}><Plus size={16}/> Add company</button></div></div>
     <div className="surface"><div className="table-toolbar"><div className="searchbox"><Search size={16}/><input placeholder="Search companies…" value={search} onChange={e=>setSearch(e.target.value)}/></div><button className="subtle-link" onClick={exportFile}><Download size={15}/> Export</button></div><div className="company-table">{companyFiltered.map(c=><div className="company-row" key={c.id}><div className="company-symbol">{(c.name||'?').slice(0,1).toUpperCase()}</div><div className="company-name"><b>{c.name}</b><small>{c.website||c.country||'Add company details'}</small></div><div className="company-type">{c.sector||'Sector not set'}</div><div className="company-contact">Priority {c.priority||3}</div><div className="company-links">{c.website&&<a href={c.website.startsWith('http')?c.website:'https://'+c.website} target="_blank" rel="noreferrer"><Globe2 size={15}/></a>}{c.linkedin_url&&<a href={c.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={15}/></a>}</div></div>)}{!companyFiltered.length&&<div className="empty-state"><Building2 size={25}/><b>No companies yet</b><span>Import your existing list or add your first target company.</span></div>}</div></div>
    </>}
    {page==='contacts'&&<>
     <div className="page-title-row"><div><span className="eyebrow">PEOPLE BEFORE PIPELINES</span><h1>Contacts</h1><p>Founders, CEOs, CTOs, product leaders and hiring decision makers.</p></div><button className="btn btn-dark" onClick={()=>{setForm({priority:3});setModal('contact')}}><Plus size={16}/> Add contact</button></div>
     <div className="surface"><div className="company-table">{data.contacts.map(c=>{const company=companyFor(c.company_id),quality=scoreContact(c,company);return <div className="company-row" key={c.id}><div className="company-symbol"><Users size={17}/></div><div className="company-name"><b>{c.first_name} {c.last_name||''}</b><small>{c.role||'Role not set'} · {company?.name||'Company'}</small></div><div className="company-type">Quality {quality}/100</div><div className="company-contact">{c.email_verified?'Email verified':c.email?'Email unverified':'No email'}</div><div className="company-links">{c.linkedin_url&&<a href={c.linkedin_url} target="_blank" rel="noreferrer"><Linkedin size={15}/></a>}{c.email&&<a href={'mailto:'+c.email}><Mail size={15}/></a>}</div></div>;})}{!data.contacts.length&&<div className="empty-state"><Users size={25}/><b>Your network starts here</b><span>Add founders and decision makers to your target companies.</span></div>}</div></div>
    </>}
    {page==='outreach'&&<>
     <div className="page-title-row"><div><span className="eyebrow">RELEVANCE IS YOUR ADVANTAGE</span><h1>Message studio</h1><p>Use real research to create and save message variants.</p></div></div>
     <div className="studio-grid"><section className="surface studio-form"><div className="studio-step"><span>01</span><div><b>Who are you reaching?</b><small>Select a contact and channel.</small></div></div>
      <label className="form-field">Contact<select value={selected} onChange={e=>{setSelected(e.target.value);setDraft(null);}}><option value="">Select a contact</option>{data.contacts.map(c=><option key={c.id} value={c.id}>{c.first_name} {c.last_name||''} · {companyFor(c.company_id)?.name||''}</option>)}</select></label>
      <label className="form-field">Channel<select value={channel} onChange={e=>setChannel(e.target.value)}><option>LinkedIn</option><option>Email</option></select></label>
      <label className="form-field">Message variant<select value={variant} onChange={e=>setVariant(e.target.value)}><option value="A">Variant A</option><option value="B">Variant B</option><option value="C">Variant C</option></select></label>
      <div className="studio-step"><span>02</span><div><b>Bring one specific detail</b><small>Never ask AI to invent company facts.</small></div></div>
      <label className="form-field">Product detail, recent news, job opening, feature or post<textarea rows="6" placeholder="Paste a real product detail, recent launch, role description or contact post…" value={context} onChange={e=>setContext(e.target.value)}/></label>
      {channel==='Email'&&selected&&<div className="research-warning">{contactFor(selected)?.email_verified?'Verified email available.':'Email is blocked until the contact email is verified.'}</div>}
      <button className="btn btn-dark full-btn" disabled={busy} onClick={generate}><Sparkles size={16}/>{busy?'Writing your message…':'Generate and save variant '+variant}</button>
     </section><section className="surface draft-panel"><span className="eyebrow">YOUR DRAFT</span>{draft?<><div className="score-line"><b>Relevance score</b><strong>{draft.score}/10</strong></div>{draft.score<7&&<div className="research-warning">Needs more research — add stronger company or contact context.</div>}{draft.subject&&<div className="draft-subject"><small>SUBJECT</small>{draft.subject}</div>}<div className="draft-copy">{draft.message}</div>{draft.improvement&&<p className="improvement"><b>Improve:</b> {draft.improvement}</p>}<div className="action-row"><button className="btn btn-light" onClick={copyDraft}><Copy size={15}/> Copy</button><button className="btn btn-dark" onClick={markSent}>I sent this manually <CheckCircle2 size={15}/></button></div></>:<div className="empty-state"><Sparkles size={26}/><b>A message worth replying to.</b><span>Your tailored draft and relevance score will appear here.</span></div>}</section></div>
     <div className="surface" style={{marginTop:14}}><span className="eyebrow">SAVED VARIANTS</span>{data.messages.filter(m=>m.contact_id===selected).map(m=><div className="company-row" key={m.id}><div className="company-symbol">{m.variant}</div><div className="company-name"><b>{m.channel} · Variant {m.variant} · Score {m.relevance_score||'—'}/10</b><small>{m.body}</small></div><span className="badge-lite">{m.status}</span></div>)}{!data.messages.some(m=>m.contact_id===selected)&&<p className="improvement">Saved message variants for the selected contact will appear here.</p>}</div>
    </>}
    {page==='queue'&&<>
     <div className="page-title-row"><div><span className="eyebrow">A LITTLE PROGRESS, EVERY DAY</span><h1>Daily queue</h1><p>Your 20 highest-priority contacts, sorted by follow-up urgency and warmth.</p></div><span className="queue-badge"><Zap size={15}/> {queue.length} / 20</span></div>
     <div className="surface">{queue.map(c=><div className="company-row" key={c.id}><div className="company-symbol">{c.first_name?.slice(0,1)||'?'}</div><div className="company-name"><b>{c.first_name} {c.last_name||''} · {c._company?.name||'Company'}</b><small>{c.role||'Decision maker'} · {c.next_follow_up_at?'Follow up '+new Date(c.next_follow_up_at).toLocaleDateString():'No follow-up scheduled'} · Priority {c.priority||3}</small></div><div className="company-links"><button className="subtle-link" onClick={()=>{setSelected(c.id);setPage('outreach')}}>Prepare message <ArrowRight size={14}/></button><button className="subtle-link" onClick={()=>recordEvent(c,'replied')}>Log reply</button><button className="subtle-link" onClick={()=>recordEvent(c,'meeting')}>Meeting booked</button></div></div>)}{!queue.length&&<div className="empty-state"><CalendarClock size={26}/><b>Your queue is empty</b><span>Add contacts and set priority or follow-up dates to build your daily list.</span><button className="btn btn-dark" onClick={()=>setPage('contacts')}>Add contacts</button></div>}</div>
    </>}
    {page==='analytics'&&<>
     <div className="page-title-row"><div><span className="eyebrow">LEARN WHAT OPENS DOORS</span><h1>Analytics</h1><p>Track real outcomes logged from your manual outreach.</p></div></div>
     <div className="stats-grid">{[['Sent',sent],['Replies',replies],['Meetings',meetings],['Reply rate',sent?Math.round(replies/sent*100)+'%':'—']].map(([l,v])=><div className="stat-card" key={l}><div className="stat-top">{l}</div><strong>{v}</strong></div>)}</div>
     <div className="surface"><span className="eyebrow">PERFORMANCE BY MESSAGE VARIANT</span>{['A','B','C'].map(v=>{const s=data.events.filter(e=>e.event_type==='sent'&&e.variant===v).length,r=data.events.filter(e=>e.event_type==='replied'&&e.variant===v).length;return <div className="company-row" key={v}><div className="company-symbol">{v}</div><div className="company-name"><b>Variant {v}</b><small>{s} sent · {r} replies</small></div><strong>{s?Math.round(r/s*100)+'%':'—'}</strong></div>;})}</div>
    </>}
    {page==='profile'&&<ProfileEditor profile={data.profile} user={user} save={save} notify={notify}/>}
    {loading&&<div className="loading-line">Syncing your private workspace…</div>}
   </div>
   <footer>FOUNDERFLOW <span>Built for thoughtful outreach · Your data stays yours</span></footer>
  </main>
  {modal&&<div className="modal-backdrop" onClick={()=>setModal('')}><form className="modal-card" onSubmit={modal==='company'?addCompany:addContact} onClick={e=>e.stopPropagation()}><div className="modal-title"><h2>{modal==='company'?'Add a company':'Add a decision maker'}</h2><button type="button" onClick={()=>setModal('')}><X size={18}/></button></div>
   {modal==='contact'&&<label className="form-field">Company<select required value={form.company_id||''} onChange={e=>setForm(p=>({...p,company_id:e.target.value}))}><option value="">Select company</option>{data.companies.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</select></label>}
   {(modal==='company'?companyFormFields:contactFormFields).map(([k,l])=><label className="form-field" key={k}>{l}{k==='next_follow_up_at'?<input type="date" value={form[k]?.slice(0,10)||''} onChange={e=>setForm(p=>({...p,[k]:e.target.value?new Date(e.target.value).toISOString():null}))}/>:k==='description'||k==='recent_news'||k==='outreach_angle'||k==='notes'?<textarea rows={2} value={form[k]||''} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}/>:k==='priority'?<select value={form[k]||3} onChange={e=>setForm(p=>({...p,[k]:Number(e.target.value)}))}>{[1,2,3,4,5].map(n=><option key={n} value={n}>{n}</option>)}</select>:<input required={k==='name'||k==='first_name'} value={form[k]||''} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}/>}</label>)}
   {modal==='contact'&&<label className="form-field"><input type="checkbox" checked={Boolean(form.warm_contact)} onChange={e=>setForm(p=>({...p,warm_contact:e.target.checked}))}/> Warm contact</label>}
   {modal==='contact'&&<label className="form-field"><input type="checkbox" checked={Boolean(form.email_verified)} onChange={e=>setForm(p=>({...p,email_verified:e.target.checked}))}/> I have verified this email address</label>}
   <button className="btn btn-dark" type="submit">Save to workspace <ArrowRight size={15}/></button>
  </form></div>}
  {toast&&<div className="toast">{toast}</div>}
 </div>;
}
function ProfileEditor({profile,user,save,notify}){
 const [form,setForm]=useState(profile||{});
 useEffect(()=>setForm(profile||{}),[profile]);
 const fields=[['headline','Your role / professional headline'],['services','What services or expertise do you offer?'],['experience','Experience and proof points'],['audience','Who do you want to reach?'],['industries','Target industries'],['value_proposition','What makes your work valuable?'],['tone','Preferred tone'],['cta','Preferred call to action']];
 return <><div className="page-title-row"><div><span className="eyebrow">YOUR VOICE, YOUR VALUE</span><h1>My outreach profile</h1><p>Configure the sender identity AI should use. Nothing is hard-coded.</p></div></div><div className="surface profile-form">{fields.map(([k,l])=><label className="form-field" key={k}>{l}<textarea rows={k==='services'||k==='experience'?3:2} value={form[k]||''} onChange={e=>setForm(p=>({...p,[k]:e.target.value}))}/></label>)}<button className="btn btn-dark" onClick={async()=>{const r=await save('sender_profiles',{...form,owner_id:user.id});if(r)notify('Profile saved');}}>Save my profile <ArrowRight size={15}/></button></div></>;
}
