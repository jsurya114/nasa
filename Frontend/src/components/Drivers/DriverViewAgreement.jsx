import React from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import Header from '../../reuse/driver/Header';
import Nav from '../../reuse/driver/Nav';

const DriverViewAgreement = () => {
  const { driver } = useSelector(state => state.driver);

  return (
    <>
      <Header />
      <div className="min-h-screen bg-gray-50 flex flex-col items-center py-10 px-4 sm:px-6 lg:px-8 font-poppins pb-36 mt-16">
        <div className="max-w-3xl w-full bg-white shadow-xl rounded-2xl overflow-hidden border border-gray-100">
          
          {/* Header */}
          <div className="bg-blue-900 text-white p-6 text-center">
            <h1 className="text-2xl font-bold uppercase tracking-wider">Independent Contractor Agreement</h1>
            <p className="mt-2 text-blue-200">NASA LOGISTICS CARRIERS LLC</p>
          </div>

          {/* Agreement Content - Scrollable */}
          <div className="p-8 text-gray-700 text-sm leading-relaxed space-y-6 bg-gray-50 border-b">
            <p>This Independent Contractor Agreement (“Agreement”) is entered into by and between:</p>
            
            <div className="bg-white p-4 rounded border border-gray-200">
              <ul className="font-semibold text-gray-900 space-y-1">
                <li>Company: NASA LOGISTICS CARRIERS LLC</li>
                <li>Owner: Abdul Rahiman</li>
              </ul>
              <p className="my-2 font-bold text-gray-500">AND</p>
              <ul className="font-semibold text-gray-900 space-y-1">
                <li>Contractor: {driver?.name}</li>
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

          {/* Signature Badge */}
          <div className="p-8 bg-white flex flex-col items-center justify-center space-y-4">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center shadow-inner">
              <span className="text-3xl">✅</span>
            </div>
            <div className="text-center">
              <h2 className="text-xl font-bold text-gray-900">Agreement Digitally Signed</h2>
              <p className="text-sm text-gray-500 mt-1">You have read and agreed to these terms.</p>
            </div>
            <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mt-4 w-full md:w-1/2 text-center">
              <p className="text-gray-700 font-semibold">{driver?.name}</p>
            </div>
          </div>
        </div>
      </div>
      <Nav />
    </>
  );
};

export default DriverViewAgreement;
