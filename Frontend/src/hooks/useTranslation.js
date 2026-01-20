// File: hooks/useTranslation.js

import { useSelector } from 'react-redux';
import { getTranslation } from './translation.js';

const useTranslation = () => {
  const { currentLanguage } = useSelector((state) => state.language);
  
  const t = (key) => getTranslation(key, currentLanguage);
  
  return { t, currentLanguage };
};

export default useTranslation;