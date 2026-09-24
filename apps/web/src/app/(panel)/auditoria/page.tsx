"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  exportarAuditoriaCsv,
  getAuditoria,
  getAuditoriaResumen,
  getSecretarias,
  type AccionAuditoria,
  type AuditoriaResumen,
  type FiltrosAuditoria,
  type RegistroAuditoria,
  type Secretaria,
} from "@/lib/api";
import {
  ACCION_ESTILO,
  ACCION_LABEL,
  aIso,
  fechaHoraBolivia,
  moduloLabel,
  MODULOS,
  rangoRapido,
  type RangoRapido,
} from "@/lib/auditoria";
import { useSession } from "@/lib/session-context";
import { rangoDeRol } from "@/lib/roles";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";
import { AuditoriaDetalle } from "@/components/AuditoriaDetalle";

const ACCIONES: AccionAuditoria[] = ["INSERT", "UPDATE", "DELETE"];
const TAMANOS = [20, 50, 100];
const RANGOS: { clave: RangoRapido; label: string }[] = [
  { clave: "hoy", label: "Hoy" },
  { clave: "ayer", label: "Ayer" },
  { clave: "7d", label: "7 días" },
  { clave: "30d", label: "30 días" },
];

interface FiltrosUI {
  q: string;
  modulos: string[]; // labels de MODULOS
  acciones: AccionAuditoria[];
  secretariaId: string;
  desdeDia: string;
  desdeHora: string;
  hastaDia: string;
  hastaHora: string;
}

const VACIO: FiltrosUI = {
  q: "",
  modulos: [],
  acciones: [],
  secretariaId: "",
  desdeDia: "",
  desdeHora: "",
  hastaDia: "",
  hastaHora: "",
};

function leerDeUrl(): FiltrosUI {
  if (typeof window === "undefined") return VACIO;
  const p = new URLSearchParams(window.location.search);
  const dividir = (v: string | null) => (v ? v.split(",").filter(Boolean) : []);
  const [dDia = "", dHora = ""] = (p.get("desde") ?? "").split("T");
  const [hDia = "", hHora = ""] = (p.get("hasta") ?? "").split("T");
  return {
    q: p.get("q") ?? "",
    modulos: dividir(p.get("modulos")).filter((m) => MODULOS.some((x) => x.label === m)),
    acciones: dividir(p.get("acciones")).filter((a): a is AccionAuditoria =>
      (ACCIONES as string[]).includes(a),
    ),
    secretariaId: p.get("sec") ?? "",
    desdeDia: dDia,
    desdeHora: dHora,
    hastaDia: hDia,
    hastaHora: hHora,
  };
}

function escribirUrl(f: FiltrosUI, porPagina: number) {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.modulos.length) p.set("modulos", f.modulos.join(","));
  if (f.acciones.length) p.set("acciones", f.acciones.join(","));
  if (f.secretariaId) p.set("sec", f.secretariaId);
  if (f.desdeDia) p.set("desde", f.desdeDia + (f.desdeHora ? `T${f.desdeHora}` : ""));
  if (f.hastaDia) p.set("hasta", f.hastaDia + (f.hastaHora ? `T${f.hastaHora}` : ""));
  if (porPagina !== TAMANOS[0]) p.set("pp", String(porPagina));
  const qs = p.toString();
  window.history.replaceState(null, "", qs ? `?${qs}` : window.location.pathname);
}

