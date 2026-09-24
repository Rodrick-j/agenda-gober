"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  actualizarSecretaria,
  crearSecretaria,
  getSecretarias,
  type Secretaria,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";

type EstadoFiltro = "todas" | "activas" | "inactivas";
type AreaUnidad = "institucional" | "desarrollo" | "social" | "territorio";
type AreaFiltro = "todas" | AreaUnidad;

const FORM_FIELD_CLASS =
  "mt-2 w-full rounded-xl border border-slate-200 bg-[#f8fafc] px-3.5 py-2.5 text-sm font-medium text-[#183558] outline-none transition placeholder:text-slate-400 hover:border-slate-300 focus:border-[#0d5fc1] focus:bg-white focus:ring-4 focus:ring-[#0d5fc1]/10";

const AREAS: Array<{
  key: AreaFiltro;
  label: string;
  shortLabel: string;
  dot: string;
  active: string;
}> = [
  { key: "todas", label: "Todas las unidades", shortLabel: "Todas", dot: "bg-slate-400", active: "border-[#102a4c] bg-[#102a4c] text-white" },
  { key: "institucional", label: "Gestión institucional", shortLabel: "Institucional", dot: "bg-blue-500", active: "border-blue-600 bg-blue-600 text-white" },
  { key: "desarrollo", label: "Desarrollo económico", shortLabel: "Desarrollo", dot: "bg-amber-500", active: "border-amber-500 bg-amber-500 text-white" },
  { key: "social", label: "Área social y cultural", shortLabel: "Social y cultura", dot: "bg-rose-600", active: "border-rose-700 bg-rose-700 text-white" },
  { key: "territorio", label: "Territorio y planificación", shortLabel: "Territorio", dot: "bg-emerald-600", active: "border-emerald-600 bg-emerald-600 text-white" },
];

const AREA_CARD_UI: Record<AreaUnidad, { label: string; dot: string; cover: string; icon: string; accent: string }> = {
  institucional: {
    label: "Gestión institucional",
    dot: "bg-blue-500",
    cover: "from-[#062c59] via-[#084b83] to-[#0b6aa8]",
    icon: "bg-blue-50 text-blue-700 ring-blue-100",
    accent: "bg-blue-500",
  },
  desarrollo: {
    label: "Desarrollo económico",
    dot: "bg-amber-500",
    cover: "from-[#5c3505] via-[#a45c08] to-[#dc8c16]",
    icon: "bg-amber-50 text-amber-700 ring-amber-100",
    accent: "bg-amber-500",
  },
  social: {
    label: "Área social y cultural",
    dot: "bg-rose-600",
    cover: "from-[#521126] via-[#861534] to-[#b62548]",
    icon: "bg-rose-50 text-rose-700 ring-rose-100",
    accent: "bg-rose-600",
  },
  territorio: {
    label: "Territorio y planificación",
    dot: "bg-emerald-600",
    cover: "from-[#06423d] via-[#087064] to-[#0b9480]",
    icon: "bg-emerald-50 text-emerald-700 ring-emerald-100",
    accent: "bg-emerald-600",
  },
};

const LOGOS_SECRETARIAS: Record<string, string> = {
  sddpi: "/images/secretarias/sddpi.png",
  sddssa: "/images/secretarias/sddssa.png",
  sdmaamt: "/images/secretarias/sdmaamt.png",
  sdmmre: "/images/secretarias/sdmmre.png",
};

