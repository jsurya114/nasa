import { previewStatement, publishStatement } from './publishStatement.js';
import { listStatements, listUnallocated, loadStatement, rematchOpenGroups, voidStatement, addEvent } from './statementStore.js';

// The router's service, built on a pg pool. Each call is one unit of work; publishing opens its own transaction.
export const createStatementService = (pool) => ({
  list: () => listStatements(pool),
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
