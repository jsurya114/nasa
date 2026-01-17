import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getAllDriversAvailability,
  getAvailableCities,
  updateDriverAvailabilityByAdmin,
  manualResetAllDriversAvailability,
  clearMessages
} from "../../redux/slice/driver/availabilitySlice.js";
import { toast } from "react-toastify";

import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";

export default function AdminDriverAvailability() {
  const dispatch = useDispatch();

  const { allDriversAvailability, availableCities, pagination, loading, citiesLoading, resetLoading, error } = useSelector(
    (state) => state.availability
  );
  const { admin } = useSelector((state) => state.admin);

  const [filterDay, setFilterDay] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [editingDriverId, setEditingDriverId] = useState(null);
  const [editAvailability, setEditAvailability] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [currentDayIndex, setCurrentDayIndex] = useState(0);

  const daysOfWeek = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ];

  const daysShort = {
    monday: "Mon",
    tuesday: "Tue",
    wednesday: "Wed",
    thursday: "Thu",
    friday: "Fri",
    saturday: "Sat",
    sunday: "Sun"
  };

  const dayIndexMap = {
    monday: 0,
    tuesday: 1,
    wednesday: 2,
    thursday: 3,
    friday: 4,
    saturday: 5,
    sunday: 6
  };

  // Get user's timezone
  const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  // Update current day index (in USER'S LOCAL timezone, Monday-based)
  useEffect(() => {
    const updateCurrentDay = () => {
      const now = new Date();
      
      // Use Intl API to get time in user's timezone
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        weekday: 'long',
        hour: 'numeric',
        hour12: false
      });
      
      const parts = formatter.formatToParts(now);
      const weekday = parts.find(p => p.type === 'weekday').value.toLowerCase();
      
      // Map day name to index (Monday = 0)
      const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayIndex = dayNames.indexOf(weekday);
      
      setCurrentDayIndex(dayIndex);
    };

    updateCurrentDay();
    const interval = setInterval(updateCurrentDay, 60000);
    return () => clearInterval(interval);
  }, [userTimezone]);

  // Fetch cities on mount
  useEffect(() => {
    dispatch(getAvailableCities());
  }, [dispatch]);

  useEffect(() => {
    dispatch(getAllDriversAvailability({
      filterDay: filterDay || null,
      page: currentPage,
      limit: itemsPerPage,
      searchQuery: searchQuery || null,
      filterCity: filterCity || null
    }));
  }, [dispatch, currentPage, filterDay, itemsPerPage, searchQuery, filterCity]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      dispatch(clearMessages());
    }
  }, [error, dispatch]);

  const handleFilterChange = (day) => {
    setFilterDay(day);
    setCurrentPage(1);
  };

  const handleCityFilterChange = (city) => {
    setFilterCity(city);
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (newLimit) => {
    setItemsPerPage(newLimit);
    setCurrentPage(1);
  };

  const filteredDrivers = allDriversAvailability;

  const getAvailabilityCount = (drivers) => {
    const counts = {};
    daysOfWeek.forEach((day) => {
      counts[day] = drivers.filter(
        (d) => d.availability?.[day] === true
      ).length;
    });
    return counts;
  };

  const availabilityCounts = getAvailabilityCount(allDriversAvailability);

  const totalPages = pagination?.totalPages || 0;
  const totalRecords = pagination?.totalRecords || 0;
  const hasNextPage = pagination?.hasNextPage || false;
  const hasPreviousPage = pagination?.hasPreviousPage || false;

  const goToPage = (page) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages));
  };

  const goToFirstPage = () => setCurrentPage(1);
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToPreviousPage = () => setCurrentPage(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setCurrentPage(prev => Math.min(totalPages, prev + 1));

  const getPageNumbers = () => {
    const pages = [];
    const maxVisible = 7;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 4) {
        for (let i = 1; i <= 5; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 3) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 4; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        for (let i = currentPage - 1; i <= currentPage + 1; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  const getAvailableDays = (availability) => {
    return Object.values(availability).filter(Boolean).length;
  };

  const isDayLocked = (dayKey) => {
    const dayIndex = dayIndexMap[dayKey];
    return dayIndex < currentDayIndex;
  };

  const startEdit = (driver) => {
    setEditingDriverId(driver.id);
    setEditAvailability({ ...driver.availability });
  };

  const cancelEdit = () => {
    setEditingDriverId(null);
    setEditAvailability({});
    setIsSaving(false);
  };

  const toggleDay = (day) => {
    if (isDayLocked(day)) {
      toast.error(`Cannot edit ${day}. That day has already ended.`);
      return;
    }
    
    setEditAvailability((prev) => ({
      ...prev,
      [day]: !prev[day]
    }));
  };

  const saveAvailability = async (driverId) => {
    setIsSaving(true);
    try {
      const res = await dispatch(
        updateDriverAvailabilityByAdmin({
          driverId,
          availability: editAvailability
        })
      );
      
      if (!res.error) {
        toast.success("Availability updated successfully!");
        setEditingDriverId(null);
        setEditAvailability({});
      } else {
        toast.error(res.error?.message || "Failed to update availability");
      }
    } catch (err) {
      toast.error("An error occurred while updating");
    } finally {
      setIsSaving(false);
    }
  };

  const handleManualReset = async () => {
    if (window.confirm(
      '⚠️ WARNING: This will reset availability for ALL drivers (enabled and disabled) to unavailable.\n\nAre you sure you want to continue?'
    )) {
      try {
        const result = await dispatch(manualResetAllDriversAvailability()).unwrap();
        toast.success(`✅ ${result.totalDriversReset} drivers reset successfully!`);
        
        // Refresh the current page
        dispatch(getAllDriversAvailability({
          filterDay: filterDay || null,
          page: currentPage,
          limit: itemsPerPage,
          searchQuery: searchQuery || null,
          filterCity: filterCity || null
        }));
      } catch (error) {
        toast.error(error || 'Failed to reset availability');
      }
    }
  };

  const clearFilters = () => {
    setFilterDay("");
    setFilterCity("");
    setSearchQuery("");
    setCurrentPage(1);
  };

  const hasActiveFilters = filterDay || filterCity || searchQuery;

  return (
    <>
      <Header />

      <div className="min-h-screen bg-gradient-to-br from-gray-50 to-gray-100 p-3 sm:p-4 md:p-6 pb-32">
        <div className="max-w-7xl mx-auto">
          {/* Header Card */}
          <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex flex-col gap-4">
              <div className="flex items-start justify-between">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-gray-900 flex items-center gap-2">
                    <svg className="w-6 h-6 sm:w-7 sm:h-7 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    Driver Availability
                  </h1>
                  <p className="text-xs sm:text-sm text-gray-600 mt-1">
                    View and manage driver availability schedules
                    {admin?.role === "superadmin" && <span className="ml-1 text-blue-600 font-medium">(Superadmin Access)</span>}
                  </p>
                </div>
                
                {/* Stats Badge */}
                <div className="hidden sm:flex flex-col items-end">
                  <div className="text-2xl font-bold text-blue-600">{totalRecords}</div>
                  <div className="text-xs text-gray-500">Total Drivers</div>
                </div>
              </div>

              {/* Filters Section */}
              <div className="flex flex-col gap-3">
                {/* Search Bar */}
                <div className="relative">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                  <input
                    type="text"
                    placeholder="Search by name, email, or driver code..."
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setCurrentPage(1);
                    }}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm transition-all"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => {
                        setSearchQuery("");
                        setCurrentPage(1);
                      }}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  )}
                </div>

                {/* Filter Dropdowns */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {/* Day Filter */}
                  <div className="relative">
                    <select
                      value={filterDay}
                      onChange={(e) => handleFilterChange(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer transition-all"
                    >
                      <option value="">All Days</option>
                      {daysOfWeek.map((day) => (
                        <option key={day} value={day}>
                          {day.charAt(0).toUpperCase() + day.slice(1)} 
                        </option>
                      ))}
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* City Filter */}
                  <div className="relative">
                    <select
                      value={filterCity}
                      onChange={(e) => handleCityFilterChange(e.target.value)}
                      disabled={citiesLoading}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      <option value="">All Cities</option>
                      {availableCities.map((city) => (
                        <option key={city} value={city}>
                          {city}
                        </option>
                      ))}
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Items Per Page */}
                  <div className="relative">
                    <select
                      value={itemsPerPage}
                      onChange={(e) => handleItemsPerPageChange(parseInt(e.target.value))}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer transition-all"
                    >
                      <option value={10}>10 per page</option>
                      <option value={25}>25 per page</option>
                      <option value={50}>50 per page</option>
                      <option value={100}>100 per page</option>
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Active Filters & Clear Button */}
                {hasActiveFilters && (
                  <div className="flex items-center justify-between p-3 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-medium text-blue-900">Active Filters:</span>
                      {filterDay && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded text-xs font-medium text-blue-700 border border-blue-200">
                          Day: {filterDay}
                          <button onClick={() => handleFilterChange("")} className="hover:text-blue-900">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      )}
                      {filterCity && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded text-xs font-medium text-blue-700 border border-blue-200">
                          City: {filterCity}
                          <button onClick={() => handleCityFilterChange("")} className="hover:text-blue-900">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      )}
                      {searchQuery && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-white rounded text-xs font-medium text-blue-700 border border-blue-200">
                          Search: "{searchQuery}"
                          <button onClick={() => setSearchQuery("")} className="hover:text-blue-900">
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </span>
                      )}
                    </div>
                    <button
                      onClick={clearFilters}
                      className="text-xs font-medium text-blue-700 hover:text-blue-900 underline whitespace-nowrap"
                    >
                      Clear All
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Manual Reset Button (Superadmin Only) */}
          {admin?.role === "superadmin" && (
            <div className="bg-gradient-to-r from-red-50 to-orange-50 border border-red-200 rounded-xl p-4 mb-4 sm:mb-6 shadow-sm">
              <div className="flex items-center justify-between gap-4">
                <div className="flex items-start gap-3 flex-1">
                  <svg className="w-6 h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-red-900">Superadmin Action</h3>
                    <p className="text-xs text-red-700 mt-1">
                      Reset all drivers' availability to unavailable. This action affects all enabled and disabled drivers.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleManualReset}
                  disabled={resetLoading}
                  className="px-4 py-2 bg-red-600 text-white text-sm font-semibold rounded-lg hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm flex items-center gap-2 whitespace-nowrap"
                >
                  {resetLoading ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
                        <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
                      </svg>
                      Resetting...
                    </>
                  ) : (
                    <>
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                      Reset All Availability
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
          {/* Info about locked days */}
          <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-3 sm:p-4 mb-4 sm:mb-6 shadow-sm">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="text-xs sm:text-sm font-semibold text-amber-900">Editing Restrictions</p>
                <p className="text-xs text-amber-700 mt-1">
                  Past days (before today) cannot be edited to maintain historical accuracy. Days with 🔒 icon are locked. Drivers have a 7:00 PM cutoff for editing today and tomorrow.
                </p>
              </div>
            </div>
          </div>
          {loading ? (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-12 text-center">
              <div className="animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent mx-auto"></div>
              <p className="mt-4 text-gray-600 font-medium">Loading drivers...</p>
            </div>
          ) : filteredDrivers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-12 text-center">
              <svg className="w-20 h-20 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Drivers Found</h3>
              <p className="text-gray-600 mb-4">
                {hasActiveFilters
                  ? "No drivers match your current filters"
                  : "No drivers available"}
              </p>
              {hasActiveFilters && (
                <button
                  onClick={clearFilters}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
                >
                  Clear Filters
                </button>
              )}
            </div>
          ) : (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
              {/* Desktop Table */}
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Driver Info
                      </th>
                      {daysOfWeek.map((day) => (
                        <th
                          key={day}
                          className="px-3 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider"
                        >
                          <div className="flex flex-col items-center gap-1">
                            <span>{daysShort[day]}</span>
                            {isDayLocked(day) && (
                              <svg className="w-3 h-3 text-gray-400" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                              </svg>
                            )}
                          </div>
                        </th>
                      ))}
                      <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredDrivers.map((driver) => {
                      const isEditing = editingDriverId === driver.id;
                      const displayAvailability = isEditing ? editAvailability : driver.availability;

                      return (
                        <tr key={driver.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4">
                            <div>
                              <div className="flex items-center gap-2">
                                <div className="text-sm font-semibold text-gray-900">
                                  {driver.name}
                                </div>
                                {!driver.enabled && (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                    Disabled
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 mt-0.5">
                                {driver.email}
                              </div>
                              <div className="flex items-center gap-2 mt-1">
                                <span className="text-xs text-gray-500">
                                  Code: {driver.driver_code}
                                </span>
                                <span className="text-xs text-blue-600 font-medium">
                                  • {driver.city}
                                </span>
                              </div>
                            </div>
                          </td>

                          {daysOfWeek.map((day) => {
                            const isAvailable = displayAvailability?.[day];
                            const isLocked = isDayLocked(day);

                            return (
                              <td key={day} className="px-3 py-4 text-center">
                                {isEditing ? (
                                  <button
                                    onClick={() => toggleDay(day)}
                                    disabled={isLocked}
                                    className={`w-10 h-10 rounded-lg transition-all flex items-center justify-center mx-auto ${
                                      isLocked
                                        ? 'bg-gray-100 opacity-50 cursor-not-allowed'
                                        : isAvailable
                                        ? 'bg-green-100 hover:bg-green-200 ring-2 ring-green-300'
                                        : 'bg-red-100 hover:bg-red-200 ring-2 ring-red-300'
                                    }`}
                                    title={isLocked ? `${day} is locked (past day)` : `Toggle ${day}`}
                                  >
                                    {isLocked ? (
                                      <svg className="w-4 h-4 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                      </svg>
                                    ) : isAvailable ? (
                                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    )}
                                  </button>
                                ) : (
                                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center mx-auto ${
                                    isAvailable ? 'bg-green-100' : 'bg-red-100'
                                  }`}>
                                    {isAvailable ? (
                                      <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : (
                                      <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                      </svg>
                                    )}
                                  </div>
                                )}
                              </td>
                            );
                          })}

                          <td className="px-6 py-4 text-center">
                            {isEditing ? (
                              <div className="flex justify-center gap-2">
                                <button
                                  onClick={() => saveAvailability(driver.id)}
                                  disabled={isSaving}
                                  className="px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-all shadow-sm disabled:opacity-50 flex items-center gap-1"
                                >
                                  {isSaving ? (
                                    <>
                                      <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
                                        <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
                                      </svg>
                                      Save
                                    </>
                                  ) : (
                                    <>
                                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                      </svg>
                                      Save
                                    </>
                                  )}
                                </button>
                                <button
                                  onClick={cancelEdit}
                                  disabled={isSaving}
                                  className="px-3 py-1.5 bg-gray-500 text-white text-xs font-medium rounded-lg hover:bg-gray-600 transition-all shadow-sm disabled:opacity-50 flex items-center gap-1"
                                >
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEdit(driver)}
                                className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-all shadow-sm flex items-center gap-1 mx-auto"
                              >
                                <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                Edit
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Mobile Cards */}
              <div className="md:hidden divide-y divide-gray-200">
                {filteredDrivers.map((driver) => {
                  const isEditing = editingDriverId === driver.id;
                  const displayAvailability = isEditing ? editAvailability : driver.availability;

                  return (
                    <div key={driver.id} className="p-4 hover:bg-gray-50 transition-colors">
                      <div className="flex items-start justify-between mb-3">
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <h3 className="text-sm font-semibold text-gray-900">
                              {driver.name}
                            </h3>
                            {!driver.enabled && (
                              <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-800">
                                Disabled
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-600">{driver.email}</p>
                          <div className="flex items-center gap-2 mt-1">
                            <span className="text-[10px] text-gray-500">
                              Code: {driver.driver_code}
                            </span>
                            <span className="text-[10px] text-blue-600 font-medium">
                              • {driver.city}
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-lg font-bold text-blue-600">
                            {getAvailableDays(displayAvailability)}/7
                          </div>
                          <div className="text-[9px] text-gray-500">Available</div>
                        </div>
                      </div>

                      <div className="mt-3">
                        <div className="grid grid-cols-7 gap-1.5">
                          {daysOfWeek.map((day) => {
                            const isAvailable = displayAvailability?.[day];
                            const isLocked = isDayLocked(day);
                            
                            return (
                              <div
                                key={day}
                                onClick={() => {
                                  if (isEditing && !isLocked) {
                                    toggleDay(day);
                                  }
                                }}
                                className={`aspect-square rounded-lg flex flex-col items-center justify-center transition-all ${
                                  isLocked
                                    ? 'bg-gray-100 opacity-60'
                                    : isAvailable
                                    ? 'bg-green-100'
                                    : 'bg-red-100'
                                } ${
                                  isEditing && !isLocked
                                    ? 'cursor-pointer active:scale-95 shadow-sm'
                                    : ''
                                }`}
                              >
                                {isLocked ? (
                                  <svg className="w-3 h-3 text-gray-500" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                  </svg>
                                ) : isAvailable ? (
                                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                )}
                                <span className="text-[9px] font-medium text-gray-600 mt-0.5">
                                  {daysShort[day]}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div className="pt-3 border-t border-gray-200 mt-3">
                        {editingDriverId === driver.id ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveAvailability(driver.id)}
                              disabled={isSaving}
                              className="flex-1 px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              {isSaving ? (
                                <>
                                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
                                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
                                  </svg>
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Save
                                </>
                              )}
                            </button>
                            <button
                              onClick={cancelEdit}
                              disabled={isSaving}
                              className="flex-1 px-4 py-2 bg-gray-500 text-white text-sm font-medium rounded-lg hover:bg-gray-600 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                            >
                              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => startEdit(driver)}
                            className="w-full px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-all shadow-sm flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit Availability
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Enhanced Pagination Footer */}
              <div className="px-4 sm:px-6 py-4 sm:py-6 bg-gradient-to-r from-gray-50 to-gray-100 border-t-2 border-gray-200">
                <div className="flex flex-col gap-4">
                  {/* Info and Stats */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
                    <div className="text-xs sm:text-sm text-gray-700 font-medium">
                      Showing <span className="font-bold text-blue-600">{(currentPage - 1) * itemsPerPage + 1}</span> to{' '}
                      <span className="font-bold text-blue-600">{Math.min(currentPage * itemsPerPage, totalRecords)}</span> of{' '}
                      <span className="font-bold text-blue-600">{totalRecords}</span> drivers
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6">
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-green-100 rounded-md flex items-center justify-center ring-1 ring-green-300">
                          <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-xs text-gray-600 font-medium">Available</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-red-100 rounded-md flex items-center justify-center ring-1 ring-red-300">
                          <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                        <span className="text-xs text-gray-600 font-medium">Unavailable</span>
                      </div>
                    </div>
                  </div>

                  {/* Enhanced Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="flex items-center justify-center gap-2">
                      {/* First Page */}
                      <button
                        onClick={goToFirstPage}
                        disabled={!hasPreviousPage || loading}
                        className="p-2 border-2 border-gray-300 rounded-lg hover:bg-gray-200 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-300 transition-all"
                        title="First Page"
                      >
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                      </button>
                      
                      {/* Previous */}
                      <button
                        onClick={goToPreviousPage}
                        disabled={!hasPreviousPage || loading}
                        className="p-2 border-2 border-gray-300 rounded-lg hover:bg-gray-200 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-300 transition-all"
                        title="Previous"
                      >
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>

                      {/* Page Numbers */}
                      <div className="hidden sm:flex items-center gap-1">
                        {getPageNumbers().map((page, idx) => (
                          page === '...' ? (
                            <span key={`ellipsis-${idx}`} className="px-3 py-2 text-sm text-gray-500 font-medium">...</span>
                          ) : (
                            <button
                              key={page}
                              onClick={() => goToPage(page)}
                              disabled={loading}
                              className={`min-w-[2.5rem] px-3 py-2 text-sm font-bold border-2 rounded-lg transition-all disabled:opacity-50 ${
                                currentPage === page
                                  ? 'bg-blue-600 text-white border-blue-600 shadow-lg scale-105'
                                  : 'border-gray-300 text-gray-700 hover:bg-gray-200 hover:border-gray-400'
                              }`}
                            >
                              {page}
                            </button>
                          )
                        ))}
                      </div>

                      {/* Mobile Page Indicator */}
                      <div className="sm:hidden px-4 py-2 bg-white border-2 border-gray-300 rounded-lg text-sm font-bold text-gray-700">
                        {currentPage} / {totalPages}
                      </div>

                      {/* Next */}
                      <button
                        onClick={goToNextPage}
                        disabled={!hasNextPage || loading}
                        className="p-2 border-2 border-gray-300 rounded-lg hover:bg-gray-200 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-300 transition-all"
                        title="Next"
                      >
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      {/* Last Page */}
                      <button
                        onClick={goToLastPage}
                        disabled={!hasNextPage || loading}
                        className="p-2 border-2 border-gray-300 rounded-lg hover:bg-gray-200 hover:border-gray-400 disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:border-gray-300 transition-all"
                        title="Last Page"
                      >
                        <svg className="w-4 h-4 text-gray-700" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="h-24" />
      <Nav />
    </>
  );
}