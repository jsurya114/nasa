import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { fetchDashboardData, fetchFilteredPaymentData, fetchSummaryData, clearFilteredData, payDriver, setDataType } from "../../redux/slice/admin/dashSlice.js";
import Header from "../../reuse/Header.jsx";
import Nav from "../../reuse/Nav.jsx";
import PaymentDashboardTable from "./DashboardTable.jsx"; 
import Loader from "../Loader.jsx"

export default function Dashboard() {
  const dispatch = useDispatch();
  const navigate = useNavigate();

  const { 
    cities, 
    drivers, 
    routes, 
    loading, 
    error, 
    filteredPaymentData, 
    summaryData,
    summaryLoading,
    isFiltered,
    paymentProcessing,
    pagination,
    filters: reduxFilters,
    selectedDataType
  } = useSelector((state) => state.dash);

  const { isSuperAdmin } = useSelector((state) => state.admin);

  const getTodayDate = () => {
    const today = new Date();
    return today.toLocaleDateString("en-CA")
  };

  // Local state for form inputs only
  const [localFilters, setLocalFilters] = useState({
    job: "All",
    driver: "All",
    route: "All",
    startDate: "",
    endDate: "",
    paymentStatus: "All",
    companyEarnings: false,
  });

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(10);
  const [showExtraFields, setShowExtraFields] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  // ✅ Calculate available data types based on filtered data
  const availableDataTypes = useMemo(() => {
    if (!isFiltered || filteredPaymentData.length === 0) {
      return { daily: false, weekly: false };
    }

    const hasDaily = filteredPaymentData.some(row => row.data_type === 'daily');
    const hasWeekly = filteredPaymentData.some(row => row.data_type === 'weekly');

    return { daily: hasDaily, weekly: hasWeekly };
  }, [filteredPaymentData, isFiltered]);

  // ✅ Show data type tabs only when driver is selected
  const shouldShowDataTypeTabs = useMemo(() => {
    return isFiltered && 
           reduxFilters.driver && 
           reduxFilters.driver !== "All" &&
           (availableDataTypes.daily || availableDataTypes.weekly);
  }, [isFiltered, reduxFilters.driver, availableDataTypes]);

  const shouldShowPayButton = useMemo(() => {
    return (
      isFiltered &&
      reduxFilters.driver && 
      reduxFilters.driver !== "All" &&
      reduxFilters.paymentStatus === "Pending" &&
      filteredPaymentData.length > 0 &&
      filteredPaymentData.some(row => !row.paid)
    );
  }, [isFiltered, reduxFilters.driver, reduxFilters.paymentStatus, filteredPaymentData]);

  // ✅ Use summaryData from Redux instead of calculating from paginated data
  const extraFieldsData = useMemo(() => {
    if (!isFiltered || !summaryData) {
      return {
        packages: 0,
        noScanned: 0,
        failedAttempt: 0,
        firstStop: 0,
        doubleStop: 0,
        delivered: 0,
        driversPayment: 0,
        companyEarnings: 0,
      };
    }

    return {
      packages: Number(summaryData.total_packages) || 0,
      noScanned: Number(summaryData.total_no_scanned) || 0,
      failedAttempt: Number(summaryData.total_failed_attempt) || 0,
      firstStop: Number(summaryData.total_fs) || 0,
      doubleStop: Number(summaryData.total_ds) || 0,
      delivered: Number(summaryData.total_delivered) || 0,
      driversPayment: Number(summaryData.total_driver_payment) || 0,
      companyEarnings: Number(summaryData.total_company_earnings) || 0,
    };
  }, [summaryData, isFiltered]);

  // ✅ Only fetch dropdown data on mount, don't fetch payment data
  useEffect(() => {
    dispatch(fetchDashboardData());
  }, [dispatch]);

  const handleFilterChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;
    setLocalFilters((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }, []);

  const handleFilterClick = () => {
    setShowExtraFields(isSuperAdmin && localFilters.companyEarnings);
    
    const filterParams = {
      page: 1,
      limit: itemsPerPage,
      dataType: "all" // Reset to all when filtering
    };
    
    // Reset data type selection
    dispatch(setDataType("all"));
    
    if (localFilters.job !== "All") filterParams.job = localFilters.job;
    if (localFilters.driver !== "All") filterParams.driver = localFilters.driver;
    if (localFilters.route !== "All") filterParams.route = localFilters.route;
    if (localFilters.startDate) filterParams.startDate = localFilters.startDate;
    if (localFilters.endDate) filterParams.endDate = localFilters.endDate;
    if (localFilters.paymentStatus !== "All") filterParams.paymentStatus = localFilters.paymentStatus;
    if (isSuperAdmin && localFilters.companyEarnings) filterParams.companyEarnings = localFilters.companyEarnings;
    
    setCurrentPage(1);
    
    // ✅ Fetch both paginated data AND summary data
    dispatch(fetchFilteredPaymentData(filterParams));
    
    // ✅ Fetch summary data if company earnings is enabled
    if (isSuperAdmin && localFilters.companyEarnings) {
      const summaryParams = { ...filterParams };
      delete summaryParams.page;
      delete summaryParams.limit;
      delete summaryParams.companyEarnings;
      dispatch(fetchSummaryData(summaryParams));
    }
  };

  const handleClearFilters = () => {
    setLocalFilters({
      job: "All",
      driver: "All",
      route: "All",
      startDate: "",
      endDate: "",
      paymentStatus: "All",
      companyEarnings: false,
    });
    setShowExtraFields(false);
    setCurrentPage(1);
    
    // ✅ Just clear data, don't fetch anything
    dispatch(clearFilteredData());
    dispatch(setDataType("all"));
  };

  // ✅ Handle data type tab change
  const handleDataTypeChange = (dataType) => {
    dispatch(setDataType(dataType));
    
    const filterParams = {
      ...reduxFilters,
      dataType: dataType,
      page: 1,
      limit: itemsPerPage
    };
    
    setCurrentPage(1);
    
    // ✅ Fetch both paginated data AND summary data
    dispatch(fetchFilteredPaymentData(filterParams));
    
    // ✅ Update summary data for the selected data type
    if (isSuperAdmin && showExtraFields) {
      const summaryParams = { ...filterParams };
      delete summaryParams.page;
      delete summaryParams.limit;
      delete summaryParams.companyEarnings;
      dispatch(fetchSummaryData(summaryParams));
    }
  };

  const handlePayDriver = async () => {
    setShowConfirmModal(false);
    
    const result = await dispatch(payDriver({
      driverName: reduxFilters.driver,
      startDate: reduxFilters.startDate || null,
      endDate: reduxFilters.endDate || null,
    }));
    
    if (result.type === 'dashboard/payDriver/fulfilled') {
      setLocalFilters(prev => ({
        ...prev,
        paymentStatus: "All"
      }));
      
      const filterParams = {
        page: currentPage,
        limit: itemsPerPage,
        dataType: selectedDataType
      };
      
      if (reduxFilters.job && reduxFilters.job !== "All") filterParams.job = reduxFilters.job;
      if (reduxFilters.driver && reduxFilters.driver !== "All") filterParams.driver = reduxFilters.driver;
      if (reduxFilters.route && reduxFilters.route !== "All") filterParams.route = reduxFilters.route;
      if (reduxFilters.startDate) filterParams.startDate = reduxFilters.startDate;
      if (reduxFilters.endDate) filterParams.endDate = reduxFilters.endDate;
      if (isSuperAdmin && reduxFilters.companyEarnings) filterParams.companyEarnings = reduxFilters.companyEarnings;
      
      dispatch(fetchFilteredPaymentData(filterParams));
      
      // ✅ Refetch summary data
      if (isSuperAdmin && showExtraFields) {
        const summaryParams = { ...filterParams };
        delete summaryParams.page;
        delete summaryParams.limit;
        delete summaryParams.companyEarnings;
        dispatch(fetchSummaryData(summaryParams));
      }
    }
  };

  const handleAddDelivery = useCallback(() => {
    navigate("/admin/journeys");
  }, [navigate]);

  const filterOptions = useMemo(
    () => [
      {
        label: "Job",
        type: "select",
        name: "job",
        options: ["All", ...(cities?.map((city) => city.job) || [])],
      },
      {
        label: "Driver",
        type: "select",
        name: "driver",
        options: ["All", ...(drivers?.map((driver) => driver.name) || [])],
      },
      {
        label: "Route",
        type: "select",
        name: "route",
        options: ["All", ...(routes?.map((route) => route.name) || [])],
      },
      { label: "Start Date", type: "date", name: "startDate" },
      { label: "End Date", type: "date", name: "endDate" },
      {
        label: "Payment status",
        type: "select",
        name: "paymentStatus",
        options: ["All", "Paid", "Pending"],
      },
    ],
    [cities, drivers, routes]
  );

  if (loading) return <div className="text-center py-10"><Loader/></div>;
  if (error) return <div className="text-center text-red-600 py-10">{error}</div>;

  return (
    <>
      <style>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: scale(0.95);
          }
          to {
            opacity: 1;
            transform: scale(1);
          }
        }
        .animate-fadeIn {
          animation: fadeIn 0.2s ease-out;
        }
        
        .data-type-tab {
          position: relative;
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          border-radius: 0.5rem;
          transition: all 0.2s ease;
          cursor: pointer;
        }
        
        .data-type-tab:hover:not(.active):not(.disabled) {
          background-color: #e0f2fe;
        }
        
        .data-type-tab.active {
          background-color: #3b82f6;
          color: white;
          box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.3);
        }
        
        .data-type-tab.disabled {
          opacity: 0.4;
          cursor: not-allowed;
          color: #9ca3af;
        }
      `}</style>
      
    <div className="min-h-screen bg-gray-100 text-gray-900 font-poppins">
      <Header />

      <main className="max-w-[1450px] mx-auto p-2 sm:p-4 pb-20 sm:pb-40">
        <section className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4">
          <div className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3 flex items-center justify-between">
            <span>Data Filters</span>
            {isFiltered && (
              <span className="text-sm font-normal text-gray-600">
                📅 Showing filtered data
              </span>
            )}
          </div>
          <div className="divide-y">
            {filterOptions.map((item, i) => (
              <div
                key={i}
                className="grid grid-cols-1 sm:grid-cols-[160px_1fr_40px] items-center gap-2 sm:gap-3 px-4 py-3"
              >
                <div className="text-gray-600">{item.label}</div>
                {item.type === "select" ? (
                  <select
                    className="w-full border border-gray-200 rounded-lg px-3 py-2"
                    name={item.name}
                    value={localFilters[item.name]}
                    onChange={handleFilterChange}
                  >
                    {item.options.map((opt, j) => (
                      <option key={j} value={opt}>
                        {opt}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={item.type}
                    name={item.name}
                    value={localFilters[item.name]}
                    onChange={handleFilterChange}
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-400"
                  />
                )}
                <div className="text-gray-400 text-center hidden sm:block">
                  {item.type === "select" ? "▾" : "📅"}
                </div>
              </div>
            ))}

            {isSuperAdmin && (
              <div className="flex items-center gap-3 px-4 py-3 bg-blue-50 border-l-4 border-blue-500">
                <input
                  type="checkbox"
                  name="companyEarnings"
                  checked={localFilters.companyEarnings}
                  onChange={handleFilterChange}
                  className="w-4 h-4"
                />
                <span className="font-medium text-gray-700">
                  Summary
                </span>
              </div>
            )}

            <div className="px-4 py-3 flex flex-wrap gap-3">
              <button
                onClick={handleFilterClick}
                className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-blue-700 transition-colors"
              >
                Filter Data
              </button>
              <button
                onClick={handleClearFilters}
                className="bg-gray-500 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-gray-600 transition-colors"
              >
                Clear Filters
              </button>
              <button
                onClick={handleAddDelivery}
                className="bg-blue-600 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-blue-700 transition-colors"
              >
                Add Delivery
              </button>
              
              {shouldShowPayButton && (
                <button
                  onClick={() => setShowConfirmModal(true)}
                  disabled={paymentProcessing}
                  className="bg-green-600 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                >
                  {paymentProcessing ? "Processing..." : `💰 Pay ${reduxFilters.driver}`}
                </button>
              )}
            </div>

            {showExtraFields && isSuperAdmin && (
              <div className="px-4 py-3 grid grid-cols-1 gap-3 bg-blue-50">
                <div className="mb-2 font-semibold text-gray-700 flex items-center gap-2">
                  <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                  </svg>
                   Summary
                  {summaryLoading && <span className="text-sm text-gray-500 ml-2">(Loading...)</span>}
                </div>
                
                {[
                  { field: "packages", label: "Total Packages" },
                  { field: "noScanned", label: "Total No Scanned" },
                  { field: "failedAttempt", label: "Total Failed Attempt" },
                  { field: "firstStop", label: "Total First Stop (FS)" },
                  { field: "doubleStop", label: "Total Double Stop (DS)" },
                  { field: "delivered", label: "Total Delivered" },
                  { field: "driversPayment", label: "Total Drivers Payment" },
                  { field: "companyEarnings", label: "Total Company Earnings", highlight: true },
                ].map((item, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <label className="w-48 text-gray-600">{item.label}:</label>
                    <input
                      type="text"
                      name={item.field}
                      value={extraFieldsData[item.field]}
                      readOnly
                      className="flex-1 border border-gray-200 rounded-lg px-3 py-2 bg-white text-gray-700 font-semibold"
                    />
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* ✅ Data Type Tabs - Show only when driver is selected */}
        {shouldShowDataTypeTabs && (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4 p-4">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-semibold text-gray-700 mr-2">View:</span>
              
              <button
                onClick={() => handleDataTypeChange("all")}
                className={`data-type-tab ${selectedDataType === "all" ? "active" : ""}`}
              >
                📊 All Data
              </button>
              
              <button
                onClick={() => handleDataTypeChange("daily")}
                disabled={!availableDataTypes.daily}
                className={`data-type-tab ${selectedDataType === "daily" ? "active" : ""} ${!availableDataTypes.daily ? "disabled" : ""}`}
              >
                📅 SPEEDX
              </button>
              
              <button
                onClick={() => handleDataTypeChange("weekly")}
                disabled={!availableDataTypes.weekly}
                className={`data-type-tab ${selectedDataType === "weekly" ? "active" : ""} ${!availableDataTypes.weekly ? "disabled" : ""}`}
              >
                📆 GOFO
              </button>
              
              <span className="ml-auto text-xs text-gray-500">
                {selectedDataType === "all" && "Showing all records"}
                {selectedDataType === "daily" && "Showing daily records only"}
                {selectedDataType === "weekly" && "Showing weekly records only"}
              </span>
            </div>
          </section>
        )}

        {/* ✅ Show message when no data is displayed */}
        {!isFiltered && (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto p-8 text-center">
            <div className="flex flex-col items-center gap-4">
              <svg className="w-20 h-20 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" />
              </svg>
              <div>
                <p className="text-gray-700 text-lg font-medium mb-2">No Data to Display</p>
                <p className="text-gray-500">Please use the filters above and click "Filter Data" to view payment records</p>
              </div>
            </div>
          </section>
        )}

        {isFiltered && (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
            <div className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3">
              Driver Jobs
            </div>
            <PaymentDashboardTable showExtraFields={showExtraFields && isSuperAdmin} />
          </section>
        )}
      </main>

      <Nav />

      {showConfirmModal && (
        <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-sm w-full animate-fadeIn border border-gray-200">
            <div className="p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-3">
                Confirm Payment
              </h3>
              <p className="text-gray-600 mb-4">
                Mark all payments as paid for <span className="font-medium text-gray-900">{reduxFilters.driver}</span>?
              </p>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => setShowConfirmModal(false)}
                  className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handlePayDriver}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
                >
                  Confirm
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
    </>
  );
}