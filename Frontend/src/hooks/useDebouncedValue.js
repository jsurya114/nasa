import { useEffect, useState } from "react";

// The value, but only after it has stopped changing for `delay` ms. Used so a search filters once the admin pauses typing,
// not on every key.
export default function useDebouncedValue(value, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}
