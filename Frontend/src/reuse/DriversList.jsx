import { useState, useEffect } from 'react';
import { SkeletonTableRows } from "./Skeleton.jsx";
import { useDispatch, useSelector } from 'react-redux';
import { getUsers, toggleAvailUser, setSearchTerm, setSelectedCity, changeDriverTypes, setDriverFilter, clearDriverFilters } from '../redux/slice/admin/userLoadSlice';
import Pagination from './Pagination';
import DriverTypeModal from './DriverTypeModal';
import { countByType, driverTypeLabel } from './driverType';
import { toast } from "../utils/toast";
import { EVEREE_STATUS, ISSUE_OPTIONS, NEEDS, SORT_OPTIONS, STATUS_CHIPS } from "./driverEvereeStatus.js";

const TYPE_BADGE = {
  LOCAL: "bg-blue-100 text-blue-800",
  DESI: "bg-orange-100 text-orange-800",
};

const EMPTY_SET = new Set();

function DriversList({ onEdit }) {
  const dispatch = useDispatch();  
  const { 
    drivers = [], 
    loading: usersLoad, 
    totalPages,
    city,
    searchTerm: reduxSearchTerm,
    selectedCity: reduxSelectedCity,
    changingType,
    driverFilters: filters,
    counts,
    total,
    everee
  } = useSelector((state) => state.users);   
  
  const [localSearchTerm, setLocalSearchTerm] = useState(reduxSearchTerm || "");
  const [localSelectedCity, setLocalSelectedCity] = useState(reduxSelectedCity || "All");
  const [currentPage, setCurrentPage] = useState(1);

  // The selection survives moving between pages, but belongs to one search and city: changing either starts it again, so a driver
  // you can no longer see is never changed by accident.
  const filtersKey = `${reduxSearchTerm}|${reduxSelectedCity}|${filters.type}|${filters.enabled}|${filters.status}|${filters.issue}`;
  const [selection, setSelection] = useState({ key: filtersKey, ids: new Set() });
  const selectedIds = selection.key === filtersKey ? selection.ids : EMPTY_SET;
  const [showTypeModal, setShowTypeModal] = useState(false);

  useEffect(() => {
    dispatch(getUsers({ 
      page: currentPage, 
      search: reduxSearchTerm,
      city: reduxSelectedCity,
      ...filters
    }));    
  }, [dispatch, currentPage, reduxSearchTerm, reduxSelectedCity, filters]);

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      if (localSearchTerm !== reduxSearchTerm) {
        dispatch(setSearchTerm(localSearchTerm));
        setCurrentPage(1);
      }
    }, 500);

    return () => clearTimeout(delayDebounceFn);
  }, [localSearchTerm, reduxSearchTerm, dispatch]);

  const handleCityChange = (e) => {
    const newCity = e.target.value;
    setLocalSelectedCity(newCity);
    dispatch(setSelectedCity(newCity));
    setCurrentPage(1);
  };

  const handleClearFilters = () => {
    setLocalSearchTerm("");
    setLocalSelectedCity("All");
    dispatch(setSearchTerm(""));
    dispatch(setSelectedCity("All"));
    dispatch(clearDriverFilters());
    setCurrentPage(1);
  };

  // A filter or the sort: the table goes back to its first page.
  const setFilter = (key, value) => {
    dispatch(setDriverFilter({ key, value }));
    setCurrentPage(1);
  };
  // Pressing a column heading sorts by it; pressing it again reverses the order. Everee status starts with the drivers who still have to onboard.
  const sortBy = (key) => {
    if (filters.sort === key) setFilter("dir", filters.dir === "asc" ? "desc" : "asc");
    else { dispatch(setDriverFilter({ key: "sort", value: key })); dispatch(setDriverFilter({ key: "dir", value: "asc" })); setCurrentPage(1); }
  };
  const filtersActive = Boolean(filters.type || filters.enabled || filters.status || filters.issue);

  function handleToggleChange(id) {    
    dispatch(toggleAvailUser(id));
  }

  function handleEdit(driver) {
    if (!driver.enabled) {
      toast.warning("Cannot edit disabled driver. Please enable the driver first.");
      return;
    }
    onEdit(driver);
  }

  const changeSelection = (update) => setSelection({ key: filtersKey, ids: update(new Set(selectedIds)) });

  const toggleSelected = (id) => changeSelection((ids) => {
    if (!ids.delete(id)) ids.add(id);
    return ids;
  });

  const pageIds = drivers.map((d) => d.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selectedIds.has(id));
  const someOnPage = pageIds.some((id) => selectedIds.has(id));

  const togglePage = () => changeSelection((ids) => {
    pageIds.forEach((id) => (allOnPage ? ids.delete(id) : ids.add(id)));
    return ids;
  });

  const selectedVisible = drivers.filter((d) => selectedIds.has(d.id));
  const typeSummary = () => {
    // Only the drivers on this page are known here; the others (from earlier pages) are still changed.
    if (selectedVisible.length !== selectedIds.size) return "";
    const c = countByType(selectedVisible);
    return `Now: ${c.LOCAL} Local, ${c.DESI} Desi, ${c.NONE} not set.`;
  };

  const confirmTypeChange = async (driverType) => {
    if (changingType) return;
    // Everyone selected is on this page and already has this type: nothing to send.
    if (selectedVisible.length === selectedIds.size && selectedVisible.every((d) => d.driver_type === driverType)) {
      toast.info(`Already ${driverTypeLabel(driverType)}. No change needed.`);
      setShowTypeModal(false);
      return;
    }
    const result = await dispatch(changeDriverTypes({ driverIds: [...selectedIds], driverType }));
    if (changeDriverTypes.fulfilled.match(result)) {
      const { updated, unchanged } = result.payload;
      toast.success(updated === 0 ? "No change needed" : `${updated} ${updated === 1 ? "driver" : "drivers"} changed to ${driverTypeLabel(driverType)}${unchanged ? `, ${unchanged} already ${driverTypeLabel(driverType)}` : ""}`);
      setSelection({ key: filtersKey, ids: new Set() });
      setShowTypeModal(false);
    } else {
      toast.error(result.payload || "Could not change the driver type");
    }
  };

  const hasActiveFilters = localSearchTerm || (localSelectedCity && localSelectedCity !== "All") || filtersActive;
  const SELECT = "bg-white text-ink focus:outline-none transition-shadow min-h-11 w-full px-3 py-2 border border-line rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500";

  return (
    <section className="card-surface p-4">
      {/* Search and Filter Section */}
      <div className="mb-4 space-y-3">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search Input */}
          <div className="flex-1">
            <div className="relative">
              <input
                type="text"
                value={localSearchTerm}
                onChange={(e) => setLocalSearchTerm(e.target.value)}
                placeholder="Search by name, email, phone, or driver code..."
                className="bg-white text-ink placeholder:text-ink-muted/70 focus:outline-none transition-shadow min-h-11 w-full pl-10 pr-4 py-2 border border-line rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500"
              />
              <svg
                className="absolute left-3 top-2.5 h-5 w-5 text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                />
              </svg>
            </div>
          </div>

          {/* City Filter */}
          <div className="sm:w-64">
            <select
              value={localSelectedCity}
              onChange={handleCityChange}
              className="bg-white text-ink placeholder:text-ink-muted/70 focus:outline-none transition-shadow min-h-11 w-full px-4 py-2 border border-line rounded-xl focus:ring-4 focus:ring-brand-500/20 focus:border-brand-500"
            >
              <option value="All">All Cities</option>
              {city && city.length > 0 && city.map((c) => (
                <option key={c.id} value={c.job}>
                  {c.job}
                </option>
              ))}
            </select>
          </div>

          {/* Clear Filters Button */}
          {hasActiveFilters && (
            <button
              onClick={handleClearFilters}
              className="px-4 py-2 bg-gray-500 text-white rounded-lg hover:bg-gray-600 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
              Clear
            </button>
          )}
        </div>

        {/* Everee onboarding: how many drivers are in each state, as buttons that filter the table */}
        {everee && !everee.onboardingEnabled && (
          <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900" data-testid="everee-off">Everee onboarding is switched off, so drivers cannot start it yet. The status below shows what NASA holds today.</p>
        )}
        {everee?.enforced && (
          <p className="rounded-xl bg-brand-50 p-3 text-sm text-brand-700" data-testid="everee-enforced">Local drivers who are not onboarded are on hold: they cannot work or be paid until Everee onboarding is complete.</p>
        )}
        {counts && (
          <div role="group" aria-label="Filter by Everee onboarding status" className="flex flex-wrap gap-2" data-testid="status-chips">
            <button type="button" aria-pressed={!filters.status} onClick={() => setFilter("status", "")}
              className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${!filters.status ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-50"}`}>
              All ({counts.all})
            </button>
            {STATUS_CHIPS.filter((k) => k !== "service-unavailable" || counts[k] > 0).map((k) => (
              <button key={k} type="button" aria-pressed={filters.status === k} onClick={() => setFilter("status", filters.status === k ? "" : k)}
                className={`min-h-11 rounded-full border px-4 text-sm font-semibold ${filters.status === k ? "border-brand bg-brand text-white" : "border-line bg-white text-ink hover:bg-brand-50"}`}>
                {EVEREE_STATUS[k].chip} ({counts[k] ?? 0})
              </button>
            ))}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="text-sm font-medium text-gray-700">Driver type
            <select aria-label="Driver type" value={filters.type} onChange={(e) => setFilter("type", e.target.value)} className={`${SELECT} mt-1`}>
              <option value="">All types</option>
              <option value="LOCAL">Local</option>
              <option value="DESI">Desi</option>
              <option value="none">Not set</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">Account
            <select aria-label="Account" value={filters.enabled} onChange={(e) => setFilter("enabled", e.target.value)} className={`${SELECT} mt-1`}>
              <option value="">Enabled and disabled</option>
              <option value="enabled">Enabled</option>
              <option value="disabled">Disabled</option>
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">Needs fixing
            <select aria-label="Needs fixing" value={filters.issue} onChange={(e) => setFilter("issue", e.target.value)} className={`${SELECT} mt-1`}>
              {ISSUE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="text-sm font-medium text-gray-700">Sort by
            <select aria-label="Sort by" value={filters.sort} onChange={(e) => sortBy(e.target.value)} className={`${SELECT} mt-1`}>
              {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <div className="text-sm font-medium text-gray-700">Order
            <button type="button" onClick={() => setFilter("dir", filters.dir === "asc" ? "desc" : "asc")} aria-label={`Order: ${filters.dir === "asc" ? "ascending" : "descending"}. Press to reverse.`}
              className={`${SELECT} mt-1 text-left`}>
              {filters.dir === "asc" ? "↑ A to Z / pending first" : "↓ Z to A / finished first"}
            </button>
          </div>
        </div>

        {/* Active Filters Display */}
        {hasActiveFilters && (
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-sm text-gray-600">Active filters:</span>
            {localSearchTerm && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-800">
                Search: "{localSearchTerm}"
                <button
                  onClick={() => {
                    setLocalSearchTerm("");
                    dispatch(setSearchTerm(""));
                  }}
                  className="ml-1 hover:text-purple-900"
                >
                  ×
                </button>
              </span>
            )}
            {localSelectedCity && localSelectedCity !== "All" && (
              <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                City: {localSelectedCity}
                <button
                  onClick={() => {
                    setLocalSelectedCity("All");
                    dispatch(setSelectedCity("All"));
                  }}
                  className="ml-1 hover:text-blue-900"
                >
                  ×
                </button>
              </span>
            )}
            {[["status", "Everee", EVEREE_STATUS[filters.status]?.chip], ["type", "Type", { LOCAL: "Local", DESI: "Desi", none: "Not set" }[filters.type]],
              ["enabled", "Account", { enabled: "Enabled", disabled: "Disabled" }[filters.enabled]], ["issue", "Needs fixing", ISSUE_OPTIONS.find((o) => o.value === filters.issue)?.label]]
              .filter(([key]) => filters[key]).map(([key, label, value]) => (
                <span key={key} className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  {label}: {value}
                  <button type="button" aria-label={`Remove the ${label} filter`} onClick={() => setFilter(key, "")} className="ml-1 hover:text-green-900">×</button>
                </span>
              ))}
          </div>
        )}
      </div>

      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="font-bold text-lg">Drivers{typeof total === "number" && counts ? <span className="ml-2 text-sm font-normal text-gray-500" data-testid="driver-total">{total} {total === 1 ? "driver" : "drivers"}</span> : null}</h2>
        {selectedIds.size > 0 && (
          <button
            type="button"
            onClick={() => setShowTypeModal(true)}
            className="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
          >
            Change ({selectedIds.size})
          </button>
        )}
      </div>
      
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="bg-gray-50 text-left">
              <th className="px-3 py-2 border-b border-line">
                <input
                  type="checkbox"
                  aria-label="Select all drivers on this page"
                  checked={allOnPage}
                  ref={(el) => { if (el) el.indeterminate = someOnPage && !allOnPage; }}
                  onChange={togglePage}
                  disabled={pageIds.length === 0}
                  className="h-4 w-4"
                />
              </th>
              {[["Sl No"], ["Driver Code", "code"], ["Name", "name"], ["Email"], ["Phone"], ["City", "city"], ["Driver Type", "type"], ["Everee", "status"], ["Account", "enabled"], ["Actions"]].map(
                ([head, key]) => (
                  <th key={head} className="px-3 py-2 border-b border-line" aria-sort={key && filters.sort === key ? (filters.dir === "asc" ? "ascending" : "descending") : undefined}>
                    {key ? (
                      <button type="button" onClick={() => sortBy(key)} title={`Sort by ${head}`} className="inline-flex items-center gap-1 font-semibold hover:text-brand">
                        {head}
                        <span aria-hidden="true" className="text-xs text-gray-400">{filters.sort === key ? (filters.dir === "asc" ? "↑" : "↓") : "↕"}</span>
                      </button>
                    ) : head}
                  </th>
                )
              )}
            </tr>
          </thead>
          <tbody>
            {usersLoad && drivers.length === 0 ? (
              <SkeletonTableRows rows={5} cols={11} label="Loading drivers..." />
            ) : drivers.length > 0 ? (
              drivers.map((d, i) => (
                <tr key={d.id} className={!d.enabled ? "bg-gray-50" : ""}>
                  <td className="px-3 py-2 border-b">
                    <input
                      type="checkbox"
                      aria-label={`Select ${d.name}`}
                      checked={selectedIds.has(d.id)}
                      onChange={() => toggleSelected(d.id)}
                      className="h-4 w-4"
                    />
                  </td>
                  <td className="px-3 py-2 border-b">
                    {(currentPage - 1) * 10 + i + 1}
                  </td>
                  <td className="px-3 py-2 border-b">
                    <span className={`font-mono ${!d.enabled ? "text-gray-400" : "text-gray-700"}`}>
                      {d.driver_code}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <span className={!d.enabled ? "text-gray-400" : ""}>
                      {d.name}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <span className={!d.enabled ? "text-gray-400" : ""}>
                      {d.email}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <span className={!d.enabled ? "text-gray-400" : ""}>
                      {d.phone_number || "-"}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <span className={!d.enabled ? "text-gray-400" : ""}>
                      {d.job}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b">
                    <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${TYPE_BADGE[d.driver_type] ?? "bg-gray-100 text-gray-600"}`}>
                      {driverTypeLabel(d.driver_type)}
                    </span>
                  </td>
                  <td className="px-3 py-2 border-b" data-testid={`everee-${d.id}`}>
                    {EVEREE_STATUS[d.everee_status] ? (
                      <>
                        <span title={EVEREE_STATUS[d.everee_status].hint} className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${EVEREE_STATUS[d.everee_status].tone}`}>
                          {EVEREE_STATUS[d.everee_status].label}
                        </span>
                        {(d.everee_needs ?? []).length > 0 && (
                          <ul className="mt-1 space-y-0.5 text-xs text-red-700">
                            {d.everee_needs.map((n) => <li key={n}>{NEEDS[n]}</li>)}
                          </ul>
                        )}
                      </>
                    ) : "-"}
                  </td>
                  <td className="px-3 py-2 border-b">
                    {d.enabled ? (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        Enabled
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                        </svg>
                        Disabled
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 border-b">
                    <div className="flex items-center gap-3">
                      {/* Toggle Switch */}
                      <label 
                        className="relative inline-flex items-center cursor-pointer"
                        title={d.enabled ? "Disable driver" : "Enable driver"}
                      >
                        <input
                          type="checkbox"
                          checked={d.enabled}
                          onChange={() => handleToggleChange(d.id)}
                          className="sr-only"
                        />
                        <div
                          className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out ${
                            d.enabled ? "bg-purple-600" : "bg-gray-300"
                          }`}
                        >
                          <div
                            className={`w-5 h-5 bg-white rounded-full shadow-lg transform transition-transform duration-200 ease-in-out ${
                              d.enabled ? "translate-x-5" : "translate-x-0.5"
                            } mt-0.5`}
                          ></div>
                        </div>
                      </label>

                      {/* Edit Button */}
                      <button
                        onClick={() => handleEdit(d)}
                        disabled={!d.enabled}
                        className={`group relative px-4 py-1.5 text-white text-xs font-medium rounded-md transition-all duration-200 shadow-sm flex items-center gap-1.5 ${
                          d.enabled
                            ? "bg-brand hover:bg-brand-900 hover:shadow-md cursor-pointer"
                            : "bg-gray-400 cursor-not-allowed opacity-50"
                        }`}
                        title={d.enabled ? "Edit driver" : "Enable driver to edit"}
                      >
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                        <span>Edit</span>
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan="11" className="text-center py-8 text-gray-500">
                  <div className="flex flex-col items-center gap-2">
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                    <p className="font-medium">
                      {hasActiveFilters ? "No drivers match your filters" : "No drivers found"}
                    </p>
                    {hasActiveFilters && (
                      <button
                        onClick={handleClearFilters}
                        className="text-sm text-purple-600 hover:text-purple-700 underline"
                      >
                        Clear filters to see all drivers
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="mt-4">
          <Pagination
            page={currentPage}
            totalPages={totalPages}
            onPageChange={(pg) => setCurrentPage(pg)}
          />
        </div>
      )}
      {showTypeModal && (
        <DriverTypeModal
          count={selectedIds.size}
          summary={typeSummary()}
          busy={Boolean(changingType)}
          onCancel={() => setShowTypeModal(false)}
          onConfirm={confirmTypeChange}
        />
      )}
    </section>
  );
}

export default DriversList;