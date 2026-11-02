import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { ShieldCheck } from "lucide-react";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import { useDispatch, useSelector } from "react-redux";
import { fetchDeliverySummary, resetDeliveries, setDeliveriesFromCache } from "../../redux/slice/driver/deliverySlice.js";
import { accessDriver } from "../../redux/slice/driver/driverSlice.js";
import { toast } from "../../utils/toast";
import useTranslation from "../../hooks/useTranslation.js";

const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache

const Deliveries = () => {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const { deliveries, status, error } = useSelector((state) => state.delivery);
  const driver = useSelector((state) => state.driver?.driver);
  const isAuthenticated = useSelector((state) => state.driver?.isAuthenticated);

  const [filters, setFilters] = useState({ from_date: "", to_date: "" });
  const [hasFiltered, setHasFiltered] = useState(false);
  const [validationError, setValidationError] = useState("");
  const [selectedDataType, setSelectedDataType] = useState("all"); // "all", "daily", "weekly"
  
  // Use refs to prevent toast spam
  const lastSuccessToast = useRef(0);
  const lastErrorToast = useRef(0);
  const initialLoadDone = useRef(false);

  // Check if both data types exist in the deliveries
  const availableDataTypes = useMemo(() => {
    if (!deliveries || deliveries.length === 0) return { daily: false, weekly: false };
    
    const hasDaily = deliveries.some(d => d.data_type === 'daily');
    const hasWeekly = deliveries.some(d => d.data_type === 'weekly');
    
    return { daily: hasDaily, weekly: hasWeekly };
  }, [deliveries]);

  // Filter deliveries based on selected data type
  const filteredDeliveries = useMemo(() => {
    if (!deliveries || deliveries.length === 0) return [];
    
    if (selectedDataType === "all") return deliveries;
    
    return deliveries.filter(d => d.data_type === selectedDataType);
  }, [deliveries, selectedDataType]);

  // Determine current data type being displayed
  const currentDataType = useMemo(() => {
    if (!filteredDeliveries || filteredDeliveries.length === 0) return null;
    return filteredDeliveries[0]?.data_type || 'daily';
  }, [filteredDeliveries]);

  // Memoized summary calculation based on filtered deliveries
  const summary = useMemo(() => {
    if (!filteredDeliveries || filteredDeliveries.length === 0) return null;
    const result = filteredDeliveries.reduce(
      (acc, d) => {
        return {
          packages: acc.packages + (parseInt(d.packages) || 0),
          no_scanned: acc.no_scanned + (parseInt(d.no_scanned) || 0),
          failed_attempt: acc.failed_attempt + (parseInt(d.failed_attempt) || 0),
          first_stop: acc.first_stop + (parseInt(d.first_stop) || 0),
          double_stop: acc.double_stop + (parseInt(d.double_stop) || 0),
          delivered: acc.delivered + (parseInt(d.delivered) || 0),
          earning: acc.earning + (parseFloat(d.earning) || 0),
          insuranceDeduction: acc.insuranceDeduction + (parseFloat(d.insurance_deduction) || 0),
        };
      },
      { packages: 0, no_scanned: 0, failed_attempt: 0, first_stop: 0, double_stop: 0, delivered: 0, earning: 0, insuranceDeduction: 0 }
    );
    // Count working days where insurance was charged
    result.insuranceDays = filteredDeliveries.filter(r => Number(r.insurance_deduction) > 0).length;
    result.netPayment = result.earning - result.insuranceDeduction;
    return result;
  }, [filteredDeliveries]);

  // Load from localStorage ONCE with cache validation
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    const savedFilters = localStorage.getItem("deliveryFilters");
    const savedDeliveries = localStorage.getItem("deliveryData");
    const savedTimestamp = localStorage.getItem("deliveryTimestamp");
    const savedDataType = localStorage.getItem("deliveryDataType");

    if (savedFilters && savedDeliveries && savedTimestamp) {
      const cacheAge = Date.now() - parseInt(savedTimestamp);
      
      if (cacheAge < CACHE_DURATION) {
        try {
          const parsedFilters = JSON.parse(savedFilters);
          const parsedDeliveries = JSON.parse(savedDeliveries);
          
          if (parsedDeliveries.length > 0) {
            setFilters(parsedFilters);
            setHasFiltered(true);
            setSelectedDataType(savedDataType || "all");
            dispatch(setDeliveriesFromCache(parsedDeliveries));
          }
        } catch {
          localStorage.removeItem("deliveryData");
          localStorage.removeItem("deliveryFilters");
          localStorage.removeItem("deliveryTimestamp");
          localStorage.removeItem("deliveryDataType");
        }
      } else {
        localStorage.removeItem("deliveryData");
        localStorage.removeItem("deliveryFilters");
        localStorage.removeItem("deliveryTimestamp");
        localStorage.removeItem("deliveryDataType");
      }
    }
  }, [dispatch]);

  // Fetch driver data once
  useEffect(() => {
    if (!driver && isAuthenticated !== false) {
      dispatch(accessDriver());
    }
  }, [dispatch, driver, isAuthenticated]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dispatch(resetDeliveries());
    };
  }, [dispatch]);

  // Success toast with debouncing
  useEffect(() => {
    if (status === "succeeded" && hasFiltered && deliveries?.length > 0) {
      const now = Date.now();
      
      if (now - lastSuccessToast.current > 3000) {
        localStorage.setItem("deliveryData", JSON.stringify(deliveries));
        localStorage.setItem("deliveryFilters", JSON.stringify(filters));
        localStorage.setItem("deliveryTimestamp", Date.now().toString());
        localStorage.setItem("deliveryDataType", selectedDataType);

        const recordText = deliveries.length === 1 ? t('deliveryRecord') : t('deliveryRecords');
        toast.success(
          `${t('successfullyFetched')} ${deliveries.length} ${recordText}!`,
          { position: "top-right", autoClose: 3000, toastId: "delivery-success" }
        );
        lastSuccessToast.current = now;
      }
    }
  }, [status, hasFiltered, deliveries, filters, selectedDataType, t]);

  // Error toast with debouncing
  useEffect(() => {
    if (status === "failed" && error) {
      const now = Date.now();
      
      if (now - lastErrorToast.current > 3000) {
        toast.error(error, { 
          position: "top-right", 
          autoClose: 4000,
          toastId: "delivery-error" 
        });
        lastErrorToast.current = now;
      }
    }
  }, [status, error]);

  // Memoized handlers
  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFilters((prev) => ({ ...prev, [name]: value }));
    setValidationError("");
  }, []);

  const handleFilter = useCallback((e) => {
    e.preventDefault();

    if (!filters.from_date || !filters.to_date) {
      setValidationError(t('pleaseSelectDateRange'));
      return;
    }

    if (new Date(filters.from_date) > new Date(filters.to_date)) {
      setValidationError(t('error'));
      return;
    }

    if (!driver?.id) {
      setValidationError(t('error'));
      return;
    }

    setValidationError("");
    setHasFiltered(true);
    setSelectedDataType("all");
    dispatch(fetchDeliverySummary({ driverId: driver.id, ...filters }));
  }, [dispatch, filters, driver, t]);

  const handleReset = useCallback(() => {
    setFilters({ from_date: "", to_date: "" });
    setHasFiltered(false);
    setValidationError("");
    setSelectedDataType("all");
    dispatch(resetDeliveries());
    localStorage.removeItem("deliveryData");
    localStorage.removeItem("deliveryFilters");
    localStorage.removeItem("deliveryTimestamp");
    localStorage.removeItem("deliveryDataType");
    lastSuccessToast.current = 0;
    lastErrorToast.current = 0;
  }, [dispatch]);

  const formatDate = useCallback((dateString) => {
    if (!dateString) return "-";
    return new Date(dateString + 'T00:00:00').toLocaleDateString('en-CA');
  }, []);

  // Dynamic table headers based on current data type
  const tableHeaders = useMemo(() => {
    if (currentDataType === 'weekly') {
      return [t('journeyDate'), t('routeName'), t('packages'), t('firstStop'), t('doubleStop'), t('delivered'), t('closed'), t('earning'), t('paid')];
    } else {
      return [
        t('journeyDate'), t('routeName'), t('startSeq'), t('endSeq'), t('packages'), 
        t('notScanned'), t('failed'), t('doubleStop'), t('delivered'), t('closed'), t('earning'), t('paid')
      ];
    }
  }, [currentDataType, t]);

  // Dynamic summary labels based on current data type
  const summaryLabels = useMemo(() => {
    const labels = {};

    if (currentDataType === 'weekly' || selectedDataType === 'all') {
      labels[t('totalPackages')] = summary?.packages;
      labels[t('firstStop')] = summary?.first_stop;
      labels[t('doubleStop')] = summary?.double_stop;
      labels[t('delivered')] = summary?.delivered;
    } else {
      // daily only
      labels[t('totalPackages')] = summary?.packages;
      labels[t('delivered')] = summary?.delivered;
      labels[t('failed')] = summary?.failed_attempt;
      labels[t('notScanned')] = summary?.no_scanned;
      labels[t('doubleStop')] = summary?.double_stop;
    }

    // Always show insurance info and deduct from total when there's insurance
    if (summary?.insuranceDeduction > 0) {
      labels['Insurance Days'] = summary?.insuranceDays || 0;
      labels['Insurance ($1.92/day)'] = summary ? `-$${summary.insuranceDeduction.toFixed(2)}` : "$0.00";
      labels[t('totalEarning')] = summary ? `$${summary.netPayment.toFixed(2)}` : "$0.00";
    } else {
      labels[t('totalEarning')] = summary ? `$${summary.earning.toFixed(2)}` : "$0.00";
    }

    return labels;
  }, [summary, currentDataType, selectedDataType, t]);

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />

      <main className="max-w-6xl mx-auto mt-4 sm:mt-6 mb-24 px-4 sm:px-6 pb-36">
        <div className="card-surface mb-8">
          <div className="p-4 sm:p-6 border-b border-line">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold text-gray-800">{t('deliverySummary')}</h2>
                <p className="text-sm text-gray-500 mt-1">{t('filterDeliveries')}</p>
              </div>
            </div>
          </div>

          <div className="p-4 sm:p-6 grid grid-cols-1 sm:grid-cols-4 gap-4">
            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700">{t('fromDate')}</label>
              <input
                type="date"
                name="from_date"
                value={filters.from_date}
                onChange={handleChange}
                max={filters.to_date || undefined}
                className="w-full px-3 py-3 text-base border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-purple-600"
              />
            </div>

            <div>
              <label className="block text-sm font-medium mb-2 text-gray-700">{t('toDate')}</label>
              <input
                type="date"
                name="to_date"
                value={filters.to_date}
                onChange={handleChange}
                min={filters.from_date || undefined}
                className="w-full px-3 py-3 text-base border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-purple-600 focus:border-purple-600"
              />
            </div>

            <div className="flex items-end">
              <button
                onClick={handleFilter}
                className="w-full px-4 py-3 bg-brand text-white rounded-md hover:bg-brand-dark transition disabled:bg-gray-400"
                disabled={status === "loading"}
              >
                {status === "loading" ? t('loading') : t('filter')}
              </button>
            </div>

            <div className="flex items-end">
              <button
                onClick={handleReset}
                className="w-full px-4 py-3 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition"
                disabled={status === "loading"}
              >
                {t('reset')}
              </button>
            </div>

            {validationError && (
              <div className="sm:col-span-4 mt-2 text-red-600 text-sm font-medium">{validationError}</div>
            )}
          </div>

          {/* Data Type Filter Buttons */}
          {hasFiltered && deliveries && deliveries.length > 0 && 
           availableDataTypes.daily && availableDataTypes.weekly && (
            <div className="px-4 sm:px-6 pb-4">
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-sm font-medium text-gray-700">{t('view')}:</span>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => setSelectedDataType("all")}
                    className={`px-4 py-2.5 rounded-md text-sm font-semibold transition ${
                      selectedDataType === "all"
                        ? "bg-brand text-white shadow-md"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {t('all')} ({deliveries.length})
                  </button>
                  <button
                    onClick={() => setSelectedDataType("daily")}
                    className={`px-4 py-2.5 rounded-md text-sm font-semibold transition ${
                      selectedDataType === "daily"
                        ? "bg-brand text-white shadow-md"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {t('showDaily')} ({deliveries.filter(d => d.data_type === 'daily').length})
                  </button>
                  <button
                    onClick={() => setSelectedDataType("weekly")}
                    className={`px-4 py-2.5 rounded-md text-sm font-semibold transition ${
                      selectedDataType === "weekly"
                        ? "bg-purple-600 text-white shadow-md"
                        : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                    }`}
                  >
                    {t('showWeekly')} ({deliveries.filter(d => d.data_type === 'weekly').length})
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Current Data Type Badge */}
          {currentDataType && filteredDeliveries.length > 0 && (
            <div className="px-4 sm:px-6 pb-4">
              <div className={`inline-flex px-4 py-2 rounded-full font-semibold text-sm ${
                currentDataType === 'weekly' 
                  ? 'bg-purple-100 text-purple-700 border border-purple-300' 
                  : 'bg-blue-100 text-blue-700 border border-blue-300'
              }`}>
                {currentDataType === 'weekly' ? t('showingGofoData') : t('showingSpeedxData')}
              </div>
            </div>
          )}

          {/* Summary */}
          {summary && (
            <div className="px-4 sm:px-6 pb-6">
              <div className="rounded-2xl bg-brand-50/70 p-4 mb-4">
                <h3 className="text-sm font-semibold text-ink mb-3">{t('summaryStatistics')}</h3>
                <dl className={`grid gap-3 ${currentDataType === 'weekly' ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-6'}`}>
                  {Object.entries(summaryLabels).map(([label, value]) => (
                    <div key={label} className="rounded-2xl border border-line bg-white px-3 py-3">
                      <dt className="flex items-center gap-1 text-xs font-medium text-ink-muted">
                        {label.startsWith('Insurance') && <ShieldCheck className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
                        {label}
                      </dt>
                      <dd className="mt-1 text-lg font-semibold tabular-nums text-ink">{value}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            </div>
          )}

          {/* Messages */}
          {hasFiltered && status === "succeeded" && (!filteredDeliveries || filteredDeliveries.length === 0) && (
            <div className="px-6 pb-6 text-center text-yellow-700 bg-yellow-50 border border-yellow-200 rounded-md p-4">
              <p>{t('noDeliveriesFound')} {selectedDataType !== "all" ? selectedDataType : ""} {t('deliveriesFoundFor')} {formatDate(filters.from_date)} {t('to')} {formatDate(filters.to_date)}</p>
            </div>
          )}

          {error && (
            <div className="px-6 pb-6 text-center text-red-700 bg-red-50 border border-red-200 rounded-md p-4">
              <p>{error}</p>
            </div>
          )}

          {!hasFiltered && status === "idle" && (
            <div className="px-6 pb-6 text-center text-blue-700 bg-blue-50 border border-blue-200 rounded-md p-4">
              <p>{t('pleaseSelectDateRange')}</p>
            </div>
          )}
        </div>

        {/* Table */}
        {/* Phones: one card per day, with the route prices shown (the table shows them on hover). */}
        {filteredDeliveries && filteredDeliveries.length > 0 && (
          <ul className="space-y-3 md:hidden">
            {filteredDeliveries.map((d, i) => {
              const counts = currentDataType === 'weekly'
                ? [[t('packages'), d.packages], [t('firstStop'), d.first_stop], [t('doubleStop'), d.double_stop], [t('delivered'), d.delivered]]
                : [[t('startSeq'), d.start_seq], [t('endSeq'), d.end_seq], [t('packages'), d.packages], [t('notScanned'), d.no_scanned], [t('failed'), d.failed_attempt], [t('doubleStop'), d.double_stop], [t('delivered'), d.delivered]];
              return (
                <li key={d.id || i} className="card-surface p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm text-ink-muted">{formatDate(d.journey_date)}</p>
                      <p className="truncate text-base font-semibold text-ink">
                        {d.route_name}
                        {d.route_code && (
                          <span className="ml-2 rounded-md bg-brand-50 px-1.5 py-0.5 text-[11px] font-medium text-brand-700">{d.route_code}</span>
                        )}
                      </p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-xs text-ink-muted">{t('earning')}</p>
                      <p className="text-lg font-semibold tabular-nums text-ink">${parseFloat(d.earning || 0).toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2 text-xs font-medium">
                    <span className={`rounded-full px-2.5 py-1 ${d.closed ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {t('closed')}: {d.closed ? t('yes') : t('no')}
                    </span>
                    <span className={`rounded-full px-2.5 py-1 ${d.paid ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"}`}>
                      {t('paid')}: {d.paid ? t('yes') : t('no')}
                    </span>
                  </div>
                  <dl className="mt-3 grid grid-cols-3 gap-2">
                    {counts.map(([label, value]) => (
                      <div key={label} className="rounded-xl bg-brand-50/70 px-2.5 py-2">
                        <dt className="text-[11px] leading-tight text-ink-muted">{label}</dt>
                        <dd className="text-sm font-semibold tabular-nums text-ink">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-3 text-xs text-ink-muted">
                    {t('routePrice')}:{' '}
                    <span className="font-medium text-ink">
                      {d.driver_route_price != null && d.driver_route_price > 0 ? `${parseFloat(d.driver_route_price).toFixed(2)}` : t('notSet')}
                    </span>
                    {' · '}
                    {t('doubleStopPrice')}:{' '}
                    <span className="font-medium text-ink">
                      {d.driver_doublestop_price != null && d.driver_doublestop_price > 0 ? `${parseFloat(d.driver_doublestop_price).toFixed(2)}` : t('notSet')}
                    </span>
                  </p>
                </li>
              );
            })}
          </ul>
        )}

        {filteredDeliveries && filteredDeliveries.length > 0 && (
          <div className="card-surface hidden overflow-hidden md:block">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-brand-50/60 border-b">
                  <tr>
                    {tableHeaders.map((h) => (
                      <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredDeliveries.map((d, i) => (
                    <tr key={d.id || i} className="hover:bg-brand-50/40 border-b border-line">
                      <td className="px-4 py-3 text-sm text-ink">{formatDate(d.journey_date)}</td>
                      <td className="px-4 py-3 text-sm relative group">
                        <span className="cursor-help border-b border-dotted border-gray-400">
                          {d.route_name}
                        </span>
                        {/* Tooltip */}
                        <div className="absolute left-0 bottom-full mb-2 hidden group-hover:block z-50 w-72 p-3 bg-gray-800 text-white text-xs rounded-lg shadow-lg">
                          <div className="font-semibold mb-2 text-blue-300 flex items-center justify-between">
                            <span>{d.route_name}</span>
                            {d.route_code && (
                              <span className="text-gray-400 text-[10px] bg-gray-700 px-2 py-0.5 rounded">
                                {d.route_code}
                              </span>
                            )}
                          </div>
                          <div className="space-y-1.5 border-t border-gray-600 pt-2">
                            <div className="flex justify-between items-center">
                              <span className="text-gray-300">{t('routePrice')}:</span>
                              <span className="font-bold text-green-400">
                                {d.driver_route_price != null && d.driver_route_price > 0 
                                  ? `${parseFloat(d.driver_route_price).toFixed(2)}`
                                  : <span className="text-red-400">{t('notSet')}</span>
                                }
                              </span>
                            </div>
                            <div className="flex justify-between items-center">
                              <span className="text-gray-300">{t('doubleStopPrice')}:</span>
                              <span className="font-bold text-yellow-400">
                                {d.driver_doublestop_price != null && d.driver_doublestop_price > 0
                                  ? `${parseFloat(d.driver_doublestop_price).toFixed(2)}`
                                  : <span className="text-red-400">{t('notSet')}</span>
                                }
                              </span>
                            </div>
                          </div>
                          <div className="absolute top-full left-4 -mt-1 border-4 border-transparent border-t-gray-800"></div>
                        </div>
                      </td>
                      
                      {currentDataType === 'weekly' ? (
                        <>
                          <td className="px-4 py-3 text-sm text-blue-600 text-center">{d.packages}</td>
                          <td className="px-4 py-3 text-sm text-purple-600 text-center">{d.first_stop}</td>
                          <td className="px-4 py-3 text-sm text-purple-600 text-center">{d.double_stop}</td>
                          <td className="px-4 py-3 text-sm text-green-600 text-center">{d.delivered}</td>
                          <td className={`px-4 py-3 text-sm font-semibold text-center ${
                            d.closed ? "text-green-600" : "text-red-600"
                          }`}>
                            {d.closed ? t('yes') : t('no')}
                          </td>
                          <td className="px-4 py-3 text-sm text-indigo-600 font-semibold">
                            ${parseFloat(d.earning || 0).toFixed(2)}
                          </td>
                          <td className={`px-4 py-3 text-sm font-semibold text-center ${
                            d.paid ? "text-green-600" : "text-red-600"
                          }`}>
                            {d.paid ? t('yes') : t('no')}
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="px-4 py-3 text-sm text-center">{d.start_seq}</td>
                          <td className="px-4 py-3 text-sm text-center">{d.end_seq}</td>
                          <td className="px-4 py-3 text-sm text-blue-600 text-center">{d.packages}</td>
                          <td className="px-4 py-3 text-sm text-yellow-600 text-center">{d.no_scanned}</td>
                          <td className="px-4 py-3 text-sm text-red-600 text-center">{d.failed_attempt}</td>
                          <td className="px-4 py-3 text-sm text-purple-600 text-center">{d.double_stop}</td>
                          <td className="px-4 py-3 text-sm text-green-600 text-center">{d.delivered}</td>
                          <td className={`px-4 py-3 text-sm font-semibold text-center ${
                            d.closed ? "text-green-600" : "text-red-600"
                          }`}>
                            {d.closed ? t('yes') : t('no')}
                          </td>
                          <td className="px-4 py-3 text-sm text-indigo-600 font-semibold">
                            ${parseFloat(d.earning || 0).toFixed(2)}
                          </td>
                          <td className={`px-4 py-3 text-sm font-semibold text-center ${
                            d.paid ? "text-green-600" : "text-red-600"
                          }`}>
                            {d.paid ? t('yes') : t('no')}
                          </td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      <Nav />
    </div>
  );
};

export default Deliveries;