import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getAllDriversAvailability,
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

  const [filterDay, setFilterDay] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  const daysOfWeek = [
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sunday"
  ];

  // Fetch data on mount and when page/filter changes
  useEffect(() => {
    dispatch(getAllDriversAvailability({
      filterDay: filterDay || null,
      page: currentPage,
      limit: itemsPerPage
    }));
  }, [dispatch, currentPage, filterDay, itemsPerPage]);

  useEffect(() => {
    if (error) {
      toast.error(error);
      dispatch(clearMessages());
    }
  }, [error, dispatch]);

  const handleFilterChange = (day) => {
    setFilterDay(day);
    setCurrentPage(1); // Reset to first page when filter changes
  };

  // Client-side search filtering
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

  // Pagination info
  const totalPages = pagination?.totalPages || 0;
  const totalRecords = pagination?.totalRecords || 0;
  const hasNextPage = pagination?.hasNextPage || false;
  const hasPreviousPage = pagination?.hasPreviousPage || false;

  // Pagination handlers
  const goToPage = (page) => {
    setCurrentPage(Math.min(Math.max(1, page), totalPages));
  };

  const goToFirstPage = () => setCurrentPage(1);
  const goToLastPage = () => setCurrentPage(totalPages);
  const goToPreviousPage = () => setCurrentPage(prev => Math.max(1, prev - 1));
  const goToNextPage = () => setCurrentPage(prev => Math.min(totalPages, prev + 1));

  // Generate page numbers
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

  return (
    <>
      <Header />

      {/* Increased padding bottom to pb-44 (176px) to clear the Nav */}
      <div className="min-h-screen bg-gray-50 p-4 sm:p-6 pb-64">
        <div className="max-w-full mx-auto">
          {/* Page Header */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <h1 className="text-2xl font-bold text-gray-900">
                  Driver Availability Management
                </h1>
                <p className="text-sm text-gray-600 mt-1">
                  View and manage weekly availability for all drivers
                </p>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="text-right">
                  <div className="text-2xl font-bold text-blue-600">
                    {totalRecords}
                  </div>
                  <div className="text-xs text-gray-600">Total Drivers</div>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-6">
            <div className="flex flex-col sm:flex-row gap-3">
              <div className="flex-1">
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                    <svg className="w-5 h-5 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="text"
                    placeholder="Search by name, email, or driver code..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="sm:w-64">
                <select
                  value={filterDay}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white"
                >
                  <option value="">All Days</option>
                  {daysOfWeek.map((day) => (
                    <option key={day} value={day}>
                      {day.charAt(0).toUpperCase() + day.slice(1)} - {availabilityCounts[day]} available
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            {loading && !allDriversAvailability.length && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
                <p className="mt-4 text-sm text-gray-600">Loading drivers...</p>
              </div>
            )}

            {!loading && filteredDrivers.length === 0 && (
              <div className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
                  <svg className="w-8 h-8 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4" />
                  </svg>
                </div>
                <p className="text-gray-600 font-medium">No drivers found</p>
                <p className="text-sm text-gray-500 mt-1">Try adjusting your search or filter</p>
              </div>
            )}

            {!loading && filteredDrivers.length > 0 && (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full">
                    <thead>
                      <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider w-64">
                          Driver Information
                        </th>
                        <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                          City
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Mon
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Tue
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Wed
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Thu
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Fri
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Sat
                        </th>
                        <th className="px-4 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Sun
                        </th>
                        <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                          Status
                        </th>
                      </tr>
                    </thead>

                    <tbody className="divide-y divide-gray-200">
                      {filteredDrivers.map((driver, index) => (
                        <tr
                          key={driver.id}
                          className={`hover:bg-blue-50 transition-colors ${
                            index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
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
                            <td
                              key={day}
                              className="px-4 py-4 whitespace-nowrap text-center"
                            >
                              {driver.availability?.[day] ? (
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Table Footer with Pagination */}
                <div className="px-6 py-24 bg-gray-50 border-t border-gray-200">
                  <div className="flex flex-col gap-4">
                    {/* Info and Legend */}
                    <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
                      <div className="text-sm text-gray-600">
                        Showing <span className="font-semibold text-gray-900">{filteredDrivers.length}</span> of{' '}
                        <span className="font-semibold text-gray-900">{totalRecords}</span> drivers
                      </div>

                      <div className="flex items-center gap-6">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 bg-green-100 rounded flex items-center justify-center">
                            <svg className="w-3 h-3 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          </div>
                          <span className="text-sm text-gray-600">Available</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 bg-red-100 rounded flex items-center justify-center">
                            <svg className="w-3 h-3 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </div>
                          <span className="text-sm text-gray-600">Unavailable</span>
                        </div>
                      </div>
                    </div>

                    {/* Pagination Controls */}
                    {totalPages > 1 && (
                      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 border-t pt-4">
                        <div className="flex items-center gap-2 flex-wrap justify-center">
                          <button
                            onClick={goToFirstPage}
                            disabled={!hasPreviousPage || loading}
                            className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="First Page"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
                            </svg>
                          </button>
                          
                          <button
                            onClick={goToPreviousPage}
                            disabled={!hasPreviousPage || loading}
                            className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Previous Page"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                          </button>

                          <div className="flex items-center gap-1">
                            {getPageNumbers().map((page, idx) => (
                              page === '...' ? (
                                <span key={`ellipsis-${idx}`} className="px-2 py-1">...</span>
                              ) : (
                                <button
                                  key={page}
                                  onClick={() => goToPage(page)}
                                  disabled={loading}
                                  className={`px-3 py-1 border rounded transition-colors disabled:opacity-50 ${
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

                          <button
                            onClick={goToNextPage}
                            disabled={!hasNextPage || loading}
                            className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Next Page"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>

                          <button
                            onClick={goToLastPage}
                            disabled={!hasNextPage || loading}
                            className="px-3 py-1 border rounded hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                            title="Last Page"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                            </svg>
                          </button>
                        </div>

                        <div className="text-sm text-gray-600">
                          Page {currentPage} of {totalPages}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
{/* Spacer to prevent content hiding behind fixed bottom Nav */}
<div className="h-28" />

      <Nav />
    </>
  );
}