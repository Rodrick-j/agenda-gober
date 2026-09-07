import Image from "next/image";

interface InstitutionalMarkProps {
  compact?: boolean;
  vertical?: boolean;
  className?: string;
}

export function InstitutionalMark({ compact = false, vertical = false, className }: InstitutionalMarkProps) {
  if (vertical) {
    return (
      <Image
        src="/images/imagotipo-gador-2026-vertical.png"
        alt="Gobernación de Oruro"
        width={544}
        height={811}
        className={className ?? (compact ? "h-auto w-24" : "h-auto w-40 xl:w-56")}
      />
    );
  }

  return (
    <Image
      src="/images/imagotipo-gador-2026.png"
      alt="Gobernación de Oruro"
      width={1073}
      height={300}
      className={className ?? (compact ? "h-auto w-40" : "h-16 w-auto")}
    />
  );
}
