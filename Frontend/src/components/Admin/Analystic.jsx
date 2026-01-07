import React, { useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { fetchAnalyticsData } from '../../redux/slice/admin/analyticsSlice';

const Analystic = ({ viewType, selectedDate }) => {
  const dispatch = useDispatch();
  const { data, loading, error } = useSelector((state) => state.analytics);

  useEffect(() => {
    // Fetch analytics data whenever viewType or selectedDate changes
    if (selectedDate) {
      dispatch(fetchAnalyticsData({ 
        viewType, 
        date: selectedDate
      }));
    }
  }, [dispatch, viewType, selectedDate]);

  // Group data by driver and route, organizing sequences by issue type
  const groupedData = React.useMemo(() => {
    if (!data || data.length === 0) return [];

    const grouped = {};

    data.forEach((item) => {
      // Create a unique key for driver + route combination
      const key = `${item.driver_name}|${item.route}`;
      
      if (!grouped[key]) {
        grouped[key] = {
          driver_name: item.driver_name,
          route: item.route,
          no_scanned: [],
          double_stop: [],
          failed_attempt: []
        };
      }

      // Add sequences to respective issue arrays
      if (item.no_scanned > 0) {
        grouped[key].no_scanned.push(item.sequence);
      }
      if (item.double_stop > 0) {
        grouped[key].double_stop.push(item.sequence);
      }
      if (item.failed_attempt > 0) {
        grouped[key].failed_attempt.push(item.sequence);
      }
    });

    // Convert to array and sort sequences for each issue type
    return Object.values(grouped).map(group => ({
      ...group,
      no_scanned: group.no_scanned.sort((a, b) => a - b),
      double_stop: group.double_stop.sort((a, b) => a - b),
      failed_attempt: group.failed_attempt.sort((a, b) => a - b)
    }));
  }, [data]);

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
          {viewType === 'daily' ? 'Daily' : 'Weekly'} breakdown - showing sequences with issues
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
      ) : groupedData.length === 0 ? (
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
                  <div className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-orange-500"></span>
                    No Scanned
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-purple-200">
                  <div className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-green-500"></span>
                    Double Stop
                  </div>
                </th>
                <th className="px-4 py-3 text-left font-semibold text-gray-700 border-b-2 border-purple-200">
                  <div className="flex items-center gap-1">
                    <span className="inline-block w-2 h-2 rounded-full bg-red-500"></span>
                    Failed Attempt
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {groupedData.map((group, idx) => (
                <tr 
                  key={idx} 
                  className="hover:bg-gray-50 transition-colors border-b border-gray-200"
                >
                  <td className="px-4 py-3 font-medium text-gray-800">
                    {group.driver_name}
                  </td>
                  <td className="px-4 py-3 text-gray-600">
                    {group.route}
                  </td>
                  <td className="px-4 py-3">
                    {group.no_scanned.length > 0 ? (
                      <span className="px-3 py-1 bg-orange-50 text-orange-700 rounded-md text-xs font-semibold inline-block">
                        {group.no_scanned.join(', ')}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {group.double_stop.length > 0 ? (
                      <span className="px-3 py-1 bg-green-50 text-green-700 rounded-md text-xs font-semibold inline-block">
                        {group.double_stop.join(', ')}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {group.failed_attempt.length > 0 ? (
                      <span className="px-3 py-1 bg-red-50 text-red-700 rounded-md text-xs font-semibold inline-block">
                        {group.failed_attempt.join(', ')}
                      </span>
                    ) : (
                      <span className="text-gray-400 text-xs">-</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
};

export default Analystic;