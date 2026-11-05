import { PayrollError } from '../../services/payroll/payRuns/payRunStore.js';

const MAX_STATEMENTS = 2000;

// An optional list of statement numbers (the drivers chosen for a payment): absent means the whole run. A list in the request body is an array;
// in a query string it is "1,2,3". Anything else, an empty list or a bad number is a 400, never silently the whole run.
export const statementIdList = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  const list = Array.isArray(value) ? value : String(value).split(',');
  if (list.length === 0 || list.length > MAX_STATEMENTS || list.some((v) => !/^\d{1,12}$/.test(String(v).trim()) || Number(v) <= 0)) {
    throw new PayrollError(400, 'statementIds must be a list of statement numbers from this run');
  }
  return [...new Set(list.map((v) => Number(String(v).trim())))].sort((a, b) => a - b);
};