function normalizar(valor: string) {
  return valor.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function textoUnidad(secretaria: Secretaria) {
  return normalizar(`${secretaria.slug} ${secretaria.nombre} ${secretaria.descripcion ?? ""}`);
}

function obtenerArea(secretaria: Secretaria): AreaUnidad {
  const texto = textoUnidad(secretaria);

  if (/sdop|obras|sdpd|planificacion/.test(texto)) return "territorio";
  if (/sddssa|salud|educacion|sdct|cultura|turismo|social/.test(texto)) return "social";
  if (/sddpi|desarrollo productivo|sdmmre|mineria|metalurgia|sdmaamt|medio ambiente|madre tierra/.test(texto)) return "desarrollo";
  return "institucional";
}

function obtenerLogo(secretaria: Secretaria) {
  const texto = textoUnidad(secretaria);
  if (/sddssa/.test(texto)) return LOGOS_SECRETARIAS.sddssa;
  if (/sdmmre/.test(texto)) return LOGOS_SECRETARIAS.sdmmre;
  if (/sdmaamt/.test(texto)) return LOGOS_SECRETARIAS.sdmaamt;
  if (/sddpi|desarrollo productivo/.test(texto)) return LOGOS_SECRETARIAS.sddpi;
  return null;
}

function inicialesUnidad(secretaria: Secretaria) {
  if (/^[A-Z]{2,8}$/.test(secretaria.nombre)) return secretaria.nombre;
  return secretaria.nombre
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 3)
    .map((palabra) => palabra[0])
    .join("")
    .toUpperCase();
}

