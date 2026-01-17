/**
 * Timezone-Aware Availability Utilities
 * 
 * This module provides timezone-aware date/time calculations for driver availability.
 * All logic uses the user's local timezone to ensure consistent behavior globally.
 */

/**
 * Get the current day and time in the user's timezone
 * @param {string} timezone - IANA timezone string (e.g., 'America/Chicago', 'Asia/Kolkata')
 * @returns {Object} - { dayIndex: 0-6 (Mon-Sun), dayName: string, hour: 0-23, date: Date }
 */
export const getCurrentTimeInTimezone = (timezone) => {
  const now = new Date();
  
  // Get localized time in the user's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    hour: 'numeric',
    hour12: false,
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  });
  
  const parts = formatter.formatToParts(now);
  const weekday = parts.find(p => p.type === 'weekday').value.toLowerCase();
  const hour = parseInt(parts.find(p => p.type === 'hour').value, 10);
  
  // Map JavaScript day (Sunday=0) to our system (Monday=0)
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const dayIndex = dayNames.indexOf(weekday);
  
  return {
    dayIndex,
    dayName: weekday,
    hour,
    date: now,
    timezone
  };
};

/**
 * Calculate which days should be locked based on current time
 * @param {string} timezone - User's IANA timezone
 * @returns {Object} - Object with day names as keys and lock status as boolean values
 */
export const calculateDayLockStatus = (timezone) => {
  const { dayIndex, hour } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  const lockStatus = {};
  
  dayNames.forEach((day, index) => {
    // Past days: Always locked
    if (index < dayIndex) {
      lockStatus[day] = true;
    }
    // Current day: Always locked
    else if (index === dayIndex) {
      lockStatus[day] = true;
    }
    // Next day: Locked if current time >= 7 PM (19:00)
    else if (index === (dayIndex + 1) % 7) {
      lockStatus[day] = hour >= 19;
    }
    // Future days: Never locked
    else {
      lockStatus[day] = false;
    }
  });
  
  return lockStatus;
};

/**
 * Validate if a specific day can be modified given current time
 * @param {string} dayToUpdate - Day name to update
 * @param {string} timezone - User's IANA timezone
 * @returns {Object} - { canUpdate: boolean, reason: string }
 */
export const canUpdateDay = (dayToUpdate, timezone) => {
  const { dayIndex, dayName, hour } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  const targetDayIndex = dayNames.indexOf(dayToUpdate.toLowerCase());
  
  if (targetDayIndex === -1) {
    return { canUpdate: false, reason: 'Invalid day specified' };
  }
  
  // Past days
  if (targetDayIndex < dayIndex) {
    return {
      canUpdate: false,
      reason: `Cannot update availability for ${dayToUpdate}. That day has already ended. You can only update availability for future days.`
    };
  }
  
  // Current day
  if (targetDayIndex === dayIndex) {
    return {
      canUpdate: false,
      reason: `Cannot update availability for today (${dayName}). You can only update availability for future days.`
    };
  }
  
  // Next day after 7 PM cutoff
  const nextDayIndex = (dayIndex + 1) % 7;
  if (targetDayIndex === nextDayIndex && hour >= 19) {
    return {
      canUpdate: false,
      reason: `Cannot modify availability for ${dayToUpdate} after 7:00 PM. The cutoff time has passed.`
    };
  }
  
  // Future days are always allowed
  return { canUpdate: true, reason: null };
};

/**
 * Validate all days in an availability object
 * @param {Object} availability - Availability object with day keys
 * @param {Object} currentAvailability - Current availability from database
 * @param {string} timezone - User's IANA timezone
 * @returns {Object} - { isValid: boolean, errors: Array<string> }
 */
export const validateAvailabilityUpdate = (availability, currentAvailability, timezone) => {
  const { dayIndex, dayName, hour } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const errors = [];
  
  const nextDayIndex = (dayIndex + 1) % 7;
  const nextDayName = dayNames[nextDayIndex];
  
  for (const day of dayNames) {
    const targetDayIndex = dayNames.indexOf(day);
    
    // Skip if value hasn't changed
    if (availability[day] === currentAvailability.availability[day]) {
      continue;
    }
    
    // Past days
    if (targetDayIndex < dayIndex) {
      errors.push(`Cannot modify availability for ${day}. That day has already ended.`);
    }
    
    // Current day
    else if (targetDayIndex === dayIndex) {
      errors.push(`Cannot modify today's (${dayName}) availability.`);
    }
    
    // Next day after 7 PM
    else if (targetDayIndex === nextDayIndex && hour >= 19) {
      errors.push(`Cannot modify availability for ${nextDayName} after 7:00 PM. The cutoff time has passed.`);
    }
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Calculate the next Sunday 12:00 PM in a given timezone
 * Used for scheduling weekly resets
 * @param {string} timezone - IANA timezone
 * @returns {Date} - Next Sunday at 12:00 PM in that timezone
 */
export const getNextSundayNoon = (timezone) => {
  const now = new Date();
  
  // Create a date formatter for the target timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hour12: false
  });
  
  // Find next Sunday
  const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const parts = formatter.formatToParts(now);
  const currentDay = parts.find(p => p.type === 'weekday').value.toLowerCase();
  const currentDayIndex = daysOfWeek.indexOf(currentDay);
  
  // Calculate days until next Sunday (0 = today is Sunday, need next week)
  const daysUntilSunday = currentDayIndex === 0 ? 7 : (7 - currentDayIndex);
  
  // Create next Sunday at noon in local time
  const nextSunday = new Date(now);
  nextSunday.setDate(now.getDate() + daysUntilSunday);
  
  // Convert to target timezone noon
  const year = parseInt(parts.find(p => p.type === 'year').value);
  const month = parseInt(parts.find(p => p.type === 'month').value) - 1;
  const day = parseInt(parts.find(p => p.type === 'day').value) + daysUntilSunday;
  
  const noonInTimezone = new Date(year, month, day, 12, 0, 0);
  
  return noonInTimezone;
};

/**
 * Format a date/time for logging purposes
 * @param {Date} date - Date object
 * @param {string} timezone - IANA timezone
 * @returns {string} - Formatted string
 */
export const formatDateForTimezone = (date, timezone) => {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true
  }).format(date);
};