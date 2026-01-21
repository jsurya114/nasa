// components/driver/DriverAccessCodePage.jsx
"use client";

import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  fetchAccessCodes,
  createAccessCode,
  clearError,
  setPage,
  setPageLimit,
  setSearchTerm,
  setZipCodeFilter,
} from "../../redux/slice/driver/driverAccessCodeSlice";
import Header from "../../reuse/driver/Header";
import Nav from "../../reuse/driver/Nav";
import { toast } from "react-toastify";
import useTranslation from "../../hooks/useTranslation.js";
import AccessCodeDetailsDialog from "../AccessCodeDetailsDialog.jsx";

export default function DriverAccessCodePage() {
  const { t } = useTranslation();
  const dispatch = useDispatch();
  const {
    accessCodes = [],
    status = "idle",
    error: reduxError,
    currentPage,
    pageLimit,
    totalPages,
    totalItems,
    searchTerm,
    zipCodeFilter,
  } = useSelector((state) => state.driverAccessCodes || {});

  const [address, setAddress] = useState("");
  const [accessCode, setAccessCode] = useState("");
  const [zipCode, setZipCode] = useState("");
  const [errors, setErrors] = useState({});
  const [touched, setTouched] = useState({});
  const [localSearch, setLocalSearch] = useState("");
  const [localZipCodeFilter, setLocalZipCodeFilter] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [selectedAccessCode, setSelectedAccessCode] = useState(null);
  const [newImages, setNewImages] = useState([]);
  const [fileError, setFileError] = useState("");
  const [fileInfo, setFileInfo] = useState("");

  useEffect(() => {
    if (status === "idle") {
      dispatch(fetchAccessCodes({ page: currentPage, limit: pageLimit, search: searchTerm, zipCodeFilter }));
    }
  }, [dispatch, status]);

  useEffect(() => {
    return () => {
      dispatch(clearError());
    };
  }, [dispatch]);

  const validateField = (name, value) => {
    let error = "";

    switch (name) {
      case "zipCode":
        if (!value.trim()) {
          error = t('zipCodeRequired');
        } else if (!/^\d{5}(-\d{4})?$/.test(value.trim())) {
          error = t('zipCodeInvalid');
        }
        break;
      case "address":
        if (!value.trim()) {
          error = t('addressRequired');
        } else if (value.trim().length < 5) {
          error = t('addressMinLength');
        }
        break;
      case "accessCode":
        if (!value.trim()) {
          error = t('accessCodeRequired');
        } else if (value.length < 4) {
          error = t('accessCodeMinLength');
        }
        break;
      default:
        break;
    }

    return error;
  };

  const handleBlur = (field) => {
    setTouched({ ...touched, [field]: true });
    const value = field === "zipCode" ? zipCode : field === "address" ? address : accessCode;
    const error = validateField(field, value);
    setErrors({ ...errors, [field]: error });
  };

  const handleFieldChange = (field, value) => {
    if (field === "zipCode") {
      setZipCode(value);
    } else if (field === "address") {
      setAddress(value);
    } else if (field === "accessCode") {
      setAccessCode(value);
    }

    if (touched[field]) {
      const error = validateField(field, value);
      setErrors({ ...errors, [field]: error });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const newErrors = {
      zipCode: validateField("zipCode", zipCode),
      address: validateField("address", address),
      accessCode: validateField("accessCode", accessCode),
    };

    setErrors(newErrors);
    setTouched({ zipCode: true, address: true, accessCode: true });

    if (Object.values(newErrors).some((error) => error !== "")) {
      toast.error(t('fixValidationErrors'), { position: "top-right" });
      return;
    }

    try {
      await dispatch(
        createAccessCode({ zip_code: zipCode.trim(), address: address.trim(), access_code: accessCode.trim(), images: newImages }),
      ).unwrap();

      toast.success(t('accessCodeCreated'), { position: "top-right", autoClose: 3000 });

      setAddress("");
      setAccessCode("");
      setZipCode("");
      setErrors({});
      setTouched({});
      setNewImages([]);
      setFileError("");
      setFileInfo("");
    } catch (err) {
      toast.error(err || t('createFailed'), { position: "top-right", autoClose: 4000 });
    }
  };

  const onFilesChange = (e) => {
    const files = Array.from(e.target.files || []);
    const allowed = ["image/jpeg", "image/png", "image/webp", "image/jpg"];
    const invalids = files.filter((f) => !allowed.includes(f.type));
    if (invalids.length > 0) {
      setFileError(t('invalidImageFormat'));
      return;
    }
    setFileError("");
    setFileInfo("");

    let selected = files;
    if (files.length > 3) {
      selected = files.slice(0, 3);
      setFileInfo(t('maxImagesWarning'));
    }
    setNewImages(selected);
  };

  const handleSearch = () => {
    dispatch(setSearchTerm(localSearch));
    dispatch(setPage(1));
    dispatch(fetchAccessCodes({ page: 1, limit: pageLimit, search: localSearch, zipCodeFilter: localZipCodeFilter }));
  };

  const handleFilterChange = (filter) => {
    setLocalZipCodeFilter(filter);
    dispatch(setZipCodeFilter(filter));
    dispatch(setPage(1));
    dispatch(fetchAccessCodes({ page: 1, limit: pageLimit, search: localSearch, zipCodeFilter: filter }));
  };

  const handlePageChange = (newPage) => {
    dispatch(setPage(newPage));
    dispatch(fetchAccessCodes({ page: newPage, limit: pageLimit, search: searchTerm, zipCodeFilter }));
  };

  const handleLimitChange = (newLimit) => {
    dispatch(setPageLimit(newLimit));
    dispatch(fetchAccessCodes({ page: 1, limit: newLimit, search: searchTerm, zipCodeFilter }));
  };

  // Generate pagination page numbers with ellipsis (responsive)
  const getPaginationPages = () => {
    const pages = [];
    const maxVisible = 7;
    
    if (totalPages <= maxVisible) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i);
      }
    } else {
      pages.push(1);
      
      let start = Math.max(2, currentPage - 2);
      let end = Math.min(totalPages - 1, currentPage + 2);
      
      if (start <= 2) {
        end = Math.min(totalPages - 1, 5);
        start = 2;
      }
      
      if (end >= totalPages - 1) {
        start = Math.max(2, totalPages - 4);
        end = totalPages - 1;
      }
      
      if (start > 2) {
        pages.push('ellipsis-start');
      }
      
      for (let i = start; i <= end; i++) {
        pages.push(i);
      }
      
      if (end < totalPages - 1) {
        pages.push('ellipsis-end');
      }
      
      pages.push(totalPages);
    }
    
    return pages;
  };

  const openDetails = (ac) => {
    setSelectedAccessCode(ac);
    setDetailsOpen(true);
  };

  const closeDetails = () => {
    setDetailsOpen(false);
  };

  return (
    <div
      className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-50 overflow-x-hidden"
      style={{ fontFamily: "Poppins, sans-serif" }}
    >
      <Header />

      <main className="max-w-7xl mx-auto p-3 sm:p-4 lg:p-6 py-6 sm:py-12 pb-32">
        {/* Add New Access Code Card */}
        <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-2xl shadow-xl p-4 sm:p-8 mb-6 sm:mb-8">
          <div className="flex flex-col sm:flex-row sm:items-center mb-6 sm:mb-8">
            <div className="bg-gradient-to-r from-[#8200db] to-[#9d00ff] p-3 rounded-xl mb-4 sm:mb-0 sm:mr-4 w-fit">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                {t('addNewAccessCode')}
              </h1>
              <p className="text-gray-600 mt-1 text-sm sm:text-base">
                {t('createAccessCodeDesc')}
              </p>
            </div>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-6">
            {/* Zip Code Input */}
            <div className="space-y-2">
              <label htmlFor="zipCode" className="block text-sm font-semibold text-gray-800 mb-2">
                {t('zipCode')} <span className="text-red-500">*</span>
              </label>
              <input
                id="zipCode"
                type="text"
                placeholder={t('zipCodePlaceholder')}
                value={zipCode}
                onChange={(e) => handleFieldChange("zipCode", e.target.value)}
                onBlur={() => handleBlur("zipCode")}
                className={`w-full px-4 py-3 border-2 ${
                  touched.zipCode && errors.zipCode ? "border-red-500" : "border-gray-200"
                } rounded-xl focus:ring-4 focus:ring-purple-100 focus:border-[#8200db] bg-white text-gray-900 transition-all`}
                disabled={status === "loading"}
              />
              {touched.zipCode && errors.zipCode && (
                <p className="text-red-500 text-sm mt-1 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {errors.zipCode}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">{t('enterZipCodeFormat')}</p>
            </div>

            {/* Address Input */}
            <div className="space-y-2">
              <label htmlFor="address" className="block text-sm font-semibold text-gray-800 mb-2">
                {t('address')} <span className="text-red-500">*</span>
              </label>
              <input
                id="address"
                type="text"
                placeholder={t('addressPlaceholder')}
                value={address}
                onChange={(e) => handleFieldChange("address", e.target.value)}
                onBlur={() => handleBlur("address")}
                className={`w-full px-4 py-3 border-2 ${
                  touched.address && errors.address ? "border-red-500" : "border-gray-200"
                } rounded-xl focus:ring-4 focus:ring-purple-100 focus:border-[#8200db] text-gray-900 transition-all`}
                disabled={status === "loading"}
              />
              {touched.address && errors.address && (
                <p className="text-red-500 text-sm mt-1 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {errors.address}
                </p>
              )}
            </div>

            {/* Access Code Input */}
            <div className="space-y-2">
              <label htmlFor="accessCode" className="block text-sm font-semibold text-gray-800 mb-2">
                {t('accessCode')} <span className="text-red-500">*</span>
              </label>
              <input
                id="accessCode"
                type="text"
                placeholder={t('accessCodePlaceholder')}
                value={accessCode}
                onChange={(e) => handleFieldChange("accessCode", e.target.value)}
                onBlur={() => handleBlur("accessCode")}
                className={`w-full px-4 py-3 border-2 ${
                  touched.accessCode && errors.accessCode ? "border-red-500" : "border-gray-200"
                } rounded-xl focus:ring-4 focus:ring-purple-100 focus:border-[#8200db] text-gray-900 transition-all`}
                disabled={status === "loading"}
              />
              {touched.accessCode && errors.accessCode && (
                <p className="text-red-500 text-sm mt-1 flex items-center">
                  <svg className="w-4 h-4 mr-1" fill="currentColor" viewBox="0 0 20 20">
                    <path
                      fillRule="evenodd"
                      d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
                      clipRule="evenodd"
                    />
                  </svg>
                  {errors.accessCode}
                </p>
              )}
              <p className="text-xs text-gray-500 mt-1">{t('onlyLettersNumbers')}</p>
            </div>

            {/* Images Upload (Max 3) */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="block text-sm font-semibold text-gray-800">{t('images')}</label>
                <span className="text-xs text-gray-500">{t('maxImages')}</span>
              </div>
              <input
                type="file"
                multiple
                accept="image/jpeg,image/png,image/webp,image/jpg"
                onChange={onFilesChange}
                className="w-full px-4 py-2 border-2 border-gray-200 rounded-xl focus:ring-4 focus:ring-purple-100 focus:border-[#8200db] bg-white text-gray-900 transition-all"
                disabled={status === "loading"}
              />
              {fileError && <p className="text-red-500 text-sm mt-1">{fileError}</p>}
              {fileInfo && <p className="text-gray-600 text-sm mt-1">{fileInfo}</p>}
              {newImages.length > 0 && (
                <ul className="text-xs text-gray-600 list-disc pl-5 mt-1">
                  {newImages.map((f, i) => (
                    <li key={i}>{f.name}</li>
                  ))}
                </ul>
              )}
            </div>

            {/* Submit Button */}
            <div className="flex justify-end pt-4">
              <button
                type="submit"
                className={`px-6 sm:px-8 py-3 bg-gradient-to-r from-[#8200db] to-[#9d00ff] text-white rounded-xl shadow-lg hover:from-[#7300c4] hover:to-[#8a00e6] focus:outline-none focus:ring-4 focus:ring-purple-200 transition-all font-semibold ${
                  status === "loading"
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:shadow-xl transform hover:-translate-y-0.5"
                }`}
                disabled={status === "loading"}
              >
                {status === "loading" ? t('saving') : t('saveAccessCode')}
              </button>
            </div>
          </form>
        </div>

        {/* Saved Access Codes Table */}
        <div className="bg-white/80 backdrop-blur-sm border border-white/20 rounded-2xl shadow-xl overflow-hidden mb-20">
          <div className="px-3 sm:px-4 lg:px-8 py-4 sm:py-6 border-b border-gray-100">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex flex-col sm:flex-row sm:items-center">
                <div className="bg-gradient-to-r from-emerald-500 to-teal-600 p-3 rounded-xl mb-4 sm:mb-0 sm:mr-4 w-fit">
                  <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <div>
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-600 bg-clip-text text-transparent">
                    {t('savedAccessCodes')}
                  </h2>
                  <p className="text-gray-600 mt-1 text-sm sm:text-base">{t('total')}: {totalItems} {t('codes')}</p>
                </div>
              </div>

              {/* Items per page */}
              <div className="flex items-center justify-center lg:justify-end space-x-2">
                <label className="text-sm text-gray-600 whitespace-nowrap">{t('show')}:</label>
                <select
                  value={pageLimit}
                  onChange={(e) => handleLimitChange(Number(e.target.value))}
                  className="px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                >
                  <option value={5}>5</option>
                  <option value={10}>10</option>
                  <option value={20}>20</option>
                  <option value={30}>30</option>
                  <option value={40}>40</option>
                  <option value={50}>50</option>
                </select>
              </div>
            </div>

            {/* Search and Filter */}
            <div className="mt-6 flex flex-col md:flex-row gap-4">
              <div className="flex-1 min-w-0">
                <div className="relative">
                  <input
                    type="text"
                    placeholder={t('searchPlaceholder')}
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    onKeyPress={(e) => e.key === "Enter" && handleSearch()}
                    className="w-full px-4 py-2 pr-10 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                  />
                  <button
                    onClick={handleSearch}
                    className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-[#8200db] p-1"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                      />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="w-full md:w-48">
                <input
                  type="text"
                  placeholder={t('filterByZipCode')}
                  value={localZipCodeFilter}
                  onChange={(e) => handleFilterChange(e.target.value)}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-purple-500 text-sm"
                />
              </div>
            </div>
          </div>

          <div className="p-2 sm:p-3 lg:p-6">
            {status === "loading" ? (
              <div className="text-center py-16">
                <svg className="animate-spin h-12 w-12 text-[#8200db] mx-auto mb-4" viewBox="0 0 24 24">
                  <circle
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                    className="opacity-25"
                  ></circle>
                  <path
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                    className="opacity-75"
                  ></path>
                </svg>
                <p className="text-gray-600">{t('loading')}</p>
              </div>
            ) : accessCodes.length === 0 ? (
              <div className="text-center py-16">
                <div className="bg-gray-100 rounded-full p-6 w-24 h-24 mx-auto mb-6 flex items-center justify-center">
                  <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <h3 className="text-xl font-semibold text-gray-900 mb-2">{t('noData')}</h3>
                <p className="text-gray-600">
                  {searchTerm || zipCodeFilter
                    ? t('error')
                    : t('createAccessCodeDesc')}
                </p>
              </div>
            ) : (
              <>
                {/* Desktop Table View - Hidden on mobile */}
                <div className="hidden md:block w-full overflow-hidden">
                  <div className="shadow ring-1 ring-black ring-opacity-5 md:rounded-lg">
                    <table className="w-full divide-y divide-gray-200">
                      <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                        <tr>
                          <th className="px-3 lg:px-4 py-3 sm:py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                            {t('zipCode')}
                          </th>
                          <th className="px-3 lg:px-4 py-3 sm:py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider min-w-[150px]">
                            {t('address')}
                          </th>
                          <th className="px-3 lg:px-4 py-3 sm:py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                            {t('accessCode')}
                          </th>
                          <th className="px-3 lg:px-4 py-3 sm:py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                            {t('images')}
                          </th>
                          <th className="px-3 lg:px-4 py-3 sm:py-4 text-left text-xs font-bold text-gray-600 uppercase tracking-wider whitespace-nowrap">
                            {t('createdAt')}
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        {accessCodes.map((ac, index) => (
                          <tr
                            key={ac.id}
                            onClick={() => openDetails(ac)}
                            className={`hover:bg-gray-50 transition-colors cursor-pointer ${index % 2 === 0 ? "bg-white" : "bg-gray-50/50"}`}
                          >
                            <td className="px-3 lg:px-4 py-3 sm:py-4">
                              <span className="text-sm font-semibold text-gray-900">
                                {ac.zip_code}
                              </span>
                            </td>
                            <td className="px-3 lg:px-4 py-3 sm:py-4">
                              <div className="text-sm text-gray-900 break-words max-w-[300px] lg:max-w-none">
                                {ac.address}
                              </div>
                            </td>
                            <td className="px-3 lg:px-4 py-3 sm:py-4">
                              <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200 break-all max-w-[200px]">
                                {ac.access_code}
                              </span>
                            </td>
                            <td className="px-3 lg:px-4 py-3 sm:py-4">
                              <span className="inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">
                                {ac.imageCount}
                              </span>
                            </td>
                            <td className="px-3 lg:px-4 py-3 sm:py-4">
                              <span className="text-sm text-gray-600 whitespace-nowrap">
                                {new Date(ac.created_at).toLocaleDateString()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Mobile Card View - Shown only on mobile */}
                <div className="md:hidden space-y-4">
                  {accessCodes.map((ac, index) => (
                    <div
                      key={ac.id}
                      onClick={() => openDetails(ac)}
                      className="bg-white border border-gray-200 rounded-xl shadow-sm p-4 hover:shadow-md transition-all cursor-pointer active:scale-[0.98]"
                    >
                      {/* Zip Code & Images Badge */}
                      <div className="flex items-center justify-between mb-3">
                        <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-semibold bg-blue-100 text-blue-800">
                          📍 {ac.zip_code}
                        </span>
                        <span className="inline-flex items-center justify-center px-2 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800 border border-indigo-200">
                          📷 {ac.imageCount}
                        </span>
                      </div>

                      // Complete accessCode.jsx continues...

                      {/* Address */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('address')}</p>
                        <p className="text-sm text-gray-900 break-words">{ac.address}</p>
                      </div>

                      {/* Access Code */}
                      <div className="mb-3">
                        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{t('accessCode')}</p>
                        <span className="inline-flex items-center px-3 py-1.5 rounded-lg text-sm font-medium bg-indigo-50 text-indigo-800 border border-indigo-200 break-all">
                          🔒 {ac.access_code}
                        </span>
                      </div>

                      {/* Created Date */}
                      <div className="pt-3 border-t border-gray-100">
                        <p className="text-xs text-gray-500 flex items-center">
                          <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                          </svg>
                          {t('createdAt')}: {new Date(ac.created_at).toLocaleDateString()}
                        </p>
                      </div>

                      {/* Tap to view indicator */}
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <p className="text-xs text-center text-gray-400 flex items-center justify-center">
                          <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                          {t('tapToViewDetails')}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex flex-wrap justify-center items-center gap-1 sm:gap-2 mt-8 mb-4 px-2">
                    {/* Previous Button */}
                    <button
                      onClick={() => handlePageChange(currentPage - 1)}
                      disabled={currentPage === 1}
                      className={`
                        group relative inline-flex items-center px-2 sm:px-4 py-2 text-xs sm:text-sm font-semibold 
                        rounded-lg border transition-all duration-200 ease-out transform
                        ${currentPage === 1
                          ? "bg-gray-50 text-gray-400 cursor-not-allowed border-gray-200"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 hover:shadow-md hover:scale-[1.02]"
                        }
                      `}
                    >
                      <svg className="w-3 h-3 sm:w-4 sm:h-4 sm:mr-2 transition-transform duration-200 group-hover:-translate-x-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M12.707 5.293a1 1 0 010 1.414L9.414 10l3.293 3.293a1 1 0 01-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                      <span className="hidden sm:inline">{t('previous')}</span>
                      <span className="sm:hidden">{t('prev')}</span>
                    </button>

                    {/* Page Numbers */}
                    <div className="flex flex-wrap gap-1 justify-center">
                      {getPaginationPages().map((page, index) => {
                        if (page === 'ellipsis-start' || page === 'ellipsis-end') {
                          return (
                            <span
                              key={`ellipsis-${index}`}
                              className="inline-flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 text-gray-500"
                            >
                              ...
                            </span>
                          );
                        }
                        return (
                          <button
                            key={page}
                            onClick={() => handlePageChange(page)}
                            className={`
                              group relative inline-flex items-center justify-center w-8 h-8 sm:w-10 sm:h-10 text-xs sm:text-sm font-semibold 
                              rounded-lg border transition-all duration-200 ease-out transform
                              ${page === currentPage
                                ? "bg-blue-600 text-white border-blue-600 shadow-lg shadow-blue-600/25 scale-105"
                                : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 hover:shadow-md hover:scale-[1.02]"
                              }
                            `}
                          >
                            <span className="relative">{page}</span>
                            {page === currentPage && (
                              <div className="absolute inset-0 bg-white opacity-10 rounded-lg animate-pulse"></div>
                            )}
                          </button>
                        );
                      })}
                    </div>

                    {/* Next Button */}
                    <button
                      onClick={() => handlePageChange(currentPage + 1)}
                      disabled={currentPage === totalPages}
                      className={`
                        group relative inline-flex items-center px-2 sm:px-4 py-2 text-xs sm:text-sm font-semibold 
                        rounded-lg border transition-all duration-200 ease-out transform
                        ${currentPage === totalPages
                          ? "bg-gray-50 text-gray-400 cursor-not-allowed border-gray-200"
                          : "bg-white text-gray-700 border-gray-300 hover:bg-gray-50 hover:text-gray-900 hover:border-gray-400 hover:shadow-md hover:scale-[1.02]"
                        }
                      `}
                    >
                      <span className="hidden sm:inline">{t('next')}</span>
                      <span className="sm:hidden">{t('next')}</span>
                      <svg className="w-3 h-3 sm:w-4 sm:h-4 sm:ml-2 transition-transform duration-200 group-hover:translate-x-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path
                          fillRule="evenodd"
                          d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z"
                          clipRule="evenodd"
                        />
                      </svg>
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>

      <Nav />
      <AccessCodeDetailsDialog
        open={detailsOpen}
        onClose={closeDetails}
        accessCode={selectedAccessCode}
      />
    </div>
  );
}