function ResumenCard({
  label,
  valor,
  tono,
}: {
  label: string;
  valor: number | undefined;
  tono: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200/80 bg-white px-4 py-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-black tabular-nums ${tono}`}>{valor ?? "—"}</p>
    </div>
  );
}

function Chip({ children, onQuitar }: { children: React.ReactNode; onQuitar: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f2fd] px-2.5 py-1 text-[11px] font-semibold text-[#0d5fc1]">
      {children}
      <button
        type="button"
        onClick={onQuitar}
        aria-label="Quitar filtro"
        className="rounded-full p-0.5 hover:bg-[#0d5fc1]/15"
      >
        <InstitutionalIcon name="close" className="h-3 w-3" />
      </button>
    </span>
  );
}

export default function AuditoriaPage() {
  const { sesion } = useSession();
  const esTransversal = rangoDeRol(sesion.rol) >= 99;

  const [filtros, setFiltros] = useState<FiltrosUI>(leerDeUrl);
  const [qInput, setQInput] = useState(filtros.q);
  const [avanzado, setAvanzado] = useState(
    () => !!(filtros.desdeDia || filtros.hastaDia),
  );
  const [pagina, setPagina] = useState(1);
  const [porPagina, setPorPagina] = useState(
    () => Number(typeof window !== "undefined" && new URLSearchParams(window.location.search).get("pp")) || TAMANOS[0],
  );

  const [registros, setRegistros] = useState<RegistroAuditoria[]>([]);
  const [resumen, setResumen] = useState<AuditoriaResumen | null>(null);
  const [total, setTotal] = useState(0);
  const [paginas, setPaginas] = useState(1);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [detalleId, setDetalleId] = useState<number | null>(null);
  const [exportando, setExportando] = useState(false);

  // Debounce del buscador (350 ms): no dispara una consulta por tecla.
  useEffect(() => {
    const t = setTimeout(() => {
      setFiltros((f) => (f.q === qInput ? f : { ...f, q: qInput }));
      setPagina(1);
    }, 350);
    return () => clearTimeout(t);
  }, [qInput]);

  useEffect(() => {
    if (esTransversal) getSecretarias().then(setSecretarias).catch(() => undefined);
  }, [esTransversal]);

  useEffect(() => {
    escribirUrl(filtros, porPagina);
  }, [filtros, porPagina]);

  const apiFiltros = useMemo<FiltrosAuditoria>(
    () => ({
      q: filtros.q.trim() || undefined,
      modulo:
        filtros.modulos
          .flatMap((l) => MODULOS.find((m) => m.label === l)?.tablas ?? [])
          .join(",") || undefined,
      accion: filtros.acciones.join(",") || undefined,
      secretariaId: filtros.secretariaId || undefined,
      desde: aIso(filtros.desdeDia, filtros.desdeHora, false),
      hasta: aIso(filtros.hastaDia, filtros.hastaHora, true),
    }),
    [filtros],
  );

  const hayFiltros =
    !!apiFiltros.q ||
    !!apiFiltros.modulo ||
    !!apiFiltros.accion ||
    !!apiFiltros.secretariaId ||
    !!apiFiltros.desde ||
    !!apiFiltros.hasta;

  const cargarLista = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const lista = await getAuditoria({ ...apiFiltros, pagina, porPagina });
      setRegistros(lista.datos);
      setTotal(lista.total);
      setPaginas(lista.paginas);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al cargar la auditoría");
    } finally {
      setCargando(false);
    }
  }, [apiFiltros, pagina, porPagina]);

  // Las métricas no dependen de la página: se recalculan solo al cambiar los
  // filtros, no al paginar.
  const cargarResumen = useCallback(async () => {
    try {
      setResumen(await getAuditoriaResumen(apiFiltros));
    } catch {
      /* el error de la lista ya queda visible */
    }
  }, [apiFiltros]);

  useEffect(() => {
    if (esTransversal) void cargarLista();
  }, [esTransversal, cargarLista]);

  useEffect(() => {
    if (esTransversal) void cargarResumen();
  }, [esTransversal, cargarResumen]);

  function editar(patch: Partial<FiltrosUI>) {
    setFiltros((f) => ({ ...f, ...patch }));
    setPagina(1);
  }
  function toggleModulo(label: string) {
    editar({
      modulos: filtros.modulos.includes(label)
        ? filtros.modulos.filter((m) => m !== label)
        : [...filtros.modulos, label],
    });
  }
  function toggleAccion(a: AccionAuditoria) {
    editar({
      acciones: filtros.acciones.includes(a)
        ? filtros.acciones.filter((x) => x !== a)
        : [...filtros.acciones, a],
    });
  }
  function aplicarRango(clave: RangoRapido) {
    const { desdeDia, hastaDia } = rangoRapido(clave);
    editar({ desdeDia, hastaDia, desdeHora: "", hastaHora: "" });
  }
  function limpiar() {
    setFiltros(VACIO);
    setQInput("");
    setPagina(1);
  }

  async function exportar() {
    setExportando(true);
    try {
      await exportarAuditoriaCsv(apiFiltros);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo exportar");
    } finally {
      setExportando(false);
    }
  }

  if (!esTransversal) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <InstitutionalIcon name="shield" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            La auditoría solo es visible para gobernador, jefe de gabinete o administrador. Tu rol
            (<span className="font-bold capitalize">{sesion.rol}</span>) no tiene acceso — y el
            backend lo confirma: aunque llegaras a esta URL, la política RLS devuelve cero filas.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Trazabilidad institucional
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Auditoría</h1>
          <p className="mt-1 text-xs text-slate-500">
            {hayFiltros ? "Eventos que coinciden con los filtros" : "Registro de cambios del sistema"} ·{" "}
            {total} {total === 1 ? "evento" : "eventos"}
          </p>
        </div>
        <button
          type="button"
          onClick={exportar}
          disabled={exportando || total === 0}
          className="inline-flex items-center gap-2 rounded-xl border border-[#0d5fc1]/25 bg-white px-3.5 py-2 text-xs font-bold text-[#0d5fc1] shadow-sm transition hover:bg-[#eef5fd] disabled:opacity-40"
        >
          <InstitutionalIcon name="layers" className="h-4 w-4" />
          {exportando ? "Generando…" : "Exportar CSV"}
        </button>
      </div>

      {error && (
        <div
          role="alert"
          className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700"
        >
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Resumen del período */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <ResumenCard label="Eventos" valor={resumen?.total} tono="text-[#102a4c]" />
        <ResumenCard label="Creaciones" valor={resumen?.creaciones} tono="text-emerald-600" />
        <ResumenCard label="Actualizaciones" valor={resumen?.actualizaciones} tono="text-amber-600" />
        <ResumenCard label="Eliminaciones" valor={resumen?.eliminaciones} tono="text-red-600" />
        <ResumenCard label="Responsables" valor={resumen?.actores} tono="text-[#0d5fc1]" />
      </div>

      {/* Filtros */}
      <Panel className="mb-4">
        <div className="space-y-3 p-4">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <InstitutionalIcon
                name="search"
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
              />
              <input
                value={qInput}
                onChange={(e) => setQInput(e.target.value)}
                placeholder="Buscar por responsable, módulo o ID de registro…"
                className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs text-[#183558] outline-none focus:border-[#0d5fc1]/50 focus:ring-2 focus:ring-[#0d5fc1]/15"
              />
            </div>
            <div className="flex items-center gap-1">
              {RANGOS.map((r) => (
                <button
                  key={r.clave}
                  type="button"
                  onClick={() => aplicarRango(r.clave)}
                  className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:border-[#0d5fc1]/40 hover:bg-[#eef5fd] hover:text-[#0d5fc1]"
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Módulo
            </span>
            {MODULOS.map((m) => {
              const on = filtros.modulos.includes(m.label);
              return (
                <button
                  key={m.label}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleModulo(m.label)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold transition ${
                    on
                      ? "bg-[#0d5fc1] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {m.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Acción
            </span>
            {ACCIONES.map((a) => {
              const on = filtros.acciones.includes(a);
              return (
                <button
                  key={a}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleAccion(a)}
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset transition ${
                    on
                      ? ACCION_ESTILO[a]
                      : "bg-white text-slate-500 ring-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {ACCION_LABEL[a]}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <select
              value={filtros.secretariaId}
              onChange={(e) => editar({ secretariaId: e.target.value })}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs text-[#183558] outline-none focus:border-[#0d5fc1]/50 focus:ring-2 focus:ring-[#0d5fc1]/15"
            >
              <option value="">Todas las secretarías</option>
              {secretarias.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombre}
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => setAvanzado((v) => !v)}
              aria-expanded={avanzado}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 transition hover:bg-slate-50"
            >
              <InstitutionalIcon
                name="chevronRight"
                className={`h-3.5 w-3.5 transition-transform ${avanzado ? "rotate-90" : ""}`}
              />
              Filtros avanzados
            </button>

            {(hayFiltros || qInput) && (
              <button
                type="button"
                onClick={limpiar}
                className="ml-auto text-xs font-semibold text-slate-500 underline-offset-2 hover:text-[#0d5fc1] hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>

          {avanzado && (
            <div className="grid gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-2">
              <label className="text-[11px] font-semibold text-slate-500">
                Desde
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="date"
                    value={filtros.desdeDia}
                    max={filtros.hastaDia || undefined}
                    onChange={(e) => editar({ desdeDia: e.target.value })}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-[#183558]"
                  />
                  <input
                    type="time"
                    value={filtros.desdeHora}
                    onChange={(e) => editar({ desdeHora: e.target.value })}
                    disabled={!filtros.desdeDia}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-[#183558] disabled:opacity-50"
                  />
                </div>
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                Hasta
                <div className="mt-1 flex gap-1.5">
                  <input
                    type="date"
                    value={filtros.hastaDia}
                    min={filtros.desdeDia || undefined}
                    onChange={(e) => editar({ hastaDia: e.target.value })}
                    className="flex-1 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-[#183558]"
                  />
                  <input
                    type="time"
                    value={filtros.hastaHora}
                    onChange={(e) => editar({ hastaHora: e.target.value })}
                    disabled={!filtros.hastaDia}
                    className="w-24 rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-[#183558] disabled:opacity-50"
                  />
                </div>
              </label>
            </div>
          )}

          {/* Chips activos */}
          {hayFiltros && (
            <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-3">
              {filtros.q && <Chip onQuitar={() => { setQInput(""); editar({ q: "" }); }}>«{filtros.q}»</Chip>}
              {filtros.modulos.map((m) => (
                <Chip key={m} onQuitar={() => toggleModulo(m)}>
                  {m}
                </Chip>
              ))}
              {filtros.acciones.map((a) => (
                <Chip key={a} onQuitar={() => toggleAccion(a)}>
                  {ACCION_LABEL[a]}
                </Chip>
              ))}
              {filtros.secretariaId && (
                <Chip onQuitar={() => editar({ secretariaId: "" })}>
                  {secretarias.find((s) => s.id === filtros.secretariaId)?.nombre ?? "Secretaría"}
                </Chip>
              )}
              {filtros.desdeDia && (
                <Chip onQuitar={() => editar({ desdeDia: "", desdeHora: "" })}>
                  desde {filtros.desdeDia}
                  {filtros.desdeHora ? ` ${filtros.desdeHora}` : ""}
                </Chip>
              )}
              {filtros.hastaDia && (
                <Chip onQuitar={() => editar({ hastaDia: "", hastaHora: "" })}>
                  hasta {filtros.hastaDia}
                  {filtros.hastaHora ? ` ${filtros.hastaHora}` : ""}
                </Chip>
              )}
            </div>
          )}
        </div>
      </Panel>

      {/* Historial */}
      <Panel>
        <PanelTitle
          icon="audit"
          title="Historial de cambios"
          action={
            <span className="text-[10px] font-semibold text-slate-400">
              Página {pagina} de {paginas}
            </span>
          }
        />

        {cargando ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />
            ))}
          </div>
        ) : registros.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
              <InstitutionalIcon name="audit" />
            </div>
            <p className="text-xs font-bold text-slate-600">
              {hayFiltros
                ? "Ningún evento coincide con los filtros."
                : "Sin eventos registrados todavía."}
            </p>
            {hayFiltros && (
              <button
                type="button"
                onClick={limpiar}
                className="text-xs font-semibold text-[#0d5fc1] hover:underline"
              >
                Limpiar filtros
              </button>
            )}
          </div>
        ) : (
          <>
            {/* Tabla (sm+) */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="min-w-full divide-y divide-slate-100 text-sm">
                <thead className="bg-[#f4f8fd] text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-2.5">Fecha</th>
                    <th className="px-4 py-2.5">Responsable</th>
                    <th className="hidden px-4 py-2.5 lg:table-cell">Secretaría</th>
                    <th className="px-4 py-2.5">Módulo</th>
                    <th className="px-4 py-2.5">Acción</th>
                    <th className="hidden px-4 py-2.5 xl:table-cell">Registro</th>
                    <th className="px-4 py-2.5">Resumen</th>
                    <th className="px-4 py-2.5" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {registros.map((r) => (
                    <tr key={r.id} className="transition hover:bg-[#f4f8fd]">
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                        {fechaHoraBolivia(r.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs font-semibold text-[#183558]" translate="no">
                        {r.usuario_nombre ?? r.usuario_email ?? (
                          <span className="font-normal text-slate-400">Sistema</span>
                        )}
                      </td>
                      <td className="hidden px-4 py-3 text-xs text-slate-600 lg:table-cell">
                        {r.secretaria_nombre ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                        {moduloLabel(r.tabla)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
                            ACCION_ESTILO[r.accion] ?? "bg-slate-100 text-slate-600 ring-slate-200"
                          }`}
                        >
                          {ACCION_LABEL[r.accion] ?? r.accion}
                        </span>
                      </td>
                      <td className="hidden max-w-[8rem] truncate px-4 py-3 font-mono text-[11px] text-slate-400 xl:table-cell" translate="no">
                        {r.registro_id}
                      </td>
                      <td className="max-w-sm px-4 py-3 text-xs text-slate-600">{r.resumen}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDetalleId(r.id)}
                          className="rounded-lg border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-[#0d5fc1] transition hover:bg-[#eef5fd]"
                        >
                          Ver detalle
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Tarjetas (móvil) */}
            <ul className="divide-y divide-slate-100 sm:hidden">
              {registros.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => setDetalleId(r.id)}
                    className="flex w-full flex-col gap-1.5 px-4 py-3 text-left transition hover:bg-[#f4f8fd]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ring-inset ${
                          ACCION_ESTILO[r.accion] ?? "bg-slate-100 text-slate-600 ring-slate-200"
                        }`}
                      >
                        {ACCION_LABEL[r.accion] ?? r.accion}
                      </span>
                      <span className="text-[10px] text-slate-400">{fechaHoraBolivia(r.created_at)}</span>
                    </div>
                    <p className="text-xs font-semibold text-[#183558]">{r.resumen}</p>
                    <p className="text-[11px] text-slate-500">
                      {moduloLabel(r.tabla)} ·{" "}
                      <span translate="no">{r.usuario_nombre ?? r.usuario_email ?? "Sistema"}</span>
                    </p>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-4 py-2.5 text-xs">
          <div className="flex items-center gap-2 text-slate-500">
            <span>{total} resultados</span>
            <span className="text-slate-300">·</span>
            <label className="flex items-center gap-1">
              Mostrar
              <select
                value={porPagina}
                onChange={(e) => {
                  setPorPagina(Number(e.target.value));
                  setPagina(1);
                }}
                className="rounded-md border border-slate-200 bg-white px-1.5 py-1 font-semibold text-slate-600"
              >
                {TAMANOS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={pagina <= 1 || cargando}
              onClick={() => setPagina((p) => p - 1)}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              Anterior
            </button>
            <span className="px-2 font-semibold text-slate-500">
              {pagina} / {paginas}
            </span>
            <button
              type="button"
              disabled={pagina >= paginas || cargando}
              onClick={() => setPagina((p) => p + 1)}
              className="rounded-lg border border-slate-200 px-2.5 py-1 font-semibold text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              Siguiente
            </button>
          </div>
        </div>
      </Panel>

      <AuditoriaDetalle id={detalleId} onClose={() => setDetalleId(null)} />
    </div>
  );
}
