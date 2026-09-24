"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { InstitutionalIcon, type IconName } from "@/components/InstitutionalIcon";
import { getNavigationSections } from "@/components/InstitutionalSidebar";

interface MobileNavigationProps {
  rol: string;
  abierto: boolean;
  onOpenChange: (abierto: boolean) => void;
}

const PRIMARY_NAV: { href: string; label: string; icon: IconName }[] = [
  { href: "/dashboard", label: "Inicio", icon: "home" },
  { href: "/agenda", label: "Agenda", icon: "calendar" },
  { href: "/tareas", label: "Tareas", icon: "tasks" },
];

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("es");
}

function isRouteActive(pathname: string, href: string) {
  return !href.includes("#") && pathname === href.split("#")[0];
}

export function MobileNavigation({ rol, abierto, onOpenChange }: MobileNavigationProps) {
  const pathname = usePathname();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const sections = useMemo(() => getNavigationSections(rol), [rol]);

  const filteredSections = useMemo(() => {
    const term = normalize(query.trim());
    if (!term) return sections;

    return sections
      .map((section) => ({
        ...section,
        items: section.items.filter((item) =>
          normalize(`${item.label} ${item.description ?? ""} ${section.title}`).includes(term),
        ),
      }))
      .filter((section) => section.items.length > 0);
  }, [query, sections]);

  useEffect(() => {
    if (!abierto) return;

    const frame = window.requestAnimationFrame(() => searchRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [abierto]);

  function closeNavigation() {
    setQuery("");
    onOpenChange(false);
  }

  const primaryActive = PRIMARY_NAV.some((item) => isRouteActive(pathname, item.href));
  const moreActive = abierto || !primaryActive;

  return (
    <>
      <nav aria-label="Navegación rápida" className={`mobile-nav-dock lg:hidden ${abierto ? "mobile-nav-dock-behind" : ""}`}>
        <span className="mobile-nav-dock-glow" aria-hidden="true" />
        {PRIMARY_NAV.map((item) => {
          const active = isRouteActive(pathname, item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={`mobile-nav-action ${active ? "mobile-nav-action-active" : ""}`}
            >
              <span className="mobile-nav-icon"><InstitutionalIcon name={item.icon} /></span>
              <span>{item.label}</span>
              {active && <i aria-hidden="true" />}
            </Link>
          );
        })}
        <button
          type="button"
          onClick={() => onOpenChange(true)}
          aria-expanded={abierto}
          aria-controls="mobile-navigation-sheet"
          className={`mobile-nav-action ${moreActive ? "mobile-nav-action-active" : ""}`}
        >
          <span className="mobile-nav-icon"><InstitutionalIcon name="menu" /></span>
          <span>Más</span>
          {moreActive && <i aria-hidden="true" />}
        </button>
      </nav>

      <div
        aria-hidden={!abierto}
        className={`mobile-nav-layer lg:hidden ${abierto ? "mobile-nav-layer-open" : ""}`}
      >
        <button
          type="button"
          tabIndex={abierto ? 0 : -1}
          aria-label="Cerrar navegación"
          onClick={closeNavigation}
          className="mobile-nav-backdrop"
        />

        <section
          id="mobile-navigation-sheet"
          role="dialog"
          aria-modal="true"
          aria-labelledby="mobile-navigation-title"
          className="mobile-nav-sheet"
        >
          <div className="mobile-nav-handle" aria-hidden="true" />
          <div className="mobile-nav-sheet-atmosphere" aria-hidden="true" />

          <header className="mobile-nav-sheet-header">
            <div className="mobile-nav-sheet-title">
              <span><InstitutionalIcon name="layers" /></span>
              <div>
                <p>Centro de navegación</p>
                <h2 id="mobile-navigation-title">Todos los módulos</h2>
              </div>
            </div>
            <div className="mobile-nav-sheet-actions">
              <span>{rol.replaceAll("_", " ")}</span>
              <button type="button" onClick={closeNavigation} aria-label="Cerrar menú">
                <InstitutionalIcon name="close" />
              </button>
            </div>
          </header>

          <label className="mobile-nav-search">
            <span className="sr-only">Buscar módulo</span>
            <InstitutionalIcon name="search" />
            <input
              ref={searchRef}
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar agenda, proyectos, gabinete…"
              tabIndex={abierto ? 0 : -1}
            />
            {query && (
              <button type="button" onClick={() => setQuery("")} aria-label="Limpiar búsqueda">
                <InstitutionalIcon name="close" />
              </button>
            )}
          </label>

          <div className="mobile-nav-sheet-content">
            {filteredSections.map((section) => (
              <section key={section.title} className="mobile-nav-group">
                <div className="mobile-nav-group-title">
                  <span>{section.title}</span>
                  <i />
                  <small>{section.items.length}</small>
                </div>
                <div className="mobile-nav-grid">
                  {section.items.map((item) => {
                    if (!item.href) return null;
                    const active = isRouteActive(pathname, item.href);
                    return (
                      <Link
                        key={`${section.title}-${item.label}`}
                        href={item.href}
                        onClick={closeNavigation}
                        aria-current={active ? "page" : undefined}
                        className={`mobile-nav-module ${active ? "mobile-nav-module-active" : ""}`}
                      >
                        <span className="mobile-nav-module-icon"><InstitutionalIcon name={item.icon} /></span>
                        <span className="mobile-nav-module-copy">
                          <strong>{item.label}</strong>
                          <small>{item.description}</small>
                        </span>
                        <InstitutionalIcon name={active ? "check" : "chevronRight"} className="mobile-nav-module-arrow" />
                      </Link>
                    );
                  })}
                </div>
              </section>
            ))}

            {filteredSections.length === 0 && (
              <div className="mobile-nav-empty">
                <span><InstitutionalIcon name="search" /></span>
                <strong>No encontramos ese módulo</strong>
                <small>Prueba con agenda, proyectos o gabinete.</small>
              </div>
            )}
          </div>

          <footer className="mobile-nav-sheet-footer">
            <InstitutionalIcon name="shield" />
            <span>Accesos habilitados según tu rol institucional</span>
          </footer>
        </section>
      </div>
    </>
  );
}
