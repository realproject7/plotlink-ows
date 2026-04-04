#!/usr/bin/env node
// PlotLink OWS — CLI Wizard
// Zero external dependencies — Node builtins only

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { execSync, spawn } = require("child_process");
const crypto = require("crypto");

const CONFIG_DIR = path.join(require("os").homedir(), ".plotlink-ows");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");
const PID_FILE = path.join(CONFIG_DIR, "server.pid");
const PROJECT_DIR = path.dirname(__dirname);
const ENV_FILE = path.join(CONFIG_DIR, ".env");
const AGENT_CONFIG_FILE = path.join(CONFIG_DIR, "agent.config.json");

// ── Helpers ──

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(CONFIG_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeConfig(cfg) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2) + "\n");
}

function writeEnvVar(key, value) {
  const line = `${key}=${value}`;
  if (fs.existsSync(ENV_FILE)) {
    const content = fs.readFileSync(ENV_FILE, "utf-8");
    const regex = new RegExp(`^${key}=.*$`, "m");
    if (regex.test(content)) {
      fs.writeFileSync(ENV_FILE, content.replace(regex, line));
    } else {
      fs.appendFileSync(ENV_FILE, `\n${line}\n`);
    }
  } else {
    fs.writeFileSync(ENV_FILE, `${line}\n`);
  }
}

function ask(rl, question) {
  return new Promise((resolve) => rl.question(question, resolve));
}

function askSecret(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    process.stdout.write(question);
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    if (stdin.setRawMode) stdin.setRawMode(true);
    let input = "";
    const onData = (ch) => {
      const c = ch.toString();
      if (c === "\n" || c === "\r") {
        if (stdin.setRawMode) stdin.setRawMode(wasRaw);
        stdin.removeListener("data", onData);
        process.stdout.write("\n");
        rl.close();
        resolve(input);
      } else if (c === "\u0003") {
        process.exit(0);
      } else if (c === "\u007F" || c === "\b") {
        input = input.slice(0, -1);
      } else {
        input += c;
        process.stdout.write("*");
      }
    };
    stdin.on("data", onData);
    stdin.resume();
  });
}

function hashPassphrase(passphrase) {
  return crypto.createHmac("sha256", "plotlink-ows").update(passphrase).digest("hex");
}

function log(msg) {
  console.log(`  ${msg}`);
}

function header(msg) {
  console.log(`\n  \x1b[1m${msg}\x1b[0m\n`);
}

function success(msg) {
  console.log(`  \x1b[32m✓\x1b[0m ${msg}`);
}

function warn(msg) {
  console.log(`  \x1b[33m!\x1b[0m ${msg}`);
}

function error(msg) {
  console.log(`  \x1b[31m✗\x1b[0m ${msg}`);
}

// ── Commands ──

async function cmdInit() {
  header("PlotLink OWS — Setup Wizard");
  log("Let's get your local writer app configured.\n");

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

  // Step 1: Prerequisites
  header("Step 1: Prerequisites");
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1));
  if (major >= 20) {
    success(`Node.js ${nodeVersion}`);
  } else {
    error(`Node.js ${nodeVersion} — need 20+`);
    process.exit(1);
  }

  try {
    require("@open-wallet-standard/core");
    success("OWS SDK loaded (native bindings OK)");
  } catch {
    error("OWS SDK failed to load. Run: npm install @open-wallet-standard/core");
    process.exit(1);
  }

  // Step 2: Passphrase
  header("Step 2: Passphrase");
  log("Choose a passphrase to protect your writer agent.\n");
  const passphrase = await askSecret("  Passphrase: ");
  const confirm = await askSecret("  Confirm:    ");

  if (passphrase !== confirm) {
    error("Passphrases don't match.");
    rl.close();
    process.exit(1);
  }
  if (passphrase.length < 4) {
    error("Passphrase must be at least 4 characters.");
    rl.close();
    process.exit(1);
  }

  writeEnvVar("OWS_PASSPHRASE", passphrase);
  success("Passphrase set");

  // Step 3: LLM Provider
  header("Step 3: LLM Provider");
  log("1) Anthropic (recommended)");
  log("2) OpenAI");
  log("3) Google Gemini");
  log("4) Local (Ollama/LM Studio)\n");

  const choice = await ask(rl, "  Choose [1-4]: ");
  const providers = {
    "1": { id: "anthropic", name: "Anthropic", envKey: "ANTHROPIC_API_KEY", model: "claude-sonnet-4-6" },
    "2": { id: "openai", name: "OpenAI", envKey: "OPENAI_API_KEY", model: "gpt-4.1-mini" },
    "3": { id: "gemini", name: "Gemini", envKey: "GEMINI_API_KEY", model: "gemini-2.5-flash" },
    "4": { id: "local", name: "Local", envKey: null, model: "llama3.2" },
  };

  const provider = providers[choice] || providers["1"];
  let baseUrl = "";

  if (provider.id === "local") {
    baseUrl = await ask(rl, "  Base URL [http://localhost:11434]: ") || "http://localhost:11434";
    const modelName = await ask(rl, `  Model name [${provider.model}]: `) || provider.model;
    provider.model = modelName;
    rl.close();
  } else {
    rl.close();
    const apiKey = await askSecret(`  ${provider.name} API key: `);
    if (apiKey) {
      writeEnvVar(provider.envKey, apiKey);
      success(`${provider.name} API key saved`);
    }
  }

  success(`Provider: ${provider.name} / ${provider.model}`);

  // Step 4: OWS Wallet
  header("Step 4: OWS Wallet");
  try {
    const ows = require("@open-wallet-standard/core");
    const wallets = ows.listWallets();
    let wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));

    if (!wallet) {
      wallet = ows.createWallet("plotlink-writer", passphrase);
      success("Wallet created");
    } else {
      success("Wallet already exists");
    }

    const evmAccount = wallet.accounts.find((a) => a.chainId.startsWith("eip155:"));
    if (evmAccount) {
      log(`  Address (Base): ${evmAccount.address}`);
      log("");
      log("  Fund this address with a small amount of ETH on Base");
      log("  for gas (~$0.01 per story publish).");
    }
  } catch (err) {
    warn(`Wallet creation skipped: ${err.message}`);
    warn("You can create it later from the app's wallet setup screen.");
  }

  // Save config
  const config = {
    port: 7777,
    passphrase_hash: hashPassphrase(passphrase),
    llm: {
      provider: provider.id,
      model: provider.model,
      ...(baseUrl && { baseUrl }),
    },
    wallet_name: "plotlink-writer",
    created_at: new Date().toISOString(),
  };
  writeConfig(config);

  // Also write agent.config.json for the app
  const agentConfig = {
    llm: {
      activeProvider: provider.id,
      activeModel: provider.model,
      ...(provider.id === "local" && {
        local: { baseUrl, model: provider.model, apiType: "ollama" },
      }),
      ...(provider.id !== "local" && {
        [provider.id]: { apiKey: `env:${provider.envKey}`, model: provider.model },
      }),
    },
  };
  fs.writeFileSync(AGENT_CONFIG_FILE, JSON.stringify(agentConfig, null, 2) + "\n");

  // Step 5: Done
  header("Setup Complete!");
  log(`LLM:    ${provider.name} / ${provider.model}`);
  log(`Port:   ${config.port}`);
  log(`Config: ${CONFIG_FILE}`);
  log("");
  log('Run \x1b[1mnpx plotlink-ows\x1b[0m to start writing!');
  log("");

  process.exit(0);
}

