export default function ThreeDToggle({ checked, onChange, label, ariaLabel, id, ariaDescribedBy, disabled = false }) {
  return (
    <div className="flex items-center gap-4">
      {label && <span className="text-sm font-semibold text-fg">{label}</span>}
      <button
        type="button"
        id={id}
        disabled={disabled}
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel || label || undefined}
        aria-describedby={ariaDescribedBy}
        onClick={() => onChange(!checked)}
        className={`group relative w-[60px] h-[28px] rounded-[28px] cursor-pointer border-0 p-0 overflow-hidden transition-all duration-300 shadow-[inset_0_1px_2px_rgba(255,255,255,0.5),inset_0_-1px_2px_rgba(0,0,0,0.15),0_1px_2px_rgba(0,0,0,0.12)] shrink-0 ${
          checked 
            ? 'bg-gradient-to-r from-[#00d85a] to-[#00c957]' 
            : 'bg-gradient-to-r from-[#c7d0dc] to-[#ff796e]'
        } ${disabled ? 'cursor-not-allowed opacity-60' : ''}`}
      >
        <span 
          className={`absolute top-1/2 -translate-y-1/2 text-[10px] font-bold z-10 pointer-events-none transition-all duration-300 ${
            checked ? 'left-[10px] text-white' : 'right-[8px] text-[#984b46]'
          }`}
        >
          {checked ? 'ON' : 'OFF'}
        </span>
        <div 
          className={`absolute w-[22px] h-[22px] top-[3px] rounded-full transition-all duration-300 z-20 shadow-[1px_2px_4px_rgba(0,0,0,0.18),inset_1px_1px_2px_rgba(255,255,255,0.9),inset_-1px_-1px_2px_rgba(0,0,0,0.08)] group-hover:shadow-[2px_3px_5px_rgba(0,0,0,0.22),inset_1px_1px_2px_rgba(255,255,255,0.9),inset_-1px_-1px_2px_rgba(0,0,0,0.08)] group-active:scale-95 ${
            checked ? 'left-[35px]' : 'left-[3px]'
          }`}
          style={{
            background: 'linear-gradient(145deg, #ffffff, #e1e6ee)'
          }}
        />
      </button>
    </div>
  )
}
