import React, { useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import { createRoot } from 'react-dom/client';
import './styles.css';

const stages = ['Not contacted', 'LinkedIn sent', 'Email sent', 'Connected', 'Replied', 'Call booked', 'Follow-up', 'Won', 'Not a fit'];
const initial = { companies: [], contacts: [], activities: [] };
const clean = value => String(value ?? '').trim();
const yes = value => ['yes','y','true','1','sent','done'].includes(clean(value).toLowerCase());
const stageFromRow = row => yes(row['Call Booked']) ? 'Call booked' : yes(row.Replied) ? 'Replied' : yes(row['Email Sent']) ? 'Email sent' : yes(row['LinkedIn Sent']) ? 'LinkedIn sent' : 'Not contacted';
const normalizeCompany = company => ({
  ...company,
  status: !company.status || company.status === 'Researching' ? 'Not contacted' : company.status,
  country: company.country || company.region || '',
  primaryContact: company.primaryContact || '',
  primaryContactLink: company.primaryContactLink || '',
  secondaryContact: company.secondaryContact || '',
  secondaryContactLink: company.secondaryContactLink || ''
});
function readSaved() {
  try {
    const saved = JSON.parse(localStorage.getItem('founder-crm-data'));
    if (!saved) return initial;
    return { ...initial, ...saved, companies: (saved.companies || []).map(normalizeCompany) };
  } catch { return initial; }
}
function Field({label,name,placeholder='',type='text',form,setForm}) {
  return <label className="field">{label}<input type={type} placeholder={placeholder} value={form[name] ?? ''} onChange={e=>setForm(prev=>({...prev,[name]:e.target.value}))}/></label>;
}
function ExternalLink({href,children}) {
  if (!href) return <span className="muted">—</span>;
  const url = /^https?:\/\//i.test(href) ? href : 'https://' + href;
  return <a href={url} target="_blank" rel="noreferrer" onClick={e=>e.stopPropagation()}>{children || href} ↗</a>;
}
function App() {
  const [data, setData] = useState(readSaved);
  const [page, setPage] = useState('Dashboard');
  const [query, setQuery] = useState('');
  const [modal, setModal] = useState(false);
  const [form, setForm] = useState({});
  const [toast, setToast] = useState('');
  const [dragging, setDragging] = useState(null);
  const save = next => { setData(next); localStorage.setItem('founder-crm-data', JSON.stringify(next)); };
  const notify = msg => { setToast(msg); window.setTimeout(() => setToast(''), 2500); };
  const companies = useMemo(() => data.companies.filter(c => (c.name + ' ' + c.country + ' ' + c.primaryContact + ' ' + c.secondaryContact + ' ' + c.outreachAngle).toLowerCase().includes(query.toLowerCase())), [data.companies, query]);
  const count = status => data.companies.filter(c => c.status === status).length;
  const addCompany = e => {
    e.preventDefault();
    if (!clean(form.name)) return;
    const company = normalizeCompany({ ...form, id: Date.now(), status: 'Not contacted' });
    save({ ...data, companies: [...data.companies, company] });
    setModal(false); setForm({}); notify('Company added');
  };
  const updateStage = (id, status) => {
    save({ ...data, companies: data.companies.map(c => c.id === id ? { ...c, status } : c) });
  };
  const importCompanies = e => {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      try {
        const workbook = XLSX.read(event.target.result, { type: 'array' });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
        const key = s => clean(s).toLowerCase().replace(/[^a-z0-9]/g, '');
        const incoming = rows.map((row, i) => {
          const normalized = Object.fromEntries(Object.entries(row).map(([k,v]) => [key(k), clean(v)]));
          const get = (...names) => { for (const name of names) { const value = normalized[key(name)]; if (value) return value; } return ''; };
          const company = get('Company', 'Company Name', 'Name');
          if (!company) return null;
          return normalizeCompany({
            id: Date.now() + i, name: company, country: get('Region','Country'),
            website: get('Company Website','Website','URL'),
            email: get('Support / Contact Email','Contact Email','Email'),
            careers: get('Hiring / Careers Page','Careers Page'),
            linkedin: get('Company LinkedIn','LinkedIn'),
            primaryContact: get('Primary Contact'),
            primaryContactLink: get('Primary Contact Link'),
            secondaryContact: get('Secondary Contact'),
            secondaryContactLink: get('Secondary Contact Link'),
            outreachAngle: get('Best Outreach Angle','Outreach Angle'),
            linkedInSent: get('LinkedIn Sent'), emailSent: get('Email Sent'),
            replied: get('Replied'), callBooked: get('Call Booked'), notes: get('Notes'),
            status: stageFromRow({
              'LinkedIn Sent': get('LinkedIn Sent'), 'Email Sent': get('Email Sent'),
              'Call Booked': get('Call Booked'), Replied: get('Replied')
            })
          });
        }).filter(Boolean);
        const existing = new Set(data.companies.map(c => clean(c.website).toLowerCase() || clean(c.name).toLowerCase()));
        const fresh = incoming.filter(c => !existing.has(clean(c.website).toLowerCase() || clean(c.name).toLowerCase()));
        const merged = data.companies.map(c => {
          const match = incoming.find(n => clean(n.website).toLowerCase() && clean(n.website).toLowerCase() === clean(c.website).toLowerCase() || clean(n.name).toLowerCase() === clean(c.name).toLowerCase());
          return match ? normalizeCompany({ ...c, ...match, id: c.id }) : normalizeCompany(c);
        });
        save({ ...data, companies: [...merged, ...fresh] });
        notify(incoming.length + ' companies processed · ' + fresh.length + ' added · ' + (incoming.length - fresh.length) + ' updated/existing');
      } catch (err) { notify('Could not read this Excel file.'); }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };
  const exportCompanies = () => {
    const rows = data.companies.map(c => ({
      Company:c.name, Region:c.country, 'Company Website':c.website, 'Support / Contact Email':c.email,
      'Hiring / Careers Page':c.careers, 'Company LinkedIn':c.linkedin, 'Primary Contact':c.primaryContact,
      'Primary Contact Link':c.primaryContactLink, 'Secondary Contact':c.secondaryContact,
      'Secondary Contact Link':c.secondaryContactLink, 'Best Outreach Angle':c.outreachAngle,
      'LinkedIn Sent':c.linkedInSent, 'Email Sent':c.emailSent, Replied:c.replied,
      'Call Booked':c.callBooked, Status:c.status, Notes:c.notes
    }));
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, sheet, 'Companies');
    XLSX.writeFile(book, 'founderflow-companies.xlsx');
  };
  const nav = ['Dashboard','Companies','Pipeline'];
  return <div className="app">
    <aside className="sidebar">
      <div className="brand"><div className="brand-mark">F</div><div><b>FounderFlow</b><small>OUTREACH CRM</small></div></div>
      <div className="workspace">WORKSPACE <span>PERSONAL</span></div>
      <nav>{nav.map((n,i)=><button key={n} className={page===n?'active':''} onClick={()=>setPage(n)}><span className="nav-icon">{['◫','▦','⇄'][i]}</span>{n}</button>)}</nav>
      <div className="sidebar-bottom"><div className="avatar">ND</div><div><b>My workspace</b><small>Company outreach</small></div></div>
    </aside>
    <main className="main">
      <header><div><span className="eyebrow">YOUR OUTREACH WORKSPACE</span><h1>{page}</h1></div><div className="header-actions">{page==='Companies' && <button className="btn ghost" onClick={exportCompanies}>↓ Export Excel</button>}{page!=='Pipeline' && <button className="btn primary" onClick={()=>{setForm({});setModal(true)}}>＋ Add company</button>}</div></header>
      {page==='Dashboard' && <>
        <section className="welcome"><div><span className="eyebrow light">FOUNDER & LEADERSHIP OUTREACH</span><h2>Build meaningful<br/>founder relationships.</h2><p>Manage target companies and move each relationship through your outreach pipeline.</p></div><div className="welcome-art"><div className="orbit o1"></div><div className="orbit o2"></div><div className="orbit-core">✳</div><span className="orb-tag">CONNECT · BUILD · GROW</span></div></section>
        <section className="stats">{[['Target companies',data.companies.length,'Companies you selected'],['LinkedIn sent',count('LinkedIn sent'),'First touch on LinkedIn'],['Email sent',count('Email sent'),'Email outreach completed'],['Replies',count('Replied'),'Conversations started']].map(([label,value,sub])=><div className="stat" key={label}><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>)}</section>
        <section className="panel"><div className="panel-head"><div><h3>Company pipeline</h3><p>Move companies through each outreach step</p></div><button className="text-btn" onClick={()=>setPage('Pipeline')}>Open pipeline ↗</button></div><div className="pipeline-list">{stages.slice(0,6).map(s=><div className="pipeline-row" key={s}><span className="stage-dot"/><span>{s}</span><div className="bar"><i style={{width:(data.companies.length?count(s)/data.companies.length*100:0)+'%'}}/></div><b>{count(s)}</b></div>)}</div></section>
      </>}
      {page==='Companies' && <section className="panel"><div className="panel-head"><div><h3>Your selected companies</h3><p>Every company and its founder, CEO, hiring and leadership contacts are kept together here</p></div><div className="table-tools"><input className="search" placeholder="Search companies or people..." value={query} onChange={e=>setQuery(e.target.value)}/><label className="btn ghost upload">↑ Import Excel<input type="file" accept=".xlsx,.xls,.csv" onChange={importCompanies}/></label><span className="count-pill">{data.companies.length} companies</span></div></div>
        <div className="company-list">{companies.map(c=><article className="company-card" key={c.id}>
          <div className="company-top"><div><h3>{c.name}</h3><span className="company-region">{c.country || 'Region not set'}</span></div><select className="status-select" aria-label={'Outreach status for '+c.name} value={stages.includes(c.status)?c.status:'Not contacted'} onChange={e=>updateStage(c.id,e.target.value)}>{stages.map(s=><option key={s}>{s}</option>)}</select></div>
          <div className="company-links"><span>Website: <ExternalLink href={c.website} children={c.website || '—'}/></span><span>Company LinkedIn: <ExternalLink href={c.linkedin} children={c.linkedin ? 'Open company profile' : '—'}/></span><span>Careers: <ExternalLink href={c.careers} children={c.careers ? 'Hiring page' : '—'}/></span><span>Email: {c.email ? <a href={'mailto:'+c.email}>{c.email}</a> : <span className="muted">—</span>}</span></div>
          <div className="company-contacts"><div className="person-block"><b>Primary contact</b><span>{c.primaryContact || 'Not provided'}</span><ExternalLink href={c.primaryContactLink} children={c.primaryContactLink ? 'Open contact profile' : 'No profile link'}/></div><div className="person-block"><b>Secondary contact</b><span>{c.secondaryContact || 'Not provided'}</span><ExternalLink href={c.secondaryContactLink} children={c.secondaryContactLink ? 'Open contact profile' : 'No profile link'}/></div></div>
          <div className="company-bottom"><div><b>Outreach angle</b><span>{c.outreachAngle || '—'}</span></div><div><b>Outreach tracking</b><span>LinkedIn: {c.linkedInSent || 'No'} · Email: {c.emailSent || 'No'} · Replied: {c.replied || 'No'} · Call: {c.callBooked || 'No'}</span></div>{c.notes && <div><b>Notes</b><span>{c.notes}</span></div>}</div>
        </article>)}{!companies.length&&<div className="empty">No companies match your search. Import your Excel list or add a company.</div>}</div>
      </section>}
      {page==='Pipeline' && <section className="pipeline-board-wrap"><div className="panel-head"><div><h3>Company outreach pipeline</h3><p>Drag a company card between columns to update its outreach status.</p></div></div><div className="kanban">{stages.map(s=><section className={'kanban-col '+(dragging?'drag-ready':'')} key={s} onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();if(dragging!==null){updateStage(dragging,s);setDragging(null);}}}><div className="kanban-title">{s}<span>{count(s)}</span></div>{data.companies.filter(c=>c.status===s).map(c=><article className="kanban-card" key={c.id} draggable onDragStart={()=>setDragging(c.id)} onDragEnd={()=>setDragging(null)}><div className="drag-handle">⠿ Drag</div><b>{c.name}</b><small>{c.country}</small><p>{c.primaryContact || c.secondaryContact || 'No contact added'}</p><div className="card-links">{c.primaryContactLink && <ExternalLink href={c.primaryContactLink} children="Contact ↗"/>}{c.linkedin && <ExternalLink href={c.linkedin} children="Company ↗"/>}</div><select value={c.status} onChange={e=>updateStage(c.id,e.target.value)} aria-label={'Move '+c.name}>{stages.map(x=><option key={x}>{x}</option>)}</select></article>)}</section>)}</div></section>}
      <footer>FounderFlow CRM <span>Private workspace · Data saved in this browser</span></footer>
    </main>
    {modal && <div className="overlay" onClick={()=>setModal(false)}><form className="modal" onClick={e=>e.stopPropagation()} onSubmit={addCompany}><div className="modal-head"><div><span className="eyebrow">ADD TO YOUR WORKSPACE</span><h2>New company</h2></div><button type="button" className="close" onClick={()=>setModal(false)}>×</button></div><Field form={form} setForm={setForm} label="Company name" name="name" placeholder="e.g. Acme Technologies"/><Field form={form} setForm={setForm} label="Region" name="country" placeholder="US, UK, UAE..."/><Field form={form} setForm={setForm} label="Company website" name="website" placeholder="https://"/><Field form={form} setForm={setForm} label="Company LinkedIn" name="linkedin" placeholder="https://linkedin.com/company/..."/><Field form={form} setForm={setForm} label="Primary founder / CEO / hiring contact" name="primaryContact" placeholder="Name and role"/><Field form={form} setForm={setForm} label="Primary contact LinkedIn" name="primaryContactLink" placeholder="https://linkedin.com/in/..."/><Field form={form} setForm={setForm} label="Secondary contact" name="secondaryContact" placeholder="Name and role"/><Field form={form} setForm={setForm} label="Secondary contact LinkedIn" name="secondaryContactLink" placeholder="https://linkedin.com/in/..."/><Field form={form} setForm={setForm} label="Support / contact email" name="email" placeholder="hello@company.com" type="email"/><Field form={form} setForm={setForm} label="Hiring / careers page" name="careers" placeholder="https://..."/><Field form={form} setForm={setForm} label="Best outreach angle" name="outreachAngle" placeholder="Why you want to reach out"/><div className="modal-actions"><button type="button" className="btn ghost" onClick={()=>setModal(false)}>Cancel</button><button className="btn primary">Save company</button></div></form></div>}
    {toast&&<div className="toast">{toast}</div>}
  </div>;
}
createRoot(document.getElementById('root')).render(<App/>);
