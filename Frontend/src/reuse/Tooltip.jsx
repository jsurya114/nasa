const Tooltip = ({ show, text, children }) => {
  if (!show) return children;

  return (
    <div className="relative group inline-block">
      {children}
      <div className="absolute -top-9 left-1/2 -translate-x-1/2 
        bg-black text-white text-xs px-2 py-1 rounded 
        opacity-0 group-hover:opacity-100 transition pointer-events-none whitespace-nowrap">
        {text}
      </div>
    </div>
  );
};
export default Tooltip