import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { parseHistoryQuery, parseInvoice, parseVendor } from '../services/invoices/invoiceRules.js';
import { createInvoice, createVendor, getInvoice, listInvoices, listVendors, markPaymentReceived, ownerOf, updateInvoice, updateVendor } from '../services/invoices/invoiceStore.js';
import { invoiceAccessOf, invoiceActorOf } from '../middlewares/requireInvoiceAccess.js';
import { dbService } from '../services/admin/dbQueries.js';
import { toggleAdminInvoices } from '../controllers/admin/addAdminController.js';

// Invoices for selected admins. The database part needs a PostgreSQL copy (never production): run with PAYROLL_TEST_DB=1 and the DB_* variables. It runs
// in one transaction that is always rolled back. Synthetic admins and invoices only.
const hasDb = process.env.PAYROLL_TEST_DB === '1';
const migration = (name) => readFileSync(new URL(`../migrations/${name}`, import.meta.url), 'utf8');

test('the invoice routes: one access check after the sign-in check, and only the access question before it', () => {
  const source = readFileSync(new URL('../routes/invoiceRoutes.js', import.meta.url), 'utf8').split('\n').map((l) => l.trim());
  const at = (text) => source.findIndex((l) => l === text);
  const signIn = at('router.use(adminAuth);');
  const guard = at('router.use(requireInvoiceAccess);');
  assert.ok(signIn > 0 && guard > signIn, 'adminAuth must run before the access check');
  assert.equal(source.filter((l) => l === 'router.use(requireInvoiceAccess);').length, 1);
  assert.equal(source.some((l) => l.includes("requireRole('superadmin')")), false, 'the old super-admin-only guard is gone');
  const routes = source.map((text, line) => ({ text, line })).filter(({ text }) => /^router\.(get|post|put|patch|delete)\(/.test(text));
  const before = routes.filter(({ line }) => line < guard);
  assert.deepEqual(before.map((r) => r.text.split(',')[0]), ["router.get('/access'"], 'only the access question sits before the access check');
  assert.ok(routes.length >= 10, 'the invoice routes sit after the access check');
});

test('the super admin saves Invoices on or off for an ordinary admin: the wanted value, and only while a super admin in the database', async () => {
  const real = [dbService.getAdminById, dbService.setInvoiceAccessOfAdmin];
  const res = () => ({ code: null, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
  const stored = { 5: false };
  const people = { 1: { id: 1, role: 'superadmin', is_active: true }, 2: { id: 2, role: 'admin', is_active: true }, 3: { id: 3, role: 'superadmin', is_active: false },
    5: { id: 5, role: 'admin' }, 6: { id: 6, role: 'superadmin' } };
  const call = async (user, id, body = { enabled: true }) => { const r = res(); await toggleAdminInvoices({ user, params: { id }, body }, r); return r; };
  const boss = { id: 1, role: 'superadmin' };
  try {
    dbService.getAdminById = async (id) => people[id];
    dbService.setInvoiceAccessOfAdmin = async (id, enabled) => { stored[id] = enabled; return { id, can_use_invoices: enabled }; };
    assert.equal((await call({ id: 2, role: 'admin' }, '5')).code, 403, 'an ordinary admin cannot switch it');
    assert.equal((await call({ id: 2, role: 'superadmin' }, '5')).code, 403, 'a token that still says super admin, for someone who is an admin now');
    assert.equal((await call({ id: 3, role: 'superadmin' }, '5')).code, 403, 'a deactivated super admin');
    assert.equal((await call({ id: 99, role: 'superadmin' }, '5')).code, 403, 'a super admin who no longer exists');
    assert.equal(stored[5], false, 'none of those changed anything');
    assert.equal((await call(boss, 'abc')).code, 404);
    assert.equal((await call(boss, '999')).code, 404);
    assert.equal((await call(boss, '6')).code, 400, 'a super admin already has it');
    for (const body of [{}, { enabled: 'true' }, { enabled: 1 }, { enabled: null }]) assert.equal((await call(boss, '5', body)).code, 400, JSON.stringify(body));
    const noBody = res();
    await toggleAdminInvoices({ user: boss, params: { id: '5' } }, noBody);
    assert.equal(noBody.code, 400, 'no body at all');
    assert.equal(stored[5], false, 'a request that does not say on or off changes nothing');
    const on = await call(boss, '5', { enabled: true });
    assert.deepEqual([on.code, on.body.data, stored[5]], [200, { id: 5, can_use_invoices: true }, true]);
    const off = await call(boss, '5', { enabled: false });
    assert.deepEqual([off.code, off.body.data.can_use_invoices, stored[5]], [200, false, false]);
    const again = await call(boss, '5', { enabled: false }); // the same revoke sent a second time (the first answer was lost)
    assert.deepEqual([again.code, again.body.data.can_use_invoices, stored[5]], [200, false, false], 'a repeated revoke does not grant access again');
  } finally {
    [dbService.getAdminById, dbService.setInvoiceAccessOfAdmin] = real;
  }
});

test('an invoice route never runs without the admin the access check read from the database', async () => {
  const res = () => ({ code: null, status(c) { this.code = c; return this; }, json() { return this; } });
  const { getOneInvoice, getInvoices } = await import('../controllers/invoices/invoiceController.js');
  for (const handler of [getOneInvoice, getInvoices]) {
    const r = res();
    // A token that says super admin is not enough: without req.invoiceActor the request is refused before any query.
    await handler({ params: { id: '1' }, query: {}, admin: { id: 1, role: 'superadmin' }, user: { id: 1, role: 'superadmin' } }, r);
    assert.equal(r.code, 403);
  }
});

test('the owner of a request: the super admin is unrestricted, any other admin is limited to their own id', () => {
  assert.equal(ownerOf({ id: 1, role: 'superadmin' }), null);
  assert.equal(ownerOf(null), null, 'no admin given (internal use) is unrestricted');
  assert.equal(ownerOf({ id: '7', role: 'admin' }), 7);
});

test('invoices for selected admins: the switch decides access at once, and a selected admin sees and changes only their own invoices', { skip: !hasDb && 'set PAYROLL_TEST_DB=1 and the DB_* variables to run' }, async (t) => {
  const { default: pool } = await import('../config/db.js');
  const db = await pool.connect();
  const one = async (sql, params) => (await db.query(sql, params)).rows[0];
  let sp = 0;
  const rejects = async (fn, status) => {
    const name = `r${sp++}`;
    await db.query(`SAVEPOINT ${name}`);
    try { await assert.rejects(fn, (e) => e.status === status, `expected ${status}`); } finally { await db.query(`ROLLBACK TO SAVEPOINT ${name}`); }
  };
  try {
    await db.query('BEGIN');
    await db.query(migration('2026-11-11-invoices.sql'));
    await db.query(migration('2026-11-16-admin-invoice-access.sql'));
    const tag = randomBytes(3).toString('hex').toUpperCase();
    const makeAdmin = (n, role = 'admin') => one("INSERT INTO admin (password, name, email, role) VALUES ('x', $1, $2, $3) RETURNING id, role", [`Test ${n} ${tag}`, `${n}${tag}@example.test`, role]);
    const [boss, ann, bob, off] = [await makeAdmin('boss', 'superadmin'), await makeAdmin('ann'), await makeAdmin('bob'), await makeAdmin('off')];

    await t.test('access: the super admin always, an ordinary admin only when switched on, nobody else; switching off or disabling takes effect at once', async () => {
      assert.equal(await invoiceAccessOf(boss, db), true);
      assert.equal(await invoiceAccessOf(ann, db), false, 'off by default');
      await db.query('UPDATE admin SET can_use_invoices = true WHERE id = ANY($1::int[])', [[ann.id, bob.id, off.id]]);
      assert.equal(await invoiceAccessOf(ann, db), true);
      await db.query('UPDATE admin SET is_active = false WHERE id = $1', [off.id]);
      assert.equal(await invoiceAccessOf(off, db), false, 'a disabled admin has no access');
      assert.equal(await invoiceAccessOf({ id: ann.id, role: 'driver' }, db), false);
      assert.equal(await invoiceAccessOf({ id: 987654321, role: 'admin' }, db), false, 'an admin who does not exist');
      assert.equal(await invoiceAccessOf(undefined, db), false);
      await db.query('UPDATE admin SET can_use_invoices = false WHERE id = $1', [ann.id]);
      assert.equal(await invoiceAccessOf(ann, db), false, 'switched off again');
      await db.query('UPDATE admin SET can_use_invoices = true WHERE id = $1', [ann.id]);
    });

    await t.test('the role comes from the database: a token that says super admin does not help a demoted or disabled one, and a promoted admin is unrestricted', async () => {
      const staleSuper = { id: ann.id, role: 'superadmin' }; // Ann is an admin in the database (Invoices on), but an old token says super admin
      assert.deepEqual(await invoiceActorOf(staleSuper, db), { id: ann.id, role: 'admin' }, 'she is limited to her own invoices');
      await db.query('UPDATE admin SET can_use_invoices = false WHERE id = $1', [ann.id]);
      assert.equal(await invoiceAccessOf(staleSuper, db), false, 'and with Invoices off, a super admin token gives nothing');
      await db.query('UPDATE admin SET can_use_invoices = true WHERE id = $1', [ann.id]);
      await db.query("UPDATE admin SET role = 'admin' WHERE id = $1", [boss.id]); // the super admin is demoted
      assert.equal(await invoiceAccessOf(boss, db), false, 'a demoted super admin loses access at once (Invoices was never switched on for them)');
      await db.query("UPDATE admin SET role = 'superadmin', is_active = false WHERE id = $1", [boss.id]);
      assert.equal(await invoiceAccessOf(boss, db), false, 'a disabled super admin has no access');
      await db.query("UPDATE admin SET is_active = true WHERE id = $1", [boss.id]);
      assert.deepEqual(await invoiceActorOf({ id: boss.id, role: 'admin' }, db), { id: boss.id, role: 'superadmin' }, 'promoted in the database: unrestricted, whatever the token says');
      assert.equal(ownerOf(await invoiceActorOf({ id: boss.id, role: 'admin' }, db)), null);
    });

    await t.test('saving the wanted value: switching off twice leaves it off, switching on twice leaves it on, and a super admin row is never changed', async () => {
      const state = async (id) => (await one('SELECT can_use_invoices FROM admin WHERE id = $1', [id])).can_use_invoices;
      assert.equal(await state(bob.id), true);
      for (let i = 0; i < 2; i += 1) {
        assert.deepEqual(await dbService.setInvoiceAccessOfAdmin(bob.id, false, db), { id: bob.id, can_use_invoices: false });
        assert.equal(await state(bob.id), false, 'a revoke sent twice is still a revoke');
        assert.equal(await invoiceAccessOf(bob, db), false);
      }
      for (let i = 0; i < 2; i += 1) {
        assert.deepEqual(await dbService.setInvoiceAccessOfAdmin(bob.id, true, db), { id: bob.id, can_use_invoices: true });
        assert.equal(await invoiceAccessOf(bob, db), true);
      }
      assert.equal(await dbService.setInvoiceAccessOfAdmin(boss.id, true, db), undefined, 'a super admin is not an ordinary admin');
      assert.equal(await state(boss.id), false);
    });

    const vendor = await createVendor(db, ann, parseVendor({ billingName: `Shared Co ${tag}`, addressLine1: '1 Main St', billingType: 'hourly' }));
    const body = (number, over = {}) => ({
      invoiceNumber: `${number}${tag}`, type: 'hourly', vendorId: vendor.id, periodStart: '2026-10-26', periodEnd: '2026-11-01',
      billTo: { name: vendor.billingName, line1: vendor.addressLine1 },
      lines: [{ job: 'General worker', reHours: '10', overtime: '0', totalHours: '10', totalCost: '100.00' }], ...over });
    const makeInvoice = async (admin, number) => (await createInvoice(db, admin, parseInvoice(body(number)))).invoice;
    const [annInv, bobInv] = [await makeInvoice(ann, 'A'), await makeInvoice(bob, 'B')];
    const numbers = async (admin) => (await listInvoices(db, parseHistoryQuery({}), admin)).invoices.map((i) => i.invoiceNumber).filter((n) => n.endsWith(tag)).sort();

    await t.test('the list and a single invoice: a selected admin sees only their own; the super admin sees all', async () => {
      assert.deepEqual(await numbers(ann), [`A${tag}`]);
      assert.deepEqual(await numbers(bob), [`B${tag}`]);
      assert.deepEqual(await numbers(boss), [`A${tag}`, `B${tag}`]);
      assert.equal((await getInvoice(db, annInv.id, ann)).invoiceNumber, `A${tag}`);
      await rejects(() => getInvoice(db, bobInv.id, ann), 404);
      assert.equal((await getInvoice(db, bobInv.id, boss)).invoiceNumber, `B${tag}`);
      const search = await listInvoices(db, parseHistoryQuery({ search: tag }), ann);
      assert.deepEqual(search.invoices.map((i) => i.invoiceNumber), [`A${tag}`], 'a search never reaches another admin\'s invoices');
      assert.equal(search.total, 1);
    });

    await t.test('editing and recording a payment: another admin\'s invoice is not found; the super admin may', async () => {
      const edit = (n) => parseInvoice(body(n));
      await rejects(() => updateInvoice(db, ann, bobInv.id, edit('B'), bobInv.version), 404);
      await rejects(() => markPaymentReceived(db, ann, bobInv.id, { receivedOn: '2026-11-10', reference: null, version: null }), 404);
      assert.equal((await getInvoice(db, bobInv.id, bob)).status, 'pending', 'nothing was changed');
      const mine = await updateInvoice(db, ann, annInv.id, edit('A'), annInv.version);
      assert.equal(mine.version, annInv.version + 1);
      const paid = await markPaymentReceived(db, ann, annInv.id, { receivedOn: '2026-11-10', reference: null, version: null });
      assert.equal(paid.invoice.status, 'paid');
      const byBoss = await updateInvoice(db, boss, bobInv.id, edit('B'), bobInv.version);
      assert.equal(byBoss.invoiceNumber, `B${tag}`);
    });

    await t.test('vendors are shared for listing and invoices, but only their creator or the super admin may change one', async () => {
      const names = (await listVendors(db)).map((v) => v.billingName);
      assert.ok(names.includes(vendor.billingName), 'Bob sees the vendor Ann created');
      const change = (admin, id = vendor.id) => updateVendor(db, admin, id, parseVendor({ billingName: `Shared Co ${tag}`, addressLine1: '2 Side St', billingType: 'hourly' }));
      await rejects(() => change(bob), 403);
      await rejects(() => change(bob, 987654321), 404);
      assert.equal((await change(ann)).addressLine1, '2 Side St', 'the creator may');
      assert.equal((await change(boss)).addressLine1, '2 Side St', 'the super admin may');
      assert.equal((await one('SELECT address_line1 FROM invoice_vendors WHERE id = $1', [vendor.id])).address_line1, '2 Side St');
    });
  } finally {
    await db.query('ROLLBACK');
    db.release();
    await pool.end();
  }
});
