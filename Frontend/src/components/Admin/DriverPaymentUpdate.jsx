import React from "react";
import { useDispatch,useSelector } from "react-redux";
import { fetchDriverPayment } from "../../redux/slice/admin/dashboardUpdateSlice";

export default function DriverPaymentSection({loadData}) {
  const dispatch = useDispatch();
  const { loading } = useSelector((state) => state.dashboard);

  // const handleClick = () => {
    
  // };

  return (
    <>
      {/* driver payment calculate button section */}
      <section className="card-surface mb-4 p-6 overflow-x-auto flex justify-center">
        <button
          onClick={loadData}
          className="px-3 py-1 bg-blue-800 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          disabled={loading}
        >
          {loading ? "Calculating..." : "Calculate Driver Payment"}
        </button>
      </section>
    </>
  );
}
