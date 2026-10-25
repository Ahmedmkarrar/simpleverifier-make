const http = require('node:http');

const KEY = 'sv_live_mockkey';

const EMAIL_RESULTS = {
  'jane@company.com': { status: 'valid', reason: 'Mailbox exists', send_advice: 'safe', reason_detail: 'The mail server confirmed this mailbox exists.', mailbox_checked: true },
  'info@catchall.test': { status: 'risky', reason: 'Catch-all domain', send_advice: 'care', reason_detail: 'The domain accepts every address, so the mailbox cannot be confirmed.', mailbox_checked: true },
  'nobody@company.com': { status: 'invalid', reason: 'Mailbox does not exist', send_advice: 'do_not_send', reason_detail: 'The mail server rejected this mailbox.', mailbox_checked: true },
};

const send = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const readBody = (req) =>
  new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => resolve(raw ? JSON.parse(raw) : {}));
  });

const startMockApi = () => {
  const calls = [];
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const body = req.method === 'POST' ? await readBody(req) : {};
    calls.push({ method: req.method, path: url.pathname, headers: req.headers, body });

    const key = req.headers.authorization;
    if (key === 'Bearer sv_live_noapi') return send(res, 402, { error: 'This plan does not include API access.' });
    if (key === 'Bearer sv_live_throttled') return send(res, 429, { error: 'rate limited' });
    if (key !== `Bearer ${KEY}`) return send(res, 401, { error: 'Invalid API key' });

    if (url.pathname === '/api/v1/me') return send(res, 200, { ok: true, email: 'tester@example.com', plan: 'pro' });
    if (url.pathname === '/api/v1/verify') {
      if (!body.email) return send(res, 400, { error: 'email is required' });
      const result = EMAIL_RESULTS[body.email] || EMAIL_RESULTS['nobody@company.com'];
      return send(res, 200, { email: body.email, ...result });
    }
    if (url.pathname === '/api/v1/phone') {
      if (!body.phone) return send(res, 400, { error: 'phone is required' });
      const live = body.live === true;
      return send(res, 200, {
        phone_status: 'valid',
        phone_e164: '+14155552671',
        phone_country: body.country || 'US',
        phone_type: 'fixed_line_or_mobile',
        live_lookup: live,
        ...(live ? { phone_carrier: 'Mock Carrier', phone_line_type: 'mobile' } : {}),
      });
    }
    return send(res, 404, { error: 'not found' });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () =>
      resolve({ server, calls, base: `http://127.0.0.1:${server.address().port}/api/v1`, key: KEY }),
    ),
  );
};

module.exports = { startMockApi };
