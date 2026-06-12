import { registerSetCommand } from "./set.js";
import { registerStatusCommand } from "./status.js";
export function registerReferralCommands(program) {
    const referral = program.command("referral").description("Referral management");
    registerSetCommand(referral);
    registerStatusCommand(referral);
}
