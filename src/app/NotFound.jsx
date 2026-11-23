// The desk's 404 screen: any unknown /app path, and the Team room for everyone but the admin.
import React from 'react';
import { Link } from '../lib/router.jsx';
import { paths } from '../lib/routes.js';

export function NotFound() {
  return <div className="state"><span className="state-code">404</span><h1 tabIndex={-1} data-page-title>That page is not part of your desk.</h1><p>The address may be old or mistyped.</p><div className="actions"><Link className="btn btn-dark" to={paths.today()}>Go to Today</Link><Link className="btn" to={paths.pipeline()}>Open Pipeline</Link></div></div>;
}
