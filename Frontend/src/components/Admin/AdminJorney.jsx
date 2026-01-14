import React, { useEffect, useState, useCallback, useMemo } from "react";
import { useSelector, useDispatch } from "react-redux";
import {
  fetchPaginatedJourneys,
  updateJourney,
  addJourney,
  fetchAdminRoutes,
  fetchAllDrivers,
  clearJourneyError,
  deleteJourney,
  fetchRoutesByDriver
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
const [isAdding, setIsAdding] = useState(false);
const [selectedDriverForRoutes, setSelectedDriverForRoutes] = useState(null);

  const [editableJourneyId, setEditableJourneyId] = useState(null);
  const [formData, setFormData] = useState({});
  const [editValidationErrors, setEditValidationErrors] = useState({});
  const [newJourneyData, setNewJourneyData] = useState({
    driver_id: "",
    route_id: "",
    start_seq: "",
    end_seq: "",
    journey_date: new Date().toLocaleDateString("en-CA"),
  });
  
  const [validationErrors, setValidationErrors] = useState({});
  const [errorTimeout, setErrorTimeout] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  // ✅ NEW: Filter states
  const [filters, setFilters] = useState({
    route_id: "",
    driver_name: "",
    journey_date: ""
  });

  // ✅ Fetch paginated data with filters on mount and when page/limit/filters change
  useEffect(() => {
    dispatch(fetchPaginatedJourneys({ 
      page: currentPage, 
      limit: itemsPerPage,
      ...filters 
    }));
  }, [dispatch, currentPage, itemsPerPage, filters]);

  // ✅ FIXED: Always fetch routes and drivers on mount if data is empty
  useEffect(() => {
    // Only fetch if not currently loading and data is empty
    if (routesStatus !== "loading" && routes.length === 0) {
      dispatch(fetchAdminRoutes());
    }
    
    if (driversStatus !== "loading" && drivers.length === 0) {
      dispatch(fetchAllDrivers());
    }
  }, [dispatch, routes.length, drivers.length, routesStatus, driversStatus]);

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

  useEffect(() => {
  if (newJourneyData.driver_id) {
    // Fetch routes specific to this driver
    dispatch(fetchRoutesByDriver(newJourneyData.driver_id));
    setSelectedDriverForRoutes(newJourneyData.driver_id);
  } else {
    // No driver selected - show all routes
    dispatch(fetchAdminRoutes());
    setSelectedDriverForRoutes(null);
  }
}, [newJourneyData.driver_id, dispatch]);
useEffect(() => {
  if (editableJourneyId && formData.driver_id) {
    const currentJourney = paginatedJourneys.find(j => j.id === editableJourneyId);
    if (currentJourney && formData.driver_id !== currentJourney.driver_id) {
      // Driver changed during edit - fetch new routes
      dispatch(fetchRoutesByDriver(formData.driver_id));
    }
  }
}, [editableJourneyId, formData.driver_id, dispatch, paginatedJourneys]);


  // ✅ Handle errors without causing re-renders
  useEffect(() => {
    if (paginatedError) {
      toast.error(paginatedError);
      dispatch(clearJourneyError());
    }
  }, [paginatedError, dispatch]);

  // ✅ NEW: Handle filter changes
  const handleFilterChange = useCallback((filterName, value) => {
    setFilters(prev => ({
      ...prev,
      [filterName]: value
    }));
    setCurrentPage(1); // Reset to first page when filter changes
  }, []);

  

  // ✅ NEW: Clear all filters
  const handleClearFilters = useCallback(() => {
    setFilters({
      route_id: "",
      driver_name: "",
      journey_date: ""
    });
    setCurrentPage(1);
  }, []);

  const handleRefresh = useCallback(() => {
    dispatch(fetchPaginatedJourneys({ 
      page: currentPage, 
      limit: itemsPerPage,
      ...filters 
    }));
  }, [dispatch, currentPage, itemsPerPage, filters]);

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
  
  // If driver changes during edit, clear the route
  if (name === 'driver_id') {
    setFormData((prev) => ({ 
      ...prev, 
      [name]: value,
      route_id: '' // Clear route when driver changes
    }));
  } else {
    setFormData((prev) => ({ ...prev, [name]: value }));
  }
  
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
        await dispatch(updateJourney({ journey_id: id, ...formData })).unwrap();
        toast.success("Journey updated successfully!");
        dispatch(fetchPaginatedJourneys({ 
          page: currentPage, 
          limit: itemsPerPage,
          ...filters 
        }));
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
    [dispatch, formData, validateSequenceOverlap, paginatedJourneys, currentPage, itemsPerPage, filters]
  );

  const handleNewJourneyChange = useCallback((e) => {
  const { name, value } = e.target;
  
  // If driver changes, clear the selected route
  if (name === 'driver_id') {
    setNewJourneyData((prev) => ({ 
      ...prev, 
      [name]: value,
      route_id: "" // Clear route selection when driver changes
    }));
  } else {
    setNewJourneyData((prev) => ({ ...prev, [name]: value }));
  }
  
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
    async (e) => {
      // ✅ ENHANCED: Prevent multiple simultaneous submissions
      if (isAdding) {
        console.log("Already adding journey, ignoring duplicate click");
        return;
      }

      setIsAdding(true);

      try {
        if (errorTimeout) {
          clearTimeout(errorTimeout);
          setErrorTimeout(null);
        }

        setValidationErrors({});

        // Validation checks
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

        // ✅ FIXED: Early return with proper cleanup
        if (Object.keys(errors).length > 0) {
          setValidationErrors(errors);
          setIsAdding(false);
          return;
        }

        // Check for overlapping sequences
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
          setIsAdding(false);
          return;
        }

        // Add journey
        await dispatch(addJourney(newJourneyData)).unwrap();
        toast.success("Journey added successfully!");
        
        // Refresh with current pagination and filters
        dispatch(fetchPaginatedJourneys({ 
          page: currentPage, 
          limit: itemsPerPage,
          ...filters 
        }));
        
        // Reset form
        setNewJourneyData({
          driver_id: "",
          route_id: "",
          start_seq: "",
          end_seq: "",
          journey_date: new Date().toLocaleDateString("en-CA"),
        });
        setValidationErrors({});
        
      } catch (err) {
        setValidationErrors({
          general: err.message || "Failed to add journey"
        });
      } finally {
        // ✅ Always reset the adding state
        setIsAdding(false);
      }
    },
    [isAdding, dispatch, newJourneyData, validateSequenceOverlap, errorTimeout, currentPage, itemsPerPage, filters]
  );

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure? This will delete all related data.")) return;

    try {
      await dispatch(deleteJourney(id)).unwrap();
      toast.success("Journey deleted successfully");
      dispatch(fetchPaginatedJourneys({ 
        page: currentPage, 
        limit: itemsPerPage,
        ...filters 
      }));
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

    // Add dots if there's a gap after first page
    if (rangeStart > 2) {
      pages.push('...');
    }

    // Add pages around current
    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(i);
    }

    // Add dots if there's a gap before last page
    if (rangeEnd < totalPages - 1) {
      pages.push('...');
    }

    // Always show last page (if more than 1 page exists)
    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  const tableRows = useMemo(() => {
    return paginatedJourneys.map((journey) => {
      const isEditing = editableJourneyId === journey.id;

      return (
        <tr
          key={journey.id}
          className="border-b hover:bg-blue-50 transition-colors duration-200"
        >
          {/* Driver Cell */}
          <td className="px-4 py-3">
            {isEditing ? (
              <Select
                name="driver_id"
                options={drivers.map((driver) => ({
                  value: driver.id,
                  label: driver.name,
                }))}
                value={
                  drivers.find(d => d.id === formData.driver_id)
                    ? {
                        value: formData.driver_id,
                        label: drivers.find(d => d.id === formData.driver_id).name,
                      }
                    : null
                }
                onChange={(selectedOption) =>
                  setFormData(prev => ({ ...prev, driver_id: selectedOption?.value || '' }))
                }
                placeholder="Select driver..."
                isClearable
                isSearchable
                classNamePrefix="react-select"
                styles={{
                  control: (base, state) => ({
                    ...base,
                    borderColor: editValidationErrors.driver_id ? '#ef4444' : '#3b82f6',
                    boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : base.boxShadow,
                    minHeight: '38px',
                    borderRadius: '0.375rem',
                  }),
                  menu: base => ({
                    ...base,
                    zIndex: 9999,
                  }),
                }}
              />
            ) : (
              <span className="font-medium text-gray-800">{journey.driver_name}</span>
            )}
            {isEditing && editValidationErrors.driver_id && (
              <p className="text-xs text-red-500 mt-1">{editValidationErrors.driver_id}</p>
            )}
          </td>

          {/* Date Cell */}
          <td className="px-4 py-3 text-gray-700">{journey.journey_date}</td>

          {/* Route Cell */}
          <td className="px-4 py-3">
            {isEditing ? (
              <Select
                name="route_id"
                options={routes.map((route) => ({
                  value: route.id,
                  label: route.route || route.name || `Route ${route.id}`,
                }))}
                value={
                  routes.find(r => r.id === formData.route_id)
                    ? {
                        value: formData.route_id,
                        label: routes.find(r => r.id === formData.route_id).route || routes.find(r => r.id === formData.route_id).name,
                      }
                    : null
                }
                onChange={(selectedOption) =>
                  setFormData(prev => ({ ...prev, route_id: selectedOption?.value || '' }))
                }
                placeholder="Select route..."
                isClearable
                isSearchable
                classNamePrefix="react-select"
                styles={{
                  control: (base, state) => ({
                    ...base,
                    borderColor: editValidationErrors.route_id ? '#ef4444' : '#3b82f6',
                    boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : base.boxShadow,
                    minHeight: '38px',
                    borderRadius: '0.375rem',
                  }),
                  menu: base => ({
                    ...base,
                    zIndex: 9999,
                  }),
                }}
              />
            ) : (
              <span className="font-medium text-gray-800">{journey.route_name}</span>
            )}
            {isEditing && editValidationErrors.route_id && (
              <p className="text-xs text-red-500 mt-1">{editValidationErrors.route_id}</p>
            )}
          </td>

          {/* Start Seq Cell */}
          <td className="px-4 py-3 text-center">
            {isEditing ? (
              <>
                <input
                  type="number"
                  name="start_seq"
                  value={formData.start_seq}
                  onChange={handleChange}
                  className={`w-20 border-2 rounded px-2 py-1 text-center focus:outline-none focus:ring-2 ${
                    editValidationErrors.start_seq 
                      ? 'border-red-500 focus:ring-red-500' 
                      : 'border-blue-500 focus:ring-blue-500'
                  }`}
                  min="1"
                />
                {editValidationErrors.start_seq && (
                  <p className="text-xs text-red-500 mt-1">{editValidationErrors.start_seq}</p>
                )}
              </>
            ) : (
              <span className="inline-block bg-blue-100 text-blue-800 px-3 py-1 rounded-full font-semibold">
                {journey.start_seq}
              </span>
            )}
          </td>

          {/* End Seq Cell */}
          <td className="px-4 py-3 text-center">
            {isEditing ? (
              <>
                <input
                  type="number"
                  name="end_seq"
                  value={formData.end_seq}
                  onChange={handleChange}
                  className={`w-20 border-2 rounded px-2 py-1 text-center focus:outline-none focus:ring-2 ${
                    editValidationErrors.end_seq 
                      ? 'border-red-500 focus:ring-red-500' 
                      : 'border-blue-500 focus:ring-blue-500'
                  }`}
                  min="1"
                />
                {editValidationErrors.end_seq && (
                  <p className="text-xs text-red-500 mt-1">{editValidationErrors.end_seq}</p>
                )}
              </>
            ) : (
              <span className="inline-block bg-green-100 text-green-800 px-3 py-1 rounded-full font-semibold">
                {journey.end_seq}
              </span>
            )}
          </td>

          {/* Packages Cell */}
          <td className="px-4 py-3 text-center">
            <span className="inline-block bg-purple-100 text-purple-800 px-3 py-1 rounded-full font-semibold">
              {journey.packages}
            </span>
          </td>

          {/* Actions Cell */}
          <td className="px-4 py-3 text-center">
            {isEditing ? (
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => handleSave(journey.id)}
                  className="bg-green-500 text-white px-4 py-2 rounded-lg hover:bg-green-600 transition-colors font-medium flex items-center gap-1"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Save
                </button>
                <button
                  onClick={handleCancel}
                  className="bg-gray-500 text-white px-4 py-2 rounded-lg hover:bg-gray-600 transition-colors font-medium flex items-center gap-1"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Cancel
                </button>
              </div>
            ) : (
              <div className="flex justify-center gap-2">
                <button
                  onClick={() => handleEdit(journey)}
                  className="bg-blue-500 text-white px-4 py-2 rounded-lg hover:bg-blue-600 transition-colors font-medium flex items-center gap-1"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                  </svg>
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(journey.id)}
                  className="bg-red-500 text-white px-4 py-2 rounded-lg hover:bg-red-600 transition-colors font-medium flex items-center gap-1"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    className="h-4 w-4"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                  >
                    <path
                      fillRule="evenodd"
                      d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  Delete
                </button>
              </div>
            )}
            {isEditing && editValidationErrors.general && (
              <p className="text-xs text-red-500 mt-2 text-left">{editValidationErrors.general}</p>
            )}
          </td>
        </tr>
      );
    });
  }, [paginatedJourneys, editableJourneyId, formData, handleEdit, handleCancel, handleSave, handleChange, handleDelete, editValidationErrors, drivers, routes]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 via-white to-purple-50">
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

        {/* ✅ NEW: Filter Section */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-4 border-2 border-blue-200">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-lg font-semibold text-blue-700">Filter Journeys</h2>
            <button
              onClick={handleClearFilters}
              className="text-sm bg-gray-200 hover:bg-gray-300 text-gray-700 px-3 py-1 rounded-lg transition-colors flex items-center gap-1"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                className="h-4 w-4"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z"
                  clipRule="evenodd"
                />
              </svg>
              Clear Filters
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1">Filter by Route</label>
              <Select
                name="route_filter"
                options={routes.map((route) => ({
                  value: route.id,
                  label: route.route || route.name || `Route ${route.id}`,
                }))}
                value={
                  filters.route_id
                    ? routes.find(r => r.id === filters.route_id)
                      ? {
                          value: filters.route_id,
                          label: routes.find(r => r.id === filters.route_id).route || routes.find(r => r.id === filters.route_id).name,
                        }
                      : null
                    : null
                }
                onChange={(selectedOption) =>
                  handleFilterChange('route_id', selectedOption?.value || '')
                }
                placeholder="All routes..."
                isClearable
                isSearchable
                classNamePrefix="react-select"
                styles={{
                  control: (base, state) => ({
                    ...base,
                    borderColor: '#3b82f6',
                    boxShadow: state.isFocused ? '0 0 0 1px #3b82f6' : base.boxShadow,
                    minHeight: '38px',
                    borderRadius: '0.375rem',
                  }),
                  menu: base => ({
                    ...base,
                    zIndex: 9999,
                  }),
                }}
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Filter by Driver Name</label>
              <input
                type="text"
                name="driver_name_filter"
                value={filters.driver_name}
                onChange={(e) => handleFilterChange('driver_name', e.target.value)}
                className="w-full border-2 border-blue-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Enter driver name..."
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1">Filter by Date</label>
              <input
                type="date"
                name="journey_date_filter"
                value={filters.journey_date}
                onChange={(e) => handleFilterChange('journey_date', e.target.value)}
                className="w-full border-2 border-blue-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
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
                options={drivers.filter(d=>d.enabled).map((driver) => ({
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
                options={routes.filter(r=>r.enabled).map((route) => ({
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
  type="button"
  onClick={handleAddJourney}
  disabled={isAdding}
  style={{ pointerEvents: isAdding ? 'none' : 'auto' }}
  className={`
    bg-green-500 text-white px-6 py-2 rounded
    font-medium flex items-center gap-2
    transition-all duration-200
    ${isAdding 
      ? 'opacity-50 cursor-not-allowed bg-green-500' 
      : 'hover:bg-green-600 hover:shadow-lg active:scale-95'
    }
  `}
>
  {isAdding ? (
    <>
      <svg
        className="animate-spin h-5 w-5 pointer-events-none"
        xmlns="http://www.w3.org/2000/svg"
        fill="none"
        viewBox="0 0 24 24"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        ></circle>
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        ></path>
      </svg>
      Adding...
    </>
  ) : (
    <>
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-5 w-5 pointer-events-none"
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
    </>
  )}
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
                        <p className="text-gray-400 text-sm">Try adjusting your filters or add a new journey</p>
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