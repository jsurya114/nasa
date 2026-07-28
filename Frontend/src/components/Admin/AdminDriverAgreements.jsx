import React, { useEffect, useState } from 'react';
import axios from '../../redux/slice/axiosInstance';
import { toast } from 'react-toastify';
import Header from '../../reuse/Header';
import Nav from '../../reuse/Nav';
import SearchBar from '../../reuse/Search';
import { X } from 'lucide-react';

const AgreementModal = ({ isOpen, onClose, driverName }) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        
        {/* Modal Header */}
        <div className="bg-blue-900 text-white p-5 rounded-t-2xl flex items-center justify-between">
          <div>
            <h2 className="text-xl font-bold uppercase tracking-wider">Independent Contractor Agreement</h2>
            <p className="text-blue-200 text-sm mt-1">NASA LOGISTICS CARRIERS LLC</p>
          </div>
          <button onClick={onClose} className="text-white/70 hover:text-white transition p-1">
            <X size={24} />
          </button>
        </div>

        {/* Scrollable Content */}
        <div className="p-8 overflow-y-auto text-gray-700 text-sm leading-relaxed space-y-6 flex-1">
          <p>This Independent Contractor Agreement ("Agreement") is entered into by and between:</p>
          
          <div className="bg-gray-50 p-4 rounded border border-gray-200">
            <ul className="font-semibold text-gray-900 space-y-1">
              <li>Company: NASA LOGISTICS CARRIERS LLC</li>
              <li>Owner: Abdul Rahiman</li>
            </ul>
            {driverName && (
              <>
                <p className="my-2 font-bold text-gray-500">AND</p>
                <ul className="font-semibold text-gray-900 space-y-1">
                  <li>Contractor: {driverName}</li>
                </ul>
              </>
            )}
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">1. Nature of Relationship</h3>
            <p>The Contractor agrees and acknowledges that they are an independent contractor and not an employee of NASA LOGISTICS CARRIERS LLC. The Contractor is not entitled to employee benefits, insurance (except as stated), or tax withholdings.</p>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">2. Payment Terms</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Payments will be made according to the payment schedule provided upon sign-up.</li>
              <li>Payment is based on completed deliveries only.</li>
              <li>Each delivery must include 4 valid required delivery photos.</li>
              <li>Per-package rate varies depending on the assigned route and will be discussed upon sign-up.</li>
              <li>A second package delivered to the same door will be paid at a lower rate than of first package, price for second package will be discussed during sign up.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">3. Delivery Requirements</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Contractor must take 4 compliant photos per delivery.</li>
              <li>Contractor must follow all delivery procedures and compliance requirements at all times.</li>
              <li><span className="font-semibold text-red-600">Violent delivery (throwing or tossing packages) will result in a $300 deduction per incident.</span> (Regardless of the package content)</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">4. Package Responsibility & Penalties</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Any misdelivered package that is unrecoverable will be charged at full package value of package.</li>
              <li>Any package delivered to an unauthorized location, left unattended in a lobby, or left on grass (unless fenced/secured single family house) will result in a <span className="font-semibold text-red-600">$100 charge</span> per package if not recovered.</li>
              <li><span className="font-semibold text-red-600">Delivering to a mailbox under any circumstance is strictly prohibited and will result in a $500 charge per package.</span></li>
              <li>Any package lost after leaving the warehouse will be charged at full package value.</li>
              <li>If a package is missing before leaving the warehouse, the Contractor must report it immediately via the designated WhatsApp group. (If not reported in group full value will be charged)</li>
              <li>Any damaged package reported after leaving the warehouse will be the Contractor's responsibility and charged at full value.</li>
              <li>Contractor must attempt recovery of any misdelivered package within 24 hours of notice.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">5. Attendance & Work Schedule</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Contractor must report to work at 5:30 AM.</li>
              <li>Repeated lateness will result in termination.</li>
              <li>Contractor must set weekly availability every Sunday.</li>
              <li>No same-day call-offs in the morning.</li>
              <li>If unable to work, Contractor must notify by 7:00 PM the previous day.</li>
              <li>Failure to show up after confirming availability will result in termination.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">6. Route Assignment</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Contractors do not choose routes.</li>
              <li>Once assigned, routes cannot be changed or disputed.</li>
              <li>Refusal to accept assigned routes or packages will result in immediate termination.</li>
              <li>The Contractor shall not contact company management, supervisors, or administrative personnel to dispute, complain about, or express personal preferences regarding assigned routes.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">7. Work Completion</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>All assigned deliveries must be completed by 9:00 PM.</li>
              <li>Consistently finishing after 9:00 PM may result in reduced package assignments.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">8. Conduct Policy</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>No fighting, arguing, or use of abusive language.
                <ul className="list-none pl-5 mt-1 text-red-600 font-semibold">
                  <li>- First occurrence: $100 fine</li>
                  <li>- Second occurrence: Immediate termination</li>
                </ul>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">9. Occupational Accident Insurance (for GOFO drivers, not applicable for SpeedX or other drivers)</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>A daily fee of $1.92 per working day will be charged.</li>
              <li>Coverage applies only from arrival at the warehouse through completion of delivery duties.</li>
              <li>Commute to and from home is NOT covered.</li>
            </ul>
            <p className="mt-2 font-semibold">Coverage Includes:</p>
            <ul className="list-disc pl-5">
              <li>Accidental death & dismemberment (up to $300,000)</li>
              <li>Medical expenses (up to $1,000,000)</li>
              <li>Temporary disability</li>
              <li>Occupational trauma</li>
              <li>Assault, carjacking, and related coverage</li>
            </ul>
            <p className="mt-2 font-semibold text-red-600">Important Notes:</p>
            <ul className="list-disc pl-5 text-red-600">
              <li>Contractor must have a valid driver's license and be 18–80 years old.</li>
              <li>This insurance covers ONLY the Contractor. It does NOT cover vehicle damage, property damage, or passengers.</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">10. Liability & Damages</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>Contractor is fully responsible for vehicle damage, personal property damage, and third-party property damage.</li>
              <li>Drivers must NOT drive on grass or lawns, or damage fences, gates, mailboxes, or vehicles.</li>
              <li>Any customer-reported damage to their property will be invoiced and charged to the Contractor. (Driver)</li>
            </ul>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-2 border-b pb-1">11. General Compliance</h3>
            <ul className="list-disc pl-5 space-y-1">
              <li>The Contractor is required to inspect all packages and verify that every assigned package is in their possession before leaving the warehouse. Once the Contractor exits the warehouse, they assume full responsibility for any missing or lost packages and full value will be deducted.</li>
              <li>Contractor agrees to follow all company policies and delivery standards.</li>
            </ul>
          </div>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t bg-gray-50 rounded-b-2xl flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2 bg-gray-200 text-gray-700 rounded-md hover:bg-gray-300 transition font-medium text-sm"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

