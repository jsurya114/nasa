import pool from '../../config/db.js';
import HttpStatus from '../../utils/statusCodes.js';
import logger from '../../utils/logger.js';
import { getAllowedJobs, isCityLimited } from '../../services/admin/adminCityAccess.js';
import { ChoiceError, cityOfChoice, deleteChoice, listChoices, listDailyCities, saveNameMatch, saveSubRouteChoice } from '../../services/admin/dailyByName/dailyChoices.js';

// Admin (super admin, or a city admin for their own cities): the remembered choices of the daily upload that finds drivers by name.
const positive = (value) => (Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null);

const mayUseCity = async (user, cityId) => {
  if (!isCityLimited(user.role)) return true;
  const job = (await pool.query('SELECT job FROM city WHERE id = $1', [cityId])).rows[0]?.job;
  return Boolean(job) && (await getAllowedJobs(user.id)).includes(job);
};

const handle = (action) => async (req, res) => {
  try {
    await action(req, res);
  } catch (error) {
    if (error instanceof ChoiceError) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: error.message });
    logger.error('Daily matching choice failed', error);
    return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ success: false, message: 'The choice could not be saved. Try again.' });
  }
};

const cityFrom = async (req, res, value) => {
  const cityId = positive(value);
  if (!cityId) { res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Choose a city.' }); return null; }
  if (!(await mayUseCity(req.user, cityId))) { res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'This city is not one of your cities.' }); return null; }
  return cityId;
};

export const getDailyChoices = handle(async (req, res) => {
  if (req.query.cityId === undefined) {
    const allowed = isCityLimited(req.user.role) ? await getAllowedJobs(req.user.id) : null;
    return res.status(HttpStatus.OK).json({ success: true, cities: await listDailyCities(pool, allowed) });
  }
  const cityId = await cityFrom(req, res, req.query.cityId);
  if (!cityId) return;
  res.status(HttpStatus.OK).json({ success: true, ...(await listChoices(pool, cityId)) });
});

export const putNameMatch = handle(async (req, res) => {
  const cityId = await cityFrom(req, res, req.body?.cityId);
  if (!cityId) return;
  const driverId = positive(req.body?.driverId);
  if (!driverId) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Choose a driver.' });
  const id = await saveNameMatch(pool, { cityId, fileName: req.body?.fileName, driverId, adminId: req.user.id });
  logger.info('Daily name match saved', { id, cityId, driverId });
  res.status(HttpStatus.OK).json({ success: true, id });
});

export const putSubRouteChoice = handle(async (req, res) => {
  const cityId = await cityFrom(req, res, req.body?.cityId);
  if (!cityId) return;
  const [mainRouteId, driverId, subRouteId] = ['mainRouteId', 'driverId', 'subRouteId'].map((k) => positive(req.body?.[k]));
  if (!mainRouteId || !driverId || !subRouteId) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Choose the driver, the main route and the sub-route.' });
  const id = await saveSubRouteChoice(pool, { cityId, mainRouteId, driverId, subRouteId, adminId: req.user.id });
  logger.info('Daily sub-route choice saved', { id, cityId, driverId, mainRouteId, subRouteId });
  res.status(HttpStatus.OK).json({ success: true, id });
});

export const deleteDailyChoice = handle(async (req, res) => {
  const kind = req.params.kind === 'names' ? 'names' : req.params.kind === 'subroutes' ? 'subroutes' : null;
  const id = positive(req.params.id);
  if (!kind || !id) return res.status(HttpStatus.BAD_REQUEST).json({ success: false, message: 'Unknown entry.' });
  const cityId = await cityOfChoice(pool, kind, id);
  if (!cityId) return res.status(HttpStatus.NOT_FOUND).json({ success: false, message: 'That entry no longer exists.' });
  if (!(await mayUseCity(req.user, cityId))) return res.status(HttpStatus.FORBIDDEN).json({ success: false, message: 'This city is not one of your cities.' });
  await deleteChoice(pool, kind, id);
  logger.info('Daily matching choice undone', { kind, id, cityId });
  res.status(HttpStatus.OK).json({ success: true });
});