export default function SecretariasPage() {
  const { sesion } = useSession();
  const esAdmin = sesion.rol === "admin";

  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState("");
  const [estadoFiltro, setEstadoFiltro] = useState<EstadoFiltro>("todas");
  const [areaFiltro, setAreaFiltro] = useState<AreaFiltro>("todas");

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<Secretaria | null>(null);
  const [nombre, setNombre] = useState("");
  const [slug, setSlug] = useState("");
  const [descripcion, setDescripcion] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      setSecretarias(await getSecretarias());
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo cargar el directorio institucional");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!mostrarForm) return;

    const bodyOverflow = document.body.style.overflow;
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !guardando) setMostrarForm(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = bodyOverflow;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [guardando, mostrarForm]);

  const resumen = useMemo(() => {
    const activas = secretarias.filter((secretaria) => secretaria.activa).length;
    return {
      total: secretarias.length,
      activas,
      inactivas: secretarias.length - activas,
      publicaciones: secretarias.reduce((total, secretaria) => total + secretaria.publicaciones_visibles, 0),
    };
  }, [secretarias]);

  const conteoAreas = useMemo(() => {
    const conteo: Record<AreaFiltro, number> = {
      todas: secretarias.length,
      institucional: 0,
      desarrollo: 0,
      social: 0,
      territorio: 0,
    };
    secretarias.forEach((secretaria) => {
      conteo[obtenerArea(secretaria)] += 1;
    });
    return conteo;
  }, [secretarias]);

  const secretariasVisibles = useMemo(() => {
    const termino = normalizar(busqueda.trim());
    return secretarias
      .filter((secretaria) => {
        const coincideBusqueda = !termino || textoUnidad(secretaria).includes(termino);
        const coincideEstado =
          estadoFiltro === "todas" ||
          (estadoFiltro === "activas" && secretaria.activa) ||
          (estadoFiltro === "inactivas" && !secretaria.activa);
        const coincideArea = areaFiltro === "todas" || obtenerArea(secretaria) === areaFiltro;
        return coincideBusqueda && coincideEstado && coincideArea;
      })
      .sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
  }, [areaFiltro, busqueda, estadoFiltro, secretarias]);

  const hayFiltros = Boolean(busqueda || estadoFiltro !== "todas" || areaFiltro !== "todas");

  function limpiarFiltros() {
    setBusqueda("");
    setEstadoFiltro("todas");
    setAreaFiltro("todas");
  }

  function abrirNueva() {
    setError(null);
    setEditando(null);
    setNombre("");
    setSlug("");
    setDescripcion("");
    setMostrarForm(true);
  }

  function abrirEditar(secretaria: Secretaria) {
    setError(null);
    setEditando(secretaria);
    setNombre(secretaria.nombre);
    setSlug(secretaria.slug);
    setDescripcion(secretaria.descripcion ?? "");
    setMostrarForm(true);
  }

  async function onGuardar(event: FormEvent) {
    event.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await actualizarSecretaria(editando.id, {
          nombre: nombre.trim(),
          descripcion: descripcion.trim() || undefined,
        });
      } else {
        await crearSecretaria({
          nombre: nombre.trim(),
          slug,
          descripcion: descripcion.trim() || undefined,
        });
      }
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la unidad");
    } finally {
      setGuardando(false);
    }
  }

  async function onToggleActiva(secretaria: Secretaria) {
    setError(null);
    try {
      await actualizarSecretaria(secretaria.id, { activa: !secretaria.activa });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar la unidad");
    }
  }

  return (
    <div className="mx-auto max-w-7xl">
      <section className="relative mb-5 overflow-hidden rounded-[26px] bg-[linear-gradient(115deg,#02224f_0%,#043c79_62%,#0875b8_100%)] px-5 py-6 text-white shadow-[0_18px_45px_-24px_rgba(2,34,79,.65)] sm:px-7 lg:px-8">
        <div className="pointer-events-none absolute -right-20 -top-36 h-80 w-80 rounded-full border-[52px] border-white/[.045]" />
        <div className="pointer-events-none absolute bottom-0 right-[28%] h-px w-72 bg-gradient-to-r from-transparent via-[#65dff4]/60 to-transparent" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-xl">
            <div className="mb-2 flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-[0.2em] text-[#86d9f5]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#65dff4] shadow-[0_0_10px_rgba(101,223,244,.8)]" />
              Estructura institucional
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">Secretarías y unidades</h1>
            <p className="mt-2 text-xs leading-relaxed text-blue-100/75 sm:text-sm">
              Consulta, organiza y administra las dependencias del Gobierno Autónomo Departamental de Oruro.
            </p>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
            <dl className="grid grid-cols-3 overflow-hidden rounded-2xl border border-white/10 bg-white/[.07] backdrop-blur-sm">
              <div className="min-w-20 px-4 py-3 text-center">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-blue-100/60">Unidades</dt>
                <dd className="mt-0.5 text-lg font-black">{resumen.total}</dd>
              </div>
              <div className="min-w-20 border-x border-white/10 px-4 py-3 text-center">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-blue-100/60">Activas</dt>
                <dd className="mt-0.5 text-lg font-black text-emerald-300">{resumen.activas}</dd>
              </div>
              <div className="min-w-20 px-4 py-3 text-center">
                <dt className="text-[9px] font-bold uppercase tracking-wider text-blue-100/60">Publicaciones</dt>
                <dd className="mt-0.5 text-lg font-black text-[#ffd48a]">{resumen.publicaciones}</dd>
              </div>
            </dl>
            {esAdmin && (
              <button
                onClick={abrirNueva}
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#8a1538] px-4 py-3 text-xs font-extrabold text-white shadow-lg shadow-[#360616]/25 transition hover:-translate-y-0.5 hover:bg-[#a51b44] hover:shadow-xl focus:outline-none focus:ring-4 focus:ring-white/15"
              >
                <InstitutionalIcon name="plus" className="h-4 w-4" />
                Nueva secretaría
              </button>
            )}
          </div>
        </div>
      </section>

      {error && !mostrarForm && (
        <div role="alert" className="mb-5 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700">
          <InstitutionalIcon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      <section aria-label="Filtros del directorio" className="mb-5 rounded-2xl border border-slate-200/80 bg-white p-4 shadow-sm shadow-slate-200/60 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="relative block w-full lg:max-w-md">
            <span className="sr-only">Buscar secretaría o unidad</span>
            <InstitutionalIcon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="search"
              value={busqueda}
              onChange={(event) => setBusqueda(event.target.value)}
              placeholder="Buscar por nombre, sigla o función…"
              className="w-full rounded-xl border border-slate-200 bg-[#f8fafc] py-2.5 pl-10 pr-4 text-xs font-medium text-[#183558] outline-none transition placeholder:text-slate-400 focus:border-[#0d5fc1] focus:bg-white focus:ring-4 focus:ring-[#0d5fc1]/10"
            />
          </label>

          <div className="flex w-full gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1 lg:w-auto" aria-label="Filtrar por estado">
            {([
              ["todas", "Todas", resumen.total],
              ["activas", "Activas", resumen.activas],
              ["inactivas", "Inactivas", resumen.inactivas],
            ] as Array<[EstadoFiltro, string, number]>).map(([key, label, count]) => (
              <button
                key={key}
                type="button"
                aria-pressed={estadoFiltro === key}
                onClick={() => setEstadoFiltro(key)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-[10px] font-extrabold transition lg:flex-none ${
                  estadoFiltro === key
                    ? "bg-white text-[#0d5fc1] shadow-sm ring-1 ring-slate-200"
                    : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
                <span className={`rounded-full px-1.5 py-0.5 text-[8px] ${estadoFiltro === key ? "bg-blue-50" : "bg-slate-200/70"}`}>{count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="my-4 h-px bg-slate-100" />
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-2.5 text-[9px] font-extrabold uppercase tracking-[0.16em] text-slate-400">Filtrar por área</p>
            <div className="flex max-w-full gap-2 overflow-x-auto pb-1 [scrollbar-width:none]">
              {AREAS.map((area) => (
                <button
                  key={area.key}
                  type="button"
                  aria-pressed={areaFiltro === area.key}
                  onClick={() => setAreaFiltro(area.key)}
                  title={area.label}
                  className={`inline-flex shrink-0 items-center gap-2 rounded-xl border px-3 py-2 text-[10px] font-extrabold transition hover:-translate-y-0.5 ${
                    areaFiltro === area.key
                      ? area.active
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
                  }`}
                >
                  <span className={`h-1.5 w-1.5 rounded-full ${areaFiltro === area.key ? "bg-white/80" : area.dot}`} />
                  <span className="sm:hidden">{area.shortLabel}</span>
                  <span className="hidden sm:inline">{area.label}</span>
                  <span className={`rounded-full px-1.5 py-0.5 text-[8px] ${areaFiltro === area.key ? "bg-white/15 text-white" : "bg-slate-100 text-slate-400"}`}>
                    {conteoAreas[area.key]}
                  </span>
                </button>
              ))}
            </div>
          </div>
          {hayFiltros && (
            <button type="button" onClick={limpiarFiltros} className="mt-5 hidden shrink-0 text-[10px] font-extrabold text-[#0d5fc1] hover:underline sm:block">
              Limpiar filtros
            </button>
          )}
        </div>
      </section>

      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-[10px] font-bold text-slate-500">
          {cargando ? "Cargando directorio…" : `${secretariasVisibles.length} ${secretariasVisibles.length === 1 ? "unidad encontrada" : "unidades encontradas"}`}
        </p>
        {hayFiltros && (
          <button type="button" onClick={limpiarFiltros} className="text-[10px] font-extrabold text-[#0d5fc1] hover:underline sm:hidden">
            Limpiar filtros
          </button>
        )}
      </div>

      {cargando ? (
        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {[0, 1, 2, 3, 4, 5, 6, 7].map((index) => (
            <div key={index} className="h-80 animate-pulse overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="h-28 bg-slate-100" />
              <div className="space-y-3 p-4">
                <div className="h-3 w-24 rounded bg-slate-100" />
                <div className="h-5 w-3/5 rounded bg-slate-100" />
                <div className="h-9 rounded bg-slate-50" />
              </div>
            </div>
          ))}
        </div>
      ) : secretariasVisibles.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white py-16 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-50 text-slate-300">
            <InstitutionalIcon name="search" className="h-6 w-6" />
          </span>
          <h2 className="mt-4 text-sm font-extrabold text-[#183558]">No encontramos unidades</h2>
          <p className="mx-auto mt-1 max-w-sm text-xs text-slate-400">Prueba con otro nombre o cambia los filtros seleccionados.</p>
          <button type="button" onClick={limpiarFiltros} className="mt-4 rounded-xl bg-[#0d5fc1] px-4 py-2 text-[10px] font-extrabold text-white hover:bg-[#094f9f]">
            Mostrar todas
          </button>
        </div>
      ) : (
        <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {secretariasVisibles.map((secretaria) => {
            const area = obtenerArea(secretaria);
            const tema = AREA_CARD_UI[area];
            const logo = obtenerLogo(secretaria);

            return (
              <li
                key={secretaria.id}
                className="group relative flex min-h-[318px] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-sm shadow-slate-200/60 transition-all duration-300 hover:-translate-y-1 hover:border-slate-300 hover:shadow-[0_18px_36px_-20px_rgba(15,42,76,.38)]"
              >
                <div className={`absolute inset-x-0 top-0 z-10 h-1 ${tema.accent}`} />
                <div className={`relative h-28 shrink-0 overflow-hidden bg-gradient-to-br ${tema.cover}`}>
                  {logo ? (
                    <Image
                      src={logo}
                      alt={`Identidad visual de ${secretaria.nombre}`}
                      fill
                      sizes="(max-width: 640px) 100vw, (max-width: 1280px) 33vw, 25vw"
                      className="object-cover object-[center_38%] transition-transform duration-500 group-hover:scale-[1.035]"
                    />
                  ) : (
                    <>
                      <div className="absolute -right-8 -top-12 h-32 w-32 rounded-full border-[24px] border-white/[.06]" />
                      <div className="absolute bottom-0 left-0 h-px w-full bg-gradient-to-r from-transparent via-white/30 to-transparent" />
                      <div className="relative flex h-full items-center gap-3 px-5 text-white">
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/15 bg-white/10 backdrop-blur-sm">
                          <InstitutionalIcon name="building" className="h-6 w-6" />
                        </span>
                        <div>
                          <p className="text-[9px] font-bold uppercase tracking-[0.17em] text-white/60">Unidad institucional</p>
                          <p className="mt-0.5 text-2xl font-black tracking-tight">{inicialesUnidad(secretaria)}</p>
                        </div>
                      </div>
                    </>
                  )}
                  <span
                    className={`absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[8px] font-black uppercase tracking-wider shadow-sm backdrop-blur-md ${
                      secretaria.activa
                        ? "border-emerald-200/70 bg-emerald-50/95 text-emerald-700"
                        : "border-slate-200/80 bg-white/95 text-slate-500"
                    }`}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full ${secretaria.activa ? "bg-emerald-500" : "bg-slate-400"}`} />
                    {secretaria.activa ? "Activa" : "Inactiva"}
                  </span>
                </div>

                <div className="flex flex-1 flex-col p-4">
                  <div className="mb-2 flex items-center gap-2 text-[9px] font-extrabold uppercase tracking-[0.11em] text-slate-400">
                    <span className={`h-1.5 w-1.5 rounded-full ${tema.dot}`} />
                    {tema.label}
                  </div>
                  <h2 className="text-base font-black tracking-tight text-[#102a4c]">{secretaria.nombre}</h2>
                  <p className="mt-1 min-h-9 text-[11px] leading-relaxed text-slate-500 line-clamp-2">
                    {secretaria.descripcion || "Unidad del Gobierno Autónomo Departamental de Oruro"}
                  </p>

                  <div className="mt-3 flex items-center justify-between rounded-xl border border-slate-100 bg-[#f8fafc] px-3 py-2.5">
                    <span className="flex items-center gap-2 text-[10px] font-bold text-slate-500">
                      <InstitutionalIcon name="document" className="h-3.5 w-3.5 text-slate-400" />
                      Publicaciones
                    </span>
                    <span className="rounded-lg bg-white px-2 py-1 text-[10px] font-black text-[#0d5fc1] shadow-sm ring-1 ring-slate-100">
                      {secretaria.publicaciones_visibles}
                    </span>
                  </div>

                  {esAdmin && (
                    <div className="mt-auto flex gap-2 border-t border-slate-100 pt-3">
                      <button
                        onClick={() => abrirEditar(secretaria)}
                        className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-2.5 py-2 text-[10px] font-extrabold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
                      >
                        <InstitutionalIcon name="document" className="h-3.5 w-3.5" />
                        Editar
                      </button>
                      <button
                        onClick={() => onToggleActiva(secretaria)}
                        className={`flex-1 rounded-lg border px-2.5 py-2 text-[10px] font-extrabold transition ${
                          secretaria.activa
                            ? "border-red-200 text-red-600 hover:bg-red-50"
                            : "border-emerald-200 text-emerald-700 hover:bg-emerald-50"
                        }`}
                      >
                        {secretaria.activa ? "Desactivar" : "Activar"}
                      </button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {mostrarForm && (
        <div
          className="fixed inset-0 z-50 overflow-y-auto bg-[#071b35]/70 px-3 py-4 backdrop-blur-[3px] sm:p-6"
          onClick={() => !guardando && setMostrarForm(false)}
        >
          <div className="flex min-h-full items-center justify-center">
            <form
              aria-labelledby="secretaria-form-titulo"
              aria-modal="true"
              role="dialog"
              onClick={(event) => event.stopPropagation()}
              onSubmit={onGuardar}
              className="project-dialog-enter w-full max-w-lg overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_28px_80px_-18px_rgba(2,34,79,.55)]"
            >
              <div className="relative overflow-hidden bg-[linear-gradient(118deg,#02224f_0%,#043472_65%,#075da8_100%)] px-5 py-5 text-white sm:px-6">
                <div className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full border-[28px] border-white/[.05]" />
                <div className="relative flex items-start gap-3.5">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-[#65dff4]">
                    <InstitutionalIcon name="building" className="h-5 w-5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[9px] font-extrabold uppercase tracking-[0.18em] text-[#86d9f5]">Directorio institucional</p>
                    <h2 id="secretaria-form-titulo" className="mt-1 text-lg font-black">
                      {editando ? "Editar secretaría" : "Nueva secretaría"}
                    </h2>
                    <p className="mt-1 text-[10px] text-blue-100/70">
                      {editando ? "Actualiza la información pública de esta unidad." : "Registra una nueva unidad en el sistema."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setMostrarForm(false)}
                    aria-label="Cerrar formulario"
                    className="flex h-9 w-9 items-center justify-center rounded-full border border-white/15 bg-white/10 text-blue-100 transition hover:rotate-90 hover:bg-white/20 hover:text-white"
                  >
                    <InstitutionalIcon name="close" className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="space-y-4 bg-[#f4f7fb] p-5 sm:p-6">
                {error && (
                  <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-[10px] font-bold text-red-700">
                    <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
                    {error}
                  </div>
                )}
                <label htmlFor="secretaria-nombre" className="block text-xs font-bold text-slate-700">
                  Nombre o sigla <span className="text-[#8a1538]">*</span>
                  <input
                    id="secretaria-nombre"
                    value={nombre}
                    onChange={(event) => setNombre(event.target.value)}
                    required
                    maxLength={80}
                    autoFocus
                    placeholder="Ej. SDOP"
                    className={FORM_FIELD_CLASS}
                  />
                </label>
                {!editando && (
                  <label htmlFor="secretaria-slug" className="block text-xs font-bold text-slate-700">
                    Identificador técnico <span className="text-[#8a1538]">*</span>
                    <input
                      id="secretaria-slug"
                      value={slug}
                      onChange={(event) => setSlug(normalizar(event.target.value).replace(/\s+/g, "-"))}
                      required
                      pattern="[a-z0-9-]+"
                      maxLength={60}
                      placeholder="Ej. sdop"
                      className={FORM_FIELD_CLASS}
                    />
                    <span className="mt-1.5 block text-[9px] font-medium text-slate-400">Solo letras minúsculas, números y guiones.</span>
                  </label>
                )}
                <label htmlFor="secretaria-descripcion" className="block text-xs font-bold text-slate-700">
                  Nombre completo
                  <textarea
                    id="secretaria-descripcion"
                    value={descripcion}
                    onChange={(event) => setDescripcion(event.target.value)}
                    rows={3}
                    maxLength={240}
                    placeholder="Ej. Secretaría Departamental de Obras Públicas"
                    className={`${FORM_FIELD_CLASS} resize-y leading-relaxed`}
                  />
                  <span className="mt-1.5 block text-right text-[9px] font-medium text-slate-400">{descripcion.length}/240</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-2.5 border-t border-slate-200 bg-white px-5 py-4 sm:px-6">
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  disabled={guardando}
                  className="rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-extrabold text-slate-600 transition hover:bg-slate-50 disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando || !nombre.trim() || (!editando && !slug)}
                  className="inline-flex min-w-36 items-center justify-center gap-2 rounded-xl bg-[linear-gradient(110deg,#0d5fc1,#087bd4)] px-5 py-2.5 text-xs font-extrabold text-white shadow-lg shadow-blue-900/20 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:translate-y-0"
                >
                  {guardando ? (
                    <>
                      <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" />
                      Guardando…
                    </>
                  ) : editando ? (
                    "Guardar cambios"
                  ) : (
                    <>
                      <InstitutionalIcon name="plus" className="h-4 w-4" />
                      Crear secretaría
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