const AdminDriverAgreements = () => {
  const [drivers, setDrivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedDriverName, setSelectedDriverName] = useState('');

  const fetchAgreements = async () => {
    setLoading(true);
    try {
      const { data } = await axios.get('/admin/drivers/agreements');
      if (data.success) {
        setDrivers(data.data);
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to fetch agreements');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAgreements();
  }, []);

  const handleToggleAgreement = async (id, currentStatus) => {
    if (!currentStatus) return;

    if (!window.confirm("Are you sure you want to revoke this driver's agreement? They will be forced to re-sign on their next login.")) {
      return;
    }

    try {
      const { data } = await axios.put(`/admin/drivers/${id}/agreement/toggle`, {
        status: false
      });
      if (data.success) {
        toast.success(data.message);
        setDrivers(prev => prev.map(d => 
          d.id === id 
            ? { ...d, agreement_signed: false, agreement_signed_at: null, agreement_signature_name: null, agreement_joining_date: null } 
            : d
        ));
      }
    } catch (error) {
      toast.error(error.response?.data?.message || 'Failed to update agreement status');
    }
  };

  const handleViewAgreement = (driverName) => {
    setSelectedDriverName(driverName || '');
    setModalOpen(true);
  };

  const filteredDrivers = drivers.filter(driver => 
    driver.name?.toLowerCase().includes(searchQuery.toLowerCase()) || 
    driver.driver_code?.toString().toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <>
      <Header />
      <div className="p-4 font-poppins min-h-screen bg-gray-50 mt-14 pb-28">
        <div className="max-w-7xl mx-auto">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-6 gap-4">
            <div>
              <h1 className="text-2xl font-bold text-gray-800">Driver Agreements</h1>
              <p className="text-gray-500 text-sm mt-1">Manage and revoke driver independent contractor agreements.</p>
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => handleViewAgreement('')}
                className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition text-sm font-medium whitespace-nowrap"
              >
                📄 View Agreement
              </button>
              <div className="w-full md:w-72">
                <SearchBar 
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search by name or code..."
                />
              </div>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left text-gray-500">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-4">Driver</th>
                    <th className="px-6 py-4">Status</th>
                    <th className="px-6 py-4">Signature Details</th>
                    <th className="px-6 py-4">Joining Date</th>
                    <th className="px-6 py-4 text-center">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8">Loading agreements...</td>
                    </tr>
                  ) : filteredDrivers.length === 0 ? (
                    <tr>
                      <td colSpan="5" className="text-center py-8">No drivers found.</td>
                    </tr>
                  ) : (
                    filteredDrivers.map(driver => (
                      <tr key={driver.id} className="bg-white border-b hover:bg-gray-50">
                        <td className="px-6 py-4">
                          <div className="font-semibold text-gray-900">{driver.name}</div>
                          <div className="text-xs text-gray-500">{driver.driver_code}</div>
                        </td>
                        <td className="px-6 py-4">
                          {driver.agreement_signed ? (
                            <span className="bg-green-100 text-green-800 text-xs font-medium px-2.5 py-1 rounded-full">
                              Signed
                            </span>
                          ) : (
                            <span className="bg-amber-100 text-amber-800 text-xs font-medium px-2.5 py-1 rounded-full">
                              Pending
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {driver.agreement_signed ? (
                            <div>
                              <div className="font-medium text-gray-800">{driver.agreement_signature_name}</div>
                              <div className="text-xs text-gray-500">
                                {new Date(driver.agreement_signed_at).toLocaleString()}
                              </div>
                            </div>
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4">
                          {driver.agreement_joining_date ? (
                            new Date(driver.agreement_joining_date).toLocaleDateString()
                          ) : (
                            <span className="text-gray-400">-</span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {driver.agreement_signed && (
                              <>
                                <button
                                  onClick={() => handleViewAgreement(driver.name)}
                                  className="text-blue-600 hover:text-blue-900 hover:bg-blue-50 px-3 py-1 rounded-md text-xs font-medium transition-colors border border-blue-200"
                                >
                                  View
                                </button>
                                <button
                                  onClick={() => handleToggleAgreement(driver.id, driver.agreement_signed)}
                                  className="text-red-600 hover:text-red-900 hover:bg-red-50 px-3 py-1 rounded-md text-xs font-medium transition-colors border border-red-200"
                                >
                                  Revoke
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
      <Nav />
      <AgreementModal 
        isOpen={modalOpen} 
        onClose={() => setModalOpen(false)} 
        driverName={selectedDriverName}
      />
    </>
  );
};

export default AdminDriverAgreements;
