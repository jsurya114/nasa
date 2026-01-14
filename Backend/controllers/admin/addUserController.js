import HttpStatus from '../../utils/statusCodes.js';
import { dbService } from '../../services/admin/dbQueries.js';

export const createUsers = async (req, res) => {
    try {
        const { email, password, name, driver_code, city, enabled, phoneNumber } = req.body;

        if (!email || !password || !city || !driver_code) {
            return res.status(HttpStatus.UNAUTHORIZED).json({ message: "Email, password, city & driver code is required" })
        }

        const driver = await dbService.getDriverByEmail(email);
        if (driver)
            return res.status(HttpStatus.CONFLICT).json({ message: "User already Exists" });

        const driverCodeExists = await dbService.getDriverByCode(driver_code);
        if (driverCodeExists)
            return res.status(HttpStatus.CONFLICT).json({ message: "Driver Code already used" });

        const insertUser = await dbService.insertUser({ name, email, driver_code, password, city, enabled, phoneNumber });

        return res.status(HttpStatus.OK).json({ message: "User Added Successfully!!", insertUser });
    } catch (err) {
        console.log("Error while inserting data ", err.message)
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" })
    }
}

export const getUsers = async (req, res) => {
    try {
       

        const adminId = req.user.id;
        const adminRole = req.user.role;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;
        const search = req.query.search || "";
        const city = req.query.city || "";

        let drivers;
        let totalDrivers;

        if (adminRole === 'superadmin') {
            drivers = await dbService.getAllDrivers(limit, offset, search, city);
            totalDrivers = await dbService.getCountOfDrivers(search, city);
        } else {
            drivers = await dbService.getDriversByAdminCities(adminId, limit, offset, search, city);
            totalDrivers = await dbService.getCountOfDriversByAdminCities(adminId, search, city);
        }

        const totalPages = Math.ceil(totalDrivers / limit);

        return res.status(HttpStatus.OK).json({
            drivers,
            page,
            totalPages
        });
    } catch (err) {
        console.error("Get users error:", err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
}

export const changeStatusUser = async (req, res) => {
    try {
        const id = req.params.id;
      
        const checkUser = await dbService.getDriverById(id);
        if (!checkUser)
            return res.status(HttpStatus.NOT_FOUND).json({ message: "User does not exists" });
        const data = await dbService.changeStatus(id);
        return res.status(HttpStatus.OK).json({ message: "User updated successfully!!", data });
    } catch (err) {
        console.error(err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
}

export const updateUser = async (req, res) => {
    try {
        const id = req.params.id;
        const { name, email, city, enabled, phoneNumber, password, driver_code } = req.body;

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

        const updateData = {
            name,
            email,
            city,
            enabled,
            phoneNumber,
            driver_code
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
        console.error("Update user error:", err.message);
        res.status(500).json({ message: "Server error" });
    }
};