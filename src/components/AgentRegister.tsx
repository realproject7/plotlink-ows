"use client";

import { useState, useMemo } from "react";
import { useAccount, useWriteContract, useSignTypedData } from "wagmi";
import { decodeEventLog, type Hex } from "viem";
import { browserClient as publicClient } from "../../lib/rpc";
import { erc8004Abi } from "../../lib/contracts/erc8004";
import { ERC8004_REGISTRY, BASE_CHAIN_ID, EXPLORER_URL } from "../../lib/contracts/constants";
import { Select } from "./Select";

const GENRES = [
  "Fantasy", "Sci-Fi", "Mystery", "Romance", "Horror",
  "Thriller", "Literary Fiction", "Comedy", "Historical", "Adventure",
] as const;

const LLM_MODELS = [
  "Claude Opus", "Claude Sonnet", "OpenAI GPT", "Google Gemini",
  "Cursor Composer", "xAI Grok", "Moonshot Kimi", "DeepSeek", "Qwen", "Others",
] as const;

type WizardStep = 1 | 2 | "done";
type BindStep = "enter" | "sign" | "submit" | "bound" | null;

const EIP712_DOMAIN = {
  name: "ERC8004IdentityRegistry",
  version: "1",
  chainId: Number(BASE_CHAIN_ID),
  verifyingContract: ERC8004_REGISTRY,
} as const;

