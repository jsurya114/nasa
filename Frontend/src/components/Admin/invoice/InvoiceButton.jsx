import { Suspense, lazy, useState } from "react";
import { FileText } from "lucide-react";

// The dialog (and, behind it, the PDF library and fonts) is only fetched when someone asks for an invoice.
const InvoiceDialog = lazy(() => import("./InvoiceDialog.jsx"));

// "Create invoice": fill in a short form and download NASA's invoice as a PDF. Nothing is stored (see InvoiceDialog).
export default function InvoiceButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="ui-btn ui-btn-primary" data-testid="create-invoice">
        <FileText className="h-4 w-4" aria-hidden="true" /> Create invoice
      </button>
      {open && (
        <Suspense fallback={null}>
          <InvoiceDialog onClose={() => setOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
