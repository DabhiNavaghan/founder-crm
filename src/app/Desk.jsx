// The signed-in app: shared header (the designer's shell), the four screens, and focus handling on navigation.
import React, { useEffect, useRef } from 'react';
import { DeskProvider, useDesk } from './store.jsx';
import { Link } from '../lib/router.jsx';
import { ADMIN_NAV, NAV, TITLES, paths } from '../lib/routes.js';
import { supabase } from '../lib/data.js';
import { Mark, Menu, Wordmark } from './ui.jsx';
import { Today } from './Today.jsx';
import { Pipeline } from './Pipeline.jsx';
import { Studio } from './Studio.jsx';
import { Profile } from './Profile.jsx';
import { Team } from './Team.jsx';
import { NotFound } from './NotFound.jsx';

export default function Desk({ user, getToken, route, onSignOut, onAccount }) {
  if (!supabase) return <div className="boot"><Mark size={44} /><h1>Your desk is being set up</h1><p>FoundReach is waiting for its database connection. Try again in a few minutes.</p><button type="button" className="btn" onClick={onSignOut}>Sign out</button></div>;
  return <DeskProvider user={user} getToken={getToken}><Frame route={route} onSignOut={onSignOut} onAccount={onAccount} /></DeskProvider>;
}

function Frame({ route, onSignOut, onAccount }) {
  const { user, claiming, isAdmin } = useDesk();
  const first = useRef(true);
  const section = route.name;

  // On every navigation: name the page, go to the top, and move focus to the page heading.
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    window.scrollTo(0, 0);
    document.querySelector('[data-page-title]')?.focus({ preventScroll: true });
  }, [section, route.params.companyId]); // not on query changes: choosing a person in the studio keeps focus where it is
  // The Team room keeps the 404 title for anyone who is not the admin.
  useEffect(() => {
    document.title = (TITLES[section === 'team' && isAdmin !== true ? 'notfound' : section] || 'Desk') + ' | FoundReach';
  }, [section, isAdmin]);
  // The app is private: keep it out of search results even if a crawler runs scripts.
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots'; meta.content = 'noindex';
    document.head.append(meta);
    document.body.classList.add('has-tabbar');
    return () => { meta.remove(); document.body.classList.remove('has-tabbar'); };
  }, []);

  const name = user?.firstName || user?.fullName || user?.primaryEmailAddress?.emailAddress || 'you';
  const email = user?.primaryEmailAddress?.emailAddress || '';
  return <>
    <a className="skip" href="#app-main">Skip to content</a>
    <header className="top top-app">
      <div className="wrap">
        <Link className="brand" to={paths.today()}><Wordmark /></Link>
        <nav className={'nav' + (isAdmin === true ? ' nav-admin' : '')} aria-label="Main">
          {(isAdmin === true ? [...NAV, ...ADMIN_NAV] : NAV).map(item => item.external
            ? <a key={item.name} href={item.path}>{item.label}</a>
            : <Link key={item.name} to={item.path} aria-current={section === item.name ? 'page' : undefined}>
              {item.short ? <><span className="nav-x">{item.label}</span><span className="nav-n">{item.short}</span></> : item.label}
            </Link>)}
        </nav>
        <Menu className="pop acct" summaryClass="" label={'Account menu for ' + name} summary={<span className="avatar" aria-hidden="true">{name.trim().slice(0, 1).toUpperCase()}</span>}>
          <p className="menu-who"><b>{user?.fullName || name}</b>{email}</p>
          <hr />
          <Link to={paths.profile()} aria-current={section === 'profile' ? 'page' : undefined}>Profile</Link>
          <button type="button" onClick={onAccount}>Account settings</button>
          <button type="button" onClick={onSignOut}>Sign out</button>
        </Menu>
      </div>
    </header>
    <main id="app-main" className="wrap app-main" tabIndex={-1}>
      {claiming ? <div className="boot" role="status" style={{ minHeight: '50vh' }}><p>Saving the company to your pipeline…</p></div>
        : section === 'today' ? <Today />
        : section === 'pipeline' ? <Pipeline companyId={route.params.companyId || ''} />
        : section === 'studio' ? <Studio contactId={route.params.contactId || ''} />
        : section === 'profile' ? <Profile />
        : section === 'team' ? (isAdmin === null ? <div className="boot" role="status" style={{ minHeight: '50vh' }}><p>Loading the team room…</p></div>
          : isAdmin === true ? <Team run={route.query.run || ''} /> : <NotFound />)
        : <NotFound />}
    </main>
    <footer className="foot">
      <div className="wrap">
        <p className="foot-brand"><Mark />Every startup, one step from its founders.</p>
        <nav className="foot-nav" aria-label="Footer">
          <a href="/companies">Directory</a>
          <a href="/new">New this week</a>
          <a href="/hiring">Hiring</a>
          <a href="/collections">Collections</a>
          <a href="/about-data">About the data</a>
          <a href="/privacy">Privacy</a>
          <a href="/remove">Remove or correct my information</a>
        </nav>
        <p>Your saved companies, notes and messages are private to your account.</p>
      </div>
    </footer>
  </>;
}
