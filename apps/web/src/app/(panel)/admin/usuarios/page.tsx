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

const ROLES_TRANSVERSALES: RolNombre[] = ["gobernador", "jefe_gabinete", "admin"];
const ROL_LABEL: Record<RolNombre, string> = {
  gobernador: "Gobernador",
  jefe_gabinete: "Jefe de Gabinete",
  admin: "Super Administrador",
  secretario: "Secretario/a",
  director: "Director/a",
  operador: "Operador/a",
};
const ROL_ESTILO: Record<RolNombre, string> = {
  gobernador: "bg-amber-50 text-amber-800 ring-amber-200",
  jefe_gabinete: "bg-amber-50 text-amber-800 ring-amber-200",
  admin: "bg-violet-50 text-violet-700 ring-violet-200",
  secretario: "bg-blue-50 text-blue-700 ring-blue-200",
  director: "bg-cyan-50 text-cyan-700 ring-cyan-200",
  operador: "bg-slate-100 text-slate-600 ring-slate-200",
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
    if (esAdmin) void cargar();
    else setCargando(false);
  }, [cargar, esAdmin]);

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

      {error && (
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
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-4" onClick={() => setMostrarForm(false)}>
          <form onClick={(e) => e.stopPropagation()} onSubmit={onGuardar} className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 bg-gradient-to-r from-rose-50 to-white px-5 py-3.5">
              <h2 className="text-sm font-extrabold text-[#6f0b2b]">{editando ? "Editar usuario" : "Nuevo usuario"}</h2>
              <button type="button" onClick={() => setMostrarForm(false)} className="text-slate-400 hover:text-slate-700">
                <InstitutionalIcon name="chevronDown" className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-3 p-5">
              <label className="block text-xs font-bold text-slate-700">
                Nombre completo
                <input
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  required
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                />
              </label>
              <label className="block text-xs font-bold text-slate-700">
                Correo institucional
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={!!editando}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100 disabled:cursor-not-allowed disabled:text-slate-400"
                />
              </label>
              {!editando && (
                <label className="block text-xs font-bold text-slate-700">
                  Contraseña inicial
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    minLength={8}
                    placeholder="Mínimo 8 caracteres"
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  />
                </label>
              )}
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-xs font-bold text-slate-700">
                  Rol
                  <select
                    value={rol}
                    onChange={(e) => setRol(e.target.value as RolNombre)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100"
                  >
                    <optgroup label="Por secretaría">
                      <option value="operador">Operador/a</option>
                      <option value="director">Director/a</option>
                      <option value="secretario">Secretario/a</option>
                    </optgroup>
                    <optgroup label="Transversales">
                      <option value="jefe_gabinete">Jefe de Gabinete</option>
                      <option value="gobernador">Gobernador</option>
                      <option value="admin">Super Administrador</option>
                    </optgroup>
                  </select>
                </label>
                <label className={`block text-xs font-bold text-slate-700 ${esTransversal(rol) ? "opacity-40" : ""}`}>
                  Secretaría
                  <select
                    value={secretariaId}
                    onChange={(e) => setSecretariaId(e.target.value)}
                    required={!esTransversal(rol)}
                    disabled={esTransversal(rol)}
                    className="mt-1.5 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm font-normal outline-none transition focus:border-blue-400 focus:bg-white focus:ring-3 focus:ring-blue-100 disabled:cursor-not-allowed"
                  >
                    <option value="">Elegir…</option>
                    {secretarias.map((s) => (
                      <option key={s.id} value={s.id}>{s.nombre}</option>
                    ))}
                  </select>
                </label>
              </div>
              {esTransversal(rol) && (
                <p className="text-[10px] text-slate-400">Los roles transversales no pertenecen a ninguna secretaría — ven todo el gobierno.</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3.5">
              <button type="button" onClick={() => setMostrarForm(false)} className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">
                Cancelar
              </button>
              <button
                type="submit"
                disabled={guardando}
                className="rounded-xl bg-[#0d5fc1] px-5 py-2 text-xs font-bold text-white shadow-md shadow-blue-200 transition hover:bg-[#094f9f] disabled:cursor-wait disabled:opacity-60"
              >
                {guardando ? "Guardando…" : editando ? "Guardar cambios" : "Crear usuario"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
