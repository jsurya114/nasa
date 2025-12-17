import express from 'express';
import HttpStatus from '../../utils/statusCodes.js';
import { dbService } from '../../services/admin/dbQueries.js';

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