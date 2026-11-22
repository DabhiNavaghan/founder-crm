import React from 'react';
import { Globe2, Linkedin, Mail, Briefcase, Search, Send, MessageSquare } from 'lucide-react';

const href = url => (/^https?:\/\//i.test(url) ? url : 'https://' + url);
const host = url => { try { return new URL(href(url)).hostname.replace(/^www\./, ''); } catch { return url; } };
const peopleSearch = keywords => 'https://www.linkedin.com/search/results/people/?keywords=' + encodeURIComponent(keywords);
const PRIORITY = { 5: 'High priority', 4: 'High priority', 3: 'Medium priority', 2: 'Low priority', 1: 'Low priority' };
const FIND_ROLES = [['Founder / CEO', 'Founder CEO'], ['CTO / Engineering', 'CTO'], ['Head of Product', 'Head of Product']];

function Action({ url, icon: Icon, children, primary }) {
  return <a className={'cc-action' + (primary ? ' cc-action-primary' : '')} href={url} target={url.startsWith('mailto:') ? undefined : '_blank'} rel="noreferrer"><Icon size={13} />{children}</a>;
}

export function CompanyCard({ company: c, contacts, onMessage }) {
  const people = [...contacts].sort((a, b) => (b.priority || 3) - (a.priority || 3));
  return <article className="cc">
    <header className="cc-head">
      <div className="company-symbol">{(c.name || '?').slice(0, 1).toUpperCase()}</div>
      <div className="cc-title">
        <h3>{c.name}</h3>
        <div className="cc-tags">
          {c.sector && <span>{c.sector}</span>}
          {c.country && <span>{c.country}</span>}
          <span className={'cc-priority p' + (c.priority || 3)}>{PRIORITY[c.priority || 3]}</span>
        </div>
      </div>
      <div className="cc-actions">
        {c.website && <Action url={href(c.website)} icon={Globe2} primary>{host(c.website)}</Action>}
        {c.careers_url && <Action url={href(c.careers_url)} icon={Briefcase}>Careers</Action>}
        {c.linkedin_url && <Action url={href(c.linkedin_url)} icon={Linkedin}>LinkedIn</Action>}
        {c.contact_url && <Action url={href(c.contact_url)} icon={MessageSquare}>Contact page</Action>}
        {c.contact_email && <Action url={'mailto:' + c.contact_email} icon={Mail}>{c.contact_email}</Action>}
      </div>
    </header>
    {(c.outreach_angle || c.description || c.recent_news || c.notes) && <div className="cc-facts">
      {c.outreach_angle && <p><b>Outreach angle</b>{c.outreach_angle}</p>}
      {c.description && <p><b>About</b>{c.description}</p>}
      {c.recent_news && <p><b>Recent news</b>{c.recent_news}</p>}
      {c.notes && <p><b>Notes</b>{c.notes}</p>}
    </div>}
    <div className="cc-people">
      <span className="cc-label">{people.length ? 'Founders & priority contacts' : 'No named contact yet — find the right person'}</span>
      {people.map(p => {
        const name = (p.first_name + ' ' + (p.last_name || '')).trim();
        return <div className="cc-person" key={p.id}>
          <div className="cc-person-name"><b>{name}</b><small>{p.role || 'Role not set'}</small></div>
          <div className="cc-actions">
            {p.linkedin_url
              ? <Action url={href(p.linkedin_url)} icon={Linkedin} primary>LinkedIn profile</Action>
              : <Action url={peopleSearch(name + ' ' + c.name)} icon={Search}>Find on LinkedIn</Action>}
            {p.email && <Action url={'mailto:' + p.email} icon={Mail}>{p.email}</Action>}
            <button className="cc-action" onClick={() => onMessage(p.id)}><Send size={13} />Write message</button>
          </div>
        </div>;
      })}
      {!people.length && <div className="cc-actions">
        {FIND_ROLES.map(([label, keywords]) => <Action key={label} url={peopleSearch(c.name + ' ' + keywords)} icon={Search}>Find {label}</Action>)}
      </div>}
    </div>
  </article>;
}
