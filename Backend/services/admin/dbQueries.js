import pool  from "../../config/db.js";
import bcrypt from "bcrypt";
import { jobService } from "./jobQueries.js";

export const dbService = {
    getAdminByEmail: async (email) => {
        let result = await pool.query("SELECT * FROM admin WHERE email = $1", [email]);
        return result.rows[0];
    },
    
    checkPassword: async (password, hashedPassword) => {
        return await bcrypt.compare(password, hashedPassword)
    },

    hashedPassword: async (password) => {
        const saltRounds = 10;
        return await bcrypt.hash(password, saltRounds);
    },
    
    getDriverByEmail: async (email) => {
        let result = await pool.query("SELECT * FROM drivers WHERE email = $1", [email]);
        return result.rows[0];
    },

    getDriverByCode: async (code) => {
        let result = await pool.query("SELECT * FROM drivers WHERE driver_code = $1", [code]);
        return result.rows[0];
    },

    getDriverById: async (id) => {
        let result = await pool.query("SELECT * FROM drivers WHERE id = $1", [id]);
        return result.rows[0];
    },

    getAdminById: async (id) => {
        let result = await pool.query("SELECT * FROM admin WHERE id = $1", [id]);
        return result.rows[0];
    },

    getCountOfAdmins: async () => {
        const countResult = await pool.query(`SELECT COUNT(*) FROM admin`);
        return parseInt(countResult.rows[0].count, 10);
    },
    
    getCountOfDrivers: async (search = "", city = "") => {
        let query = `SELECT COUNT(*) FROM drivers d JOIN city c ON d.city_id = c.id WHERE 1=1`;
        const params = [];
        let paramIndex = 1;

        if (search) {
            query += ` AND (d.name ILIKE $${paramIndex} OR d.email ILIKE $${paramIndex} OR d.driver_code::text ILIKE $${paramIndex} OR d.phone_number ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (city && city !== "All") {
            query += ` AND c.job = $${paramIndex}`;
            params.push(city);
            paramIndex++;
        }

        const countResult = await pool.query(query, params);
        return parseInt(countResult.rows[0].count, 10);
    },
    
    getAllDrivers: async (lim, offset, search = "", city = "") => {
        let query = `
            SELECT d.id, d.driver_code, d.name, d.email, d.phone_number, c.job, d.enabled 
            FROM drivers d
            JOIN city c ON d.city_id = c.id 
            WHERE 1=1`;
        
        const params = [];
        let paramIndex = 1;

        if (search) {
            query += ` AND (d.name ILIKE $${paramIndex} OR d.email ILIKE $${paramIndex} OR d.driver_code::text ILIKE $${paramIndex} OR d.phone_number ILIKE $${paramIndex})`;
            params.push(`%${search}%`);
            paramIndex++;
        }

        if (city && city !== "All") {
            query += ` AND c.job = $${paramIndex}`;
            params.push(city);
            paramIndex++;
        }

        query += ` ORDER BY d.name ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
        params.push(lim, offset);

        let result = await pool.query(query, params);
        return result.rows;
    },
    
    getAllAdmins: async (limit, offset) => {
        const result = await pool.query(
            `SELECT 
                a.id AS id,
                a.name AS admin_name,
                a.email AS admin_email,
                a.role AS admin_role,
                a.is_active,
                COALESCE(STRING_AGG(c.job, ', '), '') AS cities
            FROM admin a
            LEFT JOIN admin_city_ref acr ON a.id = acr.admin_id
            LEFT JOIN city c ON acr.city_id = c.id
            WHERE a.id != $1
            GROUP BY a.id, a.name, a.email, a.role, a.is_active
            ORDER BY a.id
            LIMIT $2 OFFSET $3`,
            [100, limit, offset]
        );
        return result.rows;
    },

    insertUser: async (data) => {    
        try {
            const city_id = await jobService.getCityByJob(data.city);
            const hashedPwd = await dbService.hashedPassword(data.password);

            const result = await pool.query(
                `INSERT INTO drivers (name, email, driver_code, password, city_id, enabled, phone_number) 
                 VALUES ($1, $2, $3, $4, $5, $6, $7)
                 RETURNING id, name, email, enabled, city_id, driver_code, phone_number`,
                [data.name, data.email, data.driverCode, hashedPwd, city_id, data.enabled, data.phoneNumber || null]
            );
            
            const driver = result.rows[0];
            
            const driverWithCity = await pool.query(
                `SELECT d.id, d.driver_code, d.name, d.email, d.phone_number, c.job, d.enabled
                 FROM drivers d
                 JOIN city c ON d.city_id = c.id
                 WHERE d.id = $1`,
                [driver.id]
            );
            
            return driverWithCity.rows[0];
        } catch (err) {
            console.error("Error inserting user:", err.message);
            throw err;
        }
    },

    insertAdmin: async (data) => {    
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const hashedPwd = await dbService.hashedPassword(data.password);
            const result = await client.query(
                `INSERT INTO admin (name, email, password, role) 
                 VALUES ($1, $2, $3, $4) 
                 RETURNING id, name, email, role, is_active`,
                [data.name, data.email, hashedPwd, data.role]
            );
            const admin = result.rows[0];

            const cities = Array.isArray(data.city) ? data.city : [];
            if (data.role === 'admin' && cities.length > 0) {
                const values = data.city.map((c) => `(${admin.id}, ${c.value})`).join(',');
                const query = `
                    INSERT INTO admin_city_ref(admin_id, city_id)
                    VALUES ${values}
                    ON CONFLICT (admin_id, city_id) DO NOTHING;
                `;
                await client.query(query);
            }

            await client.query('COMMIT');
            
            const adminWithCities = await pool.query(
                `SELECT 
                    a.id AS id,
                    a.name AS admin_name,
                    a.email AS admin_email,
                    a.role AS admin_role,
                    a.is_active,
                    COALESCE(STRING_AGG(c.job, ', '), '') AS cities
                FROM admin a
                LEFT JOIN admin_city_ref acr ON a.id = acr.admin_id
                LEFT JOIN city c ON acr.city_id = c.id
                WHERE a.id = $1
                GROUP BY a.id, a.name, a.email, a.role, a.is_active`,
                [admin.id]
            );
            
            return adminWithCities.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            console.error("Error inserting new admin:", err.message);
            throw err;
        } finally {
            client.release();
        }
    },
    
    changeStatus: async (id) => {
        const result = await pool.query(
            `UPDATE drivers 
             SET enabled = NOT enabled 
             WHERE id = $1 
             RETURNING id, driver_code, name, email, city_id, enabled, phone_number`,
            [id]
        );

        const updated = result.rows[0];
        if (!updated) return null;

        const joined = await pool.query(
            `SELECT d.id, d.driver_code, d.name, d.email, d.phone_number, c.job, d.enabled
             FROM drivers d
             JOIN city c ON d.city_id = c.id
             WHERE d.id = $1`,
            [updated.id]
        );

        return joined.rows[0];  
    },

    changeStatusOfAdmin: async (id) => {
        const result = await pool.query(
            `UPDATE admin 
             SET is_active = NOT is_active 
             WHERE id = $1 
             RETURNING id, name, email, role, is_active`,
            [id]
        );
        return result.rows[0];
    },

    changeRoleOfAdmin: async (id) => {
        const result = await pool.query(
            `UPDATE admin 
             SET role = CASE 
                          WHEN role = 'admin' THEN 'superadmin'
                          ELSE 'admin'
                        END
             WHERE id = $1 
             RETURNING id, name, email, role, is_active`,
            [id]
        );
        return result.rows[0];
    },

    getDashboardData: async () => {
        const result = await pool.query(`SELECT * FROM dashboard_data`);
        
        return result.rows;
    },

    updateDriver: async (id, data) => {
        const city_id = await jobService.getCityByJob(data.city);

        // Build the update query dynamically based on whether password is provided
        let updateQuery;
        let updateParams;

        if (data.password && data.password.trim()) {
            // Hash the new password
            const hashedPwd = await dbService.hashedPassword(data.password);
            
            updateQuery = `
                UPDATE drivers
                SET name=$1, email=$2, city_id=$3, enabled=$4, phone_number=$5, password=$6
                WHERE id=$7
            `;
            updateParams = [data.name, data.email, city_id, data.enabled, data.phoneNumber || null, hashedPwd, id];
        } else {
            // Update without changing password
            updateQuery = `
                UPDATE drivers
                SET name=$1, email=$2, city_id=$3, enabled=$4, phone_number=$5
                WHERE id=$6
            `;
            updateParams = [data.name, data.email, city_id, data.enabled, data.phoneNumber || null, id];
        }

        await pool.query(updateQuery, updateParams);

        const joined = await pool.query(
            `SELECT d.id, d.driver_code, d.name, d.email, d.phone_number, c.job, d.enabled
             FROM drivers d
             JOIN city c ON d.city_id = c.id
             WHERE d.id = $1`,
            [id]
        );

        return joined.rows[0];
    },

    updateAdmin: async (id, data) => {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');

            const result = await client.query(
                `UPDATE admin 
                 SET name = $1, email = $2, role = $3
                 WHERE id = $4 
                 RETURNING id, name, email, role, is_active`,
                [data.name, data.email, data.role, id]
            );
            
            const admin = result.rows[0];
            
            if (!admin) {
                throw new Error('Admin not found');
            }

            await client.query(
                `DELETE FROM admin_city_ref WHERE admin_id = $1`,
                [id]
            );

            const cities = Array.isArray(data.city) ? data.city : [];
            if (data.role === 'admin' && cities.length > 0) {
                const values = cities.map((c) => `(${admin.id},${c.value})`).join(',');
                const query = `
                    INSERT INTO admin_city_ref(admin_id, city_id)
                    VALUES ${values}
                    ON CONFLICT (admin_id, city_id) DO NOTHING;
                `;
                await client.query(query);
            }

            await client.query('COMMIT');
            
            const joined = await client.query(
                `SELECT 
                    a.id AS id,
                    a.name AS admin_name,
                    a.email AS admin_email,
                    a.role AS admin_role,
                    a.is_active,
                    COALESCE(STRING_AGG(c.job, ', '), '') AS cities
                FROM admin a
                LEFT JOIN admin_city_ref acr ON a.id = acr.admin_id
                LEFT JOIN city c ON acr.city_id = c.id
                WHERE a.id = $1
                GROUP BY a.id, a.name, a.email, a.role, a.is_active`,
                [id]
            );
            
            return joined.rows[0];
        } catch (err) {
            await client.query('ROLLBACK');
            console.error("Error updating admin:", err.message);
            throw err;
        } finally {
            client.release();
        }
    },
    
    getAdminCities: async (adminId) => {
        try {
            const result = await pool.query(
                `SELECT c.id, c.job, c.city_code, c.enabled
                 FROM city c
                 INNER JOIN admin_city_ref acr ON c.id = acr.city_id
                 WHERE acr.admin_id = $1 AND c.enabled = true
                 ORDER BY c.job ASC`,
                [adminId]
            );
            
   
            return result.rows;
        } catch (error) {
            console.error("Error in getAdminCities:", error.message);
            throw error;
        }
    },

    getDriversByAdminCities: async (adminId, limit, offset, search = "", city = "") => {
        try {
            let query = `
                SELECT d.id, d.driver_code, d.name, d.email, d.phone_number, c.job, d.enabled 
                FROM drivers d
                JOIN city c ON d.city_id = c.id
                JOIN admin_city_ref acr ON c.id = acr.city_id
                WHERE acr.admin_id = $1`;
            
            const params = [adminId];
            let paramIndex = 2;

            if (search) {
                query += ` AND (d.name ILIKE $${paramIndex} OR d.email ILIKE $${paramIndex} OR d.driver_code::text ILIKE $${paramIndex} OR d.phone_number ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            if (city && city !== "All") {
                query += ` AND c.job = $${paramIndex}`;
                params.push(city);
                paramIndex++;
            }

            query += ` ORDER BY d.name ASC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
            params.push(limit, offset);

            const result = await pool.query(query, params);
            return result.rows;
        } catch (error) {
            console.error("Error in getDriversByAdminCities:", error.message);
            throw error;
        }
    },

    getCountOfDriversByAdminCities: async (adminId, search = "", city = "") => {
        try {
            let query = `
                SELECT COUNT(*) 
                FROM drivers d
                JOIN city c ON d.city_id = c.id
                JOIN admin_city_ref acr ON c.id = acr.city_id
                WHERE acr.admin_id = $1`;
            
            const params = [adminId];
            let paramIndex = 2;

            if (search) {
                query += ` AND (d.name ILIKE $${paramIndex} OR d.email ILIKE $${paramIndex} OR d.driver_code::text ILIKE $${paramIndex} OR d.phone_number ILIKE $${paramIndex})`;
                params.push(`%${search}%`);
                paramIndex++;
            }

            if (city && city !== "All") {
                query += ` AND c.job = $${paramIndex}`;
                params.push(city);
                paramIndex++;
            }

            const result = await pool.query(query, params);
            return parseInt(result.rows[0].count, 10);
        } catch (error) {
            console.error("Error in getCountOfDriversByAdminCities:", error.message);
            throw error;
        }
    }
};