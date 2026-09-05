"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { obtenerToken } from "@/lib/auth";

export default function Home() {
  const router = useRouter();

  useEffect(() => {
    router.replace(obtenerToken() ? "/dashboard" : "/login");
  }, [router]);

  return null;
}
