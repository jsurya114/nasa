/**
 * The sign-in and consent page shown to the owner (issue #220). Plain HTML with no scripts, so there is nothing to
 * inject into. Everything that came from outside (the app's self-chosen name, the redirect host) is escaped, and the
 * redirect host is shown on purpose: the name is only what the app calls itself.
 */
import { CONSENT_PATH } from './config.js';

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

// Headers for every page this feature serves: not framed, not cached, nothing sent on to other sites.
// The form may post back here and the browser may then be redirected to the app's callback address.
export function pageHeaders(redirectOrigin) {
  const formTargets = ["'self'", redirectOrigin].filter(Boolean).join(' ');
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; form-action ${formTargets}; frame-ancestors 'none'; base-uri 'none'`,
  };
}

const STYLE = `
  :root{color-scheme:light dark;--bg:#faf8f5;--card:#fff;--ink:#1f1a24;--muted:#5d5566;--line:#e4dfe9;--brand:#5b2a86;--bad:#a4262c}
  @media (prefers-color-scheme:dark){:root{--bg:#17131c;--card:#221c2a;--ink:#f3eef8;--muted:#b5abc0;--line:#3a3145;--brand:#b48ae0;--bad:#ff8a8f}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:24px 16px}
  main{max-width:440px;margin:0 auto;background:var(--card);border:1px solid var(--line);border-radius:16px;padding:24px}
  h1{font-size:1.35rem;margin:0 0 4px;color:var(--brand)}p{margin:8px 0}.muted{color:var(--muted);font-size:.92rem}
  ul{margin:8px 0 8px 1.1rem;padding:0}li{margin:4px 0}label{display:block;font-weight:600;margin:14px 0 4px}
  input{width:100%;font:inherit;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit}
  input:focus-visible,button:focus-visible{outline:3px solid var(--brand);outline-offset:2px}
  .row{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}button{font:inherit;font-weight:600;padding:11px 18px;border-radius:10px;border:1px solid var(--brand);cursor:pointer;min-height:44px}
  .allow{background:var(--brand);color:#fff}.deny{background:transparent;color:var(--brand)}
  .error{color:var(--bad);border:1px solid var(--bad);border-radius:10px;padding:10px 12px;margin:12px 0}
  code{background:var(--bg);padding:1px 6px;border-radius:6px}`;

const shell = (title, body) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`;

export function renderConsent({ requestId, clientName, redirectHost, scope, error }) {
  const app = clientName ? escapeHtml(clientName) : 'An app';
  return shell('Connect NASA Insights', `
    <h1>Connect NASA Insights</h1>
    <p><strong>${app}</strong> is asking to read NASA Logistics business reports for you.</p>
    <p class="muted">It will return to <code>${escapeHtml(redirectHost)}</code>. The name above is whatever the app calls itself; check that address.</p>
    <p><strong>It can</strong> (permission <code>${escapeHtml(scope)}</code>):</p>
    <ul><li>Read metric definitions and city lists.</li><li>Read delivery, revenue and gross-margin summaries, trends, and city and driver rankings (driver names and cities only).</li><li>Read carrier claim totals, driver payment status totals, and estimated future deliveries.</li></ul>
    <p><strong>It cannot:</strong></p>
    <ul><li>Change anything, pay anyone, or run payroll.</li><li>See passwords, bank details or tax details.</li></ul>
    <p class="muted">Only the NASA super admin can approve. You can disconnect at any time.</p>
    ${error ? `<div class="error" role="alert">${escapeHtml(error)}</div>` : ''}
    <form method="post" action="${CONSENT_PATH}" autocomplete="off">
      <input type="hidden" name="request" value="${escapeHtml(requestId)}">
      <label for="email">NASA super admin email</label>
      <input id="email" name="email" type="email" autocomplete="username" required maxlength="150">
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" required maxlength="200">
      <div class="row">
        <button class="allow" type="submit" name="decision" value="allow">Allow read-only access</button>
        <button class="deny" type="submit" name="decision" value="deny" formnovalidate>Cancel</button>
      </div>
    </form>`);
}

export function renderMessage(title, text) {
  return shell(title, `<h1>${escapeHtml(title)}</h1><p>${escapeHtml(text)}</p>`);
}
