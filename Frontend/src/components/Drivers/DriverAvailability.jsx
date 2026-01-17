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
  const [tomorrowDayIndex, setTomorrowDayIndex] = useState(1);

  const daysOfWeek = [
    { key: "monday", label: "Monday", short: "Mon", index: 0 },
    { key: "tuesday", label: "Tuesday", short: "Tue", index: 1 },
    { key: "wednesday", label: "Wednesday", short: "Wed", index: 2 },
    { key: "thursday", label: "Thursday", short: "Thu", index: 3 },
    { key: "friday", label: "Friday", short: "Fri", index: 4 },
    { key: "saturday", label: "Saturday", short: "Sat", index: 5 },
    { key: "sunday", label: "Sunday", short: "Sun", index: 6 }
  ];

  // Update current day, hour, and tomorrow every minute (in CST timezone)
  useEffect(() => {
    const updateCurrentTime = () => {
      const now = new Date();
      
      // Convert to UTC-6 (CST)
      const utcOffset = now.getTimezoneOffset(); // Get current UTC offset in minutes
      const cstOffset = -360; // UTC-6 = -360 minutes
      const cstTime = new Date(now.getTime() + (cstOffset - utcOffset) * 60000);
      
      const dayIndexJS = cstTime.getDay(); // 0 = Sunday, 1 = Monday, etc.
      const hour = cstTime.getHours(); // 0-23
      
      // Convert to Monday-based week (Monday = 0, Sunday = 6)
      const dayIndex = dayIndexJS === 0 ? 6 : dayIndexJS - 1;
      
      setCurrentDayIndex(dayIndex);
      setCurrentHour(hour);
      setTomorrowDayIndex((dayIndex + 1) % 7);
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
    // Today is ALWAYS locked
    if (dayIndex === currentDayIndex) {
      return true;
    }
    
    // Tomorrow is locked ONLY after 7 PM today
    if (dayIndex === tomorrowDayIndex && currentHour >= 19) {
      return true;
    }
    
    // Past days are locked
    if (dayIndex < currentDayIndex) {
      return true;
    }
    
    return false;
  };

  const getLockReason = (dayIndex) => {
    if (dayIndex === currentDayIndex) {
      return "today";
    }
    
    if (dayIndex === tomorrowDayIndex && currentHour >= 19) {
      return "tomorrow_after_7pm";
    }
    
    if (dayIndex < currentDayIndex) {
      return "past";
    }
    
    return null;
  };

  const handleToggle = (day, dayIndex) => {
    if (isDayLocked(dayIndex)) {
      const dayName = daysOfWeek.find(d => d.index === dayIndex)?.label || day;
      const lockReason = getLockReason(dayIndex);
      
      if (lockReason === "today") {
        toast.error(`Cannot update today's availability. You can update availability starting from tomorrow (before 7 PM) or the day after tomorrow.`);
      } else if (lockReason === "tomorrow_after_7pm") {
        toast.error(`Cannot update tomorrow's availability after 7:00 PM CST. The cutoff time has passed.`);
      } else if (lockReason === "past") {
        toast.error(`Cannot update ${dayName}. That day has already passed.`);
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

  const getTomorrowDayName = () => {
    return daysOfWeek.find(d => d.index === tomorrowDayIndex)?.label || '';
  };

  return (
    <>
      <Header title="My Availability" />
      <div className="min-h-screen bg-gray-50 pb-20">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8">
          {loading && !driverAvailability ? (
            <div className="flex items-center justify-center h-64">
              <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent"></div>
            </div>
          ) : (
            <>
              {/* Summary Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
                <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg shadow-lg p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-blue-100 text-sm font-medium">Available Days</p>
                      <p className="text-3xl font-bold mt-1">{getAvailableDaysCount()}</p>
                      <p className="text-blue-100 text-xs mt-1">out of 7 days</p>
                    </div>
                    <svg className="w-12 h-12 text-blue-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-lg shadow-lg p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-green-100 text-sm font-medium">Current Day</p>
                      <p className="text-2xl font-bold mt-1">{getCurrentDayName()}</p>
                      <p className="text-green-100 text-xs mt-1">CST Timezone</p>
                    </div>
                    <svg className="w-12 h-12 text-green-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>

                <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-lg shadow-lg p-5 text-white">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-purple-100 text-sm font-medium">Last Updated</p>
                      <p className="text-sm font-semibold mt-1">{formatDate(updatedAt)}</p>
                    </div>
                    <svg className="w-12 h-12 text-purple-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                </div>
              </div>

              {/* Days Grid */}
              <div className="space-y-3 mb-6">
                {daysOfWeek.map(({ key, label, short, index }) => {
                  const isCurrentDay = index === currentDayIndex;
                  const isTomorrow = index === tomorrowDayIndex;
                  const isLocked = isDayLocked(index);
                  const lockReason = getLockReason(index);

                  return (
                    <div
                      key={key}
                      className={`bg-white rounded-lg shadow-sm p-4 sm:p-5 transition-all duration-200 border-2 ${
                        isCurrentDay
                          ? 'border-blue-500 bg-blue-50/30'
                          : isTomorrow
                          ? 'border-yellow-500 bg-yellow-50/30'
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
                              : isTomorrow
                              ? 'bg-yellow-100 text-yellow-700 ring-2 ring-yellow-300'
                              : isLocked
                              ? 'bg-gray-100 text-gray-500'
                              : availability[key]
                              ? 'bg-green-100 text-green-700'
                              : 'bg-gray-100 text-gray-600'
                          }`}>
                            {short.toUpperCase()}
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className="text-base font-semibold text-gray-900">
                                {label}
                              </div>
                              {isCurrentDay && (
                                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800">
                                  Today - Locked
                                </span>
                              )}
                              {isTomorrow && (
                                currentHour >= 19 ? (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">
                                    Tomorrow - Locked (After 7 PM)
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-800">
                                    Tomorrow - Editable (Before 7 PM)
                                  </span>
                                )
                              )}
                              {isLocked && !isCurrentDay && !isTomorrow && (
                                <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">
                                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                                    <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                  </svg>
                                  {lockReason === "past" ? " Past" : " Locked"}
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
                      <li>• <strong>⚠️ Today ({getCurrentDayName()}) is ALWAYS LOCKED</strong></li>
                      <li>• <strong>⏰ Tomorrow ({getTomorrowDayName()}) locks at 7:00 PM CST today</strong></li>
                      <li>• <strong>✅ You can update from the day after tomorrow onwards anytime</strong></li>
                      <li>• <strong>Past days are locked and cannot be changed</strong></li>
                      <li>• <strong>Week runs Monday to Sunday, resets every Sunday at 12:00 PM CST</strong></li>
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