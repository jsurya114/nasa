import usePersistentState from "../../hooks/usePersistentState.js";
import { buildFilterParams, summaryParamsOf } from "./dashboard/filterParams.js";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
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
  setDataType
} from "../../redux/slice/admin/dashSlice.js";
import Header from "../../reuse/Header.jsx";
import Nav from "../../reuse/Nav.jsx";
import PaymentDashboardTable from "./DashboardTable.jsx";
import usePenaltySummary from "./dashboard/usePenaltySummary.js";
import { summaryItems, summaryLook } from "./dashboard/penaltyDisplay.js";
import PaymentRuns from "./payRuns/PaymentRuns.jsx";
import Loader from "../Loader.jsx"
import { CalendarDays, CalendarRange, ChevronDown, Gavel, LayoutGrid, ShieldCheck, Banknote } from "lucide-react";

const BLANK_FILTERS = {
  job: "All",
  driver: "All",
  route: "All",
  startDate: "",
  endDate: "",
  paymentStatus: "All",
  companyEarnings: false,
};

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
    filters: reduxFilters,
    selectedDataType,
    showTodayOnly,
    tableOwnerId,
    driversLoading,
    routesLoading
  } = useSelector((state) => state.dash);
  // While a city's drivers or routes load, only that dropdown waits; the rest of the page stays as it is.
  const isLoadingOptions = (name) => (name === "driver" && driversLoading) || (name === "route" && routesLoading);

  const { isSuperAdmin, admin } = useSelector((state) => state.admin);
  const penalty = usePenaltySummary();
  const penaltyLines = useMemo(() => summaryItems(penalty, Number(summaryData?.total_driver_payment || 0) - Number(summaryData?.total_insurance_deduction || 0)), [penalty, summaryData]);

  // Local state for form inputs only
  // The form is kept for when the admin leaves this page and comes back; `applied` is the form as it was when Filter Data was pressed.
  const [localFilters, setLocalFilters] = usePersistentState("admin", "dashboard", "form", BLANK_FILTERS);
  const [applied, setApplied] = usePersistentState("admin", "dashboard", "applied", null);

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = usePersistentState("admin", "dashboard", "perPage", 10);
  const [showExtraFields, setShowExtraFields] = usePersistentState("admin", "dashboard", "extra", false);

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

  // Fetch dropdown data AND the table on mount. Coming back to the page, the admin finds what they had: the dropdowns narrowed to the
  // chosen city, and the table they filtered (kept in Redux, or asked again with the same filters after a reload) instead of today's.
  const latest = useRef({});
  latest.current = { localFilters, applied, isFiltered, showTodayOnly, showExtraFields, isSuperAdmin, adminId: admin?.id ?? null, tableOwnerId };
  const lastPerPage = useRef(null);
  useEffect(() => {
    const perPageChanged = lastPerPage.current !== null && lastPerPage.current !== itemsPerPage;
    lastPerPage.current = itemsPerPage;
    const { localFilters: form, applied: before, isFiltered: held, showTodayOnly: today, showExtraFields: extra, isSuperAdmin: superAdmin, adminId, tableOwnerId: owner } = latest.current;
    dispatch(fetchDashboardData()).then(() => {
      if (form.job && form.job !== "All") {
        dispatch(fetchDriversByCity(form.job));
        dispatch(fetchRoutesByCity(form.job));
      }
    });
    // Held only if the signed-in administrator asked for it: a table is never carried over from another person.
    const redisHoldsFilteredTable = held && !today && adminId !== null && owner === adminId;
    if (perPageChanged || (!redisHoldsFilteredTable && !before)) {
      dispatch(fetchTodayPaymentData({ page: 1, limit: itemsPerPage }));
    } else if (!redisHoldsFilteredTable) {
      const params = buildFilterParams(before, { limit: itemsPerPage, isSuperAdmin: superAdmin });
      dispatch(fetchFilteredPaymentData(params));
      if (extra) dispatch(fetchSummaryData(summaryParamsOf(params)));
    }
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
  }, [dispatch, setLocalFilters]);
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
  }, [handleJobChange, setLocalFilters]);

  // ✅ UPDATED: Handle Filter Data button - check if filters are applied
  const handleFilterClick = () => {
    penalty.rememberScope(localFilters); // keep the applied city and driver IDs even if the dropdowns change before the next apply
    penalty.retry(); // and ask again, so a record saved or completed since then shows up
    setShowExtraFields(localFilters.companyEarnings);

    const filterParams = buildFilterParams(localFilters, { limit: itemsPerPage, isSuperAdmin });
    setApplied(localFilters);

    dispatch(setDataType("all"));

    setCurrentPage(1);

    dispatch(fetchFilteredPaymentData(filterParams));

    if (localFilters.companyEarnings) {
      dispatch(fetchSummaryData(summaryParamsOf(filterParams)));
    }
  };

  // ✅ UPDATED: Handle Clear Filters - reset to today's data
  const handleClearFilters = () => {
    setLocalFilters(BLANK_FILTERS);
    setApplied(null);
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

  const refreshAfterPayment = () => {
    if (isFiltered && applied) {
      const params = { ...buildFilterParams(applied, { limit: itemsPerPage, isSuperAdmin }), page: currentPage, dataType: selectedDataType };
      dispatch(fetchFilteredPaymentData(params));
      if (showExtraFields) dispatch(fetchSummaryData(summaryParamsOf(params)));
    } else dispatch(fetchTodayPaymentData({ page: 1, limit: itemsPerPage }));
    penalty.retry();
  };

  const handleAddDelivery = useCallback(() => {
    navigate("/admin/journeys");
  }, [navigate]);

  const filterOptions = useMemo(
    () => [
      {
        label: "City",
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
          display: inline-flex;
          align-items: center;
          gap: 0.5rem;
          padding: 0.75rem 1.5rem;
          font-weight: 600;
          border-radius: 0.75rem;
          transition: all 0.2s ease;
          cursor: pointer;
        }
        
        .data-type-tab:hover:not(.active):not(.disabled) {
          background-color: var(--color-brand-50);
        }
        
        .data-type-tab.active {
          background-color: var(--color-brand);
          color: white;
          box-shadow: 0 4px 10px -2px rgb(59 31 107 / 0.35);
        }
        
        .data-type-tab.disabled {
          opacity: 0.4;
          cursor: not-allowed;
          color: #9ca3af;
        }
      `}</style>

      <div className="min-h-dvh bg-canvas text-ink">
        <Header />

        <main className="max-w-[1450px] mx-auto p-2 sm:p-4 pb-20 sm:pb-40">
          {/* The payment list is a super admin call on the server; an ordinary admin gets no card, no request and no pay run link. */}
          {isSuperAdmin && <PaymentRuns cities={cities ?? []} onRecorded={refreshAfterPayment} />}
          <section className="card-surface mb-4">
            <div className="font-bold text-ink bg-brand-50/60 border-b border-line px-4 py-3 flex items-center justify-between">
              <span>Data Filters</span>
              {showTodayOnly && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Showing today's journeys
                </span>
              )}
              {isFiltered && !showTodayOnly && (
                <span className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted">
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  Showing filtered data
                </span>
              )}
            </div>
            <div className="divide-y">
              {filterOptions.map((item, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 sm:grid-cols-[160px_1fr_40px] items-center gap-2 sm:gap-3 px-4 py-3"
                >
                  <div className="text-gray-600">{item.label}{isLoadingOptions(item.name) && " (loading...)"}</div>
                  {item.type === "select" ? (
                    <select
                      className="bg-white text-ink placeholder:text-ink-muted/70 focus:outline-none transition-shadow focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 min-h-11 w-full border border-line rounded-xl px-3 py-2"
                      name={item.name}
                      value={localFilters[item.name]}
                      onChange={handleFilterChange}
                      disabled={isLoadingOptions(item.name)}
                      aria-busy={isLoadingOptions(item.name)}
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
                      className="bg-white text-ink placeholder:text-ink-muted/70 transition-shadow min-h-11 w-full border border-line rounded-xl px-3 py-2 focus:outline-none focus:ring-4 focus:ring-brand-500/20"
                    />
                  )}
                  <div className="text-ink-muted hidden sm:flex justify-center">
                    {item.type === "select"
                      ? <ChevronDown className="h-4 w-4" aria-hidden="true" />
                      : <CalendarDays className="h-5 w-5" aria-hidden="true" />}
                  </div>
                </div>
              ))}

              <div className="flex items-center gap-3 px-4 py-3 bg-brand-50 border-l-4 border-brand-500">
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
                  className="bg-brand text-white font-semibold px-4 py-2.5 rounded-xl shadow-md hover:bg-brand-900 transition-colors"
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
                  className="bg-brand text-white font-semibold px-4 py-2.5 rounded-xl shadow-md hover:bg-brand-900 transition-colors"
                >
                  Add Delivery
                </button>

              </div>

              {showExtraFields && (
                <div className="px-4 py-3 grid grid-cols-1 gap-3 bg-brand-50">
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
                      { field: "insuranceDeduction", label: "Insurance Deduction", icon: ShieldCheck, highlight: false, isNegative: true },
                    ] : []),
                    // #166: this payday's Penalty & Others and what is still owed, below the insurance deduction; then the net.
                    ...penaltyLines.afterInsurance,
                    { field: "netDriverPayment", kind: "net", preview: penaltyLines.net.preview, muted: penaltyLines.net.muted, icon: Banknote, label: penaltyLines.net.label,
                      text: `$${penaltyLines.net.net.toFixed(2)}` },
                    ...(isSuperAdmin ? [{ field: "companyEarnings", label: "Total Company Earnings", highlight: true }] : []),
                  ].map((item, i) => {
                    const look = summaryLook(item);
                    const Icon = item.icon ?? (item.kind === "deducted" || item.kind === "notice" ? Gavel : item.kind === "net" ? Banknote : null);
                    return (
                      <div key={i} className="flex items-center gap-3" data-testid={item.kind ? `summary-${item.kind}` : undefined}>
                        <label className={`w-48 inline-flex items-center gap-1.5 ${look.label}`}>
                          {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />}
                          {item.label}:
                        </label>
                        <input
                          type="text"
                          name={item.field ?? item.kind}
                          value={item.text ?? (item.isNegative ? `-$${extraFieldsData[item.field]}` : item.isBold || item.isMoney ? `$${extraFieldsData[item.field]}` : extraFieldsData[item.field])}
                          readOnly
                          className={`placeholder:text-ink-muted/70 focus:outline-none transition-shadow focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500 min-h-11 flex-1 border border-line rounded-xl px-3 py-2 bg-white font-semibold ${look.input}`}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          {shouldShowDataTypeTabs && (
            <section className="card-surface mb-4 p-4">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-700 mr-2">View:</span>

                <button
                  onClick={() => handleDataTypeChange("all")}
                  className={`data-type-tab ${selectedDataType === "all" ? "active" : ""}`}
                >
                  <LayoutGrid className="h-4 w-4" aria-hidden="true" />
                  All Data
                </button>

                <button
                  onClick={() => handleDataTypeChange("daily")}
                  disabled={!availableDataTypes.daily}
                  className={`data-type-tab ${selectedDataType === "daily" ? "active" : ""} ${!availableDataTypes.daily ? "disabled" : ""}`}
                >
                  <CalendarDays className="h-4 w-4" aria-hidden="true" />
                  SPEEDX
                </button>

                <button
                  onClick={() => handleDataTypeChange("weekly")}
                  disabled={!availableDataTypes.weekly}
                  className={`data-type-tab ${selectedDataType === "weekly" ? "active" : ""} ${!availableDataTypes.weekly ? "disabled" : ""}`}
                >
                  <CalendarRange className="h-4 w-4" aria-hidden="true" />
                  GOFO
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
            <section className="card-surface">
              <div className="font-bold text-ink bg-brand-50/60 border-b border-line px-4 py-3">
                Driver Jobs
              </div>
              <PaymentDashboardTable showExtraFields={showExtraFields} penalty={penalty} />
            </section>
          )}
        </main>

        <Nav />

      </div>
    </>
  );
}