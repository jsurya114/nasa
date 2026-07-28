import React, { useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { submitDriverAgreement } from '../../redux/slice/driver/driverSlice';
import { toast } from 'react-toastify';
import { useNavigate } from 'react-router-dom';

const DriverAgreement = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { loading, driver } = useSelector(state => state.driver);

  const [formData, setFormData] = useState({
    name: '',
    joining_date: '',
    agreed: false
  });

  // If already signed, they shouldn't be here, but just in case:
  if (driver?.agreement_signed) {
    navigate('/driver/dashboard');
    return null;
  }

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formData.agreed) {
      toast.error('You must agree to the terms to continue.');
      return;
    }
    if (!formData.name.trim() || !formData.joining_date) {
      toast.error('Please enter your name and joining date.');
      return;
    }

    try {
      await dispatch(submitDriverAgreement({
        name: formData.name,
        joining_date: formData.joining_date
      })).unwrap();
      
      toast.success('Agreement signed successfully!');
      navigate('/driver/dashboard');
    } catch (error) {
      toast.error(error.message || 'Failed to submit agreement');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 sm:px-6 lg:px-8 font-poppins">
      <div className="max-w-3xl w-full bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
        
        {/* Header */}
        <div className="bg-blue-900 text-white p-6 text-center">
          <h1 className="text-2xl font-bold uppercase tracking-wider">Independent Contractor Agreement</h1>
          <p className="mt-2 text-blue-200">NASA LOGISTICS CARRIERS LLC</p>
        </div>

        {/* Agreement Content - Scrollable */}
        <div className="p-8 h-96 overflow-y-auto text-gray-700 text-sm leading-relaxed space-y-6 bg-gray-50 border-b">
          <p>This Independent Contractor Agreement (“Agreement”) is entered into by and between:</p>
          
          <div className="bg-white p-4 rounded border border-gray-200">
            <ul className="font-semibold text-gray-900 space-y-1">
              <li>Company: NASA LOGISTICS CARRIERS LLC</li>
              <li>Owner: Abdul Rahiman</li>
            </ul>
            <p className="my-2 font-bold text-gray-500">AND</p>
            <ul className="font-semibold text-gray-900 space-y-1">
              <li>Contractor: {driver?.name}</li>
              <li>Date: {new Date().toLocaleDateString()}</li>
            </ul>
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
              <li>Any damaged package reported after leaving the warehouse will be the Contractor’s responsibility and charged at full value.</li>
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
              <li>Contractor must have a valid driver’s license and be 18–80 years old.</li>
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

        {/* Signature Form */}
        <form onSubmit={handleSubmit} className="p-8 bg-white space-y-6">
          <div className="bg-blue-50 border border-blue-100 rounded-lg p-5">
            <h3 className="text-sm font-bold text-blue-900 mb-4">12. Acknowledgment & Signature</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contractor Full Name</label>
                <input
                  type="text"
                  name="name"
                  value={formData.name}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter your full name"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date</label>
                <input
                  type="date"
                  name="joining_date"
                  value={formData.joining_date}
                  onChange={handleChange}
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500"
                  required
                />
              </div>
            </div>

            <div className="flex items-start">
              <div className="flex items-center h-5">
                <input
                  id="agreed"
                  name="agreed"
                  type="checkbox"
                  checked={formData.agreed}
                  onChange={handleChange}
                  className="w-5 h-5 text-blue-600 border-gray-300 rounded focus:ring-blue-500 cursor-pointer"
                  required
                />
              </div>
              <div className="ml-3 text-sm">
                <label htmlFor="agreed" className="font-medium text-gray-900 cursor-pointer">
                  I have read and agree to all terms
                </label>
                <p className="text-gray-500">By checking this box, I acknowledge that I am signing this agreement digitally and agree to be legally bound by its terms and conditions.</p>
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !formData.agreed || !formData.name || !formData.joining_date}
            className={`w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors ${
              (loading || !formData.agreed || !formData.name || !formData.joining_date) ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {loading ? 'Submitting...' : 'Submit Agreement'}
          </button>
        </form>
      </div>
    </div>
  );
};

export default DriverAgreement;
