import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearPaginateTerms, getAdmins, toggleAvailAdmin, toggleAdminRole } from "../redux/slice/admin/userLoadSlice";
import Pagination from "./Pagination";
import { toast } from "react-toastify";

function AdminsList({ onEdit }) {
  const dispatch = useDispatch();
  const { admins, loading: adminsLoad, error: adminsError, page, totalPages } = useSelector((state) => state.users);
  const { isSuperAdmin } = useSelector((state) => state.admin);
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    dispatch(clearPaginateTerms());
    dispatch(getAdmins({ page: currentPage }));
  }, [dispatch, currentPage]);

  function handleToggleChange(id) {
    try {
      dispatch(toggleAvailAdmin(id));
    } catch (err) {
      console.error("Failed to toggle status:", err);
    }
  }

  function handleEdit(admin) {
    if (!admin.is_active) {
      toast.warning("Cannot edit disabled admin. Please enable the admin first.");
      return;
    }
    onEdit(admin);
  }

  return (
    <section className="bg-white rounded-xl shadow p-4">
      <h2 className="font-bold text-lg mb-4">Administrators</h2>

      {!isSuperAdmin && (
        <div className="text-center py-8 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-yellow-700 font-semibold">
            Only super administrators can manage admin accounts.
          </p>
        </div>
      )}

      {isSuperAdmin && (
        <>
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gray-50 text-left">
                {["Sl No", "Name", "Email", "Role", "Cities", "Status", "Actions"].map((head, i) => (
                  <th key={i} className="px-3 py-2 border-b border-gray-200">
                    {head}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {adminsLoad && admins.length === 0 ? (
                <tr>
                  <td colSpan="7" className="text-center py-4 text-gray-500 font-medium">
                    <div className="flex items-center justify-center">
                      <svg
                        className="animate-spin h-6 w-6 mr-2 text-purple-600"
                        viewBox="0 0 24 24"
                      >
                        <circle
                          cx="12"
                          cy="12"
                          r="10"
                          stroke="currentColor"
                          strokeWidth="4"
                          fill="none"
                        />
                        <path
                          fill="currentColor"
                          d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
                        />
                      </svg>
                      Loading admins...
                    </div>
                  </td>
                </tr>
              ) : admins.length > 0 ? (
                admins.map((a, i) => (
                  <tr key={a.id} className={!a.is_active ? "bg-gray-50" : ""}>
                    <td className="px-3 py-2 border-b">{(currentPage - 1) * 5 + i + 1}</td>
                    <td className="px-3 py-2 border-b">
                      <span className={!a.is_active ? "text-gray-400" : ""}>
                        {a.admin_name}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b">
                      <span className={!a.is_active ? "text-gray-400" : ""}>
                        {a.admin_email}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b">
                      {a.admin_role === "superadmin" ? (
                        <span className={`font-semibold ${!a.is_active ? "text-gray-400" : "text-blue-600"}`}>
                          {a.admin_role}
                        </span>
                      ) : (
                        <span className={!a.is_active ? "text-gray-400" : "text-gray-700"}>
                          {a.admin_role}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b">
                      <span className={!a.is_active ? "text-gray-400" : ""}>
                        {a.cities || "N/A"}
                      </span>
                    </td>
                    <td className="px-3 py-2 border-b">
                      {a.is_active ? (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                          Enabled
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                          </svg>
                          Disabled
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 border-b">
                      <div className="flex items-center gap-3">
                        {/* Toggle Switch */}
                        <label 
                          className="relative inline-flex items-center cursor-pointer"
                          title={a.is_active ? "Disable admin" : "Enable admin"}
                        >
                          <input
                            type="checkbox"
                            checked={a.is_active}
                            onChange={() => handleToggleChange(a.id)}
                            className="sr-only"
                          />
                          <div
                            className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out ${
                              a.is_active ? "bg-purple-600" : "bg-gray-300"
                            }`}
                          >
                            <div
                              className={`w-5 h-5 bg-white rounded-full shadow-lg transform transition-transform duration-200 ease-in-out ${
                                a.is_active ? "translate-x-5" : "translate-x-0.5"
                              } mt-0.5`}
                            ></div>
                          </div>
                        </label>

                        {/* Edit Button */}
                        <button
                          onClick={() => handleEdit(a)}
                          disabled={!a.is_active}
                          className={`group relative px-4 py-1.5 text-white text-xs font-medium rounded-md transition-all duration-200 shadow-sm flex items-center gap-1.5 ${
                            a.is_active
                              ? "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:shadow-md cursor-pointer"
                              : "bg-gray-400 cursor-not-allowed opacity-50"
                          }`}
                          title={a.is_active ? "Edit admin" : "Enable admin to edit"}
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                            />
                          </svg>
                          <span>Edit</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan="7" className="text-center py-8 text-gray-500">
                    <div className="flex flex-col items-center gap-2">
                      <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
                      </svg>
                      <p className="font-medium">No admins found</p>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-4">
              <Pagination
                page={currentPage}
                totalPages={totalPages}
                onPageChange={(pg) => setCurrentPage(pg)}
              />
            </div>
          )}
        </>
      )}
    </section>
  );
}

export default AdminsList;