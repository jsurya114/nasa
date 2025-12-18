import { useState, useEffect } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { getUsers, toggleAvailUser } from '../redux/slice/admin/userLoadSlice';
import Pagination from './Pagination';
import SearchBar from './Search';
import { toast } from 'react-toastify';


function DriversList({ onEdit }) {
  const dispatch = useDispatch();  
  const { drivers = [], loading: usersLoad, error: usersError, page, totalPages } = useSelector((state) => state.users);   
  const [searchTerm, setSearchTerm] = useState("");
  const [currentPage, setCurrentPage] = useState(1);

  useEffect(() => {
    dispatch(getUsers({ page: currentPage }));    
  }, [dispatch, currentPage]);

  function handleToggleChange(id) {    
    try {
      dispatch(toggleAvailUser(id));
    } catch (err) {
      console.error("Failed to toggle status:", err);
    }
  }

  function handleEdit(driver) {
    if (!driver.enabled) {
      toast.warning("Cannot edit disabled driver. Please enable the driver first.");
      return;
    }
    onEdit(driver);
  }

  return (
    <section className="bg-white rounded-xl shadow p-4">
      <SearchBar 
        value={searchTerm} 
        onChange={(e) => setSearchTerm(e.target.value)} 
        placeholder={"Search Driver ..."}
      />
      <h2 className="font-bold text-lg mb-4">Drivers</h2>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="bg-gray-50 text-left">
            {["Sl No", "Driver Code", "Name", "Email", "City", "Status", "Actions"].map(
              (head, i) => (
                <th key={i} className="px-3 py-2 border-b border-gray-200">
                  {head}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {usersLoad && drivers.length === 0 ? (
            <tr>
              <td colSpan="7" className="text-center py-4 text-gray-500 font-medium">
                <div className="flex items-center justify-center">
                  <svg className="animate-spin h-6 w-6 mr-2 text-purple-600" viewBox="0 0 24 24">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  Loading drivers...
                </div>
              </td>
            </tr>
          ) : drivers.length > 0 ? (
            drivers.map((d, i) => (
              <tr key={d.id} className={!d.enabled ? "bg-gray-50" : ""}>
                <td className="px-3 py-2 border-b">
                  {(currentPage - 1) * 10 + i + 1}
                </td>
                <td className="px-3 py-2 border-b">
                  <span className={`font-mono ${!d.enabled ? "text-gray-400" : "text-gray-700"}`}>
                    {d.driver_code}
                  </span>
                </td>
                <td className="px-3 py-2 border-b">
                  <span className={!d.enabled ? "text-gray-400" : ""}>
                    {d.name}
                  </span>
                </td>
                <td className="px-3 py-2 border-b">
                  <span className={!d.enabled ? "text-gray-400" : ""}>
                    {d.email}
                  </span>
                </td>
                <td className="px-3 py-2 border-b">
                  <span className={!d.enabled ? "text-gray-400" : ""}>
                    {d.job}
                  </span>
                </td>
                <td className="px-3 py-2 border-b">
                  {d.enabled ? (
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
                      title={d.enabled ? "Disable driver" : "Enable driver"}
                    >
                      <input
                        type="checkbox"
                        checked={d.enabled}
                        onChange={() => handleToggleChange(d.id)}
                        className="sr-only"
                      />
                      <div
                        className={`w-11 h-6 rounded-full transition-colors duration-200 ease-in-out ${
                          d.enabled ? "bg-purple-600" : "bg-gray-300"
                        }`}
                      >
                        <div
                          className={`w-5 h-5 bg-white rounded-full shadow-lg transform transition-transform duration-200 ease-in-out ${
                            d.enabled ? "translate-x-5" : "translate-x-0.5"
                          } mt-0.5`}
                        ></div>
                      </div>
                    </label>

                    {/* Edit Button */}
                    <button
                      onClick={() => handleEdit(d)}
                      disabled={!d.enabled}
                      className={`group relative px-4 py-1.5 text-white text-xs font-medium rounded-md transition-all duration-200 shadow-sm flex items-center gap-1.5 ${
                        d.enabled
                          ? "bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700 hover:shadow-md cursor-pointer"
                          : "bg-gray-400 cursor-not-allowed opacity-50"
                      }`}
                      title={d.enabled ? "Edit driver" : "Enable driver to edit"}
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
                  </svg>
                  <p className="font-medium">No drivers found</p>
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
    </section>
  );
}

export default DriversList;