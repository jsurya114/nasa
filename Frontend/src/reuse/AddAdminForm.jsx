import { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import Select from 'react-select';

function AddAdminForm({ onSubmit, editData, isEdit, onCancel }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "admin",
    cities: [],
  });
  
  const { loading, city } = useSelector((state) => state.users);
  const [errors, setErrors] = useState({});

  // Transform city data into react-select format
  const cityOptions = Array.isArray(city) 
    ? city.map(c => ({ 
        value: c.id,
        label: c.job
      }))
    : [];

  // Populate form when edit starts
  useEffect(() => {
    if (isEdit && editData) {
      // Parse cities string to array of objects
      const citiesArray = editData.cities 
        ? editData.cities.split(', ').map(cityName => {
            const cityObj = city.find(c => c.job === cityName);
            return cityObj ? { value: cityObj.id, label: cityObj.job } : null;
          }).filter(Boolean)
        : [];

      setForm({
        name: editData.admin_name || "",
        email: editData.admin_email || "",
        password: "",
        confirmPassword: "",
        role: editData.admin_role || "admin",
        cities: citiesArray,
      });
    }
  }, [isEdit, editData, city]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm({ ...form, [name]: value });
    setErrors({ ...errors, [name]: "" });
  };

  const handleCityChange = (selectedOptions) => {
    setForm({ ...form, cities: selectedOptions || [] });
    setErrors({ ...errors, cities: "" });
  };

  const validate = () => {
    let newErrors = {};
    if (!form.name.trim()) newErrors.name = "Name is required";
    if (!form.email.trim()) newErrors.email = "Email is required";
    
    // Password only required for new admins
    if (!isEdit) {
      if (!form.password.trim()) newErrors.password = "Password is required";
      if (!form.confirmPassword.trim())
        newErrors.confirmPassword = "Confirm Password is required";
      if (form.password !== form.confirmPassword)
        newErrors.confirmPassword = "Passwords do not match";
    }
    
    if (form.role === 'admin') {
      if (form.cities.length === 0)
        newErrors.cities = "At least one city must be selected";
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

    const { confirmPassword, ...adminData } = form;
    
    // Don't send password if editing and password is empty
    if (isEdit && !adminData.password) {
      delete adminData.password;
    }
    
    onSubmit(adminData);
    
    if (!isEdit) {
      setForm({
        name: "",
        email: "",
        password: "",
        confirmPassword: "",
        role: "admin",
        cities: [],
      });
    }
    setErrors({});
  };

  const handleCancel = () => {
    setForm({
      name: "",
      email: "",
      password: "",
      confirmPassword: "",
      role: "admin",
      cities: [],
    });
    setErrors({});
    onCancel();
  };

  // Custom styles for react-select
  const customStyles = {
    control: (base, state) => ({
      ...base,
      borderColor: errors.cities ? '#ef4444' : state.isFocused ? '#9333ea' : '#d1d5db',
      boxShadow: state.isFocused ? '0 0 0 1px #9333ea' : 'none',
      '&:hover': {
        borderColor: errors.cities ? '#ef4444' : '#9333ea',
      },
      padding: '2px',
      borderRadius: '0.5rem',
    }),
    multiValue: (base) => ({
      ...base,
      backgroundColor: '#f3e8ff',
    }),
    multiValueLabel: (base) => ({
      ...base,
      color: '#6b21a8',
      fontWeight: '500',
    }),
    multiValueRemove: (base) => ({
      ...base,
      color: '#6b21a8',
      ':hover': {
        backgroundColor: '#9333ea',
        color: 'white',
      },
    }),
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-6">
      <input
        type="text"
        name="name"
        value={form.name}
        onChange={handleChange}
        placeholder="Admin Name"
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
        type="password"
        name="password"
        value={form.password}
        onChange={handleChange}
        placeholder={isEdit ? "Password (leave blank to keep current)" : "Password"}
        disabled={isEdit}
        className={`px-3 py-2 border rounded-lg ${
          isEdit ? "bg-gray-100 cursor-not-allowed" : ""
        }`}
      />
      {errors.password && <p className="text-red-500 text-sm">{errors.password}</p>}

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
      {errors.confirmPassword && (
        <p className="text-red-500 text-sm">{errors.confirmPassword}</p>
      )}

      <select
        name="role"
        value={form.role}
        onChange={handleChange}
        className="px-3 py-2 border rounded-lg"
        disabled={isEdit}
      >
        <option value="admin">Admin</option>
        <option value="superadmin">Super Admin</option>
      </select>

      {form.role === 'admin' && (
        <div className="flex flex-col gap-2">
          <Select
            isMulti
            name="cities"
            value={form.cities}
            onChange={handleCityChange}
            options={cityOptions}
            isLoading={loading}
            placeholder="Select cities..."
            noOptionsMessage={() => "No cities available"}
            className="basic-multi-select"
            classNamePrefix="select"
            styles={customStyles}
            isDisabled={loading}
          />
          {errors.cities && <p className="text-red-500 text-sm">{errors.cities}</p>}
          
          {form.cities.length > 0 && (
            <p className="text-sm text-gray-600">
              {form.cities.length} {form.cities.length === 1 ? 'city' : 'cities'} selected
            </p>
          )}
        </div>
      )}

      <div className="flex gap-3">
        <button
          type="submit"
          className="px-6 py-2 bg-purple-700 text-white rounded-lg shadow hover:bg-purple-800"
        >
          {loading ? (isEdit ? 'Updating Admin' : 'Adding Admin') : (isEdit ? 'Update Admin' : 'Add Admin')}
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

export default AddAdminForm;