// k6 version of driver-day.mjs (use it if you prefer k6's reports or want to run from k6 Cloud).
//   k6 run -e BASE=https://staging-api.example.com -e VUS=300 docs/infra/loadtest/k6-driver-day.js
// Users: docs/infra/loadtest/users.json  [{"email": "...", "password": "..."}]. NEVER point this at production.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { SharedArray } from 'k6/data';

const users = new SharedArray('users', () => JSON.parse(open('./users.json')));
const BASE = __ENV.BASE;
const VUS = Number(__ENV.VUS || 300);

export const options = {
  scenarios: {
    drivers: {
      executor: 'ramping-vus',
      stages: [
        { duration: '2m', target: VUS },   // everyone arrives
        { duration: '10m', target: VUS },  // steady state
        { duration: '1m', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.01'],
    'http_req_duration{kind:read}': ['p(95)<800'],
  },
};

export default function () {
  const u = users[(__VU - 1) % users.length];
  const login = http.post(`${BASE}/driver/login`, JSON.stringify({ email: u.email, password: u.password, timezone: 'America/Chicago' }), { headers: { 'Content-Type': 'application/json' }, tags: { kind: 'login' } });
  if (!check(login, { 'login 200': (r) => r.status === 200 })) { sleep(5); return; }
  const token = login.json('accessToken');
  const id = login.json('driver.id');
  const params = { headers: { Authorization: `Bearer ${token}` }, tags: { kind: 'read' } };

  for (let i = 0; i < 40; i++) {
    const r = Math.random();
    const path = r < 0.30 ? '/driver/availability' : r < 0.55 ? '/driver/profile' : r < 0.75 ? `/driver/deliveries/${id}` : r < 0.90 ? '/driver/payroll/statements' : '/driver/payroll/balances';
    check(http.get(`${BASE}${path}`, params), { ok: (x) => x.status === 200 });
    sleep(3 + Math.random() * 9);
  }
}
