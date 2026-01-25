import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getAllDriversAvailability,
  getAvailableCities,
  getGlobalAvailabilityCounts,
  updateDriverAvailabilityByAdmin,
  manualResetAllDriversAvailability,
  clearMessages
} from "../../redux/slice/driver/availabilitySlice.js";
import { toast } from "react-toastify";

import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";

export default function AdminDriverAvailability() {
  const dispatch = useDispatch();

  const { allDriversAvailability, availableCities, globalCounts, pagination, loading, citiesLoading, resetLoading, error } = useSelector(
    (state) => state.availability
  );
  const { admin } = useSelector((state) => state.admin);

  const [filterDay, setFilterDay] = useState("");
  const [filterCity, setFilterCity] = useState("");
  const [filterAvailabilityStatus, setFilterAvailabilityStatus] = useState(""); // New: "available", "unavailable", or ""
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [editingDriverId, setEditingDriverId] = useState(null);
  const [editAvailability, setEditAvailability] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  const [currentHour, setCurrentHour] = useState(0);

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
    const updateCurrentTime = () => {
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
      const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);

      // Map day name to index (Monday = 0)
      const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
      const dayIndex = dayNames.indexOf(weekday);

      setCurrentDayIndex(dayIndex);
      setCurrentHour(hour);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000);
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

  // Fetch global availability counts (NOT affected by pagination or day filter)
  useEffect(() => {
    dispatch(getGlobalAvailabilityCounts({
      searchQuery: searchQuery || null,
      filterCity: filterCity || null
    }));
  }, [dispatch, searchQuery, filterCity]);

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

  const handleAvailabilityStatusChange = (status) => {
    setFilterAvailabilityStatus(status);
    setCurrentPage(1);
  };

  const handleItemsPerPageChange = (newLimit) => {
    setItemsPerPage(newLimit);
    setCurrentPage(1);
  };

  const filteredDrivers = allDriversAvailability.filter((driver) => {
    // Apply availability status filter if set (works independently)
    if (filterAvailabilityStatus && filterDay) {
      // If both day and status are selected, filter by that day's availability
      const isAvailableOnDay = driver.availability?.[filterDay] === true;

      if (filterAvailabilityStatus === "available") {
        return isAvailableOnDay;
      } else if (filterAvailabilityStatus === "unavailable") {
        return !isAvailableOnDay;
      }
    } else if (filterAvailabilityStatus && !filterDay) {
      // If only status is selected (no day), filter by overall availability
      // "available" = has at least one day available
      // "unavailable" = has no days available (all days are false)
      const hasAnyDayAvailable = Object.values(driver.availability || {}).some(day => day === true);

      if (filterAvailabilityStatus === "available") {
        return hasAnyDayAvailable;
      } else if (filterAvailabilityStatus === "unavailable") {
        return !hasAnyDayAvailable;
      }
    }

    return true; // Show all if no status filter
  });

  // Use globalCounts from Redux instead of calculating from current page
  const availabilityCounts = globalCounts || {
    monday: 0,
    tuesday: 0,
    wednesday: 0,
    thursday: 0,
    friday: 0,
    saturday: 0,
    sunday: 0
  };

  // Get counts for the selected day OR overall counts
  const getSelectedDayCounts = () => {
    if (filterDay) {
      // Use global counts for the selected day
      const available = globalCounts?.[filterDay] || 0;
      const totalDrivers = pagination?.totalRecords || 0;
      const unavailable = totalDrivers - available;

      return { available, unavailable };
    } else {
      // If no day selected, show overall availability counts
      // "available" = has at least one day available
      // "unavailable" = has no days available (all days false)
      const available = allDriversAvailability.filter((d) =>
        Object.values(d.availability || {}).some(day => day === true)
      ).length;

      const unavailable = allDriversAvailability.filter((d) =>
        !Object.values(d.availability || {}).some(day => day === true)
      ).length;

      return { available, unavailable };
    }
  };

  const selectedDayCounts = getSelectedDayCounts();

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

  /**
   * FIXED: Admin day locking logic
   * Admins can edit today and future days
   * Admins CANNOT edit past days (days before today)
   * SPECIAL HANDLING FOR SUNDAY: When today is Sunday, the week display shows next week
   */
  const isDayLocked = (dayKey) => {
    // Special Rule: On Sunday before 12:00 PM (noon)
    if (currentDayIndex === 6 && currentHour < 12) {
      const dayIndex = dayIndexMap[dayKey];
      // Admins CAN edit Sunday (today) and Monday (tomorrow) even BEFORE reset
      if (dayIndex === 6 || dayIndex === 0) {
        return false;
      }
      // Block Tuesday-Saturday (Pending Reset)
      return true;
    }

    const dayIndex = dayIndexMap[dayKey];

    // Special case: If today is Sunday (index 6)
    if (currentDayIndex === 6) {
      // All days in the availability table represent:
      // - Sunday = today (can edit)
      // - Monday-Saturday = next week (can edit all)
      // So nothing is locked on Sundays after 12:00 PM
      return false;
    }

    // For Monday-Saturday (currentDayIndex 0-5):
    // Only lock past days (days that have already occurred this week)
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
      if (currentDayIndex === 6 && currentHour < 12) {
        toast.error(`Availability for ${day} is locked until the Sunday 12:00 PM reset.`);
      } else {
        toast.error(`Cannot edit ${day}. That day has already ended.`);
      }
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

        // Refresh global counts after update
        dispatch(getGlobalAvailabilityCounts({
          searchQuery: searchQuery || null,
          filterCity: filterCity || null
        }));
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

        // Refresh global counts
        dispatch(getGlobalAvailabilityCounts({
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
    setFilterAvailabilityStatus("");
    setSearchQuery("");
    setCurrentPage(1);
  };

  const hasActiveFilters = filterDay || filterCity || searchQuery || filterAvailabilityStatus;

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
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
                          {day.charAt(0).toUpperCase() + day.slice(1)} ({availabilityCounts[day] || 0} available)
                        </option>
                      ))}
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>

                  {/* Availability Status Filter - INDEPENDENT */}
                  <div className="relative">
                    <select
                      value={filterAvailabilityStatus}
                      onChange={(e) => handleAvailabilityStatusChange(e.target.value)}
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer transition-all"
                    >
                      <option value="">All Drivers</option>
                      <option value="available">
                        ✓ Available {filterDay ? `on ${filterDay.charAt(0).toUpperCase() + filterDay.slice(1)}` : '(any day)'} ({selectedDayCounts.available})
                      </option>
                      <option value="unavailable">
                        ✕ Unavailable {filterDay ? `on ${filterDay.charAt(0).toUpperCase() + filterDay.slice(1)}` : '(all days)'} ({selectedDayCounts.unavailable})
                      </option>
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
                      className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm appearance-none bg-white cursor-pointer transition-all"
                      disabled={citiesLoading}
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
                      <option value="5">5 per page</option>
                      <option value="10">10 per page</option>
                      <option value="20">20 per page</option>
                      <option value="50">50 per page</option>
                      <option value="100">100 per page</option>
                    </select>
                    <svg className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </div>
                </div>

                {/* Clear Filters Button */}
                {hasActiveFilters && (
                  <button
                    onClick={clearFilters}
                    className="w-full sm:w-auto px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    Clear All Filters
                  </button>
                )}
              </div>

              {/* Manual Reset Button (Superadmin only) */}
              {admin?.role === "superadmin" && (
                <div className="pt-3 border-t border-gray-200">
                  <button
                    onClick={handleManualReset}
                    disabled={resetLoading}
                    className={`w-full sm:w-auto px-6 py-2.5 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 text-sm ${resetLoading
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      : 'bg-red-600 text-white hover:bg-red-700 shadow-lg hover:shadow-xl active:scale-95'
                      }`}
                  >
                    {resetLoading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                        <span>Resetting...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                        </svg>
                        <span>Manual Reset All Drivers</span>
                      </>
                    )}
                  </button>
                  <p className="text-xs text-gray-500 mt-2">
                    ⚠️ This will reset availability for ALL drivers (enabled & disabled) to unavailable
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Availability Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2 sm:gap-3 mb-4 sm:mb-6">
            {daysOfWeek.map((day, index) => {
              const isCurrentDay = index === currentDayIndex;
              const count = availabilityCounts[day] || 0;

              return (
                <div
                  key={day}
                  className={`bg-white rounded-lg shadow-sm border-2 p-3 sm:p-4 transition-all ${isCurrentDay
                    ? 'border-blue-500 bg-blue-50'
                    : filterDay === day
                      ? 'border-green-500 bg-green-50'
                      : 'border-gray-200'
                    }`}
                >
                  <div className="text-center">
                    <div className={`text-xs font-semibold mb-1 ${isCurrentDay ? 'text-blue-700' : 'text-gray-600'}`}>
                      {daysShort[day]}
                      {isCurrentDay && (
                        <span className="block text-[10px] text-blue-600">Today</span>
                      )}
                    </div>
                    <div className={`text-2xl font-bold ${count > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                      {count}
                    </div>
                    <div className="text-[10px] text-gray-500 mt-1">available</div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Admin Info Banner */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
            <div className="flex items-start gap-3">
              <svg className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <h3 className="text-sm font-semibold text-blue-900 mb-1">Admin Permissions & Filters</h3>
                <ul className="text-xs text-blue-800 space-y-1">
                  <li>• ✅ <strong>You can edit availability for TODAY and all future days</strong></li>
                  <li>• ❌ Past days (before today) cannot be edited</li>
                  <li>• 🔄 Availability resets every Sunday at 12:00 PM in each driver's timezone</li>

                  {/* Show filter status */}
                  {filterAvailabilityStatus && (
                    <li className="mt-2 pt-2 border-t border-blue-300">
                      • 🔍 <strong>Active Filter:</strong> Showing <strong className={filterAvailabilityStatus === 'available' ? 'text-green-700' : 'text-red-700'}>
                        {filterAvailabilityStatus === 'available' ? 'AVAILABLE' : 'UNAVAILABLE'}
                      </strong> drivers
                      {filterDay ? (
                        <> for <strong>{filterDay.charAt(0).toUpperCase() + filterDay.slice(1)}</strong> ({filterAvailabilityStatus === 'available' ? selectedDayCounts.available : selectedDayCounts.unavailable} drivers)</>
                      ) : (
                        <> {filterAvailabilityStatus === 'available' ? '(have at least one day available)' : '(not available any day)'} ({filterAvailabilityStatus === 'available' ? selectedDayCounts.available : selectedDayCounts.unavailable} drivers)</>
                      )}
                    </li>
                  )}
                </ul>
              </div>
            </div>
          </div>

          {/* Drivers Table */}
          {loading ? (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8 sm:p-12 flex flex-col items-center justify-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-600 border-t-transparent mb-4"></div>
              <p className="text-gray-600 text-sm">Loading drivers...</p>
            </div>
          ) : filteredDrivers.length === 0 ? (
            <div className="bg-white rounded-xl shadow-md border border-gray-200 p-8 sm:p-12 text-center">
              <svg className="w-16 h-16 mx-auto text-gray-400 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
              </svg>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">No Drivers Found</h3>
              <p className="text-sm text-gray-600 mb-4">
                {hasActiveFilters
                  ? "No drivers match your current filters. Try adjusting or clearing your filters."
                  : "No drivers available in the system."
                }
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
            <>
              {/* Desktop Table */}
              <div className="hidden lg:block bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead className="bg-gradient-to-r from-blue-50 to-blue-100 border-b border-gray-200">
                      <tr>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Driver Info
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          City
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Status
                        </th>
                        <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider" colSpan={7}>
                          Weekly Availability
                        </th>
                        <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                          Actions
                        </th>
                      </tr>
                      <tr className="bg-gray-50 border-t border-gray-200">
                        <th colSpan={3}></th>
                        {daysOfWeek.map((day, index) => {
                          const isCurrentDay = index === currentDayIndex;
                          return (
                            <th
                              key={day}
                              className={`px-2 py-2 text-center text-xs font-semibold ${isCurrentDay ? 'text-blue-700 bg-blue-50' : 'text-gray-600'
                                }`}
                            >
                              {daysShort[day]}
                              {isCurrentDay && <div className="text-[10px] text-blue-600">Today</div>}
                            </th>
                          );
                        })}
                        <th></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {filteredDrivers.map((driver, driverIndex) => {
                        const isEditing = editingDriverId === driver.id;
                        const displayAvailability = isEditing ? editAvailability : driver.availability;
                        const availableDaysCount = getAvailableDays(displayAvailability);

                        return (
                          <tr
                            key={driver.id}
                            className={`hover:bg-gray-50 transition-colors ${driverIndex % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'
                              } ${isEditing ? 'ring-2 ring-blue-500' : ''}`}
                          >
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="flex items-center gap-3">
                                <div className="flex-shrink-0 h-10 w-10 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold">
                                  {driver.name.charAt(0).toUpperCase()}
                                </div>
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{driver.name}</div>
                                  <div className="text-xs text-gray-500">#{driver.driver_code}</div>
                                </div>
                              </div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <div className="text-sm text-gray-900">{driver.city}</div>
                            </td>
                            <td className="px-6 py-4 whitespace-nowrap">
                              <span
                                className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${driver.enabled
                                  ? 'bg-green-100 text-green-800'
                                  : 'bg-gray-100 text-gray-800'
                                  }`}
                              >
                                {driver.enabled ? '✓ Enabled' : '○ Disabled'}
                              </span>
                            </td>

                            {/* Day toggles */}
                            {daysOfWeek.map((day, dayIdx) => {
                              const isAvailable = displayAvailability[day];
                              const isLocked = isDayLocked(day);
                              const isDayToday = dayIdx === currentDayIndex;

                              return (
                                <td key={day} className={`px-2 py-4 text-center ${isDayToday ? 'bg-blue-50' : ''}`}>
                                  <button
                                    onClick={() => isEditing && toggleDay(day)}
                                    disabled={!isEditing || isLocked}
                                    className={`w-10 h-10 rounded-full flex items-center justify-center font-bold transition-all ${isAvailable
                                      ? 'bg-green-500 text-white hover:bg-green-600'
                                      : 'bg-gray-200 text-gray-500 hover:bg-gray-300'
                                      } ${!isEditing || isLocked
                                        ? 'cursor-not-allowed opacity-50'
                                        : 'cursor-pointer hover:scale-110 active:scale-95'
                                      }`}
                                    title={
                                      isLocked
                                        ? `Cannot edit ${day} - day has already passed`
                                        : isAvailable
                                          ? 'Available'
                                          : 'Unavailable'
                                    }
                                  >
                                    {isAvailable ? '✓' : '✕'}
                                  </button>
                                </td>
                              );
                            })}

                            <td className="px-6 py-4 whitespace-nowrap text-center">
                              {isEditing ? (
                                <div className="flex items-center justify-center gap-2">
                                  <button
                                    onClick={() => saveAvailability(driver.id)}
                                    disabled={isSaving}
                                    className="px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    {isSaving ? (
                                      <>
                                        <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent"></div>
                                        <span>Saving...</span>
                                      </>
                                    ) : (
                                      <>
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                        </svg>
                                        <span>Save</span>
                                      </>
                                    )}
                                  </button>
                                  <button
                                    onClick={cancelEdit}
                                    disabled={isSaving}
                                    className="px-3 py-1.5 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              ) : (
                                <button
                                  onClick={() => startEdit(driver)}
                                  className="px-3 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center gap-1 mx-auto"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                  </svg>
                                  <span>Edit</span>
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Mobile Cards */}
              <div className="lg:hidden space-y-4">
                {filteredDrivers.map((driver) => {
                  const isEditing = editingDriverId === driver.id;
                  const displayAvailability = isEditing ? editAvailability : driver.availability;
                  const availableDaysCount = getAvailableDays(displayAvailability);

                  return (
                    <div
                      key={driver.id}
                      className={`bg-white rounded-xl shadow-md border-2 p-4 transition-all ${isEditing ? 'border-blue-500 ring-2 ring-blue-200' : 'border-gray-200'
                        }`}
                    >
                      {/* Driver Header */}
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="flex-shrink-0 h-12 w-12 rounded-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white font-bold text-lg">
                            {driver.name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-sm font-semibold text-gray-900">{driver.name}</div>
                            <div className="text-xs text-gray-500">#{driver.driver_code}</div>
                            <div className="text-xs text-gray-600 mt-1">{driver.city}</div>
                          </div>
                        </div>
                        <span
                          className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${driver.enabled
                            ? 'bg-green-100 text-green-800'
                            : 'bg-gray-100 text-gray-800'
                            }`}
                        >
                          {driver.enabled ? '✓ Enabled' : '○ Disabled'}
                        </span>
                      </div>

                      {/* Availability Grid */}
                      <div className="grid grid-cols-7 gap-2 mb-4">
                        {daysOfWeek.map((day, dayIdx) => {
                          const isAvailable = displayAvailability[day];
                          const isLocked = isDayLocked(day);
                          const isDayToday = dayIdx === currentDayIndex;

                          return (
                            <div key={day} className="text-center">
                              <div className={`text-[10px] font-semibold mb-1 ${isDayToday ? 'text-blue-700' : 'text-gray-600'}`}>
                                {daysShort[day]}
                              </div>
                              <button
                                onClick={() => isEditing && toggleDay(day)}
                                disabled={!isEditing || isLocked}
                                className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all ${isAvailable
                                  ? 'bg-green-500 text-white'
                                  : 'bg-gray-200 text-gray-500'
                                  } ${!isEditing || isLocked
                                    ? 'cursor-not-allowed opacity-50'
                                    : 'cursor-pointer hover:scale-110 active:scale-95'
                                  } ${isDayToday ? 'ring-2 ring-blue-400' : ''}`}
                                title={
                                  isLocked
                                    ? `Cannot edit ${day} - day has already passed`
                                    : isAvailable
                                      ? 'Available'
                                      : 'Unavailable'
                                }
                              >
                                {isAvailable ? '✓' : '✕'}
                              </button>
                            </div>
                          );
                        })}
                      </div>

                      {/* Action Buttons */}
                      {isEditing ? (
                        <div className="flex gap-2">
                          <button
                            onClick={() => saveAvailability(driver.id)}
                            disabled={isSaving}
                            className="flex-1 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSaving ? (
                              <>
                                <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent"></div>
                                <span>Saving...</span>
                              </>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                                <span>Save Changes</span>
                              </>
                            )}
                          </button>
                          <button
                            onClick={cancelEdit}
                            disabled={isSaving}
                            className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => startEdit(driver)}
                          className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium flex items-center justify-center gap-2"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          <span>Edit Availability</span>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="bg-white rounded-xl shadow-md border border-gray-200 p-4 mt-6">
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-sm text-gray-700">
                      Showing <span className="font-semibold">{((currentPage - 1) * itemsPerPage) + 1}</span> to{' '}
                      <span className="font-semibold">
                        {Math.min(currentPage * itemsPerPage, totalRecords)}
                      </span>{' '}
                      of <span className="font-semibold">{totalRecords}</span> drivers
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={goToFirstPage}
                        disabled={!hasPreviousPage}
                        className="px-3 py-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                      >
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                        </svg>
                      </button>

                      <button
                        onClick={goToPreviousPage}
                        disabled={!hasPreviousPage}
                        className="px-3 py-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                      >
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                        </svg>
                      </button>

                      <div className="flex items-center gap-1">
                        {getPageNumbers().map((pageNum, idx) => (
                          pageNum === '...' ? (
                            <span key={`ellipsis-${idx}`} className="px-3 py-2 text-gray-500">...</span>
                          ) : (
                            <button
                              key={pageNum}
                              onClick={() => goToPage(pageNum)}
                              className={`px-4 py-2 rounded-lg font-medium transition-all ${currentPage === pageNum
                                ? 'bg-blue-600 text-white shadow-lg'
                                : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
                                }`}
                            >
                              {pageNum}
                            </button>
                          )
                        ))}
                      </div>

                      <button
                        onClick={goToNextPage}
                        disabled={!hasNextPage}
                        className="px-3 py-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                      >
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                      </button>

                      <button
                        onClick={goToLastPage}
                        disabled={!hasNextPage}
                        className="px-3 py-2 rounded-lg border border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
                      >
                        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                        </svg>
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="h-24" />
      <Nav />
    </>
  );
}