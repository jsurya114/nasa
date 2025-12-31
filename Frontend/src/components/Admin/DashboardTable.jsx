import { useEffect, useMemo, useState, useCallback } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchFilteredPaymentData } from "../../redux/slice/admin/dashSlice";

export default function PaymentDashboardTable() {
  const dispatch = useDispatch();
  
  const { filteredPaymentData, paymentLoading, paymentError, isFiltered, pagination, filters } = useSelector(
    (state) => state.dash
  );

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);

  useEffect(() => {
    if (pagination && pagination.page) {
      setCurrentPage(pagination.page);
    }
  }, [pagination]);

  const getTodayDate = () => {
    const today = new Date();
    return today.toISOString().split('T')[0];
  };

  const shouldShowTotals = useMemo(() => {
    // Only show totals if a specific driver is filtered (not "All")
    const hasDriverFilter = filters.driver && filters.driver !== "All";
    return hasDriverFilter && 
           filteredPaymentData.length > 0 && 
           filteredPaymentData.every(row => row.driver_name === filteredPaymentData[0].driver_name);
  }, [filteredPaymentData, filters.driver]);

  const totals = useMemo(() => {
    if (!shouldShowTotals) return null;

    return filteredPaymentData.reduce((acc, row) => {
      return {
        packages: acc.packages + (Number(row.packages) || 0),
        noScanned: acc.noScanned + (Number(row.no_scanned) || 0),
        failedAttempt: acc.failedAttempt + (Number(row.failed_attempt) || 0),
        fs: acc.fs + (Number(row.fs) || 0),
        ds: acc.ds + (Number(row.ds) || 0),
        delivered: acc.delivered + (Number(row.delivered) || 0),
        driverPayment: acc.driverPayment + (Number(row.driver_payment) || 0),
      };
    }, {
      packages: 0,
      noScanned: 0,
      failedAttempt: 0,
      fs: 0,
      ds: 0,
      delivered: 0,
      driverPayment: 0,
    });
  }, [filteredPaymentData, shouldShowTotals]);

  const handleRefresh = () => {
    const today = getTodayDate();
    dispatch(fetchFilteredPaymentData({
      ...filters,
      startDate: today,
      endDate: today,
      page: currentPage,
      limit: itemsPerPage
    }));
  };

  const handlePageChange = useCallback((newPage) => {
    if (newPage >= 1 && newPage <= pagination.totalPages) {
      setCurrentPage(newPage);
      dispatch(fetchFilteredPaymentData({
        ...filters,
        page: newPage,
        limit: itemsPerPage
      }));
    }
  }, [dispatch, filters, itemsPerPage, pagination.totalPages]);

  const handleItemsPerPageChange = useCallback((e) => {
    const newLimit = parseInt(e.target.value);
    setItemsPerPage(newLimit);
    setCurrentPage(1);
    dispatch(fetchFilteredPaymentData({
      ...filters,
      page: 1,
      limit: newLimit
    }));
  }, [dispatch, filters]);

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

  const displayData = filteredPaymentData;
  const isLoading = paymentLoading;
  const displayError = paymentError;

  return (
    <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
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

      <div className="flex items-center justify-between font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3">
        <span>Driver Jobs</span>
        <button
          onClick={handleRefresh}
          className="px-3 py-1 text-sm bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50"
          disabled={isLoading}
        >
          🔄 Refresh
        </button>
      </div>

      {isLoading && (
        <div className="p-8 flex flex-col items-center justify-center">
          <div className="relative w-16 h-16">
            <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-100 rounded-full"></div>
            <div className="absolute top-0 left-0 w-full h-full border-4 border-blue-500 rounded-full border-t-transparent animate-spin"></div>
          </div>
          <p className="mt-4 text-gray-600 font-medium">Loading payment data...</p>
        </div>
      )}

      {displayError && (
        <div className="p-4 bg-red-50 border-l-4 border-red-500 text-red-700">
          <p className="font-semibold">Error</p>
          <p>{displayError}</p>
        </div>
      )}

      {!isLoading && !displayError && displayData.length === 0 && (
        <div className="p-8 text-center">
          <svg className="w-16 h-16 text-gray-300 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-gray-500 text-lg font-medium">No data found</p>
          <p className="text-gray-400 text-sm mt-2">Try adjusting your filter criteria</p>
        </div>
      )}

      {!isLoading && !displayError && displayData.length > 0 && (
        <>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="bg-gradient-to-r from-gray-50 to-gray-100 text-left">
                  {[
                    "Driver",
                    "Job Date",
                    "Route",
                    "Sequence",
                    "Packages",
                    "No Scanned",
                    "Failed Attempt",
                    "FS",
                    "DS",
                    "Delivered",
                    "Closed",
                    "Driver Payment",
                    "Paid",
                  ].map((head, i) => (
                    <th
                      key={i}
                      className="px-3 py-2 border-b-2 border-gray-200 font-semibold text-gray-700"
                    >
                      {head}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {displayData.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50 transition-colors">
                    <td className="px-3 py-2 border-b border-gray-200">
                      {row.driver_name}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200">
                      {new Date(row.journey_date + 'T00:00:00').toLocaleDateString('en-CA')}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200">{row.route_name || row.route_id}</td>
                    <td className="px-3 py-2 border-b border-gray-200">
                      {row.start_seq}-{row.end_seq}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200">{row.packages}</td>
                    <td className="px-3 py-2 border-b border-gray-200">{row.no_scanned}</td>
                    <td className="px-3 py-2 border-b border-gray-200">
                      {row.failed_attempt}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200">{row.fs}</td>
                    <td className="px-3 py-2 border-b border-gray-200">{row.ds}</td>
                    <td className="px-3 py-2 border-b border-gray-200">{row.delivered}</td>
                    <td
                      className={`px-3 py-2 border-b border-gray-200 font-semibold ${
                        row.closed ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {row.closed ? "Yes" : "No"}
                    </td>
                    <td className="px-3 py-2 border-b border-gray-200 relative group">
                      {row.driver_payment ? (
                        <span className="cursor-pointer">
                          {row.driver_payment}
                          <span className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 z-50
                                         w-max max-w-xs rounded-md bg-gray-800 text-white text-xs px-2 py-1
                                         opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                            <p>Full amount displayed here</p>
                          </span>
                        </span>
                      ) : (
                        "-"
                      )}
                    </td>
                    <td
                      className={`px-3 py-2 border-b border-gray-200 font-semibold ${
                        row.paid ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {row.paid ? "Yes" : "No"}
                    </td>
                  </tr>
                ))}
                
                {shouldShowTotals && totals && (
                  <tr className="bg-blue-50 font-bold border-t-2 border-blue-600">
                    <td className="px-3 py-3 border-b border-gray-200">
                      TOTAL
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200" colSpan="3">
                      {displayData[0].driver_name}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-blue-900">
                      {totals.packages}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-blue-900">
                      {totals.noScanned}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-blue-900">
                      {totals.failedAttempt}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-blue-900">
                      {totals.fs}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-blue-900">
                      {totals.ds}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-blue-900">
                      {totals.delivered}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200">
                      -
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200 text-green-700 text-lg">
                      💰 {totals.driverPayment.toFixed(2)}
                    </td>
                    <td className="px-3 py-3 border-b border-gray-200">
                      -
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          <div className="bg-gradient-to-r from-gray-50 to-gray-100 border-t-2 border-gray-200">
            <div className="px-6 py-4">
              <div className="flex flex-col sm:flex-row justify-between items-center gap-4 mb-4">
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

                <div className="text-sm font-medium text-gray-700">
                  Showing <span className="font-bold text-blue-600">{((currentPage - 1) * itemsPerPage) + 1}</span> to{' '}
                  <span className="font-bold text-blue-600">
                    {Math.min(currentPage * itemsPerPage, pagination.total)}
                  </span> of{' '}
                  <span className="font-bold text-blue-600">{pagination.total}</span> entries
                </div>
              </div>

              <div className="flex justify-center items-center gap-1">
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
        </>
      )}  
    </section>
  );
}