import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useDispatch, useSelector } from "react-redux";
import { toast, ToastContainer } from 'react-toastify';
import 'react-toastify/dist/ReactToastify.css';
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import { fetchRoutes, addRoute, toggleRouteStatus, deleteRoute, updateRoute } from "../../redux/slice/admin/routeSlice";
import { fetchPaginatedJobs } from "../../redux/slice/admin/jobSlice";
import Pagination from "../../reuse/Pagination.jsx";
import SearchBar from "../../reuse/Search.jsx";

export default function RoutesForm() {
  const dispatch = useDispatch();
  const { routes, status: routesStatus, error: routesError, page, totalPages, limit } = useSelector((state) => state.routes);
  const { cities, status: jobsStatus, error: jobsError } = useSelector((state) => state.jobs);

  const [formData, setFormData] = useState({
    route: "",
    job: "",
    companyRoutePrice: 0,
    driverRoutePrice: 0,
    companyDoubleStopPrice: 0,
    driverDoubleStopPrice: 0,
    routeCodeInString: "",
    enabled: false,
  });
  const [editingId, setEditingId] = useState(null);
  const [submitError, setSubmitError] = useState(null);
  const [submitSuccess, setSubmitSuccess] = useState(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [cityFilter, setCityFilter] = useState(""); // ✅ NEW: City filter state

  // Fetch assigned cities (role-based) - using fetchPaginatedJobs with enabled filter
  useEffect(() => {
    dispatch(fetchPaginatedJobs({ page: 1, limit: 1000, search: "", status: "enabled" }));
  }, [dispatch]);

  // ✅ ENHANCED: Debounced search with city filter
  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch(fetchRoutes({ page: 1, limit: 4, search: searchTerm, city: cityFilter }));
    }, 400);
    return () => clearTimeout(timer);
  }, [searchTerm, cityFilter, dispatch]);

  // Memoized enabled jobs - cities already filtered by role from backend
  const enabledJobs = useMemo(() => {
    if (Array.isArray(cities) && cities.length > 0) {
      return cities.filter(city => city.enabled);
    }
    return [];
  }, [cities]);

  // ✅ ENHANCED: Page change handler with city filter
  const handlePageChange = useCallback((newPage) => {
    dispatch(fetchRoutes({ page: newPage, limit: 4, search: searchTerm, city: cityFilter }));
  }, [dispatch, searchTerm, cityFilter]);

  // Memoized input change handler
  const handleInputChange = useCallback((field, value) => {
    setFormData((prev) => ({
      ...prev,
      [field]: field.includes("Price") ? parseFloat(value) || 0 : value,
    }));
    setSubmitError(null);
  }, []);

  // Memoized edit handler
  const handleEdit = useCallback((route) => {
    setFormData({
      route: route.route,
      job: route.job,
      companyRoutePrice: route.companyRoutePrice,
      driverRoutePrice: route.driverRoutePrice,
      companyDoubleStopPrice: route.companyDoubleStopPrice,
      driverDoubleStopPrice: route.driverDoubleStopPrice,
      routeCodeInString: route.routeCodeInString || "",
      enabled: route.enabled,
    });
    setEditingId(route.id);
    setSubmitError(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  // Memoized cancel edit handler
  const handleCancelEdit = useCallback(() => {
    setFormData({
      route: "",
      job: "",
      companyRoutePrice: 0,
      driverRoutePrice: 0,
      companyDoubleStopPrice: 0,
      driverDoubleStopPrice: 0,
      routeCodeInString: "",
      enabled: false,
    });
    setEditingId(null);
    setSubmitError(null);
  }, []);

  // ✅ ENHANCED: Submit handler with city filter
  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    
    if (!formData.route.trim()) {
      setSubmitError("Route name is required.");
      return;
    }
    if (!formData.job.trim()) {
      setSubmitError("Please select a Job.");
      return;
    }
    if (!formData.enabled) {
      setSubmitError("Route can only be saved if Enabled is checked.");
      return;
    }

    try {
      if (editingId) {
        await dispatch(updateRoute({ id: editingId, routeData: formData })).unwrap();
        toast.success('Route updated successfully!', {
          position: "top-right",
          autoClose: 3000,
        });
        setEditingId(null);
      } else {
        await dispatch(addRoute(formData)).unwrap();
        toast.success('Route added successfully!', {
          position: "top-right",
          autoClose: 3000,
        });
      }
      
      setFormData({
        route: "",
        job: "",
        companyRoutePrice: 0,
        driverRoutePrice: 0,
        companyDoubleStopPrice: 0,
        driverDoubleStopPrice: 0,
        routeCodeInString: "",
        enabled: false,
      });
      setSubmitError(null);
      
      // Refresh with current filters
      dispatch(fetchRoutes({ page: page || 1, limit: 4, search: searchTerm, city: cityFilter }));
    } catch (error) {
      setSubmitError(error.message || `Failed to ${editingId ? 'update' : 'add'} route`);
      toast.error(error.message || `Failed to ${editingId ? 'update' : 'add'} route. Please try again.`, {
        position: "top-right",
        autoClose: 3000,
      });
    }
  }, [formData, editingId, dispatch, page, searchTerm, cityFilter]);

  // Memoized toggle handler
  const handleToggle = useCallback(async (id) => {
    try {
      await dispatch(toggleRouteStatus(id)).unwrap();
      toast.success('Route status updated successfully!', {
        position: "top-right",
        autoClose: 2000,
      });
    } catch (error) {
      toast.error('Failed to update route status. Please try again.', {
        position: "top-right",
        autoClose: 3000,
      });
    }
  }, [dispatch]);

  // Memoized delete handler
  const handleDelete = useCallback(async (id) => {
    const confirmDelete = window.confirm("Are you sure you want to delete this route?");
    if (!confirmDelete) return;

    try {
      await dispatch(deleteRoute(id)).unwrap();
      toast.success('Route deleted successfully!', {
        position: "top-right",
        autoClose: 3000,
      });
    } catch (error) {
      toast.error('Failed to delete route. Please try again.', {
        position: "top-right",
        autoClose: 3000,
      });
    }
  }, [dispatch]);

  // ✅ NEW: Handle city filter change
  const handleCityFilterChange = useCallback((e) => {
    setCityFilter(e.target.value);
  }, []);

  // ✅ NEW: Clear all filters
  const handleClearFilters = useCallback(() => {
    setSearchTerm("");
    setCityFilter("");
  }, []);

  // Memoized price fields configuration
  const priceFields = useMemo(() => [
    { label: "Company Route Price", field: "companyRoutePrice" },
    { label: "Driver Route Price", field: "driverRoutePrice" },
    { label: "Company Double Stop Price", field: "companyDoubleStopPrice" },
    { label: "Driver Double Stop Price", field: "driverDoubleStopPrice" },
  ], []);

  // Memoized table headers
  const tableHeaders = useMemo(() => 
    ["Route", "Route String","Job", "Company Price", "Driver Price", "Status", "Actions"],
  []);

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-poppins">
      <Header />
      <main className="max-w-[1450px] mx-auto p-4 pb-40">
        {/* Form Section */}
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3 -mx-6 -mt-6 rounded-t-xl flex-1">
              {editingId ? 'Edit Route' : 'Add Route'}
            </h2>
            {editingId && (
              <button
                onClick={handleCancelEdit}
                className="ml-4 px-3 py-1.5 text-sm bg-gray-500 text-white rounded-md hover:bg-gray-600 transition-colors"
              >
                Cancel Edit
              </button>
            )}
          </div>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
            <div>
              <label className="block mb-1 font-medium">Route</label>
              <input
                type="text"
                placeholder="Enter route name"
                value={formData.route}
                onChange={(e) => handleInputChange("route", e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-600"
              />
            </div>

            <div>
              <label className="block mb-1 font-medium">Route Code (String)</label>
              <input
                type="text"
                placeholder="Enter route code string (optional)"
                value={formData.routeCodeInString}
                onChange={(e) => handleInputChange("routeCodeInString", e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-600"
              />
            </div>

            <div>
              <label className="block mb-1 font-medium">Job (City)</label>
              <select
                value={formData.job}
                onChange={(e) => handleInputChange("job", e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-600 bg-white"
              >
                <option value="">Select City</option>
                {enabledJobs.length > 0 ? (
                  enabledJobs.map((city) => (
                    <option key={city.id} value={city.job}>
                      {city.job}
                    </option>
                  ))
                ) : (
                  <option disabled>No cities available</option>
                )}
              </select>
              {jobsStatus === "loading" && (
                <div className="flex items-center mt-1">
                  <svg className="animate-spin h-6 w-6 mr-2 text-purple-600" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  <p className="text-purple-600 font-medium">Loading cities...</p>
                </div>
              )}
              {jobsStatus === "failed" && (
                <p className="text-red-500 mt-1">Error loading cities: {jobsError || "Unknown error"}</p>
              )}
            </div>

            {priceFields.map(({ label, field }) => (
              <div key={field}>
                <label className="block mb-1 font-medium">{label}</label>
                <input
                  type="number"
                  value={formData[field]}
                  onChange={(e) => handleInputChange(field, e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-600"
                  min="0"
                  step="0.01"
                />
              </div>
            ))}

            <div className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={formData.enabled}
                onChange={(e) => handleInputChange("enabled", e.target.checked)}
                className="w-4 h-4 text-purple-600"
              />
              <label className="font-medium">Enabled (to save)</label>
            </div>

            {submitError && <p className="text-red-500">{submitError}</p>}
            {submitSuccess && <p className="text-green-500">{submitSuccess}</p>}

            <div className="flex justify-end gap-2">
              <button
                type="submit"
                className={`px-4 py-1.5 text-sm bg-purple-700 text-white rounded-md shadow hover:bg-purple-800 transition-colors ${
                  !formData.enabled ? "opacity-50 cursor-not-allowed" : ""
                }`}
                disabled={!formData.enabled}
              >
                {editingId ? 'Update Route' : 'Add Route'}
              </button>
            </div>
          </form>
        </section>

        {/* Table Section */}
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <h2 className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3 rounded-t-xl">
            Route List
          </h2>
          
          {/* ✅ NEW: Filter Section */}
          <div className="px-4 py-2 border-b border-gray-200 bg-gray-50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
              {/* Search Bar */}
              <div className="md:col-span-2">
                <SearchBar
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Search routes by name or city..."
                />
              </div>
              
              {/* City Filter Dropdown */}
              <div className="flex gap-2">
                <select
                  value={cityFilter}
                  onChange={handleCityFilterChange}
                  className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md focus:ring-2 focus:ring-purple-600 focus:border-transparent bg-white text-xs"
                >
                  <option value="">All Cities</option>
                  {enabledJobs.map((city) => (
                    <option key={city.id} value={city.job}>
                      {city.job}
                    </option>
                  ))}
                </select>
                
                {/* Clear Filters Button */}
                {(searchTerm || cityFilter) && (
                  <button
                    onClick={handleClearFilters}
                    className="px-3 py-1.5 text-xs bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition-colors font-medium whitespace-nowrap"
                    title="Clear all filters"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>
            
            {/* Active Filters Display */}
            {(searchTerm || cityFilter) && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                <span className="text-xs text-gray-600 font-medium">Active filters:</span>
                {searchTerm && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full text-xs">
                    Search: "{searchTerm}"
                    <button
                      onClick={() => setSearchTerm("")}
                      className="hover:bg-purple-200 rounded-full p-0.5"
                    >
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
                {cityFilter && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full text-xs">
                    City: {cityFilter}
                    <button
                      onClick={() => setCityFilter("")}
                      className="hover:bg-blue-200 rounded-full p-0.5"
                    >
                      <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
          
          <div className="px-6 py-4">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left">
                  {tableHeaders.map((head, i) => (
                    <th key={i} className="px-3 py-2 border-b border-gray-200 font-semibold text-gray-800">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {routesStatus === "loading" && routes.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-4 text-gray-500 font-medium">
                      <div className="flex items-center justify-center">
                        <svg className="animate-spin h-6 w-6 mr-2 text-purple-600" viewBox="0 0 24 24">
                          <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                          <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                        </svg>
                        Loading routes...
                      </div>
                    </td>
                  </tr>
                ) : routesStatus === "failed" ? (
                  <tr>
                    <td colSpan="7" className="text-center py-4 text-red-500 font-medium">
                      Error loading routes: {routesError || "Unknown error"}
                    </td>
                  </tr>
                ) : routesStatus === "succeeded" && (!Array.isArray(routes) || routes.length === 0) ? (
                  <tr>
                    <td colSpan="7" className="text-center py-4 text-gray-500 font-medium">
                      {searchTerm || cityFilter ? (
                        <div className="flex flex-col items-center gap-2">
                          <svg className="w-12 h-12 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                          </svg>
                          <p>No routes found matching your filters</p>
                          <button
                            onClick={handleClearFilters}
                            className="px-3 py-1 text-xs text-purple-600 hover:text-purple-800 bg-purple-50 hover:bg-purple-100 rounded-md font-medium transition-colors"
                          >
                            Clear filters
                          </button>
                        </div>
                      ) : (
                        "No routes found"
                      )}
                    </td>
                  </tr>
                ) : (
                  routes.map((route, index) => (
                    <tr 
                      key={route.id} 
                      className={`${index % 2 === 0 ? "bg-gray-50" : "bg-white"} ${
                        editingId === route.id ? "ring-2 ring-purple-500" : ""
                      }`}
                    >
                      <td className="px-3 py-2 border-b border-gray-200">{route.route}</td>
                      <td className="px-3 py-2 border-b border-gray-200">{route.routeCodeInString}</td>
                      <td className="px-3 py-2 border-b border-gray-200">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                          {route.job}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-gray-200">{route.companyRoutePrice}</td>
                      <td className="px-3 py-2 border-b border-gray-200">{route.driverRoutePrice}</td>
                      <td className="px-3 py-2 border-b border-gray-200">
                        <span
                          className={`px-2 py-1 rounded-full text-sm font-medium ${
                            route.enabled ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                          }`}
                        >
                          {route.enabled ? "Enabled" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-3 py-2 border-b border-gray-200">
                        <div className="flex items-center gap-10">
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input
                              type="checkbox"
                              checked={route.enabled}
                              onChange={() => handleToggle(route.id)}
                              className="sr-only"
                            />
                            <div className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out ${
                              route.enabled ? 'bg-purple-600' : 'bg-gray-300'
                            }`}>
                              <div className={`w-5 h-5 bg-white rounded-full shadow-lg transform transition-transform duration-200 ease-in-out ${
                                route.enabled ? 'translate-x-5' : 'translate-x-0.5'
                              } mt-0.5`}></div>
                            </div>
                          </label>
                          
                          <button
                            onClick={() => handleEdit(route)}
                            className="group relative px-3 py-1 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-xs font-medium rounded-md hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-1"
                            title="Edit Route"
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            <span>Edit</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>
        
        <Pagination page={page} totalPages={totalPages} onPageChange={handlePageChange} />
      </main>

      <Nav />
      
      <ToastContainer
        position="top-right"
        autoClose={3000}
        hideProgressBar={false}
        newestOnTop={false}
        closeOnClick
        rtl={false}
        pauseOnFocusLoss
        draggable
        pauseOnHover
        theme="light"
        className="mt-16"
      />
    </div>
  );
}