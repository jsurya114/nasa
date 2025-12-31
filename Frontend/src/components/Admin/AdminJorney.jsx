import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  fetchPaginatedJourneys,
  updateJourney,
  addJourney,
  fetchAdminRoutes,
  fetchAllDrivers,
  clearJourneyError,
  deleteJourney
} from "../../redux/slice/driver/journeySlice.js";
import { toast } from "react-toastify";
import Header from "../../reuse/Header.jsx";
import Nav from "../../reuse/Nav.jsx";
import Select from "react-select";
import { useNavigate } from "react-router-dom";

const AdminJourney = () => {
  const dispatch = useDispatch();
  let navigate = useNavigate();
  
  const { 
    paginatedJourneys, 
    paginatedStatus, 
    paginatedError, 
    routes, 
    routesStatus, 
    drivers, 
    driversStatus,
    pagination 
  } = useSelector((state) => state.journey);

  const [editableJourneyId, setEditableJourneyId] = useState(null);
  const [formData, setFormData] = useState({});
  const [editValidationErrors, setEditValidationErrors] = useState({});
  const [newJourneyData, setNewJourneyData] = useState({
    driver_id: "",
    route_id: "",
    start_seq: "",
    end_seq: "",
    journey_date: new Date().toISOString().split('T')[0],
  });
  
  const [validationErrors, setValidationErrors] = useState({});
  const [errorTimeout, setErrorTimeout] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // ✅ Fetch paginated data on mount and when page/limit changes
  useEffect(() => {
    dispatch(fetchPaginatedJourneys({ page: currentPage, limit: itemsPerPage }));
  }, [dispatch, currentPage, itemsPerPage]);

  // ✅ Fetch routes and drivers only once
  useEffect(() => {
    if (routesStatus === "idle" || (routesStatus === "failed" && routes.length === 0)) {
      dispatch(fetchAdminRoutes());
    }
    if (driversStatus === "idle" || (driversStatus === "failed" && drivers.length === 0)) {
      dispatch(fetchAllDrivers());
    }
  }, [dispatch, routesStatus, driversStatus, routes.length, drivers.length]);

  // ✅ Auto-clear validation errors after 5 seconds
  useEffect(() => {
    if (Object.keys(validationErrors).length > 0) {
      if (errorTimeout) {
        clearTimeout(errorTimeout);
      }
      
      const timeout = setTimeout(() => {
        setValidationErrors({});
      }, 5000);
      
      setErrorTimeout(timeout);
      
      return () => {
        if (timeout) clearTimeout(timeout);
      };
    }
  }, [validationErrors]);

  // ✅ Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (errorTimeout) clearTimeout(errorTimeout);
    };
  }, [errorTimeout]);

  // ✅ Handle errors without causing re-renders
  useEffect(() => {
    if (paginatedError) {
      toast.error(paginatedError);
      dispatch(clearJourneyError());
    }
  }, [paginatedError, dispatch]);

  const handleRefresh = useCallback(() => {
    dispatch(fetchPaginatedJourneys({ page: currentPage, limit: itemsPerPage }));
  }, [dispatch, currentPage, itemsPerPage]);

  const handleEdit = useCallback((journey) => {
    setEditableJourneyId(journey.id);
    setFormData({
      driver_id: journey.driver_id,
      start_seq: journey.start_seq,
      end_seq: journey.end_seq,
      route_id: journey.route_id,
    });
    setEditValidationErrors({});
  }, []);

  const handleCancel = useCallback(() => {
    setEditableJourneyId(null);
    setFormData({});
    setEditValidationErrors({});
  }, []);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    
    if ((name === 'start_seq' || name === 'end_seq') && value !== '') {
      const numValue = parseInt(value);
      if (numValue < 1) {
        return;
      }
    }
    
    setFormData((prev) => ({ ...prev, [name]: value }));
    
    if (editValidationErrors[name]) {
      setEditValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
    
    if (editValidationErrors.general) {
      setEditValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.general;
        return newErrors;
      });
    }
  }, [editValidationErrors]);

  const validateSequenceOverlap = useCallback((driver_id, routeId, startSeq, endSeq, journeyDate, excludeJourneyId = null) => {
    const start = parseInt(startSeq);
    const end = parseInt(endSeq);
    
    const formatDateForComparison = (dateString) => {
      if (!dateString) return '';
      const date = new Date(dateString + 'T00:00:00');
      return date.toLocaleDateString('en-CA');
    };
    
    const targetDate = formatDateForComparison(journeyDate);
    
    const overlapping = paginatedJourneys.find(journey => {
      if (excludeJourneyId && journey.id === excludeJourneyId) return false;
      if (journey.driver_id !== parseInt(driver_id)) return false;
      if (journey.route_id !== parseInt(routeId)) return false;
      
      const existingDate = formatDateForComparison(journey.journey_date);
      if (existingDate !== targetDate) return false;
      
      const existingStart = parseInt(journey.start_seq);
      const existingEnd = parseInt(journey.end_seq);
      
      return (start <= existingEnd && end >= existingStart);
    });
    
    return overlapping;
  }, [paginatedJourneys]);

  const handleSave = useCallback(
    async (id) => {
      const start = parseInt(formData.start_seq);
      if (isNaN(start) || start <= 0) {
        toast.error("Start sequence must be a positive number greater than 0");
        return;
      }

      const end = parseInt(formData.end_seq);
      if (isNaN(end) || end <= 0) {
        toast.error("End sequence must be a positive number greater than 0");
        return;
      }

      if (start >= end) {
        toast.error("End sequence must be greater than start sequence");
        return;
      }

      const currentJourney = paginatedJourneys.find(j => j.id === id);
      if (!currentJourney) {
        toast.error("Journey not found");
        return;
      }

      const overlapping = validateSequenceOverlap(
        formData.driver_id,
        formData.route_id,
        formData.start_seq,
        formData.end_seq,
        currentJourney.journey_date,
        id
      );

      if (overlapping) {
        setEditValidationErrors({
          general: `Overlap! Driver has sequences ${overlapping.start_seq}-${overlapping.end_seq} on this route for this date`
        });
        return;
      }

      try {
        await dispatch(updateJourney({ journey_id: id, updatedData: formData })).unwrap();
        toast.success("Journey updated successfully!");
        dispatch(fetchPaginatedJourneys({ page: currentPage, limit: itemsPerPage }));
        setEditableJourneyId(null);
        setEditValidationErrors({});
      } catch (err) {
        if (err.errors) {
          if (err.errors.sequence) {
            toast.error(err.errors.sequence);
            setEditValidationErrors({});
            return;
          }
          
          const backendErrors = {};
          if (err.errors.start_seq) backendErrors.start_seq = err.errors.start_seq;
          if (err.errors.end_seq) backendErrors.end_seq = err.errors.end_seq;
          if (err.errors.driver_id) backendErrors.driver_id = err.errors.driver_id;
          if (err.errors.route_id) backendErrors.route_id = err.errors.route_id;
          setEditValidationErrors(backendErrors);
        } else {
          const message = err.message || "Failed to update journey";
          toast.error(message);
          setEditValidationErrors({ general: message });
        }
      }
    },
    [dispatch, formData, validateSequenceOverlap, paginatedJourneys, currentPage, itemsPerPage]
  );

  const handleNewJourneyChange = useCallback((e) => {
    const { name, value } = e.target;
    setNewJourneyData((prev) => ({ ...prev, [name]: value }));
    
    if (validationErrors[name]) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors[name];
        return newErrors;
      });
    }
    
    if (validationErrors.general) {
      setValidationErrors((prev) => {
        const newErrors = { ...prev };
        delete newErrors.general;
        return newErrors;
      });
    }
  }, [validationErrors]);

  const handleAddJourney = useCallback(
    async () => {
      if (errorTimeout) {
        clearTimeout(errorTimeout);
        setErrorTimeout(null);
      }

      setValidationErrors({});

      const errors = {};
      if (!newJourneyData.driver_id) {
        errors.driver_id = "Driver is required";
      }
      if (!newJourneyData.route_id) {
        errors.route_id = "Route is required";
      }
      if (!newJourneyData.start_seq) {
        errors.start_seq = "Start sequence is required";
      } else {
        const start = parseInt(newJourneyData.start_seq);
        if (isNaN(start) || start <= 0) {
          errors.start_seq = "Start sequence must be a positive number greater than 0";
        }
      }
      if (!newJourneyData.end_seq) {
        errors.end_seq = "End sequence is required";
      } else {
        const end = parseInt(newJourneyData.end_seq);
        if (isNaN(end) || end <= 0) {
          errors.end_seq = "End sequence must be a positive number greater than 0";
        }
      }
      if (!newJourneyData.journey_date) {
        errors.journey_date = "Journey date is required";
      }

      if (newJourneyData.start_seq && newJourneyData.end_seq && !errors.start_seq && !errors.end_seq) {
        const start = parseInt(newJourneyData.start_seq);
        const end = parseInt(newJourneyData.end_seq);
        if (start >= end) {
          errors.end_seq = "End sequence must be greater than start sequence";
        }
      }

      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        return;
      }

      const overlapping = validateSequenceOverlap(
        newJourneyData.driver_id,
        newJourneyData.route_id,
        newJourneyData.start_seq,
        newJourneyData.end_seq,
        newJourneyData.journey_date
      );

      if (overlapping) {
        setValidationErrors({
          general: `Sequence overlap detected! This driver already has sequences ${overlapping.start_seq}-${overlapping.end_seq} on this route for this date.`
        });
        return;
      }

      try {
        await dispatch(addJourney(newJourneyData)).unwrap();
        toast.success("Journey added successfully!");
        
        // Refresh with current pagination
        dispatch(fetchPaginatedJourneys({ page: currentPage, limit: itemsPerPage }));
        
        setNewJourneyData({
          driver_id: "",
          route_id: "",
          start_seq: "",
          end_seq: "",
          journey_date: new Date().toISOString().split('T')[0],
        });
        setValidationErrors({});
      } catch (err) {
        setValidationErrors({
          general: err.message || "Failed to add journey"
        });
      }
    },
    [dispatch, newJourneyData, validateSequenceOverlap, errorTimeout, currentPage, itemsPerPage]
  );

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure? This will delete all related data.")) return;

    try {
      await dispatch(deleteJourney(id)).unwrap();
      toast.success("Journey deleted successfully");
      dispatch(fetchPaginatedJourneys({ page: currentPage, limit: itemsPerPage }));
    } catch (err) {
      toast.error(err.message || "Delete failed");
    }
  };

  // ✅ Pagination Controls
  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setCurrentPage(newPage);
    }
  };

  const handleItemsPerPageChange = (e) => {
    setItemsPerPage(parseInt(e.target.value));
    setCurrentPage(1);
  };

  // Calculate page numbers to display
  const getPageNumbers = () => {
    const totalPages = pagination.totalPages;
    const current = currentPage;
    const delta = 2; // Number of pages to show on each side of current page
    const pages = [];

    // Always show first page
    pages.push(1);

    // Calculate range around current page
    const rangeStart = Math.max(2, current - delta);
    const rangeEnd = Math.min(totalPages - 1, current + delta);

    // Add ellipsis after first page if needed
    if (rangeStart > 2) {
      pages.push('...');
    }

    // Add pages in range
    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(i);
    }

    // Add ellipsis before last page if needed
    if (rangeEnd < totalPages - 1) {
      pages.push('...');
    }

    // Always show last page if there's more than 1 page
    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  const routeMap = useMemo(() => {
    const map = new Map();
    routes.forEach(route => {
      map.set(route.id, route.route || route.name || route.route_name || `Route ${route.id}`);
    });
    return map;
  }, [routes]);

  const tableRows = useMemo(() => {
    if (paginatedStatus !== "succeeded") return null;

    return paginatedJourneys.map((journey) => {
      const displayRouteName = routeMap.get(journey.route_id) || journey.route_name || 'Unknown Route';
      
      const formatDate = (dateString) => {
        if (!dateString) return '';
        const date = new Date(dateString + 'T00:00:00');
        return date.toLocaleDateString('en-CA');
      };
      
      return (
        <tr key={journey.id} className="border-t hover:bg-gray-50 transition-colors">
          <td className="px-4 py-2">{journey.driver_name}</td>
          <td className="px-4 py-2">{formatDate(journey.journey_date)}</td>
          <td className="px-4 py-2">
            {editableJourneyId === journey.id ? (
              <select
                name="route_id"
                value={formData.route_id}
                onChange={handleChange}
                className="w-full border rounded px-2 py-1"
              >
                <option value="">Select Route</option>
                {routes.map((routeItem) => (
                  <option key={routeItem.id} value={routeItem.id}>
                    {routeItem.route || routeItem.name || `Route ${routeItem.id}`}
                  </option>
                ))}
              </select>
            ) : (
              displayRouteName
            )}
          </td>
          <td className="px-4 py-2 text-center">
            {editableJourneyId === journey.id ? (
              <input
                type="number"
                name="start_seq"
                value={formData.start_seq}
                onChange={handleChange}
                min="1"
                className="w-16 border rounded px-1 py-0.5"
              />
            ) : (
              journey.start_seq
            )}
          </td>
          <td className="px-4 py-2 text-center">
            {editableJourneyId === journey.id ? (
              <input
                type="number"
                name="end_seq"
                value={formData.end_seq}
                onChange={handleChange}
                min="1"
                className="w-16 border rounded px-1 py-0.5"
              />
            ) : (
              journey.end_seq
            )}
          </td>
          <td className="px-4 py-2 text-center">
            {journey.packages || (journey.end_seq - journey.start_seq + 1)}
          </td>
          <td className="px-4 py-2 space-x-2 text-center">
            {editableJourneyId === journey.id ? (
              <>
                <button
                  onClick={() => handleSave(journey.id)}
                  className="bg-green-500 text-white px-3 py-1 rounded hover:bg-green-600 transition-colors"
                >
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="bg-gray-400 text-white px-3 py-1 rounded hover:bg-gray-500 transition-colors"
                >
                  Cancel
                </button>
              </>
            ) : (
              <button
                onClick={() => handleEdit(journey)}
                className="bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors"
              >
                Edit
              </button>
            )}
            <button
              onClick={() => handleDelete(journey.id)}
              className="bg-red-500 text-white px-3 py-1 rounded hover:bg-red-600 transition-colors"
            >
              Delete
            </button>
          </td>
        </tr>
      );
    });
  }, [paginatedJourneys, paginatedStatus, editableJourneyId, formData, routes, routeMap, editValidationErrors, handleChange, handleEdit, handleCancel, handleSave]);

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-poppins">
      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-fade-in {
          animation: fadeIn 0.3s ease-in-out;
        }
        
        /* Custom Select Dropdown Styling */
        .custom-select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
          background-position: right 0.5rem center;
          background-repeat: no-repeat;
          background-size: 1.5em 1.5em;
          padding-right: 2.5rem;
        }
      `}</style>
      <Header />

      <main className="max-w-[1450px] mx-auto p-4 pt-16 pb-40">
        <div className="flex justify-between items-center mb-4">
          <h1 className="text-2xl font-semibold">All Driver Journeys</h1>

          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/admin/dashboard")}
              className="bg-gray-600 text-white px-4 py-2 rounded-lg hover:bg-gray-700 flex items-center gap-2 transition-colors"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
              Back
            </button>

            <button
              onClick={handleRefresh}
              className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={paginatedStatus === "loading"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className={`h-5 w-5 ${paginatedStatus === "loading" ? 'animate-spin' : ''}`}
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z"
                  clipRule="evenodd"
                />
              </svg>
              Refresh
            </button>
          </div>
        </div>

        {/* Add Journey Form */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-4 border-2 border-green-200">
          <h2 className="text-lg font-semibold mb-4 text-green-700">Add New Journey</h2>
          
          {validationErrors.general && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm animate-fade-in">
              <div className="flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/>
                </svg>
                <span>{validationErrors.general}</span>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Driver *</label>
              <Select
                name="driver_id"
                options={drivers.map((driver) => ({
                  value: driver.id,
                  label: driver.name,
                }))}
                value={
                  drivers.find(driver => driver.id === newJourneyData.driver_id)
                    ? {
                        value: newJourneyData.driver_id,
                        label: drivers.find(driver => driver.id === newJourneyData.driver_id).name,
                      }
                    : null
                }
                onChange={(selectedOption) =>
                  setNewJourneyData(prev => ({ ...prev, driver_id: selectedOption?.value || '' }))
                }
                placeholder="Search or select driver..."
                isClearable
                isSearchable
                classNamePrefix="react-select"
                styles={{
                  control: (base, state) => ({
                    ...base,
                    borderColor: validationErrors.driver_id ? '#ef4444' : '#22c55e',
                    boxShadow: state.isFocused ? '0 0 0 1px #22c55e' : base.boxShadow,
                    minHeight: '38px',
                    borderRadius: '0.375rem',
                  }),
                  menu: base => ({
                    ...base,
                    zIndex: 9999,
                  }),
                }}
              />
              {validationErrors.driver_id && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.driver_id}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Route *</label>
              <Select
                name="route_id"
                options={routes.map((route) => ({
                  value: route.id,
                  label: route.route || route.name || `Route ${route.id}`,
                }))}
                value={
                  routes.find(route => route.id === newJourneyData.route_id)
                    ? {
                        value: newJourneyData.route_id,
                        label: routes.find(route => route.id === newJourneyData.route_id).route || routes.find(route => route.id === newJourneyData.route_id).name,
                      }
                    : null
                }
                onChange={(selectedOption) =>
                  setNewJourneyData(prev => ({ ...prev, route_id: selectedOption?.value || '' }))
                }
                placeholder="Search or select route..."
                isClearable
                isSearchable
                classNamePrefix="react-select"
                styles={{
                  control: (base, state) => ({
                    ...base,
                    borderColor: validationErrors.route_id ? '#ef4444' : '#22c55e',
                    boxShadow: state.isFocused ? '0 0 0 1px #22c55e' : base.boxShadow,
                    minHeight: '38px',
                    borderRadius: '0.375rem',
                  }),
                  menu: base => ({
                    ...base,
                    zIndex: 9999,
                  }),
                }}
              />
              {validationErrors.route_id && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.route_id}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Journey Date *</label>
              <input
                type="date"
                name="journey_date"
                value={newJourneyData.journey_date}
                onChange={handleNewJourneyChange}
                className={`w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 ${
                  validationErrors.journey_date 
                    ? 'border-red-500 focus:ring-red-500' 
                    : 'focus:ring-green-500'
                }`}
              />
              {validationErrors.journey_date && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.journey_date}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Start Seq *</label>
              <input
                type="number"
                name="start_seq"
                value={newJourneyData.start_seq}
                onChange={handleNewJourneyChange}
                className={`w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 ${
                  validationErrors.start_seq 
                    ? 'border-red-500 focus:ring-red-500' 
                    : 'focus:ring-green-500'
                }`}
                min="1"
                placeholder="e.g. 1"
              />
              {validationErrors.start_seq && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.start_seq}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">End Seq *</label>
              <input
                type="number"
                name="end_seq"
                value={newJourneyData.end_seq}
                onChange={handleNewJourneyChange}
                className={`w-full border rounded px-3 py-2 focus:outline-none focus:ring-2 ${
                  validationErrors.end_seq 
                    ? 'border-red-500 focus:ring-red-500' 
                    : 'focus:ring-green-500'
                }`}
                min="1"
                placeholder="e.g. 10"
              />
              {validationErrors.end_seq && (
                <p className="text-xs text-red-500 mt-1">{validationErrors.end_seq}</p>
              )}
            </div>
          </div>

          <div className="flex gap-2 mt-4">
            <button
              onClick={handleAddJourney}
              className="bg-green-500 text-white px-6 py-2 rounded hover:bg-green-600 transition-colors font-medium flex items-center gap-2"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-5 w-5"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                  clipRule="evenodd"
                />
              </svg>
              Add Journey
            </button>
          </div>
        </div>

        {/* Journey Table */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full table-auto border-collapse text-sm">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Driver</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Date</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-700">Route</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Start Seq</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">End Seq</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Packages</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-700">Actions</th>
                </tr>
              </thead>
              <tbody>
                {paginatedStatus === "loading" ? (
                  <tr>
                    <td colSpan="7" className="text-center py-16">
                      <div className="flex flex-col items-center justify-center gap-3">
                        <div className="relative w-16 h-16">
                          <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-100 rounded-full"></div>
                          <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
                        </div>
                        <span className="text-gray-600 font-medium text-lg">Loading journeys...</span>
                      </div>
                    </td>
                  </tr>
                ) : paginatedJourneys.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="text-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-gray-500 text-lg font-medium">No journeys found</p>
                        <p className="text-gray-400 text-sm">Add a new journey to get started</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  tableRows
                )}
              </tbody>
            </table>
          </div>

          {/* Enhanced Pagination Controls */}
          {paginatedStatus === "succeeded" && paginatedJourneys.length > 0 && (
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-t-2 border-gray-200">
              <div className="px-6 py-4">
                {/* Top Row: Items per page and info */}
                <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
                  {/* Items per page */}
                  <div className="flex items-center gap-3">
                    <span className="text-sm font-medium text-gray-700">Rows per page:</span>
                    <select
                      value={itemsPerPage}
                      onChange={handleItemsPerPageChange}
                      className="custom-select border-2 border-gray-300 rounded-lg px-3 py-2 text-sm font-medium bg-white hover:border-blue-400 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none transition-all cursor-pointer"
                    >
                      <option value={5}>5</option>
                      <option value={10}>10</option>
                      <option value={15}>15</option>
                      <option value={30}>30</option>
                      <option value={50}>50</option>
                    </select>
                  </div>

                  {/* Page info */}
                  <div className="text-sm font-medium text-gray-700">
                    Showing <span className="font-bold text-blue-600">{((currentPage - 1) * itemsPerPage) + 1}</span> to{' '}
                    <span className="font-bold text-blue-600">
                      {Math.min(currentPage * itemsPerPage, pagination.total)}
                    </span> of{' '}
                    <span className="font-bold text-blue-600">{pagination.total}</span> entries
                  </div>
                </div>

                {/* Bottom Row: Page navigation */}
                <div className="flex justify-center items-center gap-1">
                  {/* First and Previous Buttons */}
                  <button
                    onClick={() => handlePageChange(1)}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border-2 border-gray-300 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-50 hover:border-blue-400 transition-all duration-200 group"
                    title="First Page"
                  >
                    <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                    </svg>
                  </button>
                  
                  <button
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="p-2 rounded-lg border-2 border-gray-300 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-50 hover:border-blue-400 transition-all duration-200 group"
                    title="Previous Page"
                  >
                    <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                    </svg>
                  </button>

                  {/* Page Numbers */}
                  <div className="flex items-center gap-1 mx-2">
                    {getPageNumbers().map((pageNum, index) => (
                      pageNum === '...' ? (
                        <span key={`ellipsis-${index}`} className="px-3 py-2 text-gray-400 font-medium">
                          ...
                        </span>
                      ) : (
                        <button
                          key={pageNum}
                          onClick={() => handlePageChange(pageNum)}
                          className={`min-w-[40px] px-3 py-2 rounded-lg font-semibold transition-all duration-200 ${
                            currentPage === pageNum
                              ? 'bg-blue-500 text-white shadow-lg scale-110 border-2 border-blue-600'
                              : 'bg-white text-gray-700 border-2 border-gray-300 hover:bg-blue-50 hover:border-blue-400 hover:text-blue-600'
                          }`}
                        >
                          {pageNum}
                        </button>
                      )
                    ))}
                  </div>

                  {/* Next and Last Buttons */}
                  <button
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage === pagination.totalPages}
                    className="p-2 rounded-lg border-2 border-gray-300 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-50 hover:border-blue-400 transition-all duration-200 group"
                    title="Next Page"
                  >
                    <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                  
                  <button
                    onClick={() => handlePageChange(pagination.totalPages)}
                    disabled={currentPage === pagination.totalPages}
                    className="p-2 rounded-lg border-2 border-gray-300 bg-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-blue-50 hover:border-blue-400 transition-all duration-200 group"
                    title="Last Page"
                  >
                    <svg className="w-5 h-5 text-gray-600 group-hover:text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      <Nav />
    </div>
  );
};

export default AdminJourney;