// services/driver/accessCodeQueries.js
import pool from "../../config/db.js";
import logger from '../../utils/logger.js';

const accessCodeQueries = {
  getAccessCodes: async (page = 1, limit = 10, search = '', zipCodeFilter = '') => {
    try {
      const offset = (page - 1) * limit;
      
      // Build the WHERE clause dynamically
      let whereConditions = [];
      let queryParams = [];
      let paramIndex = 1;

      if (search) {
        whereConditions.push(`(ac.address ILIKE $${paramIndex} OR ac.access_code ILIKE $${paramIndex} OR ac.zip_code ILIKE $${paramIndex})`);
        queryParams.push(`%${search}%`);
        paramIndex++;
      }

      if (zipCodeFilter) {
        whereConditions.push(`ac.zip_code ILIKE $${paramIndex}`);
        queryParams.push(`%${zipCodeFilter}%`);
        paramIndex++;
      }

      const whereClause = whereConditions.length > 0 ? `WHERE ${whereConditions.join(' AND ')}` : '';

      // Get total count
      const countQuery = `
        SELECT COUNT(*) as total
        FROM public.access_codes ac
        ${whereClause};
      `;
      const countResult = await pool.query(countQuery, queryParams);
      const total = parseInt(countResult.rows[0].total);

      // Get paginated data
      const dataQuery = `
        SELECT ac.id,
               ac.zip_code,
               ac.address,
               ac.access_code,
               ac.image_url1,
               ac.image_url2,
               ac.image_url3,
               ac.created_at 
        FROM public.access_codes ac
        ${whereClause}
        ORDER BY ac.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1};
      `;
      queryParams.push(limit, offset);
      const dataResult = await pool.query(dataQuery, queryParams);


      return {
        data: dataResult.rows,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasMore: offset + dataResult.rows.length < total
        }
      };
    } catch (error) {
      logger.error('Driver Database error in getAccessCodes', error);
      throw error;
    }
  },
};

export default accessCodeQueries;
