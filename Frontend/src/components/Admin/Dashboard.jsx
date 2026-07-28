import React, { useState, useMemo, useCallback, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import {
  fetchDashboardData,
  fetchDriversByCity,
  fetchRoutesByCity,
  fetchFilteredPaymentData,
  fetchTodayPaymentData,
  fetchSummaryData,
  clearFilteredData,
  payDriver,
  setDataType
} from "../../redux/slice/admin/dashSlice.js";
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
    selectedDataType,
    showTodayOnly
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
  const [selectedPaymentType, setSelectedPaymentType] = useState(null); // 'daily' or 'weekly'

  // Calculate available data types based on filtered data
  const [originalDataTypes, setOriginalDataTypes] = useState({ daily: false, weekly: false });

  useEffect(() => {
    if (isFiltered && selectedDataType === "all" && filteredPaymentData.length > 0) {
      const hasDaily = filteredPaymentData.some(row => row.data_type === 'daily');
      const hasWeekly = filteredPaymentData.some(row => row.data_type === 'weekly');
      setOriginalDataTypes({ daily: hasDaily, weekly: hasWeekly });
    }
  }, [filteredPaymentData, isFiltered, selectedDataType]);

  const availableDataTypes = useMemo(() => {
    if (!isFiltered) {
      return { daily: false, weekly: false };
    }

    if (selectedDataType === "all") {
      const hasDaily = filteredPaymentData.some(row => row.data_type === 'daily');
      const hasWeekly = filteredPaymentData.some(row => row.data_type === 'weekly');
      return { daily: hasDaily, weekly: hasWeekly };
    }

    return originalDataTypes;
  }, [filteredPaymentData, isFiltered, selectedDataType, originalDataTypes]);

  const shouldShowDataTypeTabs = useMemo(() => {
    return isFiltered &&
      reduxFilters.driver &&
      reduxFilters.driver !== "All" &&
      (availableDataTypes.daily || availableDataTypes.weekly);
  }, [isFiltered, reduxFilters.driver, availableDataTypes]);

  // ✅ UPDATED: Check for closed status as well as payment status
  const shouldShowPayButton = useMemo(() => {
    if (!isFiltered ||
      !reduxFilters.driver ||
      reduxFilters.driver === "All" ||
      reduxFilters.paymentStatus !== "Pending" ||
      filteredPaymentData.length === 0) {
      return false;
    }

    // ✅ Only show pay button if there are unpaid AND closed journeys
    const hasUnpaidClosedJourneys = filteredPaymentData.some(row => !row.paid && row.closed);
    return hasUnpaidClosedJourneys;
  }, [isFiltered, reduxFilters.driver, reduxFilters.paymentStatus, filteredPaymentData]);

  // ✅ UPDATED: Calculate separate counts for daily and weekly payments
  const paymentCounts = useMemo(() => {
    if (!filteredPaymentData.length) {
      return { dailyClosedUnpaid: 0, weeklyClosedUnpaid: 0, openUnpaid: 0 };
    }

    const dailyClosedUnpaid = filteredPaymentData.filter(row =>
      row.closed && !row.paid && row.data_type === 'daily'
    ).length;
    const weeklyClosedUnpaid = filteredPaymentData.filter(row =>
      row.closed && !row.paid && row.data_type === 'weekly'
    ).length;
    const openUnpaid = filteredPaymentData.filter(row => !row.closed && !row.paid).length;

    return { dailyClosedUnpaid, weeklyClosedUnpaid, openUnpaid };
  }, [filteredPaymentData]);

  // ✅ NEW: Separate conditions for showing daily and weekly pay buttons
  const shouldShowDailyPayButton = useMemo(() => {
    return isFiltered &&
      reduxFilters.driver &&
      reduxFilters.driver !== "All" &&
      reduxFilters.paymentStatus === "Pending" &&
      paymentCounts.dailyClosedUnpaid > 0;
  }, [isFiltered, reduxFilters.driver, reduxFilters.paymentStatus, paymentCounts.dailyClosedUnpaid]);

  const shouldShowWeeklyPayButton = useMemo(() => {
    return isFiltered &&
      reduxFilters.driver &&
      reduxFilters.driver !== "All" &&
      reduxFilters.paymentStatus === "Pending" &&
      paymentCounts.weeklyClosedUnpaid > 0;
  }, [isFiltered, reduxFilters.driver, reduxFilters.paymentStatus, paymentCounts.weeklyClosedUnpaid]);

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
        insuranceDeduction: 0,
        netDriverPayment: 0,
      };
    }

    const totalDriverPayment = Number(summaryData.total_driver_payment) || 0;
    const totalInsurance = Number(summaryData.total_insurance_deduction) || 0;

    return {
      packages: Number(summaryData.total_packages) || 0,
      noScanned: Number(summaryData.total_no_scanned) || 0,
      failedAttempt: Number(summaryData.total_failed_attempt) || 0,
      firstStop: Number(summaryData.total_fs) || 0,
      doubleStop: Number(summaryData.total_ds) || 0,
      delivered: Number(summaryData.total_delivered) || 0,
      driversPayment: totalDriverPayment.toFixed(2),
      companyEarnings: Number(summaryData.total_company_earnings) || 0,
      insuranceDeduction: totalInsurance.toFixed(2),
      netDriverPayment: (totalDriverPayment - totalInsurance).toFixed(2),
    };
  }, [summaryData, isFiltered]);

  // Fetch dropdown data AND today's data on mount
  useEffect(() => {
    dispatch(fetchDashboardData());
    dispatch(fetchTodayPaymentData({ page: 1, limit: itemsPerPage }));
  }, [dispatch, itemsPerPage]);

  // Handle job city change to fetch filtered drivers and routes
  const handleJobChange = useCallback((value) => {
    setLocalFilters((prev) => ({
      ...prev,
      job: value,
      driver: "All",
      route: "All", // ✅ Also reset route when job changes
    }));

    if (value && value !== "All") {
      dispatch(fetchDriversByCity(value));
      dispatch(fetchRoutesByCity(value)); // ✅ Fetch routes filtered by city
    } else {
      dispatch(fetchDriversByCity("All"));
      dispatch(fetchRoutesByCity("All")); // ✅ Fetch all routes
    }
  }, [dispatch]);
  const handleFilterChange = useCallback((e) => {
    const { name, value, type, checked } = e.target;

    // ✅ Special handling for job field
    if (name === "job") {
      handleJobChange(value);
      return;
    }

    setLocalFilters((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
  }, [handleJobChange]);

  // ✅ UPDATED: Handle Filter Data button - check if filters are applied
  const handleFilterClick = () => {
    setShowExtraFields(localFilters.companyEarnings);

    // ✅ NEW: Check if any filters are actually applied
    const hasFilters =
      localFilters.job !== "All" ||
      localFilters.driver !== "All" ||
      localFilters.route !== "All" ||
      localFilters.startDate ||
      localFilters.endDate ||
      localFilters.paymentStatus !== "All";

    const filterParams = {
      page: 1,
      limit: itemsPerPage,
      dataType: "all"
    };

    dispatch(setDataType("all"));

    // ✅ NEW: If no filters, show all data instead of filtered
    if (!hasFilters) {
      // No filters applied - fetch all data
      filterParams.allData = true; // This will fetch all data without date restriction
    } else {
      // Filters applied - add them to params
      if (localFilters.job !== "All") filterParams.job = localFilters.job;
      if (localFilters.driver !== "All") filterParams.driver = localFilters.driver;
      if (localFilters.route !== "All") filterParams.route = localFilters.route;
      if (localFilters.startDate) filterParams.startDate = localFilters.startDate;
      if (localFilters.endDate) filterParams.endDate = localFilters.endDate;
      if (localFilters.paymentStatus !== "All") filterParams.paymentStatus = localFilters.paymentStatus;
    }

    if (isSuperAdmin && localFilters.companyEarnings) filterParams.companyEarnings = localFilters.companyEarnings;

    setCurrentPage(1);

    dispatch(fetchFilteredPaymentData(filterParams));

    if (localFilters.companyEarnings) {
      const summaryParams = { ...filterParams };
      delete summaryParams.page;
      delete summaryParams.limit;
      delete summaryParams.companyEarnings;
      dispatch(fetchSummaryData(summaryParams));
    }
  };

  // ✅ UPDATED: Handle Clear Filters - reset to today's data
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
    setOriginalDataTypes({ daily: false, weekly: false });

    // Reset drivers and routes to show all
    dispatch(fetchDriversByCity("All"));
    dispatch(fetchRoutesByCity("All")); // ✅ Also reset routes
    dispatch(clearFilteredData());
    dispatch(setDataType("all"));

    // ✅ NEW: Fetch today's data after clearing
    dispatch(fetchTodayPaymentData({ page: 1, limit: itemsPerPage }));
  };

  const handleDataTypeChange = (dataType) => {
    dispatch(setDataType(dataType));

    const filterParams = {
      ...reduxFilters,
      dataType: dataType,
      page: 1,
      limit: itemsPerPage
    };

    setCurrentPage(1);

    dispatch(fetchFilteredPaymentData(filterParams));

    if (showExtraFields) {
      const summaryParams = { ...filterParams };
      delete summaryParams.page;
      delete summaryParams.limit;
      delete summaryParams.companyEarnings;
      dispatch(fetchSummaryData(summaryParams));
    }
  };

  // ✅ UPDATED: handlePayDriver now accepts dataType for separate payments
  const handlePayDriver = async (dataType) => {
    setShowConfirmModal(false);
    setSelectedPaymentType(null);

    const result = await dispatch(payDriver({
      driverName: reduxFilters.driver,
      startDate: reduxFilters.startDate || null,
      endDate: reduxFilters.endDate || null,
      dataType: dataType, // 'daily' or 'weekly'
      job: reduxFilters.job || null, // ✅ FIX: Pass selected city to scope payment
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
      if (reduxFilters.companyEarnings) filterParams.companyEarnings = reduxFilters.companyEarnings;

      dispatch(fetchFilteredPaymentData(filterParams));

      if (showExtraFields) {
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

  if (loading) return <div className="text-center py-10"><Loader /></div>;
  if (error) return <div className="text-center text-red-600 py-10">{error}</div>
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
              {showTodayOnly && (
                <span className="text-sm font-normal text-blue-600">
                  📅 Showing today's journeys
                </span>
              )}
              {isFiltered && !showTodayOnly && (
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

                {/* ✅ UPDATED: Separate Daily and Weekly Pay Buttons */}
                {shouldShowDailyPayButton && (
                  <button
                    onClick={() => {
                      setSelectedPaymentType('daily');
                      setShowConfirmModal(true);
                    }}
                    disabled={paymentProcessing}
                    className="bg-green-600 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-green-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {paymentProcessing ? "Processing..." : `📅 Pay Daily (${paymentCounts.dailyClosedUnpaid})`}
                  </button>
                )}

                {shouldShowWeeklyPayButton && (
                  <button
                    onClick={() => {
                      setSelectedPaymentType('weekly');
                      setShowConfirmModal(true);
                    }}
                    disabled={paymentProcessing}
                    className="bg-purple-600 text-white font-semibold px-4 py-2 rounded-lg shadow-md hover:bg-purple-700 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {paymentProcessing ? "Processing..." : `📆 Pay Weekly (${paymentCounts.weeklyClosedUnpaid})`}
                  </button>
                )}
              </div>

              {showExtraFields && (
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
                    ...(Number(extraFieldsData.insuranceDeduction) > 0 ? [
                      { field: "insuranceDeduction", label: "🛡️ Insurance Deduction", highlight: false, isNegative: true },
                      { field: "netDriverPayment", label: "💵 Net Driver Payment", highlight: false, isBold: true },
                    ] : []),
                    ...(isSuperAdmin ? [{ field: "companyEarnings", label: "Total Company Earnings", highlight: true }] : []),
                  ].map((item, i) => (
                    <div key={i} className="flex items-center gap-3">
                      <label className={`w-48 ${item.isNegative ? 'text-red-600' : item.isBold ? 'text-green-700 font-bold' : 'text-gray-600'}`}>{item.label}:</label>
                      <input
                        type="text"
                        name={item.field}
                        value={item.isNegative ? `-$${extraFieldsData[item.field]}` : item.isBold ? `$${extraFieldsData[item.field]}` : extraFieldsData[item.field]}
                        readOnly
                        className={`flex-1 border border-gray-200 rounded-lg px-3 py-2 bg-white font-semibold ${item.isNegative ? 'text-red-600' : item.isBold ? 'text-green-700' : 'text-gray-700'}`}
                      />
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>

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

          {isFiltered && (
            <section className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-x-auto">
              <div className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3">
                Driver Jobs
              </div>
              <PaymentDashboardTable showExtraFields={showExtraFields} />
            </section>
          )}
        </main>

        <Nav />

        {/* ✅ UPDATED: Confirmation Modal for Separate Daily/Weekly Payments */}
        {showConfirmModal && (
          <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-lg shadow-xl max-w-md w-full animate-fadeIn border border-gray-200">
              <div className="p-6">
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-full flex items-center justify-center ${selectedPaymentType === 'weekly' ? 'bg-purple-100' : 'bg-green-100'}`}>
                    <svg className={`w-6 h-6 ${selectedPaymentType === 'weekly' ? 'text-purple-600' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-semibold text-gray-900">
                    Confirm {selectedPaymentType === 'daily' ? 'Daily (SPEEDX)' : 'Weekly (GOFO)'} Payment
                  </h3>
                </div>

                <div className="mb-4 space-y-3">
                  <p className="text-gray-700">
                    Mark <span className="font-semibold">{selectedPaymentType === 'daily' ? 'daily' : 'weekly'}</span> payments as paid for <span className="font-semibold text-gray-900">{reduxFilters.driver}</span>?
                  </p>

                  <div className={`border rounded-lg p-3 ${selectedPaymentType === 'weekly' ? 'bg-purple-50 border-purple-200' : 'bg-green-50 border-green-200'}`}>
                    <div className="flex items-start gap-2">
                      <svg className={`w-5 h-5 mt-0.5 ${selectedPaymentType === 'weekly' ? 'text-purple-600' : 'text-green-600'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <div>
                        <p className={`text-sm font-semibold ${selectedPaymentType === 'weekly' ? 'text-purple-800' : 'text-green-800'}`}>
                          {selectedPaymentType === 'daily' ? paymentCounts.dailyClosedUnpaid : paymentCounts.weeklyClosedUnpaid} closed {selectedPaymentType} journey(s) will be marked as paid
                        </p>
                      </div>
                    </div>
                  </div>

                  {paymentCounts.openUnpaid > 0 && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="flex items-start gap-2">
                        <svg className="w-5 h-5 text-amber-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <div>
                          <p className="text-sm font-semibold text-amber-800">
                            {paymentCounts.openUnpaid} journey(s) with open status will NOT be paid
                          </p>
                          <p className="text-xs text-amber-700 mt-1">
                            Only journeys with closed status "Yes" can be marked as paid
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex gap-3 justify-end">
                  <button
                    onClick={() => {
                      setShowConfirmModal(false);
                      setSelectedPaymentType(null);
                    }}
                    className="px-4 py-2 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors font-medium"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handlePayDriver(selectedPaymentType)}
                    className={`px-4 py-2 text-white rounded-md transition-colors font-medium ${selectedPaymentType === 'weekly' ? 'bg-purple-600 hover:bg-purple-700' : 'bg-green-600 hover:bg-green-700'}`}
                  >
                    Confirm Payment
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