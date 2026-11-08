import { StatementWorkChanged, rematchOpenGroups } from './statementStore.js';

const UNDEFINED_TABLE = '42P01';

// Matches carrier statement groups that were waiting for work, right after a weekly add put that work on the Dashboard (issue #252). It runs in a savepoint of the caller's
// transaction and NEVER fails the caller: matching does not change what the weekly add stores. rematchOpenGroups holds and re-checks the pay rows it attaches; if a journey changed
// meanwhile (StatementWorkChanged), or anything else goes wrong, the match is undone, the weekly import stays exactly as it was, and the groups stay unmatched for the next add or
// the owner's "Match again". An older database without the statement tables simply skips it. Returns how many groups were matched.
export const matchAfterWeeklyAdd = async (client, logger) => {
  await client.query('SAVEPOINT statement_rematch');
  try {
    const matched = await rematchOpenGroups(client);
    await client.query('RELEASE SAVEPOINT statement_rematch');
    return matched;
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT statement_rematch');
    if (error instanceof StatementWorkChanged) logger.warn('Carrier statement matching was skipped after the weekly add because a journey changed; it will match on the next add or with Match again');
    else if (error.code !== UNDEFINED_TABLE) logger.error('Carrier statements could not be matched after the weekly add', error);
    return 0;
  }
};
