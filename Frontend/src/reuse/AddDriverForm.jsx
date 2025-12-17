import { useState, useEffect } from "react";
import { useSelector, useDispatch } from "react-redux";
import {  getCities } from "../redux/slice/admin/userLoadSlice";

function AddDriverForm({ onSubmit, editData, isEdit, onCancel }) {

  const dispatch = useDispatch();

  const { admin } = useSelector((state) => state.admin);
  const { city, loading, error } = useSelector((state) => state.users);

  const [form, setForm] = useState({
    name: "",
    email: "",
    driverCode: null,
    password: "",
    confirmPassword: "",
    city: "",
    enabled: false,
  });

  const [errors, setErrors] = useState({});

  // fetch cities on mount based on role
 

  // Populate form when edit starts
  useEffect(() => {
    if (isEdit && editData) {
      setForm({
        name: editData.name || "",
        email: editData.email || "",
        driverCode: editData.driver_code || null,
        password: "",
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
    if (!form.driverCode) newErrors.driverCode = "Driver Code is required";
    if (!form.city.trim()) newErrors.city = "City is required";

    if (!isEdit) {
      if (!form.password.trim()) newErrors.password = "Password is required";
      if (!form.confirmPassword.trim())
        newErrors.confirmPassword = "Confirm Password is required";
      if (form.password !== form.confirmPassword)
        newErrors.confirmPassword = "Passwords do not match";
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
    onSubmit(driverData);

    if (!isEdit) {
      setForm({
        name: "",
        email: "",
        driverCode: null,
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
      driverCode: null,
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
        className="px-3 py-2 border rounded-lg"
      />
      {errors.name && <p className="text-red-500 text-sm">{errors.name}</p>}

      <input
        type="email"
        name="email"
        value={form.email}
        onChange={handleChange}
        placeholder="Email"
        className="px-3 py-2 border rounded-lg"
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
          isEdit ? "bg-gray-100 cursor-not-allowed" : ""
        }`}
      />
      {errors.driverCode && (
        <p className="text-red-500 text-sm">{errors.driverCode}</p>
      )}

      <input
        type="password"
        name="password"
        value={form.password}
        onChange={handleChange}
        placeholder="Password"
        disabled={isEdit}
        className={`px-3 py-2 border rounded-lg ${
          isEdit ? "bg-gray-100 cursor-not-allowed" : ""
        }`}
      />

      <input
        type="password"
        name="confirmPassword"
        value={form.confirmPassword}
        onChange={handleChange}
        placeholder="Confirm Password"
        disabled={isEdit}
        className={`px-3 py-2 border rounded-lg ${
          isEdit ? "bg-gray-100 cursor-not-allowed" : ""
        }`}
      />

      <select
        value={form.city}
        name="city"
        onChange={handleChange}
        className="w-full px-3 py-2 border rounded-lg bg-white"
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

      <label className="flex items-center space-x-2">
        <input
          type="checkbox"
          name="enabled"
          checked={form.enabled}
          onChange={handleChange}
        />
        <span>Enabled</span>
      </label>

      <div className="flex gap-3">
        <button
          type="submit"
          className="px-6 py-2 bg-purple-700 text-white rounded-lg hover:bg-purple-800"
        >
          {isEdit ? "Update Driver" : "Add Driver"}
        </button>

        {isEdit && (
          <button
            type="button"
            onClick={handleCancel}
            className="px-6 py-2 bg-gray-300 text-gray-800 rounded-lg hover:bg-gray-400"
          >
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}

export default AddDriverForm;
