import { previewStatement, publishStatement } from './publishStatement.js';
import { listStatements, listUnallocated, loadStatement, rematchOpenGroups, voidStatement, addEvent } from './statementStore.js';
import { statementEconomics } from './statementEconomics.js';
import { STATEMENT_COLUMNS, UNALLOCATED_COLUMNS, toCsv } from './statementCsv.js';

// The router's service, built on a pg pool. Each call is one unit of work; publishing opens its own transaction.
// The statements with their economics (revenue, driver earnings, margin, contribution), worked out from the shared reporting view.
const listWithEconomics = async (pool, options) => {
  const statements = await listStatements(pool, options);
  const economics = await statementEconomics(pool, statements.map((s) => s.id));
  return statements.map((s) => ({ ...s, economics: economics.get(String(s.id)) ?? null }));
};

export const createStatementService = (pool) => ({
  list: () => listWithEconomics(pool),
  exportCsv: async () => toCsv(STATEMENT_COLUMNS, (await listWithEconomics(pool, { limit: 500 })).map((s) => ({ ...s, ...s.economics, city: s.city }))),
  unallocatedCsv: async (id) => ((await loadStatement(pool, id)) ? toCsv(UNALLOCATED_COLUMNS, await listUnallocated(pool, id, { limit: 5000 })) : null),
  preview: (buffer) => previewStatement(pool, buffer),
  publish: (buffer, options) => publishStatement(pool, buffer, options),
  unallocated: async (id) => ((await loadStatement(pool, id)) ? listUnallocated(pool, id) : null),
  void: (id, options) => voidStatement(pool, id, options),
  rematch: async (id, { actorId }) => {
    const statement = await loadStatement(pool, id);
    if (!statement || statement.status !== 'published') return null;
    const matched = await rematchOpenGroups(pool, { statementId: id });
    if (matched > 0) await addEvent(pool, id, 'rematched', actorId, `${matched} group${matched === 1 ? '' : 's'} matched`);
    return matched;
  },
});
