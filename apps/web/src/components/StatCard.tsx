interface Props {
  etiqueta: string;
  valor: number;
  acento: string;
}

export function StatCard({ etiqueta, valor, acento }: Props) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{etiqueta}</p>
      <p className={`mt-1 text-2xl font-semibold ${acento}`}>{valor}</p>
    </div>
  );
}
