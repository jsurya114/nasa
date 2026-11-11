import HttpStatus from '../../utils/statusCodes.js';
import { dbService } from '../../services/admin/dbQueries.js';
import { canAccessJob, canAccessDriver } from '../../services/admin/cityAccess.js';
import logger from '../../utils/logger.js';
import { findDriverByName, isNameConflict, NAME_TAKEN, parseDriverName } from '../../services/admin/driverName.js';
import { parseOptionalDriverType } from '../../services/admin/driverType.js';
import { ListInputError, listDrivers, parseListQuery } from '../../services/admin/driverList.js';
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

        if (!(await canAccessJob(req.user, city)))
            return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);

        const driver = await dbService.getDriverByEmail(email);
        if (driver)
            return res.status(HttpStatus.CONFLICT).json({ message: "User already Exists" });

        const driverCodeExists = await dbService.getDriverByCode(driver_code);
        if (driverCodeExists)
            return res.status(HttpStatus.CONFLICT).json({ message: "Driver Code already used" });

        if (await findDriverByName(pool, name)) return res.status(HttpStatus.CONFLICT).json({ message: NAME_TAKEN });

        const insertUser = await dbService.insertUser({ name, email, driver_code, password, city, enabled, phoneNumber, driverType: parsedType.driverType });

        return res.status(HttpStatus.OK).json({ message: "User Added Successfully!!", insertUser });
    } catch (err) {
        // Two admins saving the same name at the same moment: the database index lets only one through.
        if (isNameConflict(err)) return res.status(HttpStatus.CONFLICT).json({ message: NAME_TAKEN });
        logger.error("Error while inserting driver", err)
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
        const { email, city, enabled, phoneNumber, password, driver_code } = req.body;
        const parsedName = parseDriverName(req.body.name);
        if (parsedName.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedName.error });
        const name = parsedName.name;
        const parsedType = parseOptionalDriverType(req.body.driverType);
        if (parsedType.error) return res.status(HttpStatus.BAD_REQUEST).json({ message: parsedType.error });

        const existing = await dbService.getDriverById(id);
        if (!existing)
            return res.status(HttpStatus.NOT_FOUND).json({ message: "User does not exists" });
        // The driver must be in one of the admin's cities now, and so must the city they move to.
        if (!(await canAccessDriver(req.user, id)) || !(await canAccessJob(req.user, city)))
            return res.status(HttpStatus.FORBIDDEN).json(CITY_FORBIDDEN);

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
            enabled,
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
        logger.error("Update user error", err);
        res.status(500).json({ message: "Server error" });
    }
};