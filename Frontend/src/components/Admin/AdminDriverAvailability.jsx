import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getAllDriversAvailability,
  updateDriverAvailabilityByAdmin,
  clearMessages
} from "../../redux/slice/driver/availabilitySlice.js";
import { toast } from "react-toastify";

import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";

export default function AdminDriverAvailability() {
  const dispatch = useDispatch();

  const { allDriversAvailability, pagination, loading, error } = useSelector(
    (state) => state.availability
  );
  const { admin } = useSelector((state) => state.admin);

  const [filterDay, setFilterDay] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);
  const [editingDriverId, setEditingDriverId] = useState(null);
  const [editAvailability, setEditAvailability] = useState({});
  const [isSaving, setIsSaving] = useState(false);

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

  useEffect(() => {
    dispatch(getAllDriversAvailability({
      filterDay: filterDay || null,
      page: currentPage,
      limit: itemsPerPage,
      searchQuery: searchQuery || null
    }));
  }, [dispatch, currentPage, filterDay, itemsPerPage, searchQuery]);

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

  const filteredDrivers = allDriversAvailability.filter(
    (driver) =>
      driver.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      driver.driver_code.toString().includes(searchQuery)
  );

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
    const maxVisible = 5;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      if (currentPage <= 3) {
        for (let i = 1; i <= 4; i++) pages.push(i);
        pages.push('...');
        pages.push(totalPages);
      } else if (currentPage >= totalPages - 2) {
        pages.push(1);
        pages.push('...');
        for (let i = totalPages - 3; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        pages.push('...');
        pages.push(currentPage - 1);
        pages.push(currentPage);
        pages.push(currentPage + 1);
        pages.push('...');
        pages.push(totalPages);
      }
    }
    
    return pages;
  };

  const getAvailableDays = (availability) => {
    return Object.values(availability).filter(Boolean).length;
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
        toast.error("Failed to update availability");
      }
    } catch (err) {
      toast.error("An error occurred while updating");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <Header />

      <div className="min-h-screen bg-gray-50 p-3 sm:p-4 md:p-6 pb-32">
        <div className="max-w-full mx-auto">
          {/* Page Header */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-4">
              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                  Driver Availability
                </h1>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                  View and manage weekly availability for all drivers
                </p>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-center sm:text-right">
                  <div className="text-xl sm:text-2xl font-bold text-blue-600">
                    {totalRecords}
                  </div>
                  <div className="text-xs text-gray-600">Total Drivers</div>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-3 sm:p-4 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-4 h-4 sm:w-5 sm:h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Search by name, email, or code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 sm:pl-10 pr-4 py-2 sm:py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="sm:w-64">
                <select
                  value={filterDay}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  className="w-full px-3 sm:px-4 py-2 sm:py-2.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">All Days</option>
                  {daysOfWeek.map((day) => (
                    <option key={day} value={day}>
                      {day.charAt(0).toUpperCase() + day.slice(1)} ({availabilityCounts[day]})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Loading State */}
          {loading && !allDriversAvailability.length && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 sm:p-16">
              <div className="flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-4 border-blue-500 border-t-transparent"></div>
                <p className="mt-4 text-sm text-gray-600">Loading drivers...</p>
              </div>
            </div>
          )}

          {/* Empty State */}
          {!loading && filteredDrivers.length === 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-12 sm:p-16">
              <div className="flex flex-col items-center justify-center">
                <div className="w-14 h-14 sm:w-16 sm:h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-7 h-7 sm:w-8 sm:h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <p className="text-gray-600 font-medium text-sm sm:text-base">No drivers found</p>
                <p className="text-xs sm:text-sm text-gray-500 mt-1">Try adjusting your search or filter</p>
              </div>
            </div>
          )}

          {/* Desktop Table View */}
          {!loading && filteredDrivers.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
              <div className="hidden md:block overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider w-64">
                        Driver Information
                      </th>
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                        City
                      </th>
                      {daysOfWeek.map((day) => (
                        <th key={day} className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          {daysShort[day]}
                        </th>
                      ))}
                      <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Action
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-200">
                    {filteredDrivers.map((driver, index) => (
                      <tr
                        key={driver.id}
                        className={`transition-colors ${
                          editingDriverId === driver.id
                            ? 'bg-blue-50 ring-2 ring-blue-300 ring-inset'
                            : index % 2 === 0
                            ? 'bg-white hover:bg-blue-50'
                            : 'bg-gray-50 hover:bg-blue-50'
                        }`}
                      >
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className="flex-shrink-0 h-10 w-10 bg-blue-100 rounded-full flex items-center justify-center">
                              <span className="text-blue-700 font-semibold text-sm">
                                {driver.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                              </span>
                            </div>
                            <div className="ml-4">
                              <div className="text-sm font-semibold text-gray-900">
                                {driver.name}
                              </div>
                              <div className="text-sm text-gray-500">
                                {driver.email}
                              </div>
                              <div className="text-xs text-gray-400">
                                Code: {driver.driver_code}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className="inline-flex px-2.5 py-1 text-xs font-medium bg-gray-100 text-gray-700 rounded-md">
                            {driver.city}
                          </span>
                        </td>

                        {daysOfWeek.map((day) => (
                          <td key={day} className="px-4 py-4 whitespace-nowrap text-center">
                            {editingDriverId === driver.id ? (
                              <label className="inline-flex items-center justify-center cursor-pointer group">
                                <input
                                  type="checkbox"
                                  checked={editAvailability[day]}
                                  onChange={() => toggleDay(day)}
                                  className="sr-only peer"
                                />
                                <div className={`w-10 h-10 rounded-lg border-2 transition-all duration-200 flex items-center justify-center ${
                                  editAvailability[day]
                                    ? 'bg-green-100 border-green-500 hover:bg-green-200'
                                    : 'bg-red-100 border-red-500 hover:bg-red-200'
                                }`}>
                                  {editAvailability[day] ? (
                                    <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  )}
                                </div>
                              </label>
                            ) : driver.availability?.[day] ? (
                              <span className="inline-flex items-center justify-center w-8 h-8 bg-green-100 rounded-md">
                                <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-8 h-8 bg-red-100 rounded-md">
                                <svg className="w-5 h-5 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                              </span>
                            )}
                          </td>
                        ))}

                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          <span
                            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold ${
                              driver.enabled
                                ? "bg-green-100 text-green-700"
                                : "bg-gray-100 text-gray-600"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                              driver.enabled ? "bg-green-500" : "bg-gray-400"
                            }`}></span>
                            {driver.enabled ? "Active" : "Inactive"}
                          </span>
                        </td>

                        <td className="px-6 py-4 whitespace-nowrap text-center">
                          {admin?.role === "superadmin" && (
                            editingDriverId === driver.id ? (
                              <div className="flex gap-2 justify-center">
                                <button
                                  onClick={() => saveAvailability(driver.id)}
                                  disabled={isSaving}
                                  className="group relative px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-green-700 transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Save changes"
                                >
                                  {isSaving ? (
                                    <>
                                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
                                        <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
                                      </svg>
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
                                  className="group relative px-4 py-2 bg-gradient-to-r from-gray-400 to-gray-500 text-white text-sm font-medium rounded-lg hover:from-gray-500 hover:to-gray-600 transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                                  title="Cancel editing"
                                >
                                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                  <span>Cancel</span>
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEdit(driver)}
                                className="group relative px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all duration-200 shadow-sm hover:shadow-md flex items-center gap-2 mx-auto"
                                title="Edit availability"
                              >
                                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                </svg>
                                <span>Edit</span>
                              </button>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden p-3 space-y-3">
                {filteredDrivers.map((driver) => (
                  <div
                    key={driver.id}
                    className={`rounded-lg border p-4 space-y-3 transition-all ${
                      editingDriverId === driver.id
                        ? 'bg-blue-50 border-blue-300 ring-2 ring-blue-200'
                        : 'bg-gray-50 border-gray-200'
                    }`}
                  >
                    {/* Driver Info */}
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-3 flex-1 min-w-0">
                        <div className="flex-shrink-0 h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
                          <span className="text-blue-700 font-semibold text-sm">
                            {driver.name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase()}
                          </span>
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-gray-900 truncate">
                            {driver.name}
                          </div>
                          <div className="text-xs text-gray-500 truncate">
                            {driver.email}
                          </div>
                          <div className="text-xs text-gray-400 mt-0.5">
                            Code: {driver.driver_code}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`flex-shrink-0 inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${
                          driver.enabled
                            ? "bg-green-100 text-green-700"
                            : "bg-gray-100 text-gray-600"
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full mr-1 ${
                          driver.enabled ? "bg-green-500" : "bg-gray-400"
                        }`}></span>
                        {driver.enabled ? "Active" : "Inactive"}
                      </span>
                    </div>

                    {/* City */}
                    <div className="flex items-center gap-2">
                      <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                      <span className="text-xs font-medium text-gray-700">{driver.city}</span>
                    </div>

                    {/* Availability Grid */}
                    <div>
                      <div className="text-xs font-semibold text-gray-700 mb-2 flex items-center justify-between">
                        <span>Weekly Availability</span>
                        <span className="text-blue-600">
                          {editingDriverId === driver.id 
                            ? `${getAvailableDays(editAvailability)}/7 days`
                            : `${getAvailableDays(driver.availability)}/7 days`
                          }
                        </span>
                      </div>
                      <div className="grid grid-cols-7 gap-1.5">
                        {daysOfWeek.map((day) => (
                          <div key={day} className="flex flex-col items-center gap-1">
                            {editingDriverId === driver.id ? (
                              <label className="cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={editAvailability[day]}
                                  onChange={() => toggleDay(day)}
                                  className="sr-only peer"
                                />
                                <div className={`w-full aspect-square rounded-md border-2 flex items-center justify-center transition-all ${
                                  editAvailability[day]
                                    ? 'bg-green-100 border-green-500'
                                    : 'bg-red-100 border-red-500'
                                }`}>
                                  {editAvailability[day] ? (
                                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                    </svg>
                                  ) : (
                                    <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                    </svg>
                                  )}
                                </div>
                              </label>
                            ) : (
                              <div className={`w-full aspect-square rounded-md flex items-center justify-center ${
                                driver.availability?.[day]
                                  ? 'bg-green-100'
                                  : 'bg-red-100'
                              }`}>
                                {driver.availability?.[day] ? (
                                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                  </svg>
                                ) : (
                                  <svg className="w-4 h-4 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                )}
                              </div>
                            )}
                            <span className="text-[9px] font-medium text-gray-600">
                              {daysShort[day]}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Mobile Action Buttons */}
                    {admin?.role === "superadmin" && (
                      <div className="pt-2 border-t border-gray-200">
                        {editingDriverId === driver.id ? (
                          <div className="flex gap-2">
                            <button
                              onClick={() => saveAvailability(driver.id)}
                              disabled={isSaving}
                              className="flex-1 px-4 py-2 bg-gradient-to-r from-green-500 to-green-600 text-white text-sm font-medium rounded-lg hover:from-green-600 hover:to-green-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
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
                              className="flex-1 px-4 py-2 bg-gradient-to-r from-gray-400 to-gray-500 text-white text-sm font-medium rounded-lg hover:from-gray-500 hover:to-gray-600 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
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
                            className="w-full px-4 py-2 bg-gradient-to-r from-blue-500 to-blue-600 text-white text-sm font-medium rounded-lg hover:from-blue-600 hover:to-blue-700 transition-all shadow-sm flex items-center justify-center gap-2"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                            </svg>
                            Edit Availability
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Table Footer with Pagination */}
              <div className="px-4 sm:px-6 py-4 sm:py-6 bg-gray-50 border-t border-gray-200">
                <div className="flex flex-col gap-4">
                  {/* Info and Legend */}
                  <div className="flex flex-col sm:flex-row items-center justify-between gap-3 sm:gap-4">
                    <div className="text-xs sm:text-sm text-gray-600">
                      Showing <span className="font-semibold text-gray-900">{filteredDrivers.length}</span> of{' '}
                      <span className="font-semibold text-gray-900">{totalRecords}</span> drivers
                    </div>

                    <div className="flex items-center gap-4 sm:gap-6">
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 bg-green-100 rounded flex items-center justify-center">
                          <svg className="w-2 h-2 sm:w-3 sm:h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                          </svg>
                        </div>
                        <span className="text-xs sm:text-sm text-gray-600">Available</span>
                      </div>
                      <div className="flex items-center gap-1.5 sm:gap-2">
                        <div className="w-3 h-3 sm:w-4 sm:h-4 bg-red-100 rounded flex items-center justify-center">
                          <svg className="w-2 h-2 sm:w-3 sm:h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </div>
                        <span className="text-xs sm:text-sm text-gray-600">Unavailable</span>
                      </div>
                    </div>
                  </div>

                  {/* Pagination Controls */}
                  {totalPages > 1 && (
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t pt-4">
                      <div className="flex items-center gap-1 sm:gap-2 flex-wrap justify-center">
                        <button
                          onClick={goToFirstPage}
                          disabled={!hasPreviousPage || loading}
                          className="p-1.5 sm:p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title="First Page"
                        >
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                          </svg>
                        </button>
                        
                        <button
                          onClick={goToPreviousPage}
                          disabled={!hasPreviousPage || loading}
                          className="p-1.5 sm:p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title="Previous"
                        >
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                          </svg>
                        </button>

                        <div className="hidden xs:flex items-center gap-1">
                          {getPageNumbers().map((page, idx) => (
                            page === '...' ? (
                              <span key={`ellipsis-${idx}`} className="px-2 py-1 text-xs sm:text-sm">...</span>
                            ) : (
                              <button
                                key={page}
                                onClick={() => goToPage(page)}
                                disabled={loading}
                                className={`px-2 sm:px-3 py-1 text-xs sm:text-sm border rounded transition-colors disabled:opacity-50 ${
                                  currentPage === page
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'hover:bg-gray-100'
                                }`}
                              >
                                {page}
                              </button>
                            )
                          ))}
                        </div>

                        <div className="xs:hidden text-xs text-gray-600 px-2">
                          Page {currentPage} of {totalPages}
                        </div>

                        <button
                          onClick={goToNextPage}
                          disabled={!hasNextPage || loading}
                          className="p-1.5 sm:p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title="Next"
                        >
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                          </svg>
                        </button>

                        <button
                          onClick={goToLastPage}
                          disabled={!hasNextPage || loading}
                          className="p-1.5 sm:p-2 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                          title="Last Page"
                        >
                          <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                          </svg>
                        </button>
                      </div>

                      <div className="hidden xs:block text-xs sm:text-sm text-gray-600">
                        Page {currentPage} of {totalPages}
                      </div>
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