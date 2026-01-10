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
  const [currentDayIndex, setCurrentDayIndex] = useState(0);
  const [currentHour, setCurrentHour] = useState(0);

  const daysOfWeek = [
    { key: "sunday", label: "Sunday", short: "Sun", index: 0 },
    { key: "monday", label: "Monday", short: "Mon", index: 1 },
    { key: "tuesday", label: "Tuesday", short: "Tue", index: 2 },
    { key: "wednesday", label: "Wednesday", short: "Wed", index: 3 },
    { key: "thursday", label: "Thursday", short: "Thu", index: 4 },
    { key: "friday", label: "Friday", short: "Fri", index: 5 },
    { key: "saturday", label: "Saturday", short: "Sat", index: 6 }
  ];

  // Update current day and hour every minute
  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      const dayIndex = now.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const hour = now.getHours(); // 0-23
      setCurrentDayIndex(dayIndex);
      setCurrentHour(hour);
    };

    updateCurrentTime();
    const interval = setInterval(updateCurrentTime, 60000); // Check every minute
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

  const isDayLocked = (dayIndex) => {
    // Days before current day are locked (they've already ended)
    if (dayIndex < currentDayIndex) {
      return true;
    }
    
    // NEW: Today is locked after 7 PM
    if (dayIndex === currentDayIndex && currentHour >= 19) {
      return true;
    }
    
    // NEW: Next day is locked after 7 PM today
    const nextDayIndex = (currentDayIndex + 1) % 7;
    if (dayIndex === nextDayIndex && currentHour >= 19) {
      return true;
    }
    
    return false;
  };

  const getLockReason = (dayIndex) => {
    const nextDayIndex = (currentDayIndex + 1) % 7;
    
    if (dayIndex < currentDayIndex) {
      return "past";
    }
    
    if (dayIndex === currentDayIndex && currentHour >= 19) {
      return "today_cutoff";
    }
    
    if (dayIndex === nextDayIndex && currentHour >= 19) {
      return "tomorrow_cutoff";
    }
    
    return null;
  };

  const handleToggle = (day, dayIndex) => {
    if (isDayLocked(dayIndex)) {
      const dayName = daysOfWeek.find(d => d.index === dayIndex)?.label || day;
      const lockReason = getLockReason(dayIndex);
      
      if (lockReason === "past") {
        toast.error(`Cannot update ${dayName}. That day has already ended. You can only update today and future days.`);
      } else if (lockReason === "today_cutoff") {
        toast.error(`Cannot update today's availability after 7:00 PM.`);
      } else if (lockReason === "tomorrow_cutoff") {
        toast.error(`Cannot update ${dayName}. The 7:00 PM cutoff has passed for tomorrow's availability.`);
      }
      return;
    }

    setAvailability((prev) => ({
      ...prev,
      [day]: !prev[day]
    }));
    setHasChanges(true);
  };

  const handleSave = () => {
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

  const getCurrentDayName = () => {
    return daysOfWeek.find(d => d.index === currentDayIndex)?.label || '';
  };

  const getLockedDaysCount = () => {
    return daysOfWeek.filter(d => isDayLocked(d.index)).length;
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

          {/* Current Day Info with 7 PM Warning */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6">
            <div className="flex items-start gap-2 sm:gap-3">
              <svg className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="flex-1">
                <div className="text-xs sm:text-sm font-semibold text-blue-900 mb-1">
                  Today is {getCurrentDayName()}
                </div>
                <div className="text-xs text-blue-800">
                  Current time: {new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                </div>
                {currentHour >= 19 && (
                  <div className="mt-2 p-2 bg-amber-100 border border-amber-300 rounded text-xs text-amber-900">
                    <strong>⏰ 7:00 PM Cutoff:</strong> You can no longer edit today's or tomorrow's availability.
                  </div>
                )}
                {currentHour < 19 && (
                  <div className="mt-2 text-xs text-blue-700">
                    ⏰ Remember: Today's and tomorrow's availability lock at 7:00 PM today
                  </div>
                )}
              </div>
            </div>
          </div>

          {loading && !hasChanges ? (
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8 text-center">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mx-auto"></div>
              <p className="mt-4 text-gray-600">Loading availability...</p>
            </div>
          ) : (
            <>
              {/* Availability Cards */}
              <div className="space-y-3 sm:space-y-4 mb-4 sm:mb-6">
                {daysOfWeek.map(({ key, label, short, index }) => {
                  const isCurrentDay = index === currentDayIndex;
                  const isLocked = isDayLocked(index);
                  const lockReason = getLockReason(index);

                  return (
                    <div
                      key={key}
                      className={`bg-white rounded-lg shadow-sm p-4 sm:p-5 transition-all duration-200 border-2 ${
                        isCurrentDay
                          ? 'border-blue-500 bg-blue-50/30'
                          : isLocked
                          ? 'border-gray-200 opacity-60'
                          : availability[key] 
                          ? 'border-green-500 bg-green-50/30' 
                          : 'border-gray-200'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3 flex-1">
                          <div className={`flex-shrink-0 h-12 w-12 rounded-lg flex items-center justify-center font-bold text-sm ${
                            isCurrentDay
                              ? 'bg-blue-100 text-blue-700 ring-2 ring-blue-300'
                              : isLocked
                              ? 'bg-gray-100 text-gray-500'
                              : availability[key]
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {short.toUpperCase()}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <div className="text-base font-semibold text-gray-900">
                                {label}
                              </div>
                              {isCurrentDay && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                  Today
                                </span>
                              )}
                              {isLocked && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                  </svg>
                                  {lockReason === "cutoff" ? " After 7PM" : " Past"}
                                </span>
                              )}
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
                          onClick={() => handleToggle(key, index)}
                          disabled={isLocked}
                          className={`relative inline-flex h-8 w-16 items-center rounded-full transition-all duration-300 focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                            isLocked
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
                  );
                })}
              </div>

              {/* Action Buttons */}
              <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6 mb-4 sm:mb-6">
                <div className="flex flex-col sm:flex-row gap-3">
                  <button
                    onClick={handleSave}
                    disabled={!hasChanges || loading}
                    className={`flex-1 py-2.5 sm:py-3 px-4 sm:px-6 rounded-lg font-semibold transition-all flex items-center justify-center gap-2 text-sm sm:text-base ${
                      hasChanges && !loading
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

                {hasChanges && (
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
                      <li>• Green = available, Gray = unavailable</li>
                      <li>• Your availability helps with shift scheduling</li>
                      <li>• <strong>You can update future days anytime before 7:00 PM</strong></li>
                      <li>• <strong>⏰ Today's and tomorrow's availability lock at 7:00 PM</strong></li>
                      <li>• <strong>Past days are locked and cannot be changed</strong></li>
                      <li>• <strong>Resets every Sunday at 12:00 PM (noon)</strong></li>
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