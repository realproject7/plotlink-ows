"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getFarcasterProfile } from "../../lib/actions";
import { truncateAddress } from "../../lib/utils";
import type { FarcasterProfile } from "../../lib/farcaster";

/**
 * Resolves an Ethereum address to a Farcaster identity via server action.
 * Shows avatar + @username with link, or falls back to truncated address.
 * Links to the internal profile page at /profile/[address].
 */
export function FarcasterAvatar({
  address,
  size = 14,
  className,
  linkProfile = true,
}: {
  address: string;
  size?: number;
  className?: string;
  linkProfile?: boolean;
}) {
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

  if (!loaded || !profile) {
    if (!linkProfile) return <span className={className}>{truncateAddress(address)}</span>;
    return (
      <Link
        href={`/profile/${address}`}
        className={`hover:text-accent transition-colors ${className ?? ""}`}
      >
        {truncateAddress(address)}
      </Link>
    );
  }

  const inner = (
    <>
      {profile.pfpUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={profile.pfpUrl}
          alt=""
          width={size}
          height={size}
          className="rounded-full"
        />
      )}
      <span>@{profile.username}</span>
    </>
  );

  if (!linkProfile) {
    return (
      <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
        {inner}
      </span>
    );
  }

  return (
    <Link
      href={`/profile/${address}`}
      className={`inline-flex items-center gap-1 text-foreground hover:text-accent transition-colors ${className ?? ""}`}
    >
      {inner}
    </Link>
  );
}
