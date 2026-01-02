import React from "react";

export default function Loader() {
  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        {/* Spinner */}
        <div className="relative w-14 h-14">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200" />
          <div className="absolute inset-0 rounded-full border-4 border-purple-600 border-t-transparent animate-spin" />
        </div>

        {/* Text */}
        <p className="text-sm font-semibold text-gray-700 tracking-wide">
          Loading, please wait...
        </p>
      </div>
    </div>
  );
}
