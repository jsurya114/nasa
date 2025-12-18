import express from 'express';
import HttpStatus from '../../utils/statusCodes.js';
import { dbService } from '../../services/admin/dbQueries.js';
import { jobService } from '../../services/admin/jobQueries.js';

// Replace the createAdmins function in addAdminController.js

export const createAdmins = async(req, res) => {
    try {
        // Verify superadmin access (double check even though middleware handles this)
        if (req.user.role !== 'superadmin') {
            return res.status(HttpStatus.FORBIDDEN).json({
                message: "Only superadmin can create admin accounts"
            });
        }

        const {email, password, name, role, cities} = req.body;
        const city = Array.isArray(cities) ? cities : [];
        
        console.log("Creating admin with data:", { name, email, role, cityCount: city.length });
        
        // Validate required fields
        if (!email || !password || !name) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "Email, password & Name are required"
            });
        }

        // Validate city requirement for admin role
        if (role === 'admin' && city.length <= 0) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "At least one city must be provided for Admin User"
            });
        }

        // Check if admin already exists
        const existingAdmin = await dbService.getAdminByEmail(email);
        if (existingAdmin) {
            return res.status(HttpStatus.CONFLICT).json({
                error: "Admin email already exists"
            });
        }

        // Prevent creating multiple superadmins without proper authorization
        if (role === 'superadmin') {
            console.log(`⚠️ Superadmin creation attempt by ${req.user.email}`);
        }

        const insertAdmin = await dbService.insertAdmin({name, email, password, role, city});    
        
        console.log("Admin created successfully:", insertAdmin);

        return res.status(HttpStatus.OK).json({
            message: "Admin Added Successfully!",
            insertAdmin
        });
    } catch(err) {
        console.error("Error while inserting admin:", err.message);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            message: "Server error while creating admin"
        });
    }
}

export const getAdmins = async(req, res) => {
    try {
        // Verify superadmin access
        if (req.user.role !== 'superadmin') {
            return res.status(HttpStatus.FORBIDDEN).json({
                message: "Only superadmin can view admin list"
            });
        }

        let page = req.query.page || 1;
        let limit = 5;
        let offset = (page - 1) * limit;

        const data = await dbService.getAllAdmins(limit, offset);
        const totalCount = await dbService.getCountOfAdmins();
        const totalPages = Math.ceil(totalCount / limit); 

        return res.status(HttpStatus.OK).json({
            admins: data,
            page: parseInt(page),
            totalPages
        });
    } catch(err) {
        console.error("Error fetching admins:", err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
            message: "Server error" 
        });
    }
}

export const changeStatusAdmin = async(req, res) => {
    try {
        // Verify superadmin access
        if (req.user.role !== 'superadmin') {
            return res.status(HttpStatus.FORBIDDEN).json({
                message: "Only superadmin can change admin status"
            });
        }

        const id = req.params.id;

        // Prevent superadmin from disabling themselves
        if (parseInt(id) === req.user.id) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "Cannot change your own status"
            });
        }

        const checkUser = await dbService.getAdminById(id);
        if (!checkUser) {
            return res.status(HttpStatus.NOT_FOUND).json({
                message: "Admin does not exist!"
            });
        }

        const data = await dbService.changeStatusOfAdmin(id);
        
        return res.status(HttpStatus.OK).json({
            message: "Admin status updated successfully!",
            data
        });
    } catch(err) {
        console.error("Error changing admin status:", err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
            message: "Server error" 
        });
    }
}

export const changeRoleAdmin = async(req, res) => {
    try {
        // Verify superadmin access
        if (req.user.role !== 'superadmin') {
            return res.status(HttpStatus.FORBIDDEN).json({
                message: "Only superadmin can change admin roles"
            });
        }

        const id = req.params.id;

        // Prevent superadmin from changing their own role
        if (parseInt(id) === req.user.id) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "Cannot change your own role"
            });
        }

        const checkUser = await dbService.getAdminById(id);
        if (!checkUser) {
            return res.status(HttpStatus.NOT_FOUND).json({
                message: "Admin does not exist"
            });
        }

        const data = await dbService.changeRoleOfAdmin(id);
        
        return res.status(HttpStatus.OK).json({
            message: "Admin role updated successfully!",
            data
        });
    } catch(err) {
        console.error("Error changing admin role:", err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
            message: "Server error" 
        });
    }
}

// Add this export to addAdminController.js

export const updateAdmin = async(req, res) => {
    try {
        // Verify superadmin access
        if (req.user.role !== 'superadmin') {
            return res.status(HttpStatus.FORBIDDEN).json({
                message: "Only superadmin can update admin accounts"
            });
        }

        const id = req.params.id;
        const { email, name, role, cities } = req.body;
        const city = Array.isArray(cities) ? cities : [];
        
        // Validate required fields
        if (!email || !name) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "Email and Name are required"
            });
        }

        // Prevent superadmin from editing themselves
        if (parseInt(id) === req.user.id) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "Cannot edit your own account"
            });
        }

        // Check if admin exists
        const existingAdmin = await dbService.getAdminById(id);
        if (!existingAdmin) {
            return res.status(HttpStatus.NOT_FOUND).json({
                message: "Admin not found"
            });
        }

        // Validate city requirement for admin role
        if (role === 'admin' && city.length <= 0) {
            return res.status(HttpStatus.BAD_REQUEST).json({
                message: "At least one city must be provided for Admin User"
            });
        }

        // Check if email is being changed and if it's already taken
        if (email !== existingAdmin.email) {
            const emailExists = await dbService.getAdminByEmail(email);
            if (emailExists) {
                return res.status(HttpStatus.CONFLICT).json({
                    error: "Email already exists"
                });
            }
        }

        const updatedAdmin = await dbService.updateAdmin(id, { name, email, role, city });    

        return res.status(HttpStatus.OK).json({
            message: "Admin Updated Successfully!",
            updatedAdmin
        });
    } catch(err) {
        console.error("Error while updating admin:", err.message);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            message: "Server error while updating admin"
        });
    }
}

// Add this to your addAdminController.js

export const getAdminCities = async(req, res) => {
    try {
        // Check if user exists (should be set by adminAuth middleware)
        if (!req.user || !req.user.id) {
            console.error("getAdminCities: req.user is undefined");
            return res.status(HttpStatus.UNAUTHORIZED).json({
                message: "User not authenticated"
            });
        }
        
        const adminId = req.user.id;
        const role = req.user.role;
        
        // If superadmin, return all enabled cities
        if (role === 'superadmin') {
            const cities = await jobService.getTotalCities();
            return res.status(HttpStatus.OK).json({ cities });
        }
        
        // If regular admin, return only assigned cities
        const cities = await dbService.getAdminCities(adminId);
        return res.status(HttpStatus.OK).json({ cities });
        
    } catch(err) {
        console.error("Error fetching admin cities:", err.message);
        return res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
            message: "Server error while fetching cities"
        });
    }
}