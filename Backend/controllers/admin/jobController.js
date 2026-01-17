import express from 'express'
import HttpStatus from '../../utils/statusCodes.js'
import { jobService } from '../../services/admin/jobQueries.js'
import pool from '../../config/db.js'

const jobController = {
  getJob: async (req, res) => {
    try {
      const jobs = await jobService.getCity()
      res.json(jobs)
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message })
    }
  },

  addJob: async (req, res) => {
    try {
      const { job, city_code, enabled, city_type } = req.body

      // Validation
      if (!job || job.trim() === "") {
        return res.status(HttpStatus.BAD_REQUEST).json({ 
          field: "job", 
          message: "Job name is required" 
        });
      }
      if (!city_code || city_code.trim() === "") {
        return res.status(HttpStatus.BAD_REQUEST).json({ 
          field: "city_code", 
          message: "City code is required" 
        });
      }
      if (enabled === false) {
        return res.status(HttpStatus.BAD_REQUEST).json({ 
          field: "enabled", 
          message: "You must enable the city to add it" 
        });
      }

      // Validate city_type
      const validCityTypes = ['DAILY', 'WEEKLY'];
      const cityTypeValue = city_type || 'DAILY'; // Default to DAILY
      
      if (!validCityTypes.includes(cityTypeValue)) {
        return res.status(HttpStatus.BAD_REQUEST).json({ 
          field: "city_type", 
          message: "City type must be either DAILY or WEEKLY" 
        });
      }

      // Add city with city_type
      const jobs = await jobService.addcity(job, city_code, cityTypeValue);
      res.status(HttpStatus.CREATED).json(jobs)
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message })
    }
  },

  updateJob: async (req, res) => {
    try {
      const { id } = req.params
      const { job, city_code, city_type } = req.body

      console.log('Update job request:', { id, job, city_code, city_type });

      // Validate city_type if provided
      if (city_type) {
        const validCityTypes = ['DAILY', 'WEEKLY'];
        if (!validCityTypes.includes(city_type)) {
          return res.status(HttpStatus.BAD_REQUEST).json({ 
            field: "city_type", 
            message: "City type must be either DAILY or WEEKLY" 
          });
        }
      }

      const updatedCity = await jobService.updateCity(id, job, city_code, city_type)

      if (!updatedCity) {
        return res.status(HttpStatus.NOT_FOUND).json({ message: "City not found" })
      }

      console.log('City updated successfully:', updatedCity);
      res.json(updatedCity)
    } catch (error) {
      console.error('Update city error:', error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message })
    }
  },

  deleteJob: async (req, res) => {
    try {
      const { id } = req.params
      const jobs = await jobService.deleteCity(id)
      if (!jobs) {
        return res.status(HttpStatus.NOT_FOUND).json({ message: "City not found" })
      }
      res.json({ message: "City deleted successfully" })
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message })
    }
  },

  jobStatus: async (req, res) => {
    try {
      const { id } = req.params
      const jobs = await jobService.cityStatus(id)
      if (!jobs) {
        return res.status(HttpStatus.NOT_FOUND).json({ message: "City not found" })
      }
      res.json(jobs)
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ error: error.message })
    }
  },

  fetchPaginatedJobs: async (req, res) => {
    try {
      const page = parseInt(req.query.page) || 1
      const limit = parseInt(req.query.limit) || 3
      const search = req.query.search || ""
      const statusFilter = req.query.status || "all"

      const isSuperAdmin = req.user.role === 'superadmin';
      const adminId = req.user.id;

      const { jobs, total } = await jobService.jobPagination(
        page, 
        limit, 
        search, 
        statusFilter, 
        isSuperAdmin, 
        adminId
      )

      res.status(HttpStatus.OK).json({
        success: true,
        jobs,
        total,
        page,
        totalPages: Math.ceil(total / limit),
        isSuperAdmin
      })
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false,
        message: error.message,
      });
    }
  },

  getCities: async (req, res) => {
    try {
      const cities = await jobService.getTotalCities();
      return res.status(HttpStatus.OK).json({ cities });
    } catch (error) {
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
        success: false, 
        message: error.message 
      });
    }
  },

  // Get driver's city type (for driver side)
  getDriverCityType: async (req, res) => {
    try {
      const driverId = req.driver.id; // From driverAuth middleware
      
      console.log('Fetching city type for driver:', driverId);
      
      const cityType = await jobService.getCityTypeByDriverId(driverId);
      
      console.log('City type found:', cityType);
      
      res.json({ 
        success: true, 
        cityType,
        isWeekly: cityType === 'WEEKLY',
        isDaily: cityType === 'DAILY'
      });
    } catch (error) {
      console.error("Error fetching driver city type:", error);
      res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ 
        success: false, 
        message: "Error fetching city type",
        error: error.message
      });
    }
  }
}

export default jobController