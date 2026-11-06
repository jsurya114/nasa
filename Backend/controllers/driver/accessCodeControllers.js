// controllers/driver/accessCodeControllers.js
import accessCodeQueries from "../../services/driver/accessCodeQueries.js";
import logger from '../../utils/logger.js';

// Helper to get language from request
const getLang = (req) => {
  return req.headers['x-language'] || req.query?.lang || 'en';
};

export const getAccessCodes = async (req, res) => {
  try {
    const lang = getLang(req);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const search = req.query.search || '';
    const zipCodeFilter = req.query.zip_code || '';

    const result = await accessCodeQueries.getAccessCodes(page, limit, search, zipCodeFilter);
    
    // Add imageCount for convenience on client
    result.data.forEach((access_code) => {
      access_code.imageCount = 0;
      if (access_code.image_url1) access_code.imageCount++;
      if (access_code.image_url2) access_code.imageCount++;
      if (access_code.image_url3) access_code.imageCount++;
    });

    res.json(result);
  } catch (err) {
    const lang = getLang(req);
    logger.error("Driver Controller error in getAccessCodes", err);
    res.status(500).json({ message: err.message });
  }
};
