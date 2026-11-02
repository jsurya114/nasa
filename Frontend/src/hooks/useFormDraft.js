import { useEffect, useRef } from "react";
import { clearDraft, readDraft, writeDraft } from "../utils/formDrafts";

// Keeps what a person has typed in a form (plain text fields only). On first use for a signed-in person the saved draft
// is handed to `onRestore` once; after that every change is saved. `saved` true (the form was submitted) removes the
// draft. Nothing happens until the person's id is known.
export default function useFormDraft({ area, userId, form, values, onRestore, saved = false }) {
  const restored = useRef(null);
  const restoreRef = useRef(onRestore);
  restoreRef.current = onRestore;

  useEffect(() => {
    if (!userId || saved) return;
    const identity = `${area}.${userId}.${form}`;
    if (restored.current === identity) return;
    restored.current = identity;
    const draft = readDraft(area, userId, form);
    if (draft) restoreRef.current(draft);
  }, [area, userId, form, saved]);

  const serialized = JSON.stringify(values);
  useEffect(() => {
    if (!userId) return;
    // Until the first restore has run, the form is still empty and must not erase the saved draft
    if (restored.current !== `${area}.${userId}.${form}`) return;
    if (saved) clearDraft(area, userId, form);
    else writeDraft(area, userId, form, JSON.parse(serialized));
  }, [area, userId, form, serialized, saved]);
}
