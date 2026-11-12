import usePersistentState from "../../hooks/usePersistentState.js";
import React, { useState, useEffect } from 'react';
import Header from '../../reuse/Header';
import Nav from '../../reuse/Nav';
import Modal from '../../reuse/Modal';
import AddAdminForm from '../../reuse/AddAdminForm';
import AddDriverForm from '../../reuse/AddDriverForm';
import AdminsList from '../../reuse/AdminsList';
import DriversList from '../../reuse/DriversList';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from "../../utils/toast";
import {
  addDriver,
  addAdmin,
  updateDriver,
  updateAdmin,
  clearMessages,
  getAdminCities
} from '../../redux/slice/admin/userLoadSlice';

const AddUsers = () => {
  const dispatch = useDispatch();

  const { error, success } = useSelector((state) => state.users);
  const { isSuperAdmin, admin } = useSelector((state) => state.admin);

  const [activeTab, setActiveTab] = usePersistentState("admin", "users", "tab", "drivers");
  const [editDriver, setEditDriver] = useState(null);
  const [editAdmin, setEditAdmin] = useState(null);
  // Each form opens in its own dialog. Adding opens it empty; Edit on a row opens it filled in.
  const [driverFormOpen, setDriverFormOpen] = useState(false);
  const [adminFormOpen, setAdminFormOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [similar, setSimilar] = useState(null); // { form, list }: drivers with a very similar name, shown before a second record is created

  // Fetch cities on mount - use getAdminCities which handles both superadmin and regular admin
  useEffect(() => {
    
    // Always use getAdminCities - it handles role-based filtering
    // Superadmin gets all cities, regular admin gets assigned cities
    dispatch(getAdminCities());
  }, [dispatch, isSuperAdmin]);

  // Toast handling
  useEffect(() => {
    if (error) {
      toast.error(error);
      dispatch(clearMessages());
    }
    if (success) {
      toast.success(success);
      dispatch(clearMessages());
    }
  }, [error, success, dispatch]);

  // Tab switching with access control
  const handleTabSwitch = (tab) => {
    if (tab === "admins" && !isSuperAdmin) {
      toast.warning("Only superadmins can access admin management");
      return;
    }
    
    // Clear edit states when switching tabs
    setEditDriver(null);
    setEditAdmin(null);
    setDriverFormOpen(false);
    setAdminFormOpen(false);
    setActiveTab(tab);
  };

  const closeDriverForm = () => {
    setDriverFormOpen(false);
    setEditDriver(null);
  };

  const closeAdminForm = () => {
    setAdminFormOpen(false);
    setEditAdmin(null);
  };

  // The Cancel buttons inside the forms are user dismissals too: like X, Escape and the backdrop, they do nothing while a save is running.
  const cancelDriverForm = () => { if (!saving) closeDriverForm(); };
  const cancelAdminForm = () => { if (!saving) closeAdminForm(); };

  // Handle driver form submission. The dialog closes only when the save worked; when it fails it stays open with what was typed.
  const handleDriverSubmit = async (form) => {
    setSaving(true);
    try {
      if (editDriver) await dispatch(updateDriver({ id: editDriver.id, formData: form })).unwrap();
      else {
        const result = await dispatch(addDriver(form));
        if (addDriver.rejected.match(result)) {
          // A very similar name (often the same person registered twice): ask before creating another record. Other refusals are shown by the slice.
          if (result.meta.similar) setSimilar({ form, list: result.meta.similar });
          return;
        }
      }
      closeDriverForm();
    } catch {
      // The users slice keeps the error and the screen shows it.
    } finally {
      setSaving(false);
    }
  };
  const createAnyway = async () => {
    const { form } = similar;
    setSimilar(null);
    await handleDriverSubmit({ ...form, confirmSimilar: true });
  };

  // Handle admin form submission (same rule as the driver form)
  const handleAdminSubmit = async (form) => {
    setSaving(true);
    try {
      if (editAdmin) await dispatch(updateAdmin({ id: editAdmin.id, formData: form })).unwrap();
      else await dispatch(addAdmin(form)).unwrap();
      closeAdminForm();
    } catch {
      // The users slice keeps the error and the screen shows it.
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <Header />

      {/* Toggle Switch */}
      <div className="flex items-center justify-center pt-6 pb-4">
        <div className="relative bg-white rounded-full p-1 shadow-md border border-line">
          <div
            className={`absolute top-1 bottom-1 bg-purple-600 rounded-full transition-all duration-300 ${
              activeTab === "drivers"
                ? "left-1 right-1/2"
                : "left-1/2 right-1"
            }`}
          />

          <button
            onClick={() => handleTabSwitch("drivers")}
            className={`relative z-10 px-6 py-2 rounded-full font-medium transition-colors ${
              activeTab === "drivers"
                ? "text-white"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            Drivers
          </button>

          <button
            onClick={() => handleTabSwitch("admins")}
            className={`relative z-10 px-6 py-2 rounded-full font-medium transition-colors ${
              activeTab === "admins"
                ? "text-white"
                : isSuperAdmin
                ? "text-gray-600 hover:text-gray-800"
                : "text-gray-400 cursor-not-allowed"
            }`}
            title={!isSuperAdmin ? "Superadmin access required" : ""}
            disabled={!isSuperAdmin}
          >
            Admins
          </button>
        </div>
      </div>

      {/* Role Indicator */}
      {admin && (
        <div className="text-center mb-4">
          <span
            className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${
              isSuperAdmin
                ? "bg-blue-100 text-blue-800"
                : "bg-green-100 text-green-800"
            }`}
          >
            {isSuperAdmin ? "Super Administrator" : "Administrator"}
          </span>
        </div>
      )}

      {/* Content */}
      <div className="flex-1 p-4 sm:p-6 pb-24">
        {activeTab === "drivers" ? (
          <div className="space-y-6">
            {/* Drivers List */}
            <div className="card-surface overflow-hidden">
              <div className="flex items-center justify-between gap-3 bg-gray-50 border-b border-line px-4 sm:px-6 py-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  All Drivers
                </h3>
                <button
                  type="button"
                  onClick={() => { setEditDriver(null); setDriverFormOpen(true); }}
                  className="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
                >
                  + Add Driver
                </button>
              </div>

              <div>
                <DriversList onEdit={(driver) => { setEditDriver(driver); setDriverFormOpen(true); }} />
              </div>
            </div>
          </div>
        ) : (
          <>
            {isSuperAdmin ? (
              <div className="space-y-6">
                {/* Admins List */}
                <div className="card-surface overflow-hidden">
                  <div className="flex items-center justify-between gap-3 bg-gray-50 border-b border-line px-4 sm:px-6 py-4">
                    <h3 className="text-lg font-semibold text-gray-800">
                      All Administrators
                    </h3>
                    <button
                      type="button"
                      onClick={() => { setEditAdmin(null); setAdminFormOpen(true); }}
                      className="min-h-11 rounded-lg bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-900"
                    >
                      + Add Admin
                    </button>
                  </div>

                  <div>
                    <AdminsList onEdit={(admin) => { setEditAdmin(admin); setAdminFormOpen(true); }} />
                  </div>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-8 max-w-md mx-auto">
                  <svg className="w-16 h-16 mx-auto mb-4 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                  </svg>
                  <h3 className="text-xl font-bold text-yellow-800 mb-3">
                    Access Restricted
                  </h3>
                  <p className="text-yellow-700">
                    Only super administrators can manage admin accounts.
                  </p>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      {driverFormOpen && activeTab === "drivers" && (
        <Modal title={editDriver ? "Edit Driver" : "Add Driver"} onClose={closeDriverForm} busy={saving}>
          <AddDriverForm
            isEdit={!!editDriver}
            editData={editDriver}
            onSubmit={handleDriverSubmit}
            onCancel={cancelDriverForm}
          />
        </Modal>
      )}
      {similar && (
        <Modal title="A similar driver already exists" onClose={() => setSimilar(null)}>
          <div role="alert" className="space-y-3 text-sm">
            <p>The name you typed is almost the same as another driver. A second record for the same person means a second payment setup, so please review that record first (search Users for the name).</p>
            <ul className="list-disc pl-5">
              {similar.list.map((d) => <li key={d.driverCode}>Driver code {d.driverCode}, {d.enabled ? "enabled" : "disabled"}</li>)}
            </ul>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button type="button" onClick={createAnyway} className="min-h-11 rounded-xl border border-line bg-white px-4 font-semibold">This is a different person: create anyway</button>
              <button type="button" onClick={() => setSimilar(null)} className="min-h-11 rounded-xl bg-brand px-4 font-semibold text-white">Go back</button>
            </div>
          </div>
        </Modal>
      )}
      {adminFormOpen && activeTab === "admins" && isSuperAdmin && (
        <Modal title={editAdmin ? "Edit Admin" : "Add Admin"} onClose={closeAdminForm} busy={saving}>
          <AddAdminForm
            isEdit={!!editAdmin}
            editData={editAdmin}
            onSubmit={handleAdminSubmit}
            onCancel={cancelAdminForm}
          />
        </Modal>
      )}
      <Nav />
    </div>
  );
};

export default AddUsers;