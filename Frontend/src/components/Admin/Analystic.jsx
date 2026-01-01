import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchAnalyticsData } from '../../redux/slice/admin/analyticsSlice';

const Analystic = ({ viewType, selectedDate }) => {
  const dispatch = useDispatch();
  const { data, loading, error } = useSelector((state) => state.analytics);

  useEffect(() => {
    // Fetch analytics data whenever viewType or selectedDate changes
    if (selectedDate) {
      dispatch(fetchAnalyticsData({ viewType, date: selectedDate }));
    }
  }, [dispatch, viewType, selectedDate]);

  // Don't render if no data has been uploaded
  if (!data || data.length === 0) {
    return (
      <section className="bg-white rounded-xl shadow p-6 text-center">
        <div className="text-gray-400">
          <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-lg font-medium">No Analytics Data Available</p>
          <p className="text-sm mt-2">Upload an Excel file to see driver analytics</p>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-white rounded-xl shadow p-6">
      <div className="mb-4">
        <h2 className="font-bold text-xl text-gray-800 flex items-center gap-2">
          <svg className="w-6 h-6 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
          Driver Analytics
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          {viewType === 'daily' ? 'Daily' : 'Weekly'} breakdown by delivery status
        </p>
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
        </div>
      ) : error ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          {error}
        </div>
      ) : data.length === 0 ? (
        <div className="text-center py-8 text-gray-500">
          <p>No analytics data to display</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="bg-gradient-to-r from-purple-50 to-purple-100">
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-purple-200">
                  Driver Name
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-purple-200">
                  Route
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-purple-200">
                  Sequence
                </th>
                <th className="px-4 py-3 text-center font-semibold text-orange-700 border-b-2 border-purple-200 bg-orange-50">
                  No Scanned
                </th>
                <th className="px-4 py-3 text-center font-semibold text-green-700 border-b-2 border-purple-200 bg-green-50">
                  Double Stop
                </th>
                <th className="px-4 py-3 text-center font-semibold text-red-700 border-b-2 border-purple-200 bg-red-50">
                  Failed Attempt
                </th>
              </tr>
            </thead>
            <tbody>
              {data.map((driver, idx) => (
                <tr 
                  key={idx} 
                  className="hover:bg-gray-50 transition-colors border-b border-gray-200"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {driver.driver_name}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {driver.route}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {driver.sequence}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {driver.no_scanned > 0 ? (
                      <span className="inline-flex items-center justify-center w-12 h-8 bg-orange-100 text-orange-700 rounded-md font-semibold">
                        {driver.no_scanned}
                      </span>
                    ) : (
                      <span className="text-gray-300">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {driver.double_stop > 0 ? (
                      <span className="inline-flex items-center justify-center w-12 h-8 bg-green-100 text-green-700 rounded-md font-semibold">
                        {driver.double_stop}
                      </span>
                    ) : (
                      <span className="text-gray-300">N/A</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {driver.failed_attempt > 0 ? (
                      <span className="inline-flex items-center justify-center w-12 h-8 bg-red-100 text-red-700 rounded-md font-semibold">
                        {driver.failed_attempt}
                      </span>
                    ) : (
                      <span className="text-gray-300">N/A</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bg-gray-100 font-semibold">
                <td colSpan="3" className="px-4 py-3 text-right text-gray-700">
                  Total:
                </td>
                <td className="px-4 py-3 text-center text-orange-700">
                  {data.reduce((sum, d) => sum + d.no_scanned, 0)}
                </td>
                <td className="px-4 py-3 text-center text-green-700">
                  {data.reduce((sum, d) => sum + d.double_stop, 0)}
                </td>
                <td className="px-4 py-3 text-center text-red-700">
                  {data.reduce((sum, d) => sum + d.failed_attempt, 0)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  );
};

export default Analystic;