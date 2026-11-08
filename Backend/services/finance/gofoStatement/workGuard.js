// The database refuses to move or delete a journey that carries revenue verified by a standing carrier statement (carrier_statement_work_guard in the
// carrier statements migration, SQLSTATE CS001). The message it carries is written for the person and has no data in it beyond the statement number.
export const STATEMENT_WORK_CONFLICT = 'CS001';

export const isStatementWorkConflict = (error) => error?.code === STATEMENT_WORK_CONFLICT;
