import React, { useState, useEffect } from "react";
import { Login } from "./components/Login";
import { Layout } from "./components/Layout";

const API_BASE = "http://localhost:7777";

export function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("ows-token"),
  );
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (!token) {
      setChecking(false);
      return;
    }
    fetch(`${API_BASE}/api/auth/verify`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => {
        if (!r.ok) {
          localStorage.removeItem("ows-token");
          setToken(null);
        }
      })
      .catch(() => {
        localStorage.removeItem("ows-token");
        setToken(null);
      })
      .finally(() => setChecking(false));
  }, [token]);

  const handleLogin = async (passphrase: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Login failed";
      localStorage.setItem("ows-token", data.token);
      setToken(data.token);
      return null;
    } catch {
      return "Cannot connect to server";
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("ows-token");
    setToken(null);
  };

  if (checking) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-muted text-sm">verifying session...</span>
      </div>
    );
  }

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return <Layout token={token} onLogout={handleLogout} />;
}