const SET_WALLET_TYPES = {
  AgentWalletSet: [
    { name: "agentId", type: "uint256" },
    { name: "newWallet", type: "address" },
    { name: "owner", type: "address" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

export function AgentRegister() {
  const { address } = useAccount();
  const { writeContractAsync } = useWriteContract();
  const { signTypedDataAsync } = useSignTypedData();

  const [step, setStep] = useState<WizardStep>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [genre, setGenre] = useState<string>("");
  const [llmModel, setLlmModel] = useState<string>("");
  const [registering, setRegistering] = useState(false);
  const [regTxHash, setRegTxHash] = useState<Hex | undefined>();
  const [agentId, setAgentId] = useState<bigint | undefined>();
  const [ownerAddress, setOwnerAddress] = useState<`0x${string}` | undefined>();
  const [agentWallet, setAgentWallet] = useState("");
  const [agentSignature, setAgentSignature] = useState<Hex | undefined>();
  const [signatureDeadline, setSignatureDeadline] = useState<bigint | undefined>();
  const [signing, setSigning] = useState(false);
  const [binding, setBinding] = useState(false);
  const [bindTxHash, setBindTxHash] = useState<Hex | undefined>();
  const [bindStep, setBindStep] = useState<BindStep>(null);
  const [error, setError] = useState<string | null>(null);

  const agentURI = useMemo(() => {
    if (!name.trim()) return "";
    const metadata = {
      name: name.trim(),
      description: description.trim(),
      genre: genre || undefined,
      llmModel: llmModel || undefined,
      registeredBy: address,
      registeredAt: new Date().toISOString(),
    };
    return JSON.stringify(metadata);
  }, [name, description, genre, llmModel, address]);

  const profileValid = name.trim().length > 0 && description.trim().length > 0;

  async function handleRegister() {
    try {
      setError(null);
      setRegistering(true);
      const hash = await writeContractAsync({
        address: ERC8004_REGISTRY,
        abi: erc8004Abi,
        functionName: "register",
        args: [agentURI],
      });
      setRegTxHash(hash);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      const registeredLog = receipt.logs.find((log) => {
        try {
          const decoded = decodeEventLog({ abi: erc8004Abi, data: log.data, topics: log.topics });
          return decoded.eventName === "Registered";
        } catch { return false; }
      });
      let newAgentId: bigint | undefined;
      if (registeredLog) {
        const decoded = decodeEventLog({ abi: erc8004Abi, data: registeredLog.data, topics: registeredLog.topics });
        if (decoded.eventName === "Registered") {
          newAgentId = decoded.args.agentId;
          setAgentId(newAgentId);
        }
      }
      setOwnerAddress(address);
      // Persist agent data to DB
      const meta = JSON.parse(agentURI);
      try {
        const cacheRes = await fetch("/api/user/agent-register", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            walletAddress: address,
            agentId: newAgentId?.toString(),
            name: meta.name,
            description: meta.description,
            genre: meta.genre,
            llmModel: meta.llmModel,
            agentOwner: address,
          }),
        });
        if (!cacheRes.ok) {
          setError("On-chain OK, but cache failed — will sync on next visit");
        }
      } catch {
        setError("On-chain OK, but cache failed — will sync on next visit");
      }
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setRegistering(false);
    }
  }

  async function handleAgentSign() {
    if (!agentId || !agentWallet) return;
    try {
      setError(null);
      setSigning(true);
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 300);
      const signature = await signTypedDataAsync({
        domain: EIP712_DOMAIN,
        types: SET_WALLET_TYPES,
        primaryType: "AgentWalletSet",
        message: { agentId, newWallet: agentWallet as `0x${string}`, owner: ownerAddress as `0x${string}`, deadline },
      });
      setAgentSignature(signature);
      setSignatureDeadline(deadline);
      setBindStep("submit");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Agent wallet signing failed");
    } finally {
      setSigning(false);
    }
  }

  async function handleSubmitBinding() {
    if (!agentId || !agentWallet || !agentSignature || !signatureDeadline) return;
    try {
      setError(null);
      setBinding(true);
      const hash = await writeContractAsync({
        address: ERC8004_REGISTRY,
        abi: erc8004Abi,
        functionName: "setAgentWallet",
        args: [agentId, agentWallet as `0x${string}`, signatureDeadline, agentSignature],
      });
      setBindTxHash(hash);
      await publicClient.waitForTransactionReceipt({ hash });
      // Persist wallet binding to DB
      fetch("/api/user/agent-update", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          walletAddress: ownerAddress,
          fields: { agent_wallet: agentWallet.toLowerCase() },
        }),
      }).catch(() => {});
      setBindStep("bound");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Wallet binding failed");
    } finally {
      setBinding(false);
    }
  }

  const isAgentWalletConnected =
    address?.toLowerCase() === agentWallet.toLowerCase() && agentWallet.match(/^0x[a-fA-F0-9]{40}$/);
  const isOwnerWalletConnected =
    ownerAddress && address?.toLowerCase() === ownerAddress.toLowerCase();

  const stepNum = typeof step === "number" ? step : 3;

  return (
    <div className="mt-6">
      {/* Step indicator */}
      <div className="flex items-center gap-2">
        {([1, 2] as const).map((s) => (
          <div key={s} className="flex items-center gap-2">
            <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-xs font-medium transition-colors ${
              s === stepNum ? "border-accent text-accent"
                : s < stepNum ? "border-accent bg-accent text-background"
                : "border-border text-muted"
            }`}>
              {s < stepNum ? "\u2713" : s}
            </div>
            {s < 2 && <div className={`h-px w-8 ${s < stepNum ? "bg-accent" : "bg-border"}`} />}
          </div>
        ))}
        <span className="text-muted ml-3 text-xs">
          {step === 1 && "Agent Profile"}
          {step === 2 && "On-chain Registration"}
          {step === "done" && "Complete"}
        </span>
      </div>

      {error && (
        <div className="border-error/30 text-error mt-6 rounded border px-3 py-2 text-xs">{error}</div>
      )}

      {/* Step 1: Profile */}
      {step === 1 && (
        <form onSubmit={(e) => { e.preventDefault(); if (profileValid) setStep(2); }} className="mt-6 space-y-5">
          <div>
            <label className="text-foreground mb-2 block text-sm">Agent Name</label>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Plotweaver-7B"
              className="border-border bg-surface text-foreground placeholder:text-muted w-full rounded border px-3 py-2 text-sm focus:border-accent focus:outline-none" />
          </div>
          <div>
            <label className="text-foreground mb-2 block text-sm">Description</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Describe what this agent does and its writing style"
              className="border-border bg-surface text-foreground placeholder:text-muted w-full resize-y rounded border px-3 py-2 text-sm leading-relaxed focus:border-accent focus:outline-none" />
          </div>
          <div>
            <label className="text-foreground mb-2 block text-sm">Primary Genre</label>
            <Select value={genre} onChange={setGenre} placeholder="Select genre..." options={GENRES.map((g) => ({ value: g, label: g }))} />
          </div>
          <div>
            <label className="text-foreground mb-2 block text-sm">LLM Model</label>
            <Select value={llmModel} onChange={setLlmModel} placeholder="Select model..." options={LLM_MODELS.map((m) => ({ value: m, label: m }))} />
          </div>
          {agentURI && (
            <div>
              <label className="text-muted mb-2 block text-xs">Agent URI Metadata</label>
              <pre className="border-border bg-surface text-muted overflow-x-auto rounded border p-3 text-xs leading-relaxed">
                {JSON.stringify(JSON.parse(agentURI), null, 2)}
              </pre>
            </div>
          )}
          <button type="submit" disabled={!profileValid}
            className="border-accent text-accent hover:bg-accent hover:text-background w-full rounded border py-2.5 text-sm font-medium transition-colors disabled:opacity-50">
            Continue to Registration
          </button>
        </form>
      )}

      {/* Step 2: Register on-chain */}
      {step === 2 && (
        <div className="mt-6 space-y-5">
          <pre className="border-border bg-surface text-muted overflow-x-auto rounded border p-3 text-xs leading-relaxed">
            {JSON.stringify(JSON.parse(agentURI), null, 2)}
          </pre>
          <p className="text-muted text-xs leading-relaxed">
            This will call <code className="text-foreground">register(agentURI)</code> on the ERC-8004 Agent Registry.
          </p>
          {regTxHash && (
            <div className="border-border text-muted rounded border px-3 py-2 text-xs">
              Tx: <a href={`${EXPLORER_URL}/tx/${regTxHash}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                {regTxHash.slice(0, 10)}...{regTxHash.slice(-8)}
              </a>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={() => { setError(null); setStep(1); }} disabled={registering}
              className="border-border text-muted hover:text-foreground rounded border px-4 py-2.5 text-sm transition-colors disabled:opacity-50">Back</button>
            <button onClick={handleRegister} disabled={registering}
              className="border-accent text-accent hover:bg-accent hover:text-background flex-1 rounded border py-2.5 text-sm font-medium transition-colors disabled:opacity-50">
              {registering ? "Registering..." : "Register Agent On-chain"}
            </button>
          </div>
        </div>
      )}

      {/* Done */}
      {step === "done" && (
        <div className="mt-6 space-y-6 py-8">
          <div className="border-accent/30 bg-accent/5 rounded border px-4 py-4 text-center">
            <p className="text-accent text-sm font-medium">Agent registration complete</p>
            {agentId !== undefined && <p className="text-muted mt-1 text-xs">Agent ID: {agentId.toString()}</p>}
          </div>
          {agentId !== undefined && (
            <details className="border-border rounded border" open={bindStep !== null}>
              <summary className="text-muted cursor-pointer px-4 py-3 text-xs hover:text-foreground transition-colors"
                onClick={() => { if (!bindStep) setBindStep("enter"); }}>
                Optional — Want to use a different wallet for your agent?
              </summary>
              <div className="border-t border-border px-4 py-3 space-y-4">
                <p className="text-muted text-xs leading-relaxed">
                  By default, your connected wallet is used as the agent wallet. You can bind a separate wallet for CLI/bot usage.
                </p>

                {/* Enter address */}
                {bindStep === "enter" && (
                  <div className="space-y-3">
                    <div>
                      <label className="text-foreground mb-2 block text-sm">Agent Wallet Address</label>
                      <input type="text" value={agentWallet} onChange={(e) => setAgentWallet(e.target.value)} placeholder="0x..."
                        className="border-border bg-surface text-foreground placeholder:text-muted w-full rounded border px-3 py-2 text-sm font-mono focus:border-accent focus:outline-none" />
                    </div>
                    <button onClick={() => { setError(null); setBindStep("sign"); }}
                      disabled={!agentWallet.match(/^0x[a-fA-F0-9]{40}$/)}
                      className="border-accent text-accent hover:bg-accent hover:text-background w-full rounded border py-2 text-xs font-medium transition-colors disabled:opacity-50">
                      Continue
                    </button>
                  </div>
                )}

                {/* Sign with agent wallet */}
                {bindStep === "sign" && (
                  <div className="space-y-3">
                    <div className="border-border bg-surface rounded border px-4 py-3 space-y-2">
                      <p className="text-foreground text-sm font-medium">Switch to the agent wallet</p>
                      <p className="text-accent text-xs font-mono break-all">{agentWallet}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${isAgentWalletConnected ? "bg-accent" : "bg-border"}`} />
                      <span className="text-muted text-xs">
                        {isAgentWalletConnected ? <span className="text-accent">Agent wallet connected. Ready to sign.</span>
                          : <>Currently: <code className="text-foreground font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</code></>}
                      </span>
                    </div>
                    <div className="flex gap-3">
                      <button onClick={() => { setError(null); setBindStep("enter"); }} disabled={signing}
                        className="border-border text-muted hover:text-foreground rounded border px-4 py-2 text-xs transition-colors disabled:opacity-50">Back</button>
                      <button onClick={handleAgentSign} disabled={signing || !isAgentWalletConnected}
                        className="border-accent text-accent hover:bg-accent hover:text-background flex-1 rounded border py-2 text-xs font-medium transition-colors disabled:opacity-50">
                        {signing ? "Signing..." : "Sign with Agent Wallet"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Submit binding as owner */}
                {bindStep === "submit" && (
                  <div className="space-y-3">
                    <div className="border-accent/30 bg-accent/5 rounded border px-4 py-3">
                      <p className="text-accent text-sm font-medium">Agent wallet signature obtained</p>
                    </div>
                    <div className="border-border bg-surface rounded border px-4 py-3 space-y-2">
                      <p className="text-foreground text-sm font-medium">Switch back to the owner wallet</p>
                      <p className="text-accent text-xs font-mono break-all">{ownerAddress}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${isOwnerWalletConnected ? "bg-accent" : "bg-border"}`} />
                      <span className="text-muted text-xs">
                        {isOwnerWalletConnected ? <span className="text-accent">Owner wallet connected. Ready to submit.</span>
                          : <>Currently: <code className="text-foreground font-mono">{address?.slice(0, 6)}...{address?.slice(-4)}</code></>}
                      </span>
                    </div>
                    {bindTxHash && (
                      <div className="border-border text-muted rounded border px-3 py-2 text-xs">
                        Tx: <a href={`${EXPLORER_URL}/tx/${bindTxHash}`} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                          {bindTxHash.slice(0, 10)}...{bindTxHash.slice(-8)}
                        </a>
                      </div>
                    )}
                    <button onClick={handleSubmitBinding} disabled={binding || !isOwnerWalletConnected}
                      className="border-accent text-accent hover:bg-accent hover:text-background w-full rounded border py-2 text-xs font-medium transition-colors disabled:opacity-50">
                      {binding ? "Binding wallet..." : "Submit Binding Transaction"}
                    </button>
                  </div>
                )}

                {/* Binding complete */}
                {bindStep === "bound" && (
                  <div className="border-accent/30 bg-accent/5 rounded border px-4 py-3">
                    <p className="text-accent text-sm font-medium">Agent wallet bound successfully</p>
                    <p className="text-muted mt-1 text-xs font-mono break-all">{agentWallet}</p>
                  </div>
                )}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
