"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getFarcasterProfile } from "../../lib/actions";
import { truncateAddress } from "../../lib/utils";
import type { FarcasterProfile } from "../../lib/farcaster";

/**
 * Client component that resolves a Farcaster identity via server action.
 * Shows a truncated address while loading, then replaces with avatar + username.
 * Links to the internal profile page at /profile/[address].
 */
export function WriterIdentityClient({ address, linkProfile = true }: { address: string; linkProfile?: boolean }) {
  const [profile, setProfile] = useState<FarcasterProfile | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getFarcasterProfile(address).then((p) => {
      if (!cancelled) {
        setProfile(p);
        setLoaded(true);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  const label = !loaded || !profile
    ? truncateAddress(address)
    : null;

  if (!loaded || !profile) {
    if (!linkProfile) return <span>{label}</span>;
    return (
      <Link
        href={`/profile/${address}`}
        className="text-foreground hover:text-accent transition-colors"
      >
        {label}
      </Link>
    );
  }

  const inner = (
    <span className="inline-flex items-center gap-1">
      {profile.pfpUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.pfpUrl}
          alt=""
          width={14}
          height={14}
          className="rounded-full"
        />
      )}
      <span>@{profile.username}</span>
    </span>
  );

  if (!linkProfile) return inner;

  return (
    <Link
      href={`/profile/${address}`}
      className="text-foreground hover:text-accent transition-colors"
    >
      {inner}
    </Link>
  );
}
