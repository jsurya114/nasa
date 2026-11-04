import { useEffect, useRef, useState } from "react";
import { useSelector } from "react-redux";
import { readView, removeView, writeView } from "../utils/viewState";

const SAME = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const userIdOf = (state, area) => (area === "admin" ? state.admin?.admin?.id : state.driver?.driver?.id);

// Works like useState, but the value is kept while the person is signed in: leave the page, come back, and it is as it was.
// area: "admin" or "driver". page and name say where it belongs (for example "dashboard", "filters"). Only plain JSON values.
// A value equal to the starting value is not stored at all. Until the person's id is known, nothing is read or written.
// ignoreSaved: start from `initial` even if something is saved (for example when a link has just chosen the value); the new value is then kept.
export default function usePersistentState(area, page, name, initial, { ignoreSaved = false } = {}) {
  const userId = useSelector((state) => userIdOf(state, area));
  const start = useRef(typeof initial === "function" ? initial() : initial);
  const restored = useRef(false);
  const [value, setValue] = useState(() => {
    if (userId) {
      restored.current = true;
      const saved = ignoreSaved ? undefined : readView(area, userId, page, name);
      if (saved !== undefined) return saved;
    }
    return start.current;
  });

  // The id can arrive after the first render; then the saved value is read once.
  useEffect(() => {
    if (!userId || restored.current) return;
    restored.current = true;
    const saved = ignoreSaved ? undefined : readView(area, userId, page, name);
    if (saved !== undefined) setValue(saved);
  }, [area, userId, page, name, ignoreSaved]);

  useEffect(() => {
    if (!userId || !restored.current) return;
    if (SAME(value, start.current)) removeView(area, userId, page, name);
    else writeView(area, userId, page, name, value);
  }, [area, userId, page, name, value]);

  return [value, setValue];
}
