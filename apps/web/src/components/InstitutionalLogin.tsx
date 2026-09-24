"use client";

import {
  useEffect,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { login } from "@/lib/api";
import { InstitutionalIcon } from "@/components/InstitutionalIcon";
import { InstitutionalMark } from "@/components/InstitutionalMark";

type AccessPhase = "idle" | "verifying" | "granted";

const CAPABILITIES = [
  { icon: "wifi" as const, label: "Tiempo real", detail: "Sincronizado" },
  { icon: "shield" as const, label: "Acceso por roles", detail: "Protegido" },
  { icon: "audit" as const, label: "Trazabilidad", detail: "Verificada" },
];

const NETWORK_POINTS = [
  { x: 17, y: 24, delay: "0s" },
  { x: 36, y: 17, delay: ".8s" },
  { x: 55, y: 32, delay: "1.5s" },
  { x: 27, y: 49, delay: "2.1s" },
  { x: 48, y: 57, delay: ".4s" },
  { x: 69, y: 48, delay: "1.1s" },
];

function getGreeting(hour: number) {
  if (hour < 12) return "Buenos días";
  if (hour < 19) return "Buenas tardes";
  return "Buenas noches";
}

function wait(milliseconds: number) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

export function InstitutionalLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [capsLock, setCapsLock] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phase, setPhase] = useState<AccessPhase>("idle");
  const [clock, setClock] = useState({ greeting: "Bienvenido", time: "--:--", date: "Portal ejecutivo" });

  useEffect(() => {
    const updateClock = () => {
      const now = new Date();
      const hour = Number(
        new Intl.DateTimeFormat("es-BO", {
          hour: "2-digit",
          hour12: false,
          timeZone: "America/La_Paz",
        }).format(now),
      );

      setClock({
        greeting: getGreeting(hour),
        time: new Intl.DateTimeFormat("es-BO", {
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
          timeZone: "America/La_Paz",
        }).format(now),
        date: new Intl.DateTimeFormat("es-BO", {
          weekday: "short",
          day: "2-digit",
          month: "short",
          timeZone: "America/La_Paz",
        })
          .format(now)
          .replaceAll(".", ""),
      });
    };

    updateClock();
    const timer = window.setInterval(updateClock, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  function trackPointer(event: PointerEvent<HTMLElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - bounds.left) / bounds.width) * 100;
    const y = ((event.clientY - bounds.top) / bounds.height) * 100;
    event.currentTarget.style.setProperty("--pointer-x", `${x}%`);
    event.currentTarget.style.setProperty("--pointer-y", `${y}%`);
  }

  function tiltCard(event: PointerEvent<HTMLDivElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - bounds.left) / bounds.width - 0.5;
    const y = (event.clientY - bounds.top) / bounds.height - 0.5;
    event.currentTarget.style.setProperty("--tilt-x", `${y * -2.2}deg`);
    event.currentTarget.style.setProperty("--tilt-y", `${x * 2.2}deg`);
  }

  function resetTilt(event: PointerEvent<HTMLDivElement>) {
    event.currentTarget.style.setProperty("--tilt-x", "0deg");
    event.currentTarget.style.setProperty("--tilt-y", "0deg");
  }

  function updateCapsLock(event: KeyboardEvent<HTMLInputElement>) {
    setCapsLock(event.getModifierState("CapsLock"));
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setPhase("verifying");

    try {
      // La API crea la cookie httpOnly. La transición breve confirma el acceso
      // antes de que el panel valide la sesión con GET /auth/me.
      await login(email, password);
      setPhase("granted");
      await wait(720);
      router.push("/dashboard");
    } catch (err) {
      setPhase("idle");
      setError(err instanceof Error ? err.message : "No fue posible iniciar sesión");
    }
  }

  const busy = phase !== "idle";

  return (
    <main
      className={`login-shell login-command-center ${phase === "granted" ? "login-is-granted" : ""}`}
      onPointerMove={trackPointer}
    >
      <div className="login-cursor-glow" aria-hidden="true" />

      <section className="login-visual" aria-label="Identidad institucional de Oruro">
        <div
          role="img"
          aria-label="Agenda estratégica y coordinación de gabinete de la Gobernación de Oruro"
          className="login-artwork"
        />
        <div className="login-visual-vignette" aria-hidden="true" />
        <div className="login-scanline" aria-hidden="true" />

        <div className="login-visual-topline" aria-hidden="true">
          <span>GADOR / 2026</span>
          <span className="login-visual-topline-rule" />
          <span>Centro de coordinación</span>
        </div>

        <svg className="login-network" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M17 24 L36 17 L55 32 L69 48 L48 57 L27 49 Z" />
          <path d="M36 17 L27 49 M55 32 L48 57 M17 24 L48 57" />
          {NETWORK_POINTS.map((point) => (
            <g key={`${point.x}-${point.y}`} style={{ "--node-delay": point.delay } as CSSProperties}>
              <circle className="login-network-ring" cx={point.x} cy={point.y} r="1.8" />
              <circle className="login-network-dot" cx={point.x} cy={point.y} r="0.55" />
            </g>
          ))}
        </svg>

        <div className="login-visual-signal" aria-hidden="true">
          <span className="login-signal-bars"><i /><i /><i /></span>
          <span>Red estratégica activa</span>
        </div>

        <div className="login-edge-beam" aria-hidden="true">
          <span />
        </div>
      </section>

      <section className="login-panel">
        <div className="login-panel-atmosphere" aria-hidden="true">
          <div className="login-grid" />
          <div className="login-orbit login-orbit-one" />
          <div className="login-orbit login-orbit-two" />
          <div className="login-particles">
            {Array.from({ length: 12 }, (_, index) => <span key={index} />)}
          </div>
        </div>

        <div className="login-panel-inner">
          <header className="login-brand-row login-enter login-enter-1">
            <InstitutionalMark compact className="login-brand-mark" />
            <div className="login-live-status">
              <span className="login-live-dot" />
              <span>
                <strong>Sistema operativo</strong>
                <small>{clock.time} BOT</small>
              </span>
            </div>
          </header>

          <div className="login-heading login-enter login-enter-2">
            <div className="login-eyebrow">
              <span /> Portal institucional <b>Acceso ejecutivo</b>
            </div>
            <h1>{clock.greeting}<span>.</span></h1>
            <p>
              El centro de decisiones estratégicas de la Gobernación, conectado en un solo lugar.
            </p>
          </div>

          <div
            className="login-access-card login-enter login-enter-3"
            onPointerMove={tiltCard}
            onPointerLeave={resetTilt}
          >
            <div className="login-card-glint" aria-hidden="true" />
            <div className="login-card-scan" aria-hidden="true" />

            <div className="login-card-header">
              <div className="login-access-id">
                <div className="login-lock-box">
                  <InstitutionalIcon name="lock" />
                  <span />
                </div>
                <div>
                  <strong>Identificación segura</strong>
                  <small>Credenciales institucionales</small>
                </div>
              </div>
              <div className="login-encryption-badge">
                <InstitutionalIcon name="shield" />
                Cifrado
              </div>
            </div>

            <form onSubmit={onSubmit} className="login-form">
              <label className="login-field-group">
                <span>Correo institucional</span>
                <div className="login-field">
                  <InstitutionalIcon name="message" className="login-field-icon" />
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    disabled={busy}
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="usuario@gober.local"
                  />
                  <i aria-hidden="true" />
                </div>
              </label>

              <label className="login-field-group">
                <span>Contraseña</span>
                <div className="login-field">
                  <InstitutionalIcon name="lock" className="login-field-icon" />
                  <input
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    disabled={busy}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    onKeyDown={updateCapsLock}
                    onKeyUp={updateCapsLock}
                    onBlur={() => setCapsLock(false)}
                    placeholder="••••••••"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((visible) => !visible)}
                    disabled={busy}
                    className="login-password-toggle"
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                  >
                    <InstitutionalIcon name={showPassword ? "eyeOff" : "eye"} />
                  </button>
                  <i aria-hidden="true" />
                </div>
                {capsLock && <small className="login-caps-warning">Bloq Mayús está activado</small>}
              </label>

              <div className="login-message-slot" aria-live="polite">
                {error && (
                  <div role="alert" className="login-error-message">
                    <InstitutionalIcon name="shield" />
                    <span>{error}</span>
                  </div>
                )}
              </div>

              <button type="submit" disabled={busy} aria-busy={busy} className={`login-submit login-submit-${phase}`}>
                <span className="login-submit-grid" aria-hidden="true" />
                <span className="login-submit-light" aria-hidden="true" />
                <span className="login-submit-content">
                  {phase === "verifying" && <span className="login-spinner" />}
                  {phase === "granted" && <InstitutionalIcon name="check" />}
                  {phase === "idle" ? "Ingresar al centro de mando" : phase === "verifying" ? "Verificando identidad" : "Acceso autorizado"}
                  {phase === "idle" && <InstitutionalIcon name="chevronRight" className="login-submit-arrow" />}
                </span>
              </button>
            </form>
          </div>

          <div className="login-capability-rail login-enter login-enter-4">
            {CAPABILITIES.map((capability) => (
              <div key={capability.label}>
                <span className="login-capability-icon"><InstitutionalIcon name={capability.icon} /></span>
                <span><strong>{capability.label}</strong><small>{capability.detail}</small></span>
              </div>
            ))}
          </div>

          <footer className="login-footer login-enter login-enter-5">
            <span>{clock.date}</span>
            <i />
            <span>Gobierno Autónomo Departamental de Oruro</span>
          </footer>
        </div>
      </section>

      {phase === "granted" && (
        <div className="login-granted-overlay" role="status" aria-live="assertive">
          <div className="login-granted-rings">
            <span /><span /><span />
            <div><InstitutionalIcon name="check" /></div>
          </div>
          <strong>Acceso autorizado</strong>
          <small>Preparando centro de mando</small>
        </div>
      )}
    </main>
  );
}
