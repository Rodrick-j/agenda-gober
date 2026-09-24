"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  actualizarUsuario,
  crearUsuario,
  getSecretarias,
  getUsuarios,
  resetearPassword,
  type CrearUsuarioInput,
  type RolNombre,
  type Secretaria,
  type UsuarioAdmin,
} from "@/lib/api";
import { useSession } from "@/lib/session-context";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { Panel, PanelTitle } from "@/components/InstitutionalPanel";

const ROLES_TRANSVERSALES: RolNombre[] = ["gobernador", "jefe_gabinete", "admin", "unicom", "apoyo"];
const ROLES_SECRETARIA: RolNombre[] = ["operador", "director", "secretario"];
const ROL_LABEL: Record<RolNombre, string> = {
  gobernador: "Gobernador",
  jefe_gabinete: "Jefe de Gabinete",
  admin: "Super Administrador",
  unicom: "UNICOM (Comunicación)",
  secretario: "Secretario/a",
  director: "Director/a",
  operador: "Operador/a",
  apoyo: "Apoyo de Gabinete",
};
const ROL_DESCRIPCION: Record<RolNombre, string> = {
  operador: "Gestión operativa y tareas asignadas",
  director: "Supervisión y aprobación de su área",
  secretario: "Máxima autoridad de una secretaría",
  unicom: "Gestión transversal de comunicación",
  jefe_gabinete: "Coordinación general del gabinete",
  gobernador: "Acceso estratégico a todo el gobierno",
  admin: "Administración de cuentas y permisos",
  apoyo: "Registra solicitudes de agenda para el Gabinete",
};
const ROL_ESTILO: Record<RolNombre, string> = {
  gobernador: "bg-amber-50 text-amber-800 ring-amber-200",
  jefe_gabinete: "bg-amber-50 text-amber-800 ring-amber-200",
  admin: "bg-violet-50 text-violet-700 ring-violet-200",
  unicom: "bg-fuchsia-50 text-fuchsia-700 ring-fuchsia-200",
  secretario: "bg-blue-50 text-blue-700 ring-blue-200",
  director: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  operador: "bg-slate-100 text-slate-600 ring-slate-200",
  apoyo: "bg-teal-50 text-teal-700 ring-teal-200",
};

function esTransversal(rol: RolNombre) {
  return ROLES_TRANSVERSALES.includes(rol);
}

