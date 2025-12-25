import HttpStatus from '../../utils/statusCodes.js';
import { dbService } from '../../services/admin/dbQueries.js';

export const createUsers=async(req,res)=>{
    try{
     const {email,password,name,driverCode,city,enabled}= req.body;
    // console.log("Data from client ",req.body);

    if(!email || !password|| !city|| !driverCode){
        return res.status(HttpStatus.UNAUTHORIZED).json({message:"Email , password, city  & driver code is required"})
    }

    const driver= await dbService.getDriverByEmail(email);
    if(driver)
        return res.status(HttpStatus.CONFLICT).json({message:"User already Exists"});
    
     const driverCodeExists= await dbService.getDriverByCode(driverCode);
    if(driverCodeExists)
        return res.status(HttpStatus.CONFLICT).json({message:"Driver Code already used"});
    
    const insertUser= await dbService.insertUser({name,email,driverCode,password,city,enabled});

    return res.status(HttpStatus.OK).json({message:"User Added Successfull!!",insertUser});
    }catch(err){
        console.log("Error while inserting data ",err.message)
       return  res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" })
    }
}
// Update the getUsers function in addUserController.js

export const getUsers = async(req, res) => {
    try {
        console.log("Entered by Get users route");

        const adminId = req.user.id;
        const adminRole = req.user.role;
        const page = parseInt(req.query.page) || 1;
        const limit = 10;
        const offset = (page - 1) * limit;

        let drivers;
        let totalDrivers;

        // If superadmin, get all drivers
        if (adminRole === 'superadmin') {
            drivers = await dbService.getAllDrivers(limit, offset);
            totalDrivers = await dbService.getCountOfDrivers();
        } else {
            // If regular admin, get only drivers from their assigned cities
            drivers = await dbService.getDriversByAdminCities(adminId, limit, offset);
            totalDrivers = await dbService.getCountOfDriversByAdminCities(adminId);
        }

        const totalPages = Math.ceil(totalDrivers / limit);

        return res.status(HttpStatus.OK).json({
            drivers,
            page,
            totalPages
        });
    } catch(err) {
        console.error("Get users error:", err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
}
export const changeStatusUser= async(req,res)=>{
    try{
        const id=req.params.id;
        console.log("Data from url ",id);
        const checkUser= await dbService.getDriverById(id);
        if(!checkUser)
            return res.status(HttpStatus.NOT_FOUND).json({message:"User does not exists"});
        const data= await dbService.changeStatus(id);
        // console.log("Data",data)
        return res.status(HttpStatus.OK).json({message:"User updated successfully!!",data});
    }catch(err){
        console.error(err.message);
        res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
    }
}

// export const checkforSuperAdminOrNot= async(req,res)=>{
//     try{
//         // const res= await dbService.
//     }catch(err){
//         console.error(err.message);
//         res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({ message: "Server error" });
//     }
// }
export const updateUser = async (req, res) => {
  try {
    const id = req.params.id;
    const { name, email, city, enabled } = req.body;

    const updatedUser = await dbService.updateDriver(id, {
      name,
      email,
      city,
      enabled,
    });

    return res.status(200).json({
      message: "Driver updated successfully",
      updatedUser,
    });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
};