function cmdStart() {
  const config = readConfig();
  if (!config) {
    warn("Not configured yet.");
    log('Run \x1b[1mnpx plotlink-ows init\x1b[0m first.');
    process.exit(1);
  }

  // Check if already running
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8"));
    try {
      process.kill(pid, 0);
      log(`Already running (PID ${pid}).`);
      log(`Open http://localhost:${config.port || 7777}`);
      process.exit(0);
    } catch {
      fs.unlinkSync(PID_FILE);
    }
  }

  // Ensure deps installed
  if (!fs.existsSync(path.join(PROJECT_DIR, "node_modules"))) {
    log("Installing dependencies...");
    execSync("npm install", { cwd: PROJECT_DIR, stdio: "inherit" });
  }

  // Ensure frontend is built
  const distDir = path.join(PROJECT_DIR, "app", "web", "dist");
  if (!fs.existsSync(distDir)) {
    log("Building frontend...");
    execSync("npx vite build --config app/vite.config.ts", { cwd: PROJECT_DIR, stdio: "inherit" });
  }

  const port = config.port || 7777;
  log(`Starting PlotLink OWS on port ${port}...`);

  const server = spawn("npx", ["tsx", "app/server.ts"], {
    cwd: PROJECT_DIR,
    stdio: "ignore",
    detached: true,
    env: { ...process.env, APP_PORT: String(port) },
  });
  server.unref();

  ensureConfigDir();
  fs.writeFileSync(PID_FILE, String(server.pid));

  // Auto-open browser
  setTimeout(() => {
    try {
      const cmd = process.platform === "darwin" ? "open" : "xdg-open";
      execSync(`${cmd} http://localhost:${port}`, { stdio: "ignore" });
    } catch { /* ignore */ }
  }, 2000);

  success(`Server started (PID ${server.pid})`);
  log(`Open http://localhost:${port}`);
}

function cmdStop() {
  if (!fs.existsSync(PID_FILE)) {
    log("Not running.");
    return;
  }

  const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8"));
  try {
    process.kill(pid, "SIGTERM");
    success(`Stopped (PID ${pid})`);
  } catch {
    warn(`Process ${pid} not found.`);
  }
  fs.unlinkSync(PID_FILE);
}

function cmdStatus() {
  const config = readConfig();
  header("PlotLink OWS — Status");

  if (!config) {
    warn("Not configured. Run: npx plotlink-ows init");
    return;
  }

  log(`Config:   ${CONFIG_FILE}`);
  log(`LLM:      ${config.llm?.provider || "—"} / ${config.llm?.model || "—"}`);
  log(`Port:     ${config.port || 7777}`);

  // Wallet
  try {
    const ows = require("@open-wallet-standard/core");
    const wallets = ows.listWallets();
    const wallet = wallets.find((w) => w.name.startsWith("plotlink-writer"));
    if (wallet) {
      const evmAccount = wallet.accounts.find((a) => a.chainId.startsWith("eip155:"));
      log(`Wallet:   ${evmAccount?.address || "no EVM address"}`);
    } else {
      log("Wallet:   not created");
    }
  } catch {
    log("Wallet:   OWS SDK not available");
  }

  // Server status
  if (fs.existsSync(PID_FILE)) {
    const pid = parseInt(fs.readFileSync(PID_FILE, "utf-8"));
    try {
      process.kill(pid, 0);
      log(`Server:   \x1b[32mrunning\x1b[0m (PID ${pid})`);
    } catch {
      log("Server:   stopped");
      fs.unlinkSync(PID_FILE);
    }
  } else {
    log("Server:   stopped");
  }
  log("");
}

// ── Router ──

const cmd = process.argv[2];
switch (cmd) {
  case "init":
    cmdInit();
    break;
  case "stop":
    cmdStop();
    break;
  case "status":
    cmdStatus();
    break;
  default:
    cmdStart();
    break;
}
