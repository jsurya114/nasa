import React, { useState, useEffect, useCallback, useMemo, useRef } from "react";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import { useSelector, useDispatch } from "react-redux";
import { toast } from "react-toastify";
import useTranslation from "../../hooks/useTranslation.js";
import {
  fetchRoutes,
  clearRoutesError,
  fetchTodayJourney,
  saveJourney,
  clearJourneyError,
  fetchDriverCityType,
} from "../../redux/slice/driver/journeySlice.js";

const Journey = () => {
  const { t } = useTranslation();
  const { driver } = useSelector((state) => state.driver);
  const dispatch = useDispatch();
  const [errors, setErrors] = useState({});
  const [isJourneySaved, setIsJourneySaved] = useState(false);
  const [showWeeklyRestriction, setShowWeeklyRestriction] = useState(false);

  const routesFetchedRef = useRef(false);
  const journeyFetchedRef = useRef(false);
  const prevDriverIdRef = useRef(null);

  const { 
    routes, 
    routesStatus, 
    routesError, 
    journeys, 
    journeyStatus, 
    journeyError,
    cityType,
    cityTypeStatus 
  } = useSelector((state) => state.journey);

  const currentDate = useMemo(() => {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }, []);

  const [formData, setFormData] = useState({
    journey_date: currentDate,
    start_sequence: "",
    end_sequence: "",
    route: "",
  });

  // Fetch city type on mount
  useEffect(() => {
    dispatch(fetchDriverCityType());
  }, [dispatch]);

  useEffect(() => {
    if (!routesFetchedRef.current && routesStatus === 'idle') {
      dispatch(fetchRoutes());
      routesFetchedRef.current = true;
    }
  }, [dispatch, routesStatus]);

  useEffect(() => {
    if (!driver?.id) return;

    const driverChanged = prevDriverIdRef.current !== driver.id;
    const shouldFetch = driverChanged || !journeyFetchedRef.current;

    if (shouldFetch) {
      prevDriverIdRef.current = driver.id;
      journeyFetchedRef.current = true;

      dispatch(fetchTodayJourney(driver.id))
        .unwrap()
        .then((data) => {
          setIsJourneySaved(data.length > 0);
        })
        .catch(() => {
          setIsJourneySaved(false);
        });
    }
  }, [dispatch, driver?.id]);

  // Show error toast for city type fetch failure
  useEffect(() => {
    if (cityTypeStatus === 'failed') {
      toast.error(t('failedLoadCityInfo'));
    }
  }, [cityTypeStatus, t]);

  useEffect(() => {
    if (routesError) {
      toast.error(routesError);
      dispatch(clearRoutesError());
    }
    if (journeyError) {
      toast.error(journeyError);
      dispatch(clearJourneyError());
    }
  }, [routesError, journeyError, dispatch]);

  const fieldMap = useMemo(() => ({
    start_sequence: "start_seq",
    end_sequence: "end_seq",
    route: "route_id",
  }), []);

  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    
    setFormData((prev) => {
      if (prev[name] === value) return prev;
      return { ...prev, [name]: value };
    });

    setErrors((prevErrors) => {
      const errorField = fieldMap[name] || name;
      if (!prevErrors[errorField]) return prevErrors;
      const { [errorField]: _, ...rest } = prevErrors;
      return rest;
    });
  }, [fieldMap]);

  const calculatePackages = useCallback((journey) => {
    if (journey.end_seq && journey.start_seq) {
      return journey.end_seq - journey.start_seq + 1;
    }
    return journey.packages || 0;
  }, []);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();

    if (isJourneySaved) return;
    
    setErrors({});
    setShowWeeklyRestriction(false);

    const journeyData = {
      driver_id: driver?.id,
      driver_name: driver?.name || "",
      journey_date: formData.journey_date,
      route_id: formData.route,
      start_seq: formData.start_sequence,
      end_seq: formData.end_sequence,
    };

    try {
      await dispatch(saveJourney(journeyData)).unwrap();
      
      await dispatch(fetchTodayJourney(driver.id)).unwrap();
      
      setIsJourneySaved(true);
      
      toast.success(t('journeySaved'), {
        position: "bottom-center",
        autoClose: 3000,
      });

      setFormData((prev) => ({
        ...prev,
        start_sequence: "",
        end_sequence: "",
        route: "",
      }));
    } catch (err) {
      setIsJourneySaved(false);
      
      if (err.error === 'WEEKLY_CITY_RESTRICTION') {
        console.log('Weekly city restriction detected from backend');
        setShowWeeklyRestriction(true);
        
        dispatch(fetchDriverCityType());
        
        toast.error(err.message || t('weeklyRestriction'), {
          position: "top-center",
          autoClose: 5000,
        });
      } else if (err.errors) {
        setErrors(err.errors);
        if (err.errors['sequenceConflict']) {
          toast.error(err.errors['sequenceConflict']);
        }
      } else {
        toast.error(err.message || t('failedSaveJourney'));
        console.error(err.message || t('failedSaveJourney'));
      }
    }
  }, [formData, driver, dispatch, isJourneySaved, t]);

  const enabledRoutes = useMemo(
    () => routes.filter((route) => route.enabled),
    [routes]
  );

  const isLoadingRoutes = routesStatus === 'loading';
  const isLoadingJourney = journeyStatus === 'loading';

  const journeyRows = useMemo(() => {
    if (journeyStatus !== "succeeded" || !Array.isArray(journeys)) {
      return null;
    }

    return journeys.map((row) => (
      <tr key={row.id || row.journey_date} className="hover:bg-gray-50">
        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
          {driver?.name}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          {row.journey_date}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
          {row.route_name}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
          {row.start_seq}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center text-sm text-gray-500">
          {row.end_seq}
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-center text-sm font-medium text-gray-900">
          {calculatePackages(row)}
        </td>
      </tr>
    ));
  }, [journeys, journeyStatus, driver?.name, calculatePackages]);

  // Loading state
  if (cityTypeStatus === 'loading') {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-poppins flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-600">{t('loading')}</p>
        </div>
      </div>
    );
  }

  // Weekly restriction view
  if (cityType === 'WEEKLY' || showWeeklyRestriction) {
    return (
      <div className="min-h-screen bg-gray-50 text-gray-900 font-poppins">
        <Header />
        <main className="max-w-5xl mx-auto mt-6 mb-24 px-6 pb-36">
          <div className="bg-blue-50 border-2 border-blue-300 rounded-lg p-8 text-center shadow-md">
            <div className="mb-4">
              <svg className="w-20 h-20 mx-auto text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h1 className="text-2xl font-bold text-gray-900 mb-2">{t('journeyDisabled')}</h1>
            <p className="text-gray-700 mb-4">
              {t('weeklyConfigured')}
            </p>
            <p className="text-sm text-gray-600">
              {t('centrallyManaged')}
            </p>
            {showWeeklyRestriction && (
              <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded-md">
                <p className="text-sm text-yellow-800">
                  ⚠️ {t('recentlyUpdated')}
                </p>
              </div>
            )}
          </div>
        </main>
        <Nav />
      </div>
    );
  }

  // Daily city - show normal journey page
  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-poppins">
      <Header />

      <main className="max-w-5xl mx-auto mt-6 mb-24 px-6 pb-36">
        <div className="bg-white border border-gray-200 rounded-lg shadow-sm mb-8">
          <div className="px-6 py-4 border-b border-gray-200">
            <h1 className="text-lg font-semibold text-gray-900">
              {t('startYourJourney')}
            </h1>
          </div>

          <div className="p-6 space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('date')}
              </label>
              <input
                type="date"
                name="journey_date"
                value={formData.journey_date}
                readOnly
                className="w-full px-3 py-2 border border-gray-300 rounded-md bg-gray-100 text-gray-500 cursor-not-allowed focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('startSequence')}
              </label>
              <input
                type="number"
                name="start_sequence"
                value={formData.start_sequence}
                onChange={handleChange}
                disabled={isJourneySaved}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              {errors.start_seq && (
                <p className="text-red-500 text-sm mt-1">{errors.start_seq}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('endSequence')}
              </label>
              <input
                type="number"
                name="end_sequence"
                value={formData.end_sequence}
                onChange={handleChange}
                disabled={isJourneySaved}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              />
              {errors.end_seq && (
                <p className="text-red-500 text-sm mt-1">{errors.end_seq}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {t('route')}
              </label>
              <select
                name="route"
                value={formData.route}
                onChange={handleChange}
                disabled={isJourneySaved || isLoadingRoutes}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">
                  {isLoadingRoutes ? t('loadingRoutes') : t('selectRoute')}
                </option>
                {enabledRoutes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.route}
                  </option>
                ))}
              </select>
              {errors.route_id && (
                <p className="text-red-500 text-sm mt-1">{errors.route_id}</p>
              )}
            </div>

            <button
              onClick={handleSubmit}
              disabled={isJourneySaved || isLoadingJourney}
              className={`w-full py-2 px-4 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors ${
                isJourneySaved || isLoadingJourney
                  ? "bg-gray-400 text-gray-700 cursor-not-allowed"
                  : "bg-blue-600 text-white hover:bg-blue-700"
              }`}
            >
              {isLoadingJourney 
                ? t('saving')
                : isJourneySaved 
                ? t('routeAlreadySaved')
                : t('saveRoute')}
            </button>
          </div>
        </div>

        <div className="bg-white border border-gray-200 rounded-lg shadow-sm">
          <div className="px-6 py-4 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">{t('records')}</h2>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('driver')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('date')}
                  </th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('route')}
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('startSeq')}
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('endSeq')}
                  </th>
                  <th className="px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider">
                    {t('packages')}
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {journeyRows}
              </tbody>
            </table>
            {journeyStatus === 'loading' && (
              <div className="text-center py-8 text-gray-500">
                {t('loadingJourneys')}
              </div>
            )}
            {journeyStatus === 'succeeded' && journeys.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                {t('noJourneysToday')}
              </div>
            )}
          </div>
        </div>
      </main>

      <Nav />
    </div>
  );
};

export default Journey;