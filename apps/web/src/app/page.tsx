"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// No hay token local que chequear (vive en una cookie httpOnly): se manda
// siempre al panel, y su layout es quien decide si hay sesión válida
// (GET /auth/me) y redirige a /login si no la hay.
export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/dashboard");
  }, [router]);

  return null;
}
