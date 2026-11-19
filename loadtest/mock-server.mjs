#!/usr/bin/env node
// A tiny fake of the driver API, used ONLY to check that driver-day.mjs itself works (percentiles, ramp-up, verdict).
// It says nothing about the real backend's capacity. Run: node loadtest/mock-server.mjs 4999
import http from 'node:http';

const port = Number(process.argv[2] || 4999);
const delay = (ms) => new Promise((r) => setTimeout(r, ms));
let n = 0;

http.createServer(async (req, res) => {
  n++;
  await delay(5 + Math.random() * 40);
  const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
  if (req.method === 'POST' && req.url === '/driver/login') return send(200, { driver: { id: 1 + (n % 50), email: 'x' }, accessToken: 'mock', refreshToken: 'mock' });
  if (!String(req.headers.authorization || '').startsWith('Bearer ')) return send(401, { message: 'no token' });
  return send(200, { ok: true });
}).listen(port, () => console.log(`mock driver API on :${port}`));
