import React, { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClerkProvider, useAuth, useClerk, useUser } from '@clerk/react';
import { navigate, useRoute } from './lib/router.jsx';
import { HOME, internalPath } from './lib/routes.js';
import { parseIntent, peekIntent, storeIntent, stripIntent } from './lib/intent.js';
import { hadSession, rememberSession, setView } from './lib/session.js';
import { enhanceLanding } from './landing/enhance.js';
import { Mark } from './app/ui.jsx';

const env = import.meta.env;
const clerkKey = env.VITE_CLERK_PUBLISHABLE_KEY;
// The signed-in app (and the database client) is only downloaded by people who sign in.
const Desk = lazy(() => import('./app/Desk.jsx'));

// /?save=slug and /?draft=slug&contact=id: remember what the visitor wanted, then clean the address bar.
const arrived = parseIntent(window.location.search);
if (arrived) {
  storeIntent(window.sessionStorage, arrived);
  window.history.replaceState(null, '', window.location.pathname + stripIntent(window.location.search) + window.location.hash);
}
const intentWaiting = () => { try { return Boolean(peekIntent(window.sessionStorage)); } catch { return false; } };

function Splash({ text = 'Opening your desk…' }) {
  return <div className="boot" role="status"><Mark size={44} /><p>{text}</p></div>;
}

function SignInGate({ onSignIn, ready }) {
  return <div className="boot">
    <Mark size={44} />
    <h1>Sign in to open your desk</h1>
    <p>Your saved companies, drafts and follow-ups are waiting. Browsing the directory needs no account.</p>
    <div className="actions">
      <button className="btn btn-dark" type="button" onClick={onSignIn} disabled={!ready}>Sign in</button>
      <a className="btn" href="/companies">Browse the directory</a>
    </div>
  </div>;
}

function Shell() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const route = useRoute();
  const [waited, setWaited] = useState(false);
  const asked = useRef(false); // sign-in was requested before Clerk finished loading
  const opened = useRef(false);

  const openSignIn = () => {
    if (!isLoaded) { asked.current = true; return; }
    if (!isSignedIn) clerk.openSignIn({});
  };

  useEffect(() => { const t = window.setTimeout(() => setWaited(true), 8000); return () => window.clearTimeout(t); }, []);
  useEffect(() => { if (isLoaded) rememberSession(isSignedIn); }, [isLoaded, isSignedIn]);
  useEffect(() => { if (route.redirect) navigate(route.redirect, { replace: true }); }, [route.redirect]);
  // Signed-in visitors never see the landing page.
  useEffect(() => { if (isLoaded && isSignedIn && route.name === 'landing') navigate(HOME, { replace: true }); }, [isLoaded, isSignedIn, route.name]);
  // Signed out with something to do (a Save/Draft link, a click on Sign in, or an app address): open sign-in once.
  useEffect(() => {
    if (!isLoaded || isSignedIn || opened.current) return;
    if (asked.current || intentWaiting() || (route.name !== 'landing' && route.name !== 'away')) { opened.current = true; clerk.openSignIn({}); }
  }, [isLoaded, isSignedIn, route.name]);
  // "Sign in" links on the static landing page open the sign-in dialog in place.
  useEffect(() => {
    const click = e => {
      const a = e.target.closest?.('#landing a[data-signin], #landing a[data-auth]');
      if (!a || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      e.preventDefault();
      openSignIn();
    };
    document.addEventListener('click', click);
    return () => document.removeEventListener('click', click);
  });

  const onLanding = route.name === 'landing';
  // While the session is still loading, a returning user sees a loader instead of a flash of the landing page.
  const pending = !isLoaded && (onLanding ? hadSession() && !waited : true);
  const showLanding = onLanding && !pending && !(isLoaded && isSignedIn);
  useLayoutEffect(() => {
    setView(showLanding ? 'landing' : 'app');
    if (showLanding) { document.title = 'FoundReach: find any startup, reach the people who run it'; enhanceLanding(); }
  }, [showLanding]);

  if (showLanding) return null;
  if (route.name === 'away') return <Splash text="Opening the directory…" />;
  if (!isLoaded) return waited ? <SignInGate ready={false} onSignIn={openSignIn} /> : <Splash />;
  if (!isSignedIn) return <SignInGate ready onSignIn={() => clerk.openSignIn({})} />;
  if (onLanding) return <Splash />;
  // Signing out must not be mistaken for "signed out, wants in": no sign-in dialog on the way out.
  const signOut = () => { opened.current = true; clerk.signOut({ redirectUrl: '/' }); };
  return <Suspense fallback={<Splash />}><Desk user={user} getToken={getToken} route={route} onSignOut={signOut} onAccount={() => clerk.openUserProfile()} /></Suspense>;
}

function Unconfigured() {
  const route = useRoute();
  const onLanding = route.name === 'landing';
  useLayoutEffect(() => { setView(onLanding ? 'landing' : 'app'); if (onLanding) enhanceLanding(); }, [onLanding]);
  if (onLanding) return null;
  return <div className="boot"><Mark size={44} /><h1>Sign-in is not set up here</h1><p>This copy of FoundReach has no sign-in key. The directory still works.</p><a className="btn" href="/companies">Browse the directory</a></div>;
}

// Clerk asks the app to navigate after sign-in and sign-out. Its own off-site pages get a normal page load.
function clerkGo(to, replace) {
  if (internalPath(to, window.location.origin) !== null) navigate(to, { replace });
  else if (/^https:\/\//i.test(String(to))) window.location.assign(to);
}

function Root() {
  if (!clerkKey) return <Unconfigured />;
  return <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/" signInFallbackRedirectUrl={HOME} signUpFallbackRedirectUrl={HOME}
    routerPush={to => clerkGo(to, false)} routerReplace={to => clerkGo(to, true)}>
    <Shell />
  </ClerkProvider>;
}

createRoot(document.getElementById('root')).render(<Root />);
