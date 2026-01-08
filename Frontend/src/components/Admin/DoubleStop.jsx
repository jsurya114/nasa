import React, { useState, useCallback, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";
import {
  excelDailyFileUpload,
  excelWeeklyFileUpload,
} from "../../redux/slice/admin/excelSlice";
import { fetchDashboardData, fetchWeeklyTempData } from "../../redux/slice/admin/doublestopSlice";
import { fetchDriverPayment, updateWeeklyExcelToDashboard } from "../../redux/slice/admin/dashboardUpdateSlice";
import FileUpload from "../../../src/components/Excel-InputTag";
import UploadedData from "../../reuse/UploadedData";
import Header from "../../reuse/Header";
import Nav from "../../reuse/Nav";
import DriverPaymentSection from "./DriverPaymentUpdate";
import TempUploadedData from "../../reuse/TempUploadedData";
import { toast } from "react-toastify";
import Analystic from "./Analystic";

const DoubleStop = () => {
  const dispatch = useDispatch();
  const [activeView, setActiveView] = useState("weekly");
  const [selectedDate, setSelectedDate] = useState(
    new Date().toLocaleDateString("en-CA")
  );

  const [file, setFile] = useState(null);
  const [weeklyErrors, setWeeklyErrors] = useState({});

  // Daily form state
  const [dailyForm, setDailyForm] = useState({
    date: "",
    file: null,
  });
  const [dailyErrors, setDailyErrors] = useState({});
  const dailyFileRef = useRef(null);

  // Daily input handler
  const handleDailyChange = (e) => {
    const { name, value, type, files } = e.target;
    setDailyForm((prev) => ({
      ...prev,
      [name]: type === "file" ? files[0] : value,
    }));
  };

  // Weekly submit
  const handleWeeklySubmit = (e) => {
    e.preventDefault();
    let errors = {};
    if (!file) errors.file = "Excel file is required";

    setWeeklyErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const formData = new FormData();
    formData.append("file", file);
    
    dispatch(excelWeeklyFileUpload(formData))
      .unwrap()
      .then(() => {
        toast.success("Weekly Excel upload completed!!");
        setFile(null);
      })
      .catch((err) => {
        toast.error("Error while processing weekly upload");
      });
  };

  // Daily submit
  const handleDailySubmit = (e) => {
    e.preventDefault();
    let errors = {};
    if (!dailyForm.file) errors.file = "Excel file is required";

    setDailyErrors(errors);
    if (Object.keys(errors).length > 0) return;

    const formData = new FormData();
    formData.append("file", dailyForm.file);
    formData.append("uploadDate", selectedDate);
    
    dispatch(excelDailyFileUpload(formData))
      .unwrap()
      .then(() => {
        toast.success("Daily file uploaded successfully");

        // Refresh dashboard for selected date with default pagination
        dispatch(fetchDashboardData({ 
          selectedDate: selectedDate, 
          page: 1, 
          limit: 10 
        }));

        if (dailyFileRef.current?.clear) {
          dailyFileRef.current.clear();
        }

        setDailyForm((prev) => ({ ...prev, file: null }));
      })
      .catch((err) => {
        const msg = typeof err === "string" ? err : err?.message || "Upload failed";
        toast.error(msg);
      });
  };

  const loadWeeklyData = useCallback((page,limit) => {
    dispatch(fetchWeeklyTempData({page,limit}));
  }, [dispatch]);

  // Fixed: Properly pass all three parameters
  const loadDailyData = useCallback((date, page = 1, limit = 10) => {
    // Ensure we have a valid date
    const dateToUse = date || selectedDate;
    
    if (!dateToUse) {
      console.error("No date provided to loadDailyData");
      toast.error("Please select a date first");
      return;
    }

    dispatch(fetchDashboardData({ 
      selectedDate: dateToUse, 
      page, 
      limit 
    }));
  }, [dispatch, selectedDate]);

  // Handle date change
  const handleDateChange = (e) => {
    const newDate = e.target.value;
    setSelectedDate(newDate);
    
    // Only load data if we're in daily view and have a valid date
    if (activeView === "daily" && newDate) {
      loadDailyData(newDate, 1, 10);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 text-gray-900 font-poppins">
      <Header />

      {/* Toggle */}
      <div className="flex items-center justify-center pt-6 pb-4">
        <div className="relative bg-white rounded-full p-1 shadow-md border border-gray-200">
          <div
            className={`absolute top-1 bottom-1 bg-purple-600 rounded-full transition-all duration-300 ease-in-out ${
              activeView === "weekly" ? "left-1 right-1/2" : "left-1/2 right-1"
            }`}
          />
          <button
            onClick={() => setActiveView("weekly")}
            className={`relative z-10 px-6 py-2 rounded-full font-medium transition-colors duration-300 ${
              activeView === "weekly"
                ? "text-white"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            Weekly
          </button>
          <button
            onClick={() => setActiveView("daily")}
            className={`relative z-10 px-6 py-2 rounded-full font-medium transition-colors duration-300 ${
              activeView === "daily"
                ? "text-white"
                : "text-gray-600 hover:text-gray-800"
            }`}
          >
            Daily
          </button>
        </div>
      </div>

      <main className="max-w-[1450px] mx-auto p-4 pb-40">
        {/* Weekly Form */}
        {activeView === "weekly" && (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4 p-6">
            <h2 className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3 -mx-6 -mt-6 rounded-t-xl">
              Weekly Upload
            </h2>
            <form
              onSubmit={handleWeeklySubmit}
              className="flex flex-col gap-4 mt-6"
            >
              <div>
                <FileUpload onFileSelect={setFile} />
                {weeklyErrors.file && (
                  <p className="text-red-500 text-sm mt-1">
                    {weeklyErrors.file}
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2 bg-purple-700 text-white rounded-lg shadow hover:bg-purple-800"
                
                >
                  Upload Weekly Data
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Daily Form */}
        {activeView === "daily" && (
          <section className="bg-white border border-gray-200 rounded-xl shadow-sm mb-4 p-6">
            <h2 className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3 -mx-6 -mt-6 rounded-t-xl">
              Daily Upload
            </h2>
            <form
              onSubmit={handleDailySubmit}
              className="flex flex-col gap-4 mt-6"
            >
              <div>
                <label className="block mb-1 font-medium">Date</label>
                <input
                  type="date"
                  value={selectedDate}
                  onChange={handleDateChange}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-600"
                />
              </div>

              <div>
                <FileUpload
                  ref={dailyFileRef}
                  onFileSelect={(f) => setDailyForm({ ...dailyForm, file: f })}
                />
                {dailyErrors.file && (
                  <p className="text-red-500 text-sm mt-1">
                    {dailyErrors.file}
                  </p>
                )}
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  className="px-6 py-2 bg-purple-700 text-white rounded-lg shadow hover:bg-purple-800"
                >
                  Upload Daily Data
                </button>
              </div>
            </form>
          </section>
        )}

        {/* Uploaded Data */}
        <section className="bg-white border mb-3 border-gray-200 rounded-xl shadow-sm overflow-x-auto">
          <h2 className="font-bold text-gray-900 bg-gray-50 border-b border-gray-200 px-4 py-3 rounded-t-xl">
            {activeView === "weekly" ? "Weekly Data" : "Daily Data"}
          </h2>
          <div className="p-4">
            {activeView === "weekly" ? (
              <TempUploadedData viewType="weekly" loadData={loadWeeklyData} />
            ) : (
              <UploadedData 
                viewType="daily" 
                loadData={loadDailyData}
                selectedDate={selectedDate}
              />
            )}
          </div>
        </section>

        {/* Analytics Section */}
        <div className="mb-3">
          <Analystic 
            viewType={activeView} 
            selectedDate={selectedDate} 
          />
        </div>

        {/* Driver Payment Section */}
        {activeView === "weekly" ? (
          <DriverPaymentSection
            loadData={() => {
              dispatch(updateWeeklyExcelToDashboard())
                .unwrap()
                .then((res) => {
                  toast.success(res.message);
                })
                .catch((err) => {
                  toast.error(err?.message || "Something went wrong");
                });
            }}
          />
        ) : (
          <DriverPaymentSection 
            loadData={() => dispatch(fetchDriverPayment(selectedDate))}
          />
        )}
      </main>

      <Nav />
    </div>
  );
};

export default DoubleStop;