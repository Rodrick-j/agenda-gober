"use client";

import Image from "next/image";
import Link from "next/link";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";

interface QuickAccess {
  href: string;
  label: string;
  icon: IconName;
}

interface RoleProfile {
  theme: string;
  eyebrow: string;
  title: (greeting: string) => string;
  description: string;
  roleLabel: string;
  icon: IconName;
  accesses: QuickAccess[];
}

interface RoleDashboardHeroProps {
  rol: string;
  email: string;
  date: string;
  now: Date | null;
  connected: boolean;
  stats: {
    visible: number;
    pending: number;
    offices: number | string;
    progress: number;
  };
  onCreate: () => void;
}

const DEFAULT_PROFILE: RoleProfile = {
  theme: "operational",
  eyebrow: "Espacio institucional",
  title: (greeting) => `${greeting}.`,
  description: "Organiza tu jornada, consulta tus pendientes y mantén el trabajo institucional en movimiento.",
  roleLabel: "Equipo institucional",
  icon: "briefcase",
  accesses: [
    { href: "/agenda", label: "Agenda", icon: "calendar" },
    { href: "/tareas", label: "Mis tareas", icon: "tasks" },
    { href: "/proyectos", label: "Proyectos", icon: "folder" },
  ],
};

const ROLE_PROFILES: Record<string, RoleProfile> = {
  gobernador: {
    theme: "governor",
    eyebrow: "Centro de mando departamental",
    title: (greeting) => `${greeting}, Gobernador.`,
    description: "Oruro se coordina desde aquí: agenda estratégica, instrucciones de despacho y visión integral del gabinete.",
    roleLabel: "Máxima autoridad ejecutiva",
    icon: "sparkles",
    accesses: [
      { href: "/mi-jornada", label: "Mi jornada", icon: "calendar" },
      { href: "/despacho", label: "Despacho", icon: "layers" },
      { href: "/gabinete", label: "Gabinete", icon: "briefcase" },
    ],
  },
  jefe_gabinete: {
    theme: "cabinet",
    eyebrow: "Coordinación ejecutiva",
    title: (greeting) => `${greeting}, Jefe de Gabinete.`,
    description: "Concentre prioridades, supervise compromisos y mantenga alineadas las decisiones del gabinete departamental.",
    roleLabel: "Jefatura de Gabinete",
    icon: "briefcase",
    accesses: [
      { href: "/despacho", label: "Despacho", icon: "layers" },
      { href: "/gabinete", label: "Gabinete", icon: "briefcase" },
      { href: "/auditoria", label: "Auditoría", icon: "audit" },
    ],
  },
  admin: {
    theme: "system",
    eyebrow: "Control institucional",
    title: () => "Sistema bajo control.",
    description: "Administre accesos, supervise la trazabilidad y mantenga disponible la plataforma institucional.",
    roleLabel: "Administración del sistema",
    icon: "shield",
    accesses: [
      { href: "/admin/usuarios", label: "Usuarios", icon: "lock" },
      { href: "/auditoria", label: "Auditoría", icon: "audit" },
      { href: "/secretarias", label: "Secretarías", icon: "building" },
    ],
  },
  unicom: {
    theme: "communication",
    eyebrow: "Comunicación estratégica",
    title: (greeting) => `${greeting}, equipo UNICOM.`,
    description: "Coordine coberturas, contenidos y mensajes para comunicar la gestión de Oruro con claridad y oportunidad.",
    roleLabel: "Unidad de Comunicación",
    icon: "megaphone",
    accesses: [
      { href: "/comunicacion", label: "Coberturas", icon: "message" },
      { href: "/agenda", label: "Agenda", icon: "calendar" },
      { href: "/dashboard#publicaciones", label: "Publicaciones", icon: "megaphone" },
    ],
  },
  secretario: {
    theme: "management",
    eyebrow: "Gestión sectorial",
    title: (greeting) => `${greeting}, Secretario.`,
    description: "Convierta prioridades en resultados y mantenga visible el avance de su área para la coordinación institucional.",
    roleLabel: "Secretaría departamental",
    icon: "building",
    accesses: [
      { href: "/agenda", label: "Agenda", icon: "calendar" },
      { href: "/proyectos", label: "Proyectos", icon: "folder" },
      { href: "/indicadores", label: "Indicadores", icon: "chart" },
    ],
  },
  director: {
    theme: "management",
    eyebrow: "Dirección operativa",
    title: (greeting) => `${greeting}, Director.`,
    description: "Coordine actividades, controle entregables y dé seguimiento al trabajo diario de su dirección.",
    roleLabel: "Dirección institucional",
    icon: "chart",
    accesses: [
      { href: "/tareas", label: "Mis tareas", icon: "tasks" },
      { href: "/agenda", label: "Agenda", icon: "calendar" },
      { href: "/proyectos", label: "Proyectos", icon: "folder" },
    ],
  },
  operador: DEFAULT_PROFILE,
};

