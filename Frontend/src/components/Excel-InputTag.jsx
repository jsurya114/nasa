import { useState, useRef, forwardRef, useImperativeHandle } from "react";

import { X } from "lucide-react";

const FileUpload = forwardRef(function FileUpload({ onFileSelect }, ref) {
  const [file, setFile] = useState(null);
  const [error, setError] = useState("");
  const inputRef = useRef(null);

  const allowedTypes = [
    "application/vnd.ms-excel", // .xls
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
    "text/csv", // optional .csv
  ];

  const clearInput = () => {
    setFile(null);
    setError("");
    if (inputRef.current) inputRef.current.value = "";
    onFileSelect(null);
  };

  useImperativeHandle(ref, () => ({
    clear: clearInput,
  }));

  const handleChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      if (!allowedTypes.includes(selectedFile.type)) {
        setError("Please upload a valid Excel file (.xls, .xlsx, .csv)");
        clearInput();
      } else {
        setError("");
        setFile(selectedFile);
        onFileSelect(selectedFile); // send to parent
      }
    }
  };

  return (
    <div>
      <label className="block mb-1 font-medium">Excel File</label>
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept=".xls,.xlsx,.csv"
          onChange={handleChange}
          className={`file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-800 hover:file:bg-brand-100 file:cursor-pointer w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-purple-600 ${
            error ? "border-red-500" : "border-gray-300"
          }`}
        />
        {file && (
          <button
            type="button"
            onClick={clearInput}
            className="absolute right-2 grid h-8 w-8 place-items-center rounded-full bg-gray-100 text-gray-600 hover:bg-red-50 hover:text-red-600"
            aria-label="Remove selected file"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <p className="text-red-500 text-sm mt-1">{error}</p>}
      {file && !error && (
        <p className="text-green-600 text-sm mt-1">Selected: {file.name}</p>
      )}
    </div>
  );
});

export default FileUpload;
