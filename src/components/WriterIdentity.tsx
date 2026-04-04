import Link from "next/link";
import { getFarcasterProfile } from "../../lib/actions";
import { truncateAddress } from "../../lib/utils";

/**
 * Server component that displays a Farcaster identity (avatar + username)
 * when available, falling back to a truncated Ethereum address.
 * Links to the internal profile page at /profile/[address].
 */
export async function WriterIdentity({ address }: { address: string }) {
  const profile = await getFarcasterProfile(address);

  if (!profile) {
    return (
      <Link
        href={`/profile/${address}`}
        className="text-foreground hover:text-accent transition-colors"
      >
        {truncateAddress(address)}
      </Link>
    );
  }

  return (
    <Link
      href={`/profile/${address}`}
      className="inline-flex items-center gap-1 text-foreground hover:text-accent transition-colors"
    >
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
      @{profile.username}
    </Link>
  );
}
