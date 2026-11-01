import Swal from "sweetalert2";

/*
 * Themed confirmation dialog, built on SweetAlert2 (already used by the app).
 * Replaces the browser's plain confirm box with one that matches the app, works with the
 * keyboard (Escape cancels, focus starts on the safe choice) and fits small screens.
 * Resolves to true only when the person confirms.
 */
const DIALOG_CLASSES = {
  container: "ui-dialog-backdrop",
  popup: "ui-dialog",
  title: "ui-dialog-title",
  htmlContainer: "ui-dialog-text",
  actions: "ui-dialog-actions",
  cancelButton: "ui-btn ui-btn-ghost",
};

const themed = Swal.mixin({
  buttonsStyling: false,
  reverseButtons: true,
  focusCancel: true,
});

export async function confirmDialog({
  title,
  text,
  html,
  confirmText = "Confirm",
  cancelText = "Cancel",
  tone = "danger",
}) {
  const result = await themed.fire({
    title,
    text,
    html,
    icon: "warning",
    iconColor: tone === "danger" ? "#dc2626" : "#b45309",
    showCancelButton: true,
    confirmButtonText: confirmText,
    cancelButtonText: cancelText,
    customClass: {
      ...DIALOG_CLASSES,
      confirmButton: tone === "danger" ? "ui-btn ui-btn-danger" : "ui-btn ui-btn-primary",
    },
  });
  return result.isConfirmed;
}

export default confirmDialog;
