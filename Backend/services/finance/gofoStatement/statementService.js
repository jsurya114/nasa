import { previewStatement, publishStatement } from './publishStatement.js';
import { listStatements, listUnallocated, loadStatement, rematchStatement, voidStatement } from './statementStore.js';

// The router's service, built on a pg pool. Each call is one unit of work: publishing, voiding and re-matching each run in one transaction.
export const createStatementService = (pool) => ({
  list: () => listStatements(pool),
  preview: (buffer) => previewStatement(pool, buffer),
  publish: (buffer, options) => publishStatement(pool, buffer, options),
  unallocated: async (id) => ((await loadStatement(pool, id)) ? listUnallocated(pool, id) : null),
  void: (id, options) => voidStatement(pool, id, options),
  rematch: (id, { actorId }) => rematchStatement(pool, id, { actorId }),
});
