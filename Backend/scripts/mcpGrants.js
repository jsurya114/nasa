// Operator tool for the NASA Insights connector (issue #220): see who is connected and disconnect them.
// Run from the Backend folder with the same database settings as the app. It only touches the mcp_oauth_* sign-in tables.
//
//   node scripts/mcpGrants.js list                 active connections (no tokens are stored or shown)
//   node scripts/mcpGrants.js revoke-admin <id>    disconnect everything signed in as that NASA admin
//   node scripts/mcpGrants.js revoke-all           disconnect every connection
//
// Disabling the connector entirely is MCP_ENABLED=false (or unset) and a restart.
import dotenv from 'dotenv';
import pool from '../config/db.js';
import { listActiveGrants, revokeAllGrants, revokeGrantsForAdmin } from '../services/mcp/store.js';

dotenv.config();
const [command, argument] = process.argv.slice(2);

try {
  if (command === 'list') {
    const rows = await listActiveGrants(pool);
    console.table(rows.map((r) => ({ grant: r.id, admin: r.admin_id, email: r.email, client: r.client_name, scope: r.scope, created: r.created_at?.toISOString(), lastUsed: r.last_used_at?.toISOString() ?? 'never' })));
    console.log(`${rows.length} active connection(s)`);
  } else if (command === 'revoke-admin' && /^\d+$/.test(argument || '')) {
    console.log(`Revoked ${await revokeGrantsForAdmin(pool, Number(argument), 'revoked_by_operator')} connection(s) for admin ${argument}`);
  } else if (command === 'revoke-all') {
    console.log(`Revoked ${await revokeAllGrants(pool, 'revoked_by_operator')} connection(s)`);
  } else {
    console.error('Usage: node scripts/mcpGrants.js list | revoke-admin <admin id> | revoke-all');
    process.exitCode = 2;
  }
} finally {
  await pool.end();
}
