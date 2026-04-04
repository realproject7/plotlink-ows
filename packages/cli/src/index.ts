import { Command } from "commander";
import { registerCreate } from "./commands/create.js";
import { registerChain } from "./commands/chain.js";
import { registerStatus } from "./commands/status.js";
import { registerClaim } from "./commands/claim.js";
import { registerAgentRegister } from "./commands/agent-register.js";

const program = new Command();

program
  .name("plotlink")
  .description("CLI for the PlotLink protocol on Base")
  .version("0.1.0");

registerCreate(program);
registerChain(program);
registerStatus(program);
registerClaim(program);
registerAgentRegister(program);

program.parse();
