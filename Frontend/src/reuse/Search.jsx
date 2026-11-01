import React from 'react';

function SearchBar({ value, onChange, placeholder = "Search..." }) {
  return (
    <div className="mb-4 px-4 pt-4 flex justify-end">
      <input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        className="w-full min-w-0 px-4 py-2.5 border border-line rounded-xl sm:w-64 focus:ring-2 focus:ring-brand-500/40 focus:border-brand-500 focus:outline-none"
      />
    </div>
  );
}

export default SearchBar;