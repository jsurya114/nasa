import React, { useState, useEffect } from 'react';
import Header from '../../reuse/Header';
import Nav from '../../reuse/Nav';
import AddAdminForm from '../../reuse/AddAdminForm';
import AddDriverForm from '../../reuse/AddDriverForm';
import AdminsList from '../../reuse/AdminsList';
import DriversList from '../../reuse/DriversList';
import { useDispatch, useSelector } from 'react-redux';
import { toast } from "react-toastify";
import {
  addDriver,
  addAdmin,
  updateDriver,
  updateAdmin,
  clearMessages,
  getCities,
  getAdminCities
} from '../../redux/slice/admin/userLoadSlice';

const AddUsers = () => {
  const dispatch = useDispatch();

  const { error, success } = useSelector((state) => state.users);
  const { isSuperAdmin, admin } = useSelector((state) => state.admin);

  const [activeTab, setActiveTab] = useState("drivers");
  const [editDriver, setEditDriver] = useState(null);
  const [editAdmin, setEditAdmin] = useState(null);

  // Fetch cities on mount - use getAdminCities which handles both superadmin and regular admin
  useEffect(() => {
    console.log("Fetching cities on mount, isSuperAdmin:", isSuperAdmin);
    
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
    setActiveTab(tab);
  };

  // Handle driver form submission
  const handleDriverSubmit = (form) => {
    if (editDriver) {
      dispatch(updateDriver({ id: editDriver.id, formData: form }))
        .unwrap()
        .then(() => {
          setEditDriver(null);
        })
        .catch((err) => {
          console.error("Failed to update driver:", err);
        });
    } else {
      dispatch(addDriver(form));
    }
  };

  // Handle admin form submission
  const handleAdminSubmit = (form) => {
    if (editAdmin) {
      dispatch(updateAdmin({ id: editAdmin.id, formData: form }))
        .unwrap()
        .then(() => {
          setEditAdmin(null);
        })
        .catch((err) => {
          console.error("Failed to update admin:", err);
        });
    } else {
      dispatch(addAdmin(form));
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-poppins">
      <Header />

      {/* Toggle Switch */}
      <div className="flex items-center justify-center pt-6 pb-4">
        <div className="relative bg-white rounded-full p-1 shadow-md border border-gray-200">
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
      <div className="flex-1 p-6 pb-24">
        {activeTab === "drivers" ? (
          <div className="space-y-6">
            {/* Add / Edit Driver */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-800">
                  {editDriver ? "Edit Driver" : "Add New Driver"}
                </h2>
                {editDriver && (
                  <button
                    onClick={() => setEditDriver(null)}
                    className="text-sm text-gray-600 hover:text-gray-800 underline"
                  >
                    Cancel Edit
                  </button>
                )}
              </div>

              <AddDriverForm
                isEdit={!!editDriver}
                editData={editDriver}
                onSubmit={handleDriverSubmit}
                onCancel={() => setEditDriver(null)}
              />
            </div>

            {/* Drivers List */}
            <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
              <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
                <h3 className="text-lg font-semibold text-gray-800">
                  All Drivers
                </h3>
              </div>

              <div className="overflow-x-auto">
                <DriversList onEdit={(driver) => setEditDriver(driver)} />
              </div>
            </div>
          </div>
        ) : (
          <>
            {isSuperAdmin ? (
              <div className="space-y-6">
                {/* Add / Edit Admin */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-xl font-bold text-gray-800">
                      {editAdmin ? "Edit Admin" : "Add New Admin"}
                    </h2>
                    {editAdmin && (
                      <button
                        onClick={() => setEditAdmin(null)}
                        className="text-sm text-gray-600 hover:text-gray-800 underline"
                      >
                        Cancel Edit
                      </button>
                    )}
                  </div>

                  <AddAdminForm 
                    isEdit={!!editAdmin}
                    editData={editAdmin}
                    onSubmit={handleAdminSubmit}
                    onCancel={() => setEditAdmin(null)}
                  />
                </div>

                {/* Admins List */}
                <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-200 px-6 py-4">
                    <h3 className="text-lg font-semibold text-gray-800">
                      All Administrators
                    </h3>
                  </div>

                  <div className="overflow-x-auto">
                    <AdminsList onEdit={(admin) => setEditAdmin(admin)} />
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

      <Nav />
    </div>
  );
};

export default AddUsers;