function getGreeting(now: Date | null) {
  if (!now) return "Bienvenido";
  const hour = now.getHours();
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

export function RoleDashboardHero({
  rol,
  email,
  date,
  now,
  connected,
  stats,
  onCreate,
}: RoleDashboardHeroProps) {
  const profile = ROLE_PROFILES[rol] ?? DEFAULT_PROFILE;
  const greeting = getGreeting(now);
  const isGovernor = rol === "gobernador";

  return (
    <section className={`role-dashboard-hero role-dashboard-${profile.theme}`}>
      <div className="role-dashboard-grid" aria-hidden="true" />
      <div className="role-dashboard-beam" aria-hidden="true" />
      <div className="role-dashboard-orbit" aria-hidden="true"><i /><i /><i /></div>
      {isGovernor && <div className="role-dashboard-governor-art" aria-hidden="true" />}

      <div className="role-dashboard-body">
        <div className="role-dashboard-copy">
          <div className="role-dashboard-eyebrow">
            <span><InstitutionalIcon name={profile.icon} /></span>
            <b>{profile.eyebrow}</b>
            <i />
            <em className={connected ? "is-connected" : ""}>{connected ? "En línea" : "Reconectando"}</em>
          </div>

          <h1>{profile.title(greeting)}</h1>
          <p>{profile.description}</p>

          <div className="role-dashboard-identity">
            <span><InstitutionalIcon name="shield" />{profile.roleLabel}</span>
            <span><InstitutionalIcon name="clock" />{date}</span>
            <span className="role-dashboard-email"><InstitutionalIcon name="users" />{email}</span>
          </div>
        </div>

        <div className="role-dashboard-radar">
          <div className="role-dashboard-seal" aria-hidden="true">
            <Image
              src="/images/imagotipo-gador-2026-vertical.png"
              alt=""
              width={544}
              height={811}
              priority={isGovernor}
            />
          </div>
          <div className="role-dashboard-radar-copy">
            <span>{isGovernor ? "Radar departamental" : "Resumen de gestión"}</span>
            <strong>{stats.pending ? `${stats.pending} pendientes requieren atención` : "Operación al día"}</strong>
            <small>{stats.offices} unidades activas coordinadas</small>
          </div>
          <div className="role-dashboard-radar-metrics">
            <span><b>{stats.visible}</b><small>Visibles</small></span>
            <span><b>{stats.pending}</b><small>Pendientes</small></span>
            <span><b>{stats.progress}%</b><small>Avance</small></span>
          </div>
          <div className="role-dashboard-radar-live"><i />Actualizado ahora</div>
        </div>
      </div>

      <div className="role-dashboard-actions">
        <nav aria-label="Accesos recomendados para tu rol">
          {profile.accesses.map((access) => (
            <Link key={access.href} href={access.href}>
              <span><InstitutionalIcon name={access.icon} /></span>
              <b>{access.label}</b>
              <InstitutionalIcon name="chevronRight" />
            </Link>
          ))}
        </nav>

        <button type="button" onClick={onCreate} aria-haspopup="dialog" aria-controls="nueva-publicacion-dialog">
          <span><InstitutionalIcon name="plus" /></span>
          <span><b>Nueva publicación</b><small>Crear contenido institucional</small></span>
          <InstitutionalIcon name="chevronRight" />
        </button>
      </div>
    </section>
  );
}
