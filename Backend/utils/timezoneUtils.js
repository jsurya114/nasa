/**
 * Timezone-Aware Availability Utilities
 * FIXED VERSION - Handles driver and admin permissions correctly
 */

/**
 * Get the current day and time in the user's timezone
 */
export const getCurrentTimeInTimezone = (timezone) => {
  const now = new Date();
  
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
 * Calculate which days should be locked based on current time (DRIVER ONLY)
 * Editing restrictions for past/current days
 */
export const calculateDayLockStatus = (timezone) => {
  const { dayIndex, hour } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  const lockStatus = {};
  
  dayNames.forEach((day, index) => {
    // Past days are locked
    if (index < dayIndex) {
      lockStatus[day] = true;
    } 
    // Current day is always locked
    else if (index === dayIndex) {
      lockStatus[day] = true;
    } 
    // Tomorrow is locked after 7 PM today
    else if (index === (dayIndex + 1) % 7) {
      lockStatus[day] = hour >= 19;
    } 
    // Future days are unlocked
    else {
      lockStatus[day] = false;
    }
  });
  
  return lockStatus;
};

/**
 * Validate if a specific day can be modified given current time (DRIVER ONLY)
 * FIXED: Handles Sunday correctly - allows editing next week's days
 */
export const canUpdateDay = (dayToUpdate, timezone) => {
  const { dayIndex, dayName, hour } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  
  const targetDayIndex = dayNames.indexOf(dayToUpdate.toLowerCase());
  
  if (targetDayIndex === -1) {
    return { canUpdate: false, reason: 'Invalid day specified' };
  }
  
  // Special case: If today is Sunday (index 6)
  if (dayIndex === 6) {
    // Cannot update Sunday itself (today)
    if (targetDayIndex === 6) {
      return {
        canUpdate: false,
        reason: `Cannot update today's (Sunday) availability.`
      };
    }
    
    // Monday (next week's first day) locked after 7 PM on Sunday
    if (targetDayIndex === 0 && hour >= 19) {
      return {
        canUpdate: false,
        reason: `Cannot modify availability for Monday after 7:00 PM on Sunday. The cutoff time has passed.`
      };
    }
    
    // Tuesday-Saturday (next week) are all unlocked
    return { canUpdate: true, reason: null };
  }
  
  // For Monday-Saturday (regular week logic):
  // Cannot update past days
  if (targetDayIndex < dayIndex) {
    return {
      canUpdate: false,
      reason: `Cannot update availability for ${dayToUpdate}. That day has already ended. You can only update availability for future days.`
    };
  }
  
  // Cannot update today
  if (targetDayIndex === dayIndex) {
    return {
      canUpdate: false,
      reason: `Cannot update availability for today (${dayName}). You can only update availability for future days.`
    };
  }
  
  // Cannot update tomorrow after 7 PM
  const nextDayIndex = (dayIndex + 1) % 7;
  if (targetDayIndex === nextDayIndex && hour >= 19) {
    return {
      canUpdate: false,
      reason: `Cannot modify availability for ${dayToUpdate} after 7:00 PM. The cutoff time has passed.`
    };
  }
  
  return { canUpdate: true, reason: null };
};

/**
 * Validate all days in an availability object (DRIVER ONLY)
 * Only checks editing restrictions (past/today/tomorrow after 7pm)
 * NO Sunday noon restriction since auto-reset handles the reset
 */
export const validateAvailabilityUpdate = (availability, currentAvailability, timezone) => {
  const { dayIndex, dayName, hour } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const errors = [];
  
  const nextDayIndex = (dayIndex + 1) % 7;
  const nextDayName = dayNames[nextDayIndex];
  
  for (const day of dayNames) {
    const targetDayIndex = dayNames.indexOf(day);
    
    // Skip if no change
    if (availability[day] === currentAvailability.availability[day]) {
      continue;
    }
    
    // Cannot modify past days
    if (targetDayIndex < dayIndex) {
      errors.push(`Cannot modify availability for ${day}. That day has already ended.`);
    } 
    // Cannot modify today
    else if (targetDayIndex === dayIndex) {
      errors.push(`Cannot modify today's (${dayName}) availability.`);
    } 
    // Cannot modify tomorrow after 7 PM
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
 * NEW: Admin validation - much more permissive
 * Admins can edit any day except days that have already passed
 * Admins CAN edit:
 * - Current day (today)
 * - Tomorrow (even after 7 PM)
 * - All future days
 */
export const validateAdminAvailabilityUpdate = (availability, currentAvailability, timezone) => {
  const { dayIndex } = getCurrentTimeInTimezone(timezone);
  const dayNames = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
  const errors = [];
  
  for (const day of dayNames) {
    const targetDayIndex = dayNames.indexOf(day);
    
    // Skip if no change
    if (availability[day] === currentAvailability.availability[day]) {
      continue;
    }
    
    // Admins can only NOT modify past days (days before today)
    if (targetDayIndex < dayIndex) {
      errors.push(`Cannot modify availability for ${day}. That day has already ended. You can only update today and future days.`);
    }
    // Admins CAN modify today and all future days - no other restrictions
  }
  
  return {
    isValid: errors.length === 0,
    errors
  };
};

/**
 * Format a date/time for logging purposes
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