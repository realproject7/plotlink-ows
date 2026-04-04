/**
 * OWS SDK smoke test — verifies native bindings load and basic operations work.
 * Run: npx tsx scripts/ows-smoke-test.ts
 */
import { createWallet, getWallet, signMessage, deleteWallet } from "@open-wallet-standard/core";

const TEST_WALLET_NAME = `plotlink-smoke-test-${Date.now()}`;

try {
  console.log("1. Creating wallet...");
  const wallet = createWallet(TEST_WALLET_NAME);
  console.log(`   ✓ Created: ${wallet.id} (${wallet.name})`);
  console.log(`   Accounts: ${wallet.accounts.length}`);

  const baseAccount = wallet.accounts.find((a) => a.chainId.startsWith("eip155:"));
  if (!baseAccount) throw new Error("No EVM account derived");
  console.log(`   ✓ Base address: ${baseAccount.address}`);

  console.log("2. Retrieving wallet...");
  const retrieved = getWallet(wallet.id);
  console.log(`   ✓ Retrieved: ${retrieved.name}`);

  console.log("3. Signing message...");
  const sig = signMessage(wallet.id, baseAccount.chainId, "PlotLink OWS test");
  console.log(`   ✓ Signature: ${sig.signature.slice(0, 20)}...`);

  console.log("4. Cleaning up...");
  deleteWallet(wallet.id);
  console.log("   ✓ Wallet deleted");

  console.log("\n✅ OWS SDK smoke test passed");
} catch (err) {
  console.error("\n❌ OWS SDK smoke test failed:", err);
  // Attempt cleanup
  try { deleteWallet(TEST_WALLET_NAME); } catch { /* ignore */ }
  process.exit(1);
}
