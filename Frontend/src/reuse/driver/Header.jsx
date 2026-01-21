import React, { useEffect, useState } from "react";
import logo from "../../assets/logo.png";
import { accessDriver, driverLogout } from "../../redux/slice/driver/driverSlice.js";
import { saveDriverLanguage, loadDriverLanguage } from "../../redux/slice/languageSlice.js";
import { useDispatch, useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import { Menu, X, Globe } from "lucide-react";
import useTranslation from "../../hooks/useTranslation.js";
import { toast } from "react-toastify";
import { getTranslation } from "../../hooks/translation.js";

function Header() {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const { driver } = useSelector((state) => state.driver);
  const { t, currentLanguage } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [langMenuOpen, setLangMenuOpen] = useState(false);

  useEffect(() => {
    dispatch(accessDriver());
  }, [dispatch]);

  useEffect(() => {
    if (driver?.id) {
      dispatch(loadDriverLanguage(driver.id));
    }
  }, [driver?.id, dispatch]);

  const handleLogout = () => {
    dispatch(driverLogout());
    navigate("/driver/login");
  };

  const handleLanguageChange = async (newLang) => {
    if (!driver?.id) {
      toast.error(t('error'));
      return;
    }

    try {
      await dispatch(saveDriverLanguage({ 
        driverId: driver.id, 
        language: newLang 
      })).unwrap();
      
      // IMPORTANT: Show success message in the NEW language (the one user just switched to)
      // NOT the old language
      const successMessage = getTranslation('updateSuccess', newLang);
      toast.success(successMessage);
    } catch (error) {
      // Show error in the NEW language as well, since that's what user wanted
      const errorMessage = getTranslation('actionFailed', newLang);
      toast.error(errorMessage);
    }
    
    setLangMenuOpen(false);
    setMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-50 flex items-center justify-between h-16 bg-[#462976] text-white px-4 border-b border-white/10">
      {/* Left Side (Hide on mobile) */}
      <div className="hidden md:block font-semibold text-sm md:text-lg">
        {t('dashboardDriver')}
      </div>

      {/* Center (Logo always centered) */}
      <div className="absolute left-1/2 transform -translate-x-1/2 md:static md:translate-x-0 md:left-auto">
        <img
          src={logo}
          alt="Logo"
          className="w-28 sm:w-40 md:w-56 object-contain"
        />
      </div>

      {/* Right Side - Desktop (≥768px) */}
      <div className="hidden md:flex items-center gap-3 text-sm md:text-base">
        {/* Language Selector */}
        <div className="relative">
          <button
            onClick={() => setLangMenuOpen(!langMenuOpen)}
            className="flex items-center gap-2 px-3 py-2 rounded-md hover:bg-white/10 transition-colors"
            aria-label={t('language')}
          >
            <Globe size={18} />
            <span className="font-medium">{currentLanguage.toUpperCase()}</span>
          </button>
          
          {langMenuOpen && (
            <div className="absolute right-0 mt-2 w-32 bg-white text-black rounded-md shadow-lg overflow-hidden z-50">
              <button
                onClick={() => handleLanguageChange('en')}
                className={`w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors ${
                  currentLanguage === 'en' ? 'bg-purple-50 text-[#462976] font-semibold' : ''
                }`}
              >
                English
              </button>
              <button
                onClick={() => handleLanguageChange('es')}
                className={`w-full text-left px-4 py-2 hover:bg-gray-100 transition-colors ${
                  currentLanguage === 'es' ? 'bg-purple-50 text-[#462976] font-semibold' : ''
                }`}
              >
                Español
              </button>
            </div>
          )}
        </div>

        {/* User Profile */}
        <div className="flex flex-col items-center">
          <div className="w-7 h-7 md:w-8 md:h-8 rounded-full bg-yellow-400 text-black font-bold grid place-items-center">
            👤
          </div>
          <div className="font-semibold truncate max-w-[120px] md:max-w-[150px]">
            {driver?.name}
          </div>
        </div>

        {/* Logout Button */}
        <button
          className="bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-md font-semibold transition-colors"
          onClick={handleLogout}
        >
          {t('logout')}
        </button>
      </div>

      {/* Hamburger Menu - Mobile (<768px) */}
      <div className="md:hidden relative ml-auto">
        <button onClick={() => setMenuOpen(!menuOpen)} aria-label="Toggle menu">
          {menuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>

        {/* Mobile dropdown */}
        {menuOpen && (
          <div className="absolute right-0 mt-2 w-48 bg-white text-black rounded-md shadow-lg z-50">
            <ul className="py-2 text-sm">
              <li className="px-4 py-2 border-b border-gray-200 font-medium text-[#462976]">
                {t('dashboardDriver')}
              </li>
              
              {/* Language Selection in Mobile */}
              <li className="px-4 py-2 border-b border-gray-200">
                <div className="flex items-center gap-2 mb-2 text-gray-600">
                  <Globe size={16} />
                  <span className="font-medium">{t('language')}</span>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleLanguageChange('en')}
                    className={`flex-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                      currentLanguage === 'en'
                        ? 'bg-[#462976] text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    EN
                  </button>
                  <button
                    onClick={() => handleLanguageChange('es')}
                    className={`flex-1 px-3 py-1 rounded text-xs font-medium transition-colors ${
                      currentLanguage === 'es'
                        ? 'bg-[#462976] text-white'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                  >
                    ES
                  </button>
                </div>
              </li>
              
              {/* User Info */}
              <li className="px-4 py-2 flex items-center gap-2 border-b border-gray-200">
                <span className="w-6 h-6 rounded-full bg-yellow-400 text-black text-xs grid place-items-center">
                  👤
                </span>
                <span className="truncate">{driver?.name}</span>
              </li>
              
              {/* Logout */}
              <li>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-red-600 hover:bg-red-50 font-medium transition-colors"
                >
                  {t('logout')}
                </button>
              </li>
            </ul>
          </div>
        )}
      </div>
    </header>
  );
}

export default Header;