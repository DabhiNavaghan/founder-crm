// Admin tools: import companies from Excel. Shown only to the account that owns the catalog.
import React, { useRef, useState } from 'react';
import { useDesk } from './store.jsx';
import { importWorkbook } from '../lib/importFlow.js';

export default function AdminImport() {
  const { userId, reload, toast } = useDesk();
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);
  const input = useRef(null);
  const busy = Boolean(progress);
  const pick = async e => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || busy) return;
    setResult(null); setProgress('Starting');
    try {
      const r = await importWorkbook(file, userId, setProgress);
      const text = 'Imported ' + r.added + ' new ' + (r.added === 1 ? 'company' : 'companies') + (r.updated ? ', updated ' + r.updated : '') + ' and added ' + r.people + ' contact' + (r.people === 1 ? '' : 's') + '.';
      setResult({ ok: true, text });
      toast(text);
      await reload();
    } catch (err) {
      setResult({ ok: false, text: 'Import failed: ' + (err.message || 'unknown error') });
    } finally { setProgress(''); }
  };
  return <div>
    <p className="t-sub">Import companies from an Excel or CSV file. Rows that match an existing company by name or website are updated; the rest are added. Founders named in the sheet are saved as contacts.</p>
    <div className="tools">
      <button type="button" className="btn" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Importing…' : 'Import companies'}</button>
      <input ref={input} hidden type="file" accept=".xlsx,.xls,.csv" onChange={pick} aria-label="Spreadsheet to import" />
    </div>
    {busy && <p className="note" role="status">{progress}</p>}
    {result && <p className={'note' + (result.ok ? '' : ' note-warn')} role={result.ok ? 'status' : 'alert'}>{result.text}</p>}
  </div>;
}
