// Pure rule for the setup form: which fields are wrong (translation keys by field).
export const validateDetails = (values, needsStartDate) => {
  const errors = {};
  if (!values.line1.trim()) errors.line1 = "psetFieldLine1Required";
  if (!values.city.trim()) errors.city = "psetFieldCityRequired";
  if (!/^[A-Za-z]{2}$/.test(values.state.trim())) errors.state = "psetFieldStateInvalid";
  if (!/^\d{5}$/.test(values.postalCode.trim())) errors.postalCode = "psetFieldZipInvalid";
  if (needsStartDate && !/^\d{4}-\d{2}-\d{2}$/.test(values.startDate)) errors.startDate = "psetFieldStartRequired";
  return errors;
};

