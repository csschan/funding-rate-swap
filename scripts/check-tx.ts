import { Connection } from "@solana/web3.js";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

async function main() {
  // get full sigs from AMM account
  const { PublicKey } = require("@solana/web3.js");
  const AMM = new PublicKey("JDMRgqodDHFGCAStE92KrcV8qPBs3whsHopiMC4UMs67");
  const sigs = await conn.getSignaturesForAddress(AMM, { limit: 5 });
  
  for (const { signature } of sigs) {
    const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    console.log("sig:", signature.slice(0, 15), "err:", tx.meta?.err ?? "none");
    const logs = tx.meta?.logMessages ?? [];
    for (const l of logs) {
      if (l.includes("Instruction") || l.includes("Error") || l.includes("Position") || l.includes("AMM")) {
        console.log(" ", l);
      }
    }
  }
}
main().catch(console.error);