export default function AdminUsuariosPage() {
  const { sesion } = useSession();
  const esAdmin = sesion.rol === "admin";

  const [usuarios, setUsuarios] = useState<UsuarioAdmin[]>([]);
  const [secretarias, setSecretarias] = useState<Secretaria[]>([]);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const [mostrarForm, setMostrarForm] = useState(false);
  const [editando, setEditando] = useState<UsuarioAdmin | null>(null);
  const [nombre, setNombre] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [rol, setRol] = useState<RolNombre>("operador");
  const [secretariaId, setSecretariaId] = useState("");
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError(null);
    try {
      const [u, s] = await Promise.all([getUsuarios(), getSecretarias()]);
      setUsuarios(u);
      setSecretarias(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error cargando los usuarios");
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      if (esAdmin) void cargar();
      else setCargando(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [cargar, esAdmin]);

  useEffect(() => {
    if (!mostrarForm) return;

    const overflowAnterior = document.body.style.overflow;
    const cerrarConEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !guardando) setMostrarForm(false);
    };

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", cerrarConEscape);
    return () => {
      document.body.style.overflow = overflowAnterior;
      window.removeEventListener("keydown", cerrarConEscape);
    };
  }, [guardando, mostrarForm]);

  const secretariaNombre = useMemo(() => {
    const map = new Map(secretarias.map((s) => [s.id, s.nombre]));
    return (id: string) => map.get(id) ?? "—";
  }, [secretarias]);

  function abrirNuevo() {
    setError(null);
    setEditando(null);
    setNombre("");
    setEmail("");
    setPassword("");
    setRol("operador");
    setSecretariaId("");
    setMostrarForm(true);
  }

  function abrirEditar(u: UsuarioAdmin) {
    setError(null);
    setEditando(u);
    setNombre(u.nombre);
    setEmail(u.email);
    setPassword("");
    setRol(u.rol);
    setSecretariaId(u.secretaria_id ?? "");
    setMostrarForm(true);
  }

  async function onGuardar(e: FormEvent) {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    try {
      if (editando) {
        await actualizarUsuario(editando.id, {
          nombre,
          rol,
          secretariaId: esTransversal(rol) ? undefined : secretariaId,
        });
      } else {
        const payload: CrearUsuarioInput = {
          nombre,
          email,
          password,
          rol,
          secretariaId: esTransversal(rol) ? undefined : secretariaId,
        };
        await crearUsuario(payload);
      }
      setMostrarForm(false);
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el usuario");
    } finally {
      setGuardando(false);
    }
  }

  async function onToggleActivo(u: UsuarioAdmin) {
    setError(null);
    try {
      await actualizarUsuario(u.id, { activo: !u.activo });
      await cargar();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo actualizar el estado");
    }
  }

  async function onResetPassword(u: UsuarioAdmin) {
    const nueva = window.prompt(`Nueva contraseña para ${u.email} (mínimo 8 caracteres):`);
    if (!nueva) return;
    setError(null);
    setAviso(null);
    try {
      await resetearPassword(u.id, nueva);
      setAviso(`Contraseña actualizada para ${u.email}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo resetear la contraseña");
    }
  }

  if (!esAdmin) {
    return (
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
          <InstitutionalIcon name="shield" className="mt-0.5 h-5 w-5 shrink-0" />
          <p>
            La gestión de usuarios es exclusiva del rol <strong>Super Administrador</strong> — a propósito,
            distinto de Gobernador y Jefe de Gabinete: quien administra cuentas no necesita ver contenido
            estratégico. Tu rol (<span className="font-bold capitalize">{sesion.rol}</span>) no tiene acceso,
            y el backend lo exige igual aunque llegaras a esta URL.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-1.5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#0d5fc1]">
            <span className="h-1.5 w-1.5 rounded-full bg-[#0d5fc1]" /> Super administración
          </div>
          <h1 className="text-xl font-black tracking-tight text-[#102a4c] sm:text-2xl">Usuarios</h1>
          <p className="mt-1 text-xs text-slate-500">Cuentas, roles y secretarías — sin tocar SQL.</p>
        </div>
        <button
          onClick={abrirNuevo}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#890b32] to-[#6d0828] px-4 py-2.5 text-xs font-bold text-white shadow-lg shadow-rose-900/15 transition hover:-translate-y-0.5 hover:shadow-xl"
        >
          <InstitutionalIcon name="plus" className="h-4 w-4" /> Nuevo usuario
        </button>
      </div>

      {error && !mostrarForm && (
        <div role="alert" className="mb-4 flex items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
          <InstitutionalIcon name="shield" className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}
      {aviso && (
        <div role="status" className="mb-4 flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-xs font-medium text-emerald-700">
          <InstitutionalIcon name="check" className="h-4 w-4 shrink-0" />
          {aviso}
        </div>
      )}

      <Panel>
        <PanelTitle icon="users" title="Cuentas del sistema" action={<span className="text-[10px] font-semibold text-slate-400">{usuarios.length} usuarios</span>} />
        {cargando ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => <div key={i} className="h-11 animate-pulse rounded-lg bg-slate-100" />)}
          </div>
        ) : usuarios.length === 0 ? (
          <div className="flex min-h-56 flex-col items-center justify-center text-center">
            <p className="text-xs font-bold text-slate-600">Sin usuarios todavía.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100 text-sm">
              <thead className="bg-[#f4f8fd] text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="px-4 py-2.5">Nombre</th>
                  <th className="px-4 py-2.5">Correo</th>
                  <th className="px-4 py-2.5">Rol</th>
                  <th className="px-4 py-2.5">Secretaría</th>
                  <th className="px-4 py-2.5">Estado</th>
                  <th className="px-4 py-2.5">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {usuarios.map((u) => (
                  <tr key={u.id} className="transition hover:bg-[#f4f8fd]">
                    <td className="whitespace-nowrap px-4 py-3 text-xs font-bold text-[#183558]">{u.nombre}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600" translate="no">{u.email}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ring-1 ring-inset ${ROL_ESTILO[u.rol]}`}>
                        {ROL_LABEL[u.rol]}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-600">
                      {esTransversal(u.rol) ? "— (transversal)" : u.secretaria_nombre ?? secretariaNombre(u.secretaria_id ?? "")}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1.5 text-[10px] font-bold ${u.activo ? "text-emerald-600" : "text-slate-400"}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${u.activo ? "bg-emerald-500" : "bg-slate-300"}`} />
                        {u.activo ? "Activo" : "Desactivado"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1.5">
                        <button onClick={() => abrirEditar(u)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-white">
                          Editar
                        </button>
                        <button onClick={() => onResetPassword(u)} className="rounded-lg border border-slate-200 px-2.5 py-1 text-[10px] font-bold text-slate-600 hover:bg-white">
                          Resetear clave
                        </button>
                        <button
                          onClick={() => onToggleActivo(u)}
                          className={`rounded-lg border px-2.5 py-1 text-[10px] font-bold ${
                            u.activo ? "border-red-200 text-red-600 hover:bg-red-50" : "border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                          }`}
                        >
                          {u.activo ? "Desactivar" : "Activar"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {mostrarForm && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-[#061a35]/65 p-3 backdrop-blur-[3px] sm:p-6"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !guardando) setMostrarForm(false);
          }}
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="usuario-dialog-title"
            onSubmit={onGuardar}
            className="project-dialog-enter flex max-h-[calc(100vh-1.5rem)] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-white/70 bg-white shadow-[0_32px_90px_rgba(2,34,79,.35)] sm:max-h-[calc(100vh-3rem)]"
          >
            <div className="relative shrink-0 overflow-hidden border-b border-blue-100 bg-gradient-to-r from-[#032b60] via-[#064e9b] to-[#0a70d6] px-5 py-5 text-white sm:px-7">
              <div className="pointer-events-none absolute -right-12 -top-16 h-40 w-40 rounded-full border border-cyan-200/15 bg-cyan-200/5" />
              <div className="pointer-events-none absolute right-24 top-0 h-full w-32 -skew-x-12 bg-white/[.035]" />
              <div className="relative flex items-start justify-between gap-4">
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-cyan-200/25 bg-white/10 text-[#67effa] shadow-inner">
                    <InstitutionalIcon name={editando ? "users" : "plus"} className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <p className="mb-1 text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#7cc7f6]">
                      Gestión de accesos
                    </p>
                    <h2 id="usuario-dialog-title" className="truncate text-lg font-black tracking-tight sm:text-xl">
                      {editando ? "Editar usuario" : "Crear nuevo usuario"}
                    </h2>
                    <p className="mt-1 text-[11px] text-blue-100/75">
                      {editando ? "Actualiza los datos y el nivel de acceso de la cuenta." : "Registra una cuenta y define sus permisos institucionales."}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  disabled={guardando}
                  aria-label="Cerrar ventana"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/15 bg-white/10 text-blue-100 transition hover:rotate-90 hover:border-white/30 hover:bg-white/20 hover:text-white focus:outline-none focus:ring-2 focus:ring-cyan-300/50 disabled:cursor-wait disabled:opacity-50"
                >
                  <InstitutionalIcon name="close" className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="min-h-0 flex-1 space-y-6 overflow-y-auto bg-[#f8fafd] px-5 py-5 sm:px-7 sm:py-6">
              {error && (
                <div role="alert" className="flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-semibold text-red-700 shadow-sm">
                  <InstitutionalIcon name="shield" className="mt-0.5 h-4 w-4 shrink-0" />
                  {error}
                </div>
              )}

              <section aria-labelledby="datos-cuenta-title">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-[#0d5fc1]">
                    <InstitutionalIcon name="users" className="h-3.5 w-3.5" />
                  </span>
                  <h3 id="datos-cuenta-title" className="text-xs font-extrabold text-[#183558]">Datos de la cuenta</h3>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>

                <div className={`grid gap-4 ${editando ? "sm:grid-cols-2" : ""}`}>
                  <label className="block text-[11px] font-bold text-slate-600">
                    Nombre completo
                    <input
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      required
                      autoFocus
                      autoComplete="name"
                      placeholder="Nombre y apellido"
                      className="mt-2 w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 text-sm font-medium text-[#183558] shadow-sm outline-none transition placeholder:text-slate-300 hover:border-slate-300 focus:border-[#2fa1f0] focus:ring-4 focus:ring-blue-100/80"
                    />
                  </label>

                  <label className="block text-[11px] font-bold text-slate-600">
                    Correo institucional
                    <span className="relative mt-2 block">
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={!!editando}
                        autoComplete="email"
                        placeholder="nombre@institucion.gob.bo"
                        className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 pr-10 text-sm font-medium text-[#183558] shadow-sm outline-none transition placeholder:text-slate-300 hover:border-slate-300 focus:border-[#2fa1f0] focus:ring-4 focus:ring-blue-100/80 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100/80 disabled:text-slate-400 disabled:shadow-none"
                      />
                      {editando && (
                        <InstitutionalIcon name="lock" className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      )}
                    </span>
                    {editando && <span className="mt-1.5 block text-[9px] font-medium text-slate-400">El correo es el identificador de acceso y no puede modificarse.</span>}
                  </label>

                  {!editando && (
                    <label className="block text-[11px] font-bold text-slate-600">
                      Contraseña inicial
                      <span className="relative mt-2 block">
                        <input
                          type="password"
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          required
                          minLength={8}
                          autoComplete="new-password"
                          placeholder="Mínimo 8 caracteres"
                          className="w-full rounded-xl border border-slate-200 bg-white px-3.5 py-3 pr-10 text-sm font-medium text-[#183558] shadow-sm outline-none transition placeholder:text-slate-300 hover:border-slate-300 focus:border-[#2fa1f0] focus:ring-4 focus:ring-blue-100/80"
                        />
                        <InstitutionalIcon name="lock" className="absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      </span>
                    </label>
                  )}
                </div>
              </section>

              <section aria-labelledby="nivel-acceso-title">
                <div className="mb-3 flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-blue-100 text-[#0d5fc1]">
                    <InstitutionalIcon name="shield" className="h-3.5 w-3.5" />
                  </span>
                  <h3 id="nivel-acceso-title" className="text-xs font-extrabold text-[#183558]">Nivel de acceso</h3>
                  <span className="h-px flex-1 bg-slate-200" />
                </div>

                <fieldset>
                  <legend className="sr-only">Selecciona el rol del usuario</legend>
                  <div className="grid gap-4 lg:grid-cols-[.78fr_1.22fr]">
                    <div>
                      <p className="mb-2 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Por secretaría</p>
                      <div className="grid grid-cols-3 gap-2 lg:grid-cols-1">
                        {ROLES_SECRETARIA.map((nombreRol) => (
                          <label key={nombreRol} className="group cursor-pointer">
                            <input
                              type="radio"
                              name="rol"
                              value={nombreRol}
                              checked={rol === nombreRol}
                              onChange={() => setRol(nombreRol)}
                              className="sr-only"
                            />
                            <span className={`flex min-h-16 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                              rol === nombreRol
                                ? "border-[#2fa1f0] bg-blue-50 text-[#094f9f] shadow-[0_6px_18px_rgba(47,161,240,.13)] ring-1 ring-[#2fa1f0]/20"
                                : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/40"
                            }`}>
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                rol === nombreRol ? "border-[#0d5fc1] bg-[#0d5fc1] text-white" : "border-slate-300 bg-white text-transparent"
                              }`}>
                                <InstitutionalIcon name="check" className="h-3 w-3" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[11px] font-extrabold leading-tight">{ROL_LABEL[nombreRol]}</span>
                                <span className="mt-0.5 hidden text-[9px] font-medium leading-tight text-slate-400 lg:block">{ROL_DESCRIPCION[nombreRol]}</span>
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div>
                      <p className="mb-2 text-[9px] font-extrabold uppercase tracking-[0.14em] text-slate-400">Acceso transversal</p>
                      <div className="grid grid-cols-2 gap-2">
                        {ROLES_TRANSVERSALES.map((nombreRol) => (
                          <label key={nombreRol} className="group cursor-pointer">
                            <input
                              type="radio"
                              name="rol"
                              value={nombreRol}
                              checked={rol === nombreRol}
                              onChange={() => setRol(nombreRol)}
                              className="sr-only"
                            />
                            <span className={`flex min-h-16 items-center gap-2.5 rounded-xl border px-3 py-2.5 transition ${
                              rol === nombreRol
                                ? "border-[#2fa1f0] bg-blue-50 text-[#094f9f] shadow-[0_6px_18px_rgba(47,161,240,.13)] ring-1 ring-[#2fa1f0]/20"
                                : "border-slate-200 bg-white text-slate-600 hover:border-blue-200 hover:bg-blue-50/40"
                            }`}>
                              <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                rol === nombreRol ? "border-[#0d5fc1] bg-[#0d5fc1] text-white" : "border-slate-300 bg-white text-transparent"
                              }`}>
                                <InstitutionalIcon name="check" className="h-3 w-3" />
                              </span>
                              <span className="min-w-0">
                                <span className="block text-[11px] font-extrabold leading-tight">{ROL_LABEL[nombreRol]}</span>
                                <span className="mt-0.5 hidden text-[9px] font-medium leading-tight text-slate-400 sm:block">{ROL_DESCRIPCION[nombreRol]}</span>
                              </span>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </fieldset>

                <div className="mt-4">
                  {esTransversal(rol) ? (
                    <div className="flex items-center gap-3 rounded-xl border border-blue-200/80 bg-gradient-to-r from-blue-50 to-cyan-50/60 px-3.5 py-3 text-[#174f86]">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-[#0d5fc1] shadow-sm ring-1 ring-blue-100">
                        <InstitutionalIcon name="building" className="h-4 w-4" />
                      </span>
                      <div>
                        <p className="text-[11px] font-extrabold">Cobertura institucional completa</p>
                        <p className="mt-0.5 text-[9px] font-medium text-slate-500">Este rol no se vincula a una secretaría y puede operar de forma transversal.</p>
                      </div>
                    </div>
                  ) : (
                    <label className="block text-[11px] font-bold text-slate-600">
                      Secretaría asignada <span className="text-red-500">*</span>
                      <span className="relative mt-2 block">
                        <select
                          value={secretariaId}
                          onChange={(e) => setSecretariaId(e.target.value)}
                          required
                          className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-3.5 py-3 pr-10 text-sm font-medium text-[#183558] shadow-sm outline-none transition hover:border-slate-300 focus:border-[#2fa1f0] focus:ring-4 focus:ring-blue-100/80"
                        >
                          <option value="">Selecciona una secretaría…</option>
                          {secretarias.map((secretaria) => (
                            <option key={secretaria.id} value={secretaria.id}>{secretaria.nombre}</option>
                          ))}
                        </select>
                        <InstitutionalIcon name="chevronDown" className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      </span>
                    </label>
                  )}
                </div>
              </section>
            </div>

            <div className="flex shrink-0 flex-col-reverse gap-2 border-t border-slate-200 bg-white px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-7">
              <p className="hidden items-center gap-1.5 text-[9px] font-semibold text-slate-400 sm:flex">
                <InstitutionalIcon name="shield" className="h-3.5 w-3.5" /> Los cambios quedan registrados en auditoría.
              </p>
              <div className="flex w-full gap-2 sm:w-auto">
                <button
                  type="button"
                  onClick={() => setMostrarForm(false)}
                  disabled={guardando}
                  className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 focus:outline-none focus:ring-4 focus:ring-slate-100 disabled:cursor-wait disabled:opacity-50 sm:flex-none"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={guardando}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-[#075bb7] to-[#0a70d6] px-5 py-2.5 text-xs font-extrabold text-white shadow-[0_8px_20px_rgba(10,112,214,.24)] transition hover:-translate-y-0.5 hover:shadow-[0_12px_26px_rgba(10,112,214,.3)] focus:outline-none focus:ring-4 focus:ring-blue-200 disabled:cursor-wait disabled:translate-y-0 disabled:opacity-60 sm:flex-none"
                >
                  {guardando ? (
                    <><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/35 border-t-white" /> Guardando…</>
                  ) : (
                    <><InstitutionalIcon name="check" className="h-4 w-4" /> {editando ? "Guardar cambios" : "Crear usuario"}</>
                  )}
                </button>
              </div>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
