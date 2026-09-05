export function InstitutionalMark({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`flex items-center ${compact ? "gap-2.5" : "gap-3"}`}>
      <svg aria-label="Símbolo institucional de Oruro" className={compact ? "h-10 w-10 shrink-0" : "h-12 w-12 shrink-0"} viewBox="0 0 64 72" role="img">
        <path d="M13 16h38v27c0 13-8 21-19 26C21 64 13 56 13 43V16Z" fill="#f8c33a" />
        <path d="M17 20h30v22c0 10-6 17-15 22-9-5-15-12-15-22V20Z" fill="#0b7a6a" />
        <path d="m20 48 9-14 5 8 4-6 8 12H20Z" fill="#e9f5f2" />
        <path d="m11 14 7-7 5 7 9-10 9 10 5-7 7 7H11Z" fill="#f7be2c" />
        <path d="M8 19c-4 10-3 25 4 35M56 19c4 10 3 25-4 35" fill="none" stroke="#f7be2c" strokeLinecap="round" strokeWidth="3" />
        <circle cx="32" cy="25" r="4" fill="#e53d45" />
      </svg>
      <div className="min-w-0">
        <p className={`${compact ? "text-[13px]" : "text-[15px]"} font-black leading-tight tracking-[0.02em] text-white`}>GOBERNACIÓN</p>
        <p className={`${compact ? "text-[13px]" : "text-[15px]"} font-black leading-tight tracking-[0.02em] text-white`}>DE ORURO</p>
      </div>
    </div>
  );
}
