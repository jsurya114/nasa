import { Navigate, Outlet } from "react-router-dom";
import { useSelector } from "react-redux";
const PublicRoutes=()=>{
    const {isAuthenticated}=useSelector((state)=>state.admin);

    return isAuthenticated ? <Navigate to="/admin/dashboard" /> : <Outlet/> ; 
}

export default PublicRoutes;