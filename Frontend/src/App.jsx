import React, { Suspense, lazy } from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import Login from "./components/Admin/Login";
import NotFound from "./components/Admin/NotFound.jsx";
import Loader from "./components/Loader.jsx";

// Lazy-loaded Admin pages
const Dashboard = lazy(() => import("./components/Admin/Dashboard"));
const Jobs = lazy(() => import("./components/Admin/Jobs"));
const RoutesForm = lazy(() => import("./components/Admin/routes-form.jsx"));
const AddUsers = lazy(() => import("./components/Admin/AddUsers.jsx"));
const DoubleStop = lazy(() => import("./components/Admin/DoubleStop.jsx"));
const AddAccessCodePage = lazy(() => import("./components/Admin/AccessCode.jsx"));
const AdminJourney = lazy(() => import("./components/Admin/AdminJorney.jsx"));
const AdminDriverAvailability = lazy(() => import("./components/Admin/AdminDriverAvailability.jsx"));

import ProtectedRoutes from "./routes/admin/ProtectedRoute.jsx";
import AdminPublicOnlyRoute from "./routes/admin/PublicOnlyRoute.jsx";
import DriverLogin from "./components/Drivers/DriverLogin.jsx";

// Lazy-loaded Driver pages
const Journey = lazy(() => import("./components/Drivers/Journey.jsx"));
const Devlivery = lazy(() => import("./components/Drivers/Delivery.jsx"));
const DriverAccessCodePage = lazy(() => import("./components/Drivers/accessCode.jsx"));
const DriverAvailability = lazy(() => import("./components/Drivers/DriverAvailability.jsx"));

import DPublicRoutes from "./routes/driver/DPublicRoutes.jsx";
import DProtectRoutes from "./routes/driver/DProtectedRoutes.jsx";
import { ToastContainer } from "react-toastify";
import "react-toastify/dist/ReactToastify.css";

function App() {
  return (
    <>
      <Router>
        <Suspense fallback={<Loader />}>
          <Routes>
            {/* Admin Public-only Login Route */}
            <Route element={<AdminPublicOnlyRoute />}>
              <Route path="/admin/login" element={<Login />} />
            </Route>

            {/* Admin Protected Routes */}
            <Route element={<ProtectedRoutes />}>
              <Route path="/admin/dashboard" element={<Dashboard />} />
              <Route path="/admin/jobs" element={<Jobs />} />
              <Route path="/admin/routes" element={<RoutesForm />} />
              <Route path="/admin/create-users" element={<AddUsers />} />
              <Route path="/admin/double-stop" element={<DoubleStop />} />
              <Route path="/admin/manage-access-codes" element={<AddAccessCodePage />} />
              <Route path="/admin/journeys" element={<AdminJourney />} />
              <Route path="/admin/driver-availability" element={<AdminDriverAvailability />} />
            </Route>

            {/* Driver Public Routes */}
            <Route element={<DPublicRoutes />}>
              <Route path="/driver/login" element={<DriverLogin />} />
            </Route>

            {/* Driver Protected Routes */}
            <Route element={<DProtectRoutes />}>
              <Route path="/driver/dashboard" element={<Journey />} />
              <Route path="/driver/access-codes" element={<DriverAccessCodePage />} />
              <Route path="/driver/delivery" element={<Devlivery />} />
              <Route path="/driver/availability" element={<DriverAvailability />} />
            </Route>

            {/* Catch-all 404 route */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
        <ToastContainer />
      </Router>
    </>
  );
}

export default App;