import HttpStatus from '../../utils/statusCodes.js';
import { dbService } from '../../services/admin/dbQueries.js';
import { canAccessJob, canAccessDriver } from '../../services/admin/cityAccess.js';
import logger from '../../utils/logger.js';
import { findDriverByName, findSimilarDrivers, isNameConflict, NAME_TAKEN, parseDriverName } from '../../services/admin/driverName.js';
import { parseOptionalDriverType } from '../../services/admin/driverType.js';
import { ListInputError, listDrivers, parseListQuery } from '../../services/admin/driverList.js';
import { driverUpdateFailure, parseDriverFields, parsePhone } from '../../services/admin/driverUpdateRules.js';
import pool from '../../config/db.js';

const CITY_FORBIDDEN = { message: "You can only manage drivers in your assigned cities" };

export const createUsers = async (req, res) => {
    try {
        const { email, password, driver_code, city, enabled, phoneNumber } = req.body;

        if (!email || !password || !city || !driver_code) {
            return res.status(HttpStatus.UNAUTHORIZED).json({ message: "Email, password, city & driver code is required" })
        }
        // One name, one driver (#177): claims are matched to drivers by name, ignoring case and extra spaces.
        const parsedName = parseDriverName(req.body.name);
        if (parsedName.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedName.error });
        const name = parsedName.name;
        const parsedType = parseOptionalDriverType(req.body.driverType);
        if (parsedType.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedType.error });

        // The phone number is required (Everee cannot onboard a driver without one).
        const parsedPhone = parsePhone(phoneNumber);
        if (parsedPhone.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedPhone.error });

        if (!(await canAccessJob(req.user, city)))
            return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);

        const driver = await dbService.getDriverByEmail(email);
        if (driver)
            return res.status(HttpStatus.CONFLICT).json({ message: "User already Exists" });

        const driverCodeExists = await dbService.getDriverByCode(driver_code);
        if (driverCodeExists)
            return res.status(HttpStatus.CONFLICT).json({ message: "Driver Code already used" });

        // The same person registered twice is how a driver ends up with two Everee setups, so the admin is told which record to review instead.
        // Only records in cities this admin manages are named.
        const visible = async (rows) => {
            const out = [];
            for (const row of rows) if (await canAccessDriver(req.user, row.id)) out.push({ driverCode: row.driver_code, enabled: row.enabled });
            return out;
        };
        const clash = await findDriverByName(pool, name);
        if (clash) {
            const [seen] = await visible([clash]);
            const detail = seen ? ` (driver code ${seen.driverCode}, ${seen.enabled ? 'enabled' : 'disabled'}). Review that record instead of creating another` : '';
            return res.status(HttpStatus.CONFLICT).json({ message: `${NAME_TAKEN}${detail}` });
        }
        if (req.body.confirmSimilar !== true) {
            const similar = await visible(await findSimilarDrivers(pool, name));
            if (similar.length > 0) {
                return res.status(HttpStatus.CONFLICT).json({
                    code: 'similar_driver',
                    message: 'A driver with a very similar name already exists. Review that record before creating another',
                    similar,
                });
            }
        }

        const insertUser = await dbService.insertUser({ name, email, driver_code, password, city, enabled, phoneNumber: parsedPhone.phone, driverType: parsedType.driverType });

        return res.status(HttpStatus.OK).json({ message: "User Added Successfully!!", insertUser });
    } catch (err) {
        // Two admins saving the same name at the same moment: the database index lets only one through.
        if (isNameConflict(err)) return res.status(HttpStatus.CONFLICT).json({ message: NAME_TAKEN });
        const refused = driverUpdateFailure(err);
        if (refused) return res.status(refused.status).json({ message: refused.message });
        logger.error("Error while inserting driver", { code: err?.code, constraint: err?.constraint, message: err?.message })
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" })
    }
}

export const getUsers = async (req, res) => {
    try {
        // Search, filters, sort and each driver's Everee status come from one query. Every choice is checked against fixed lists first.
        const filters = parseListQuery(req.query);
        const scope = req.user.role === 'superadmin' ? { all: true } : { adminId: req.user.id };
        const list = await listDrivers(pool, scope, filters);
        return res.status(HttpStatus.OK).json(list);
    } catch (err) {
        if (err instanceof ListInputError) return res.status(HttpStatus.BAD_REQUEST).json({ message: err.message });
        logger.error("Get users error", err);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
}

export const changeStatusUser = async (req, res) => {
    try {
        const id = req.params.id;
      
        const checkUser = await dbService.getDriverById(id);
        if (!checkUser)
            return res.status(HttpStatus.NOT_FOUND).json({ message: "User does not exists" });
        if (!(await canAccessDriver(req.user, id)))
            return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);
        const data = await dbService.changeStatus(id);
        return res.status(HttpStatus.OK).json({ message: "User updated successfully!!", data });
    } catch (err) {
        logger.error('Error changing driver status', err);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
}

export const updateUser = async (req, res) => {
    try {
        const id = req.params.id;
        const { city, enabled, password } = req.body;
        // Email, phone and driver code go into limited columns: refuse a bad one here, with a message, instead of letting the database fail.
        const fields = parseDriverFields(req.body);
        if (fields.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: fields.error });
        const { email, phoneNumber } = fields;
        let driver_code = fields.driverCode;
        const parsedName = parseDriverName(req.body.name);
        if (parsedName.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedName.error });
        const name = parsedName.name;
        const parsedType = parseOptionalDriverType(req.body.driverType);
        if (parsedType.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedType.error });

        const existing = await dbService.getDriverById(id);
        if (!existing)
            return res.status(HttpStatus.NOT_FOUND).json({ message: "User does not exists" });
        if (driver_code === null) driver_code = existing.driver_code; // the code cannot be empty: a request without one keeps the current code
        // The driver must be in one of the admin's cities now, and so must the city they move to.
        if (!(await canAccessDriver(req.user, id)) || !(await canAccessJob(req.user, city)))
            return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);

        // The email must stay unique (the create form checks this too). A clash used to reach the database and come back as "Server error".
        const sameEmail = await dbService.getDriverByEmail(email);
        if (sameEmail && sameEmail.id !== parseInt(id)) {
            return res.status(HttpStatus.CONFLICT).json({ message: "Another driver already uses this email" });
        }

        // Check if driver_code is being changed and if it already exists for another driver
        if (driver_code) {
            const existingDriver = await dbService.getDriverByCode(driver_code);
            
            // Only return error if the code exists AND belongs to a different driver
            if (existingDriver && existingDriver.id !== parseInt(id)) {
                return res.status(409).json({
                    message: "Driver code already exists"
                });
            }
        }

        // A driver may keep their own name; any other driver's name, ignoring case and spaces, is taken (#177).
        if (await findDriverByName(pool, name, Number(id))) return res.status(HttpStatus.CONFLICT).json({ message: NAME_TAKEN });

        const updateData = {
            name,
            email,
            city,
            enabled: typeof enabled === 'boolean' ? enabled : existing.enabled, // a form that leaves it out keeps the current value (the column cannot be empty)
            phoneNumber,
            driver_code,
            driverType: parsedType.driverType // null = keep the driver's current type
        };

        // Only include password if it's provided (not empty)
        if (password && password.trim()) {
            updateData.password = password;
        }

        const updatedUser = await dbService.updateDriver(id, updateData);

        return res.status(200).json({
            message: "Driver updated successfully",
            updatedUser,
        });
    } catch (err) {
        if (isNameConflict(err)) return res.status(HttpStatus.CONFLICT).json({ message: NAME_TAKEN });
        // A refusal we know (email or code already used, a value too long, a city that is disabled) says what to change.
        const refused = driverUpdateFailure(err);
        if (refused) return res.status(refused.status).json({ message: refused.message });
        // The code and constraint are logged so the cause of a real server error can be read from the log.
        logger.error("Update user error", { code: err?.code, constraint: err?.constraint, message: err?.message });
        res.status(500).json({ message: "Server error" });
    }
};