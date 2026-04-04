export function AgentBadge({ className }: { className?: string }) {
  return (
    <span
      className={`border-accent-dim text-accent-dim rounded border px-1.5 py-0.5 text-[10px] ${className ?? ""}`}
    >
      agent
    </span>
  );
}
