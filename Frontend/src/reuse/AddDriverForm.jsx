import { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";

function AddDriverForm({ onSubmit, editData, isEdit, onCancel }) {

  const dispatch = useDispatch();

  const { admin, isSuperAdmin } = useSelector((state) => state.admin);
  const { city, loading, error } = useSelector((state) => state.users);

  const [form, setForm] = useState({
    name: "",
    email: "",
    driverCode: "",
    password: "",
    confirmPassword: "",
    city: "",
    enabled: false,
  });

  const [errors, setErrors] = useState({});

  // Populate form when edit starts
  useEffect(() => {
    if (isEdit && editData) {
      setForm({
        name: editData.name || "",
        email: editData.email || "",
        driverCode: editData.driver_code || "",
        password: "", // Leave empty - optional to change
        confirmPassword: "",
        city: editData.job || "",
        enabled: !!editData.enabled,
      });
    }
  }, [isEdit, editData]);


  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setForm((prev) => ({
      ...prev,
      [name]: type === "checkbox" ? checked : value,
    }));
    setErrors((prev) => ({ ...prev, [name]: "" }));
  };

  const validate = () => {
    let newErrors = {};

    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.email.trim()) newErrors.email = "Email is required";
    if (!form.driverCode || !form.driverCode.toString().trim()) newErrors.driverCode = "Driver Code is required";
    if (!form.city.trim()) newErrors.city = "City is required";

    if (!isEdit) {
      // For new drivers, password is required
      if (!form.password.trim()) newErrors.password = "Password is required";
      if (!form.confirmPassword.trim())
        newErrors.confirmPassword = "Confirm Password is required";
      if (form.password !== form.confirmPassword)
        newErrors.confirmPassword = "Passwords do not match";
    } else {
      // For editing, only validate if user is trying to change password
      if (form.password.trim() || form.confirmPassword.trim()) {
        if (form.password !== form.confirmPassword)
          newErrors.confirmPassword = "Passwords do not match";
      }
    }

    return newErrors;
  };

  const handleSubmit = (e) => {
    e.preventDefault();

    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    const { confirmPassword, ...driverData } = form;
    
    // If editing and password is empty, don't send password field
    if (isEdit && !driverData.password.trim()) {
      delete driverData.password;
    }
    
    onSubmit(driverData);

    if (!isEdit) {
      setForm({
        name: "",
        email: "",
        driverCode: "",
        password: "",
        confirmPassword: "",
        city: "",
        enabled: false,
      });
    }

    setErrors({});
  };

  const handleCancel = () => {
    setForm({
      name: "",
      email: "",
      driverCode: "",
      password: "",
      confirmPassword: "",
      city: "",
      enabled: false,
    });
    setErrors({});
    onCancel(); 
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
      <input
        type="text"
        name="name"
        value={form.name}
        onChange={handleChange}
        placeholder="Driver Name"
        className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      {errors.name && <p className="text-red-500 text-sm">{errors.name}</p>}

      <input
        type="email"
        name="email"
        value={form.email}
        onChange={handleChange}
        placeholder="Email"
        className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      {errors.email && <p className="text-red-500 text-sm">{errors.email}</p>}

      <input
        type="number"
        name="driverCode"
        value={form.driverCode}
        onChange={handleChange}
        placeholder="Driver Code"
        disabled={isEdit}
        className={`px-3 py-2 border rounded-lg ${
          isEdit ? "bg-gray-100 cursor-not-allowed" : "focus:outline-none focus:ring-2 focus:ring-purple-500"
        }`}
      />
      {errors.driverCode && (
        <p className="text-red-500 text-sm">{errors.driverCode}</p>
      )}

      <div className="flex flex-col gap-2">
        <input
          type="password"
          name="password"
          value={form.password}
          onChange={handleChange}
          placeholder={isEdit ? "New Password (leave blank to keep current)" : "Password"}
          className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        {isEdit && (
          <p className="text-xs text-gray-500 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Leave empty to keep the current password
          </p>
        )}
        {errors.password && <p className="text-red-500 text-sm">{errors.password}</p>}
      </div>

      <input
        type="password"
        name="confirmPassword"
        value={form.confirmPassword}
        onChange={handleChange}
        placeholder="Confirm Password"
        className="px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
      />
      {errors.confirmPassword && (
        <p className="text-red-500 text-sm">{errors.confirmPassword}</p>
      )}

      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-700">
          City
        </label>
        <select
          value={form.city}
          name="city"
          onChange={handleChange}
          className="w-full px-3 py-2 border rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-purple-500"
        >
          <option value="">Select City</option>

          {Array.isArray(city) &&
            city.map((c) => (
              <option key={c.id} value={c.job}>
                {c.job}
              </option>
            ))}
        </select>

        {errors.city && <p className="text-red-500 text-sm">{errors.city}</p>}
        
        {/* Info message about city access */}
        {!isSuperAdmin && city.length > 0 && (
          <p className="text-xs text-blue-600 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
            </svg>
            Showing only your assigned cities ({city.length})
          </p>
        )}
        
        {city.length === 0 && !loading && (
          <p className="text-xs text-red-600 flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
            </svg>
            No cities assigned to you. Contact superadmin.
          </p>
        )}
      </div>

      <label className="flex items-center space-x-2 cursor-pointer">
        <input
          type="checkbox"
          name="enabled"
          checked={form.enabled}
          onChange={handleChange}
          className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
        />
        <span className="text-sm font-medium text-gray-700">Enable Driver</span>
      </label>

      <div className="flex gap-3">
        <button
          type="submit"
          disabled={loading}
          className="px-6 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-800 transition-colors disabled:bg-gray-400 disabled:cursor-not-allowed flex items-center gap-2"
        >
          {loading && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" className="opacity-25" />
              <path fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" className="opacity-75" />
            </svg>
          )}
          {isEdit ? "Update Driver" : "Add Driver"}
        </button>

        {isEdit && (
          <button
            type="button"
            onClick={handleCancel}
            className="px-6 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400 transition-colors"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default AddDriverForm;