import React, { useEffect, useState } from "react";
import { useSelector } from "react-redux";

const UploadedData = ({ viewType, loadData, selectedDate }) => {
  const { data, loading, error, pagination } = useSelector((state) => state.ds);
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    // Only load if we have a valid selected date
    if (selectedDate && selectedDate !== 'undefined' && selectedDate !== 'null') {
      loadData(selectedDate, currentPage, itemsPerPage);
    }
  }, [selectedDate, currentPage, itemsPerPage]);

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
    const delta = 2;
    const pages = [];

    pages.push(1);

    const rangeStart = Math.max(2, current - delta);
    const rangeEnd = Math.min(totalPages - 1, current + delta);

    if (rangeStart > 2) {
      pages.push('...');
    }

    for (let i = rangeStart; i <= rangeEnd; i++) {
      pages.push(i);
    }

    if (rangeEnd < totalPages - 1) {
      pages.push('...');
    }

    if (totalPages > 1) {
      pages.push(totalPages);
    }

    return pages;
  };

  return (
    <section className="bg-white rounded-xl shadow p-4">
      <style>{`
        .custom-select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%236B7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E");
          background-position: right 0.5rem center;
          background-repeat: no-repeat;
          background-size: 1.5em 1.5em;
          padding-right: 2.5rem;
        }
      `}</style>

      <div className="flex justify-between items-center mb-4">
        <h2 className="font-bold text-lg">Dashboard Data</h2>
        <button
          onClick={() => loadData(selectedDate, currentPage, itemsPerPage)}
          className="px-3 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-2"
          disabled={loading}
        >
          <svg
            className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`}
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

      {loading && (
        <div className="flex flex-col items-center justify-center py-16">
          <div className="relative w-16 h-16">
            <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <span className="text-gray-600 font-medium text-lg mt-3">Loading...</span>
        </div>
      )}

      {error && <p className="text-red-500 bg-red-50 p-3 rounded">{error}</p>}

      {!loading && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gray-50 text-left border-b-2 border-gray-200">
                  {[
                    "SlNo",
                    "Driver",
                    "Date",
                    "Route",
                    "Sequence",
                    "Packages",
                    "Deliveries",
                    "DS",
                    "No Scanned",
                    "Failed Attempt",
                  ].map((head, i) => (
                    <th key={i} className="px-3 py-2 font-semibold text-gray-700 whitespace-nowrap">
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data?.dailyData?.length > 0 ? (
                  data.dailyData.map((item, idx) => (
                    <tr key={idx} className="border-b hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-2 whitespace-nowrap">
                        {(currentPage - 1) * itemsPerPage + idx + 1}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.name}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {new Date(item.journey_date + 'T00:00:00').toLocaleDateString('en-CA')}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.route}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.sequence}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.packages}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.delivered}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.ds}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.no_scanned}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{item.failed_attempt}</td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="10" className="text-center py-12">
                      <div className="flex flex-col items-center gap-3">
                        <svg className="w-16 h-16 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <p className="text-gray-500 text-lg font-medium">No data found</p>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {data?.dailyData?.length > 0 && pagination.totalPages > 0 && (
            <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-t-2 border-gray-200 mt-4">
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
                      {Math.min(currentPage * itemsPerPage, pagination.totalItems)}
                    </span> of{' '}
                    <span className="font-bold text-blue-600">{pagination.totalItems}</span> entries
                  </div>
                </div>

                {/* Bottom Row: Page navigation */}
                <div className="flex flex-wrap justify-center items-center gap-1">
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
        </>
      )}
    </section>
  );
};

export default UploadedData;