"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAccount } from "wagmi";
import Image from "next/image";
import { ConnectWallet } from "./ConnectWallet";

export function NavBar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { address, isConnected } = useAccount();

  const dashboardHref = isConnected && address
    ? `/profile/${address}`
    : "/dashboard/writer";

  const navLinks = [
    { href: "/create", label: "Create" },
    { href: dashboardHref, label: "Dashboard" },
    { href: "/agents", label: "Agents" },
    { href: "/token", label: "$PLOT" },
  ];

  const isActive = (href: string, label: string) => {
    if (label === "Dashboard") {
      return pathname.startsWith("/profile/") || pathname.startsWith("/dashboard/");
    }
    return pathname === href || pathname.startsWith(href + "/");
  };

  return (
    <nav className="fixed top-0 right-0 left-0 z-50 border-b border-[var(--border)] bg-[var(--bg)]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-11 max-w-5xl items-center justify-between px-4">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-1.5 transition-opacity hover:opacity-80"
        >
          <Image
            src="/plotlink-logo-symbol.svg"
            alt=""
            width={20}
            height={24}
            className="h-5 w-auto"
          />
          <span className="font-heading text-lg font-bold tracking-tight text-[var(--accent)]">
            PlotLink
          </span>
        </Link>

        {/* Desktop nav links */}
        <div className="hidden items-center gap-1 md:flex">
          {navLinks.map(({ href, label }) => {
            const active = isActive(href, label);
            return (
              <Link
                key={label}
                href={href}
                className={`rounded px-2.5 py-1 text-xs font-medium transition-colors ${
                  active
                    ? "bg-[var(--accent)]/15 text-accent"
                    : "text-muted hover:text-foreground"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>

        {/* Right side: wallet + mobile toggle */}
        <div className="flex items-center gap-1.5">
          {/* Desktop: ConnectWallet */}
          <div className="hidden md:block">
            <ConnectWallet />
          </div>
          {/* Mobile: matched-height boxes — PFP box + hamburger box */}
          <div className="flex items-center md:hidden">
            <ConnectWallet compact />
          </div>
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="border-border text-muted hover:text-foreground flex h-7 items-center justify-center rounded border px-2 py-1 transition-colors md:hidden"
            aria-label="Toggle menu"
            aria-expanded={mobileOpen}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {mobileOpen ? (
                <>
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </>
              ) : (
                <>
                  <line x1="3" y1="6" x2="21" y2="6" />
                  <line x1="3" y1="12" x2="21" y2="12" />
                  <line x1="3" y1="18" x2="21" y2="18" />
                </>
              )}
            </svg>
          </button>
        </div>
      </div>

      {/* Mobile backdrop — closes menu on outside tap */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile dropdown */}
      {mobileOpen && (
        <div className="relative z-50 border-t border-[var(--border)] bg-[var(--bg)] px-4 pb-3 pt-2 md:hidden">
          <div className="flex flex-col gap-1">
            {navLinks.map(({ href, label }) => {
              const active = isActive(href, label);
              return (
                <Link
                  key={label}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  className={`rounded px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "bg-[var(--accent)]/15 text-accent"
                      : "text-muted hover:text-foreground"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </div>
          <div className="mt-2 border-t border-[var(--border)] pt-2">
            <ConnectWallet onNavigate={() => setMobileOpen(false)} />
          </div>
        </div>
      )}
    </nav>
  );
}
