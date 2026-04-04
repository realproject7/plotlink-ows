import React, { useState, useEffect } from "react";
import { Login } from "./components/Login";
import { Setup } from "./components/Setup";
import { Layout } from "./components/Layout";

const API_BASE = "http://localhost:7777";

export function App() {
  const [token, setToken] = useState<string | null>(() =>
    localStorage.getItem("ows-token"),
  );
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    // Check if passphrase is configured (first-run detection)
    fetch(`${API_BASE}/api/auth/status`)
      .then((r) => r.json())
      .then((d) => setConfigured(d.configured))
      .catch(() => setConfigured(null));
  }, []);

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

  const handleSetup = async (passphrase: string): Promise<string | null> => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/setup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passphrase }),
      });
      const data = await res.json();
      if (!res.ok) return data.error || "Setup failed";
      localStorage.setItem("ows-token", data.token);
      setToken(data.token);
      setConfigured(true);
      return null;
    } catch {
      return "Cannot connect to server";
    }
  };

  const handleLogout = () => {
    localStorage.removeItem("ows-token");
    setToken(null);
  };

  if (checking || configured === null) {
    return (
      <div className="flex h-screen items-center justify-center">
        <span className="text-muted text-sm">connecting...</span>
      </div>
    );
  }

  if (!configured) {
    return <Setup onSetup={handleSetup} />;
  }

  if (!token) {
    return <Login onLogin={handleLogin} />;
  }

  return <Layout token={token} onLogout={handleLogout} />;
}
