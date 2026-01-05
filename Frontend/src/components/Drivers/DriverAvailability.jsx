import { useEffect, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  getDriverAvailability,
  updateDriverAvailability,
  clearMessages
} from "../../redux/slice/driver/availabilitySlice.js";
import { toast } from "react-toastify";

import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";

export default function DriverAvailability() {
  const dispatch = useDispatch();

  const {
    driverAvailability,
    updatedAt,
    loading,
    error,
    successMessage
  } = useSelector((state) => state.availability);

  const [availability, setAvailability] = useState({
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false
  });

  const [hasChanges, setHasChanges] = useState(false);
  const [isAfterCutoff, setIsAfterCutoff] = useState(false);

  const daysOfWeek = [
    { key: "monday", label: "Monday", short: "Mon" },
    { key: "tuesday", label: "Tuesday", short: "Tue" },
    { key: "wednesday", label: "Wednesday", short: "Wed" },
    { key: "thursday", label: "Thursday", short: "Thu" },
    { key: "friday", label: "Friday", short: "Fri" },
    { key: "saturday", label: "Saturday", short: "Sat" },
    { key: "sunday", label: "Sunday", short: "Sun" }
  ];

  // Check if current time is after 7:30 PM
  useEffect(() => {
    const checkTime = () => {
      const now = new Date();
      const hours = now.getHours();
      const minutes = now.getMinutes();
      const currentTimeInMinutes = hours * 60 + minutes;
      const cutoffTimeInMinutes = 19 * 60 + 30; // 7:30 PM

      setIsAfterCutoff(currentTimeInMinutes >= cutoffTimeInMinutes);
    };

    checkTime();
    const interval = setInterval(checkTime, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    dispatch(getDriverAvailability());
  }, [dispatch]);

  useEffect(() => {
    if (driverAvailability) {
      setAvailability(driverAvailability);
    }
  }, [driverAvailability]);

  useEffect(() => {
    if (successMessage) {
      toast.success(successMessage);
      dispatch(clearMessages());
      setHasChanges(false);
    }

    if (error) {
      toast.error(error);
      dispatch(clearMessages());
    }
  }, [successMessage, error, dispatch]);

  const handleToggle = (day) => {
    if (isAfterCutoff) {
      toast.error("Cannot update availability after 7:30 PM");
      return;
    }

    setAvailability((prev) => ({
      ...prev,
      [day]: !prev[day]
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
    if (isAfterCutoff) {
      toast.error("Cannot save availability after 7:30 PM");
      return;
    }
    dispatch(updateDriverAvailability(availability));
  };

  const handleReset = () => {
    setAvailability(driverAvailability);
    setHasChanges(false);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "Never updated";
    return new Date(dateString).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const getAvailableDaysCount = () => {
    return Object.values(availability).filter(Boolean).length;
  };

  return (
    <>
      <Header />

      <div className="min-h-screen bg-gray-50 p-3 sm:p-4 md:p-6 pb-32">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 sm:gap-0">
              <div className="flex-1">
                <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
                  My Weekly Availability
                </h1>
                <p className="text-xs sm:text-sm text-gray-600 mt-1">
                  Set your weekly availability schedule
                </p>
                {updatedAt && (
                  <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                    <svg className="w-3 h-3 sm:w-4 sm:h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="hidden xs:inline">Last updated: {formatDate(updatedAt)}</span>
                    <span className="xs:hidden">{formatDate(updatedAt)}</span>
                  </p>
                )}
              </div>

              <div className="text-center sm:text-right">
                <div className="text-2xl sm:text-3xl font-bold text-blue-600">
                  {getAvailableDaysCount()}/7
                </div>
                <div className="text-xs text-gray-600 mt-1">Days Available</div>
              </div>
            </div>
          </div>

          {/* Time Restriction Warning */}
          {isAfterCutoff && (
            <div className="bg-red-50 border border-red-200 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6">
              <div className="flex items-start gap-2 sm:gap-3">
                <svg className="w-5 h-5 sm:w-6 sm:h-6 text-red-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <div>
                  <p className="text-xs sm:text-sm font-semibold text-red-900">Availability Update Locked</p>
                  <p className="text-xs text-red-700 mt-1">
                    You cannot update your availability after 7:30 PM. Please come back tomorrow before 7:30 PM to make changes.
                  </p>
                </div>
              </div>
            </div>
          )}

          {loading && (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 sm:p-12">
              <div className="flex flex-col items-center justify-center">
                <div className="animate-spin rounded-full h-10 w-10 sm:h-12 sm:w-12 border-4 border-blue-500 border-t-transparent"></div>
                <p className="mt-4 text-sm text-gray-600">Loading availability...</p>
              </div>
            </div>
          )}

          {!loading && (
            <>
              {/* Desktop Table View */}
              <div className="hidden md:block bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden mb-6">
                <table className="w-full">
                  <thead>
                    <tr className="bg-gradient-to-r from-gray-50 to-gray-100 border-b-2 border-gray-200">
                      <th className="px-6 py-4 text-left text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Day
                      </th>
                      <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Status
                      </th>
                      <th className="px-6 py-4 text-center text-xs font-bold text-gray-700 uppercase tracking-wider">
                        Availability
                      </th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-gray-200">
                    {daysOfWeek.map(({ key, label }, index) => (
                      <tr
                        key={key}
                        className={`hover:bg-blue-50 transition-colors ${
                          index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                        } ${availability[key] ? 'border-l-4 border-green-500' : ''}`}
                      >
                        <td className="px-6 py-5 whitespace-nowrap">
                          <div className="flex items-center">
                            <div className={`flex-shrink-0 h-10 w-10 rounded-lg flex items-center justify-center font-bold ${
                              availability[key]
                                ? 'bg-green-100 text-green-700'
                                : 'bg-gray-100 text-gray-600'
                            }`}>
                              {label.substring(0, 3).toUpperCase()}
                            </div>
                            <div className="ml-4">
                              <div className="text-base font-semibold text-gray-900">
                                {label}
                              </div>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-5 whitespace-nowrap text-center">
                          {availability[key] ? (
                            <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-green-100 text-green-700">
                              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                              </svg>
                              Available
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-3 py-1.5 rounded-full text-sm font-semibold bg-red-100 text-red-700">
                              <svg className="w-4 h-4 mr-1.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              Unavailable
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-5 whitespace-nowrap text-center">
                          <button
                            onClick={() => handleToggle(key)}
                            disabled={isAfterCutoff}
                            className={`relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
                              isAfterCutoff
                                ? 'opacity-50 cursor-not-allowed bg-gray-300'
                                : availability[key]
                                ? 'bg-green-500'
                                : 'bg-gray-300'
                            }`}
                          >
                            <span
                              className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${
                                availability[key]
                                  ? 'translate-x-9'
                                  : 'translate-x-1'
                              }`}
                            />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Mobile Card View */}
              <div className="md:hidden space-y-3 mb-4">
                {daysOfWeek.map(({ key, label, short }) => (
                  <div
                    key={key}
                    className={`bg-white rounded-lg shadow-sm border-2 p-4 transition-all ${
                      availability[key] 
                        ? 'border-green-500 bg-green-50/30' 
                        : 'border-gray-200'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3 flex-1">
                        <div className={`flex-shrink-0 h-12 w-12 rounded-lg flex items-center justify-center font-bold text-sm ${
                          availability[key]
                            ? 'bg-green-100 text-green-700'
                            : 'bg-gray-100 text-gray-600'
                        }`}>
                          {short.toUpperCase()}
                        </div>
                        <div className="flex-1">
                          <div className="text-base font-semibold text-gray-900">
                            {label}
                          </div>
                          <div className="mt-1">
                            {availability[key] ? (
                              <span className="inline-flex items-center text-xs font-semibold text-green-700">
                                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                                </svg>
                                Available
                              </span>
                            ) : (
                              <span className="inline-flex items-center text-xs font-semibold text-red-700">
                                <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                                </svg>
                                Unavailable
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        onClick={() => handleToggle(key)}
                        disabled={isAfterCutoff}
                        className={`relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                          isAfterCutoff
                            ? 'opacity-50 cursor-not-allowed bg-gray-300'
                            : availability[key]
                            ? 'bg-green-500'
                            : 'bg-gray-300'
                        }`}
                      >
                        <span
                          className={`inline-block h-6 w-6 transform rounded-full bg-white shadow-lg transition-transform duration-300 ${
                            availability[key]
                              ? 'translate-x-9'
                              : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Action Buttons */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6">
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || loading || isAfterCutoff}
                    className={`flex-1 py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 text-sm sm:text-base ${
                      hasChanges && !loading && !isAfterCutoff
                        ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-lg hover:shadow-xl active:scale-95'
                        : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                    }`}
                  >
                    {loading ? (
                      <>
                        <div className="animate-spin rounded-full h-4 w-4 sm:h-5 sm:w-5 border-2 border-white border-t-transparent"></div>
                        <span>Saving...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleReset}
                    disabled={!hasChanges || loading}
                    className={`flex-1 py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 text-sm sm:text-base ${
                      hasChanges && !loading
                        ? 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-gray-300 active:scale-95'
                        : 'bg-gray-50 text-gray-400 cursor-not-allowed border border-gray-200'
                    }`}
                  >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    <span>Reset</span>
                  </button>
                </div>

                {hasChanges && !isAfterCutoff && (
                  <div className="mt-4 p-3 sm:p-4 bg-amber-50 border border-amber-200 rounded-lg">
                    <div className="flex items-start gap-2 sm:gap-3">
                      <svg className="w-4 h-4 sm:w-5 sm:h-5 text-amber-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <div>
                        <p className="text-xs sm:text-sm font-semibold text-amber-900">Unsaved Changes</p>
                        <p className="text-xs text-amber-700 mt-1">Don't forget to save your availability changes before leaving this page</p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Info Box */}
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 sm:p-6">
                <div className="flex items-start gap-3 sm:gap-4">
                  <div className="flex-shrink-0">
                    <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-xs sm:text-sm font-semibold text-blue-900 mb-2">Important Information</h3>
                    <ul className="text-xs sm:text-sm text-blue-800 space-y-1">
                      <li>• Use the toggle switches to mark your availability</li>
                      <li>• Green = available, Red = unavailable</li>
                      <li>• Your availability helps with shift scheduling</li>
                      <li>• <strong>Updates locked after 7:30 PM daily</strong></li>
                      <li>• <strong>Resets every Monday at 12:00 AM</strong></li>
                    </ul>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
      <div className="h-24" />
      <Nav />
    </>
  );
}