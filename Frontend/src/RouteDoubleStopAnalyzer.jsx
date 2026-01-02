import React, { useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts';

const RouteDoubleStopAnalyzer = () => {
  const [fileData, setFileData] = useState(null);
  const [analysis, setAnalysis] = useState(null);
  const [loading, setLoading] = useState(false);

  const analyzeDoubleStops = (data) => {
    // Group by route, date, driver, address (and unit)
    const grouped = {};
    
    data.forEach(row => {
      const route = row.Route || 'Unknown';
      const address = row.Address || 'Unknown';
      const unit = row.Unit || 'NO_UNIT';
      const sequence = row.Sequence;
      
      // Create a unique key for grouping: route + address + unit
      const groupKey = `${route}|${address}|${unit}`;
      
      if (!grouped[groupKey]) {
        grouped[groupKey] = {
          route: route,
          address: address,
          unit: unit,
          deliveries: []
        };
      }
      
      grouped[groupKey].deliveries.push({
        sequence: sequence,
        trackingNo: row.TrackingNo
      });
    });

    // Calculate first stops and double stops per route
    const routeStats = {};
    
    Object.values(grouped).forEach(group => {
      const route = group.route;
      const count = group.deliveries.length;
      
      if (!routeStats[route]) {
        routeStats[route] = {
          route: route,
          firstStops: 0,
          doubleStops: 0,
          totalPackages: 0
        };
      }
      
      routeStats[route].totalPackages += count;
      
      if (count === 1) {
        // Single delivery to this address = First Stop
        routeStats[route].firstStops += 1;
      } else {
        // Multiple deliveries to same address
        routeStats[route].firstStops += 1; // First one is first stop
        routeStats[route].doubleStops += (count - 1); // Rest are double stops
      }
    });

    // Convert to array and sort by route name
    const statsArray = Object.values(routeStats).sort((a, b) => 
      a.route.localeCompare(b.route)
    );

    // Calculate totals
    const totals = statsArray.reduce((acc, stat) => ({
      firstStops: acc.firstStops + stat.firstStops,
      doubleStops: acc.doubleStops + stat.doubleStops,
      totalPackages: acc.totalPackages + stat.totalPackages
    }), { firstStops: 0, doubleStops: 0, totalPackages: 0 });

    return { routeStats: statsArray, totals };
  };

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    
    try {
      const arrayBuffer = await file.arrayBuffer();
      const data = new Uint8Array(arrayBuffer);
      
      // Using SheetJS to parse Excel
      const workbook = XLSX.read(data, { type: 'array' });
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet);
      
      setFileData(jsonData);
      const result = analyzeDoubleStops(jsonData);
      setAnalysis(result);
    } catch (error) {
      console.error('Error parsing file:', error);
      alert('Error parsing file. Please make sure it\'s a valid Excel file.');
    } finally {
      setLoading(false);
    }
  };

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-2xl shadow-xl p-8 mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-2">
            📦 Route Double Stop Analyzer
          </h1>
          <p className="text-gray-600 mb-6">
            Upload your route Excel file to analyze first stops vs double stops per route
          </p>
          
          <div className="flex items-center gap-4">
            <label className="flex-1">
              <div className="relative border-2 border-dashed border-blue-300 rounded-xl p-8 hover:border-blue-500 transition-all cursor-pointer bg-blue-50 hover:bg-blue-100">
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  onChange={handleFileUpload}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                />
                <div className="text-center">
                  <svg className="mx-auto h-12 w-12 text-blue-500 mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                  </svg>
                  <p className="text-lg font-semibold text-gray-700">
                    Click to upload Excel file
                  </p>
                  <p className="text-sm text-gray-500 mt-1">
                    Supports .xlsx and .xls formats
                  </p>
                </div>
              </div>
            </label>
          </div>
        </div>

        {loading && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <div className="inline-block animate-spin rounded-full h-16 w-16 border-4 border-blue-500 border-t-transparent"></div>
            <p className="mt-4 text-gray-600 font-medium">Analyzing data...</p>
          </div>
        )}

        {analysis && !loading && (
          <>
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-blue-100 text-sm font-medium">Total Packages</p>
                    <p className="text-4xl font-bold mt-2">{analysis.totals.totalPackages}</p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-green-100 text-sm font-medium">First Stops</p>
                    <p className="text-4xl font-bold mt-2">{analysis.totals.firstStops}</p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                </div>
              </div>

              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl shadow-lg p-6 text-white">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-orange-100 text-sm font-medium">Double Stops</p>
                    <p className="text-4xl font-bold mt-2">{analysis.totals.doubleStops}</p>
                  </div>
                  <div className="bg-white bg-opacity-20 rounded-full p-4">
                    <svg className="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
                    </svg>
                  </div>
                </div>
              </div>
            </div>

            {/* Detailed Table */}
            <div className="bg-white rounded-2xl shadow-xl overflow-hidden mb-8">
              <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-4">
                <h2 className="text-2xl font-bold text-white">📊 Route Breakdown</h2>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b-2 border-gray-200">
                    <tr>
                      <th className="px-6 py-4 text-left text-sm font-semibold text-gray-700">Route</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Total Packages</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">First Stops</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">Double Stops</th>
                      <th className="px-6 py-4 text-center text-sm font-semibold text-gray-700">DS Rate</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {analysis.routeStats.map((stat, index) => {
                      const dsRate = ((stat.doubleStops / stat.totalPackages) * 100).toFixed(1);
                      return (
                        <tr key={index} className="hover:bg-gray-50 transition-colors">
                          <td className="px-6 py-4 font-medium text-gray-900">{stat.route}</td>
                          <td className="px-6 py-4 text-center text-gray-700">{stat.totalPackages}</td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-green-100 text-green-800 px-3 py-1 rounded-full font-semibold">
                              {stat.firstStops}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <span className="bg-orange-100 text-orange-800 px-3 py-1 rounded-full font-semibold">
                              {stat.doubleStops}
                            </span>
                          </td>
                          <td className="px-6 py-4 text-center">
                            <div className="flex items-center justify-center gap-2">
                              <div className="w-32 bg-gray-200 rounded-full h-2">
                                <div 
                                  className="bg-orange-500 h-2 rounded-full transition-all"
                                  style={{ width: `${dsRate}%` }}
                                ></div>
                              </div>
                              <span className="text-sm font-medium text-gray-700 w-12">{dsRate}%</span>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                    <tr className="bg-blue-50 font-bold border-t-2 border-blue-300">
                      <td className="px-6 py-4 text-gray-900">TOTAL</td>
                      <td className="px-6 py-4 text-center text-gray-900">{analysis.totals.totalPackages}</td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-green-200 text-green-900 px-3 py-1 rounded-full">
                          {analysis.totals.firstStops}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center">
                        <span className="bg-orange-200 text-orange-900 px-3 py-1 rounded-full">
                          {analysis.totals.doubleStops}
                        </span>
                      </td>
                      <td className="px-6 py-4 text-center text-gray-900">
                        {((analysis.totals.doubleStops / analysis.totals.totalPackages) * 100).toFixed(1)}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              {/* Bar Chart */}
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4">First Stops vs Double Stops</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <BarChart data={analysis.routeStats}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="route" angle={-45} textAnchor="end" height={100} />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Bar dataKey="firstStops" fill="#10b981" name="First Stops" />
                    <Bar dataKey="doubleStops" fill="#f59e0b" name="Double Stops" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              {/* Pie Chart */}
              <div className="bg-white rounded-2xl shadow-xl p-6">
                <h3 className="text-xl font-bold text-gray-800 mb-4">Overall Distribution</h3>
                <ResponsiveContainer width="100%" height={300}>
                  <PieChart>
                    <Pie
                      data={[
                        { name: 'First Stops', value: analysis.totals.firstStops },
                        { name: 'Double Stops', value: analysis.totals.doubleStops }
                      ]}
                      cx="50%"
                      cy="50%"
                      labelLine={false}
                      label={({ name, percent }) => `${name}: ${(percent * 100).toFixed(1)}%`}
                      outerRadius={100}
                      fill="#8884d8"
                      dataKey="value"
                    >
                      <Cell fill="#10b981" />
                      <Cell fill="#f59e0b" />
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </>
        )}

        {!analysis && !loading && (
          <div className="bg-white rounded-2xl shadow-xl p-12 text-center">
            <svg className="mx-auto h-24 w-24 text-gray-300 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            <p className="text-gray-500 text-lg">Upload an Excel file to begin analysis</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default RouteDoubleStopAnalyzer;