import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

async function main() {
  const WALLET = new PublicKey("8TcQfQY12sMweH9EkvrrXbcgSeB5KGLTUPA4Jmixpm74");
  const PROGRAM = "EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC";

  const sigs = await conn.getSignaturesForAddress(WALLET, { limit: 20 });
  for (const { signature, blockTime, err } of sigs) {
    const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    const logs = tx.meta?.logMessages ?? [];
    const ours = logs.filter((l: string) => l.includes(PROGRAM) || l.includes("Instruction:"));
    if (ours.length === 0) continue;
    const instr = logs.filter((l: string) => l.includes("Instruction:")).map((l: string) => l.replace("Program log: Instruction: ", "")).join(", ");
    const errMsg = logs.filter((l: string) => l.includes("Error") || l.includes("failed")).join(" | ");
    console.log(
      new Date((blockTime ?? 0) * 1000).toISOString().slice(11, 19),
      err ? "FAIL" : "OK  ",
      instr,
      errMsg ? "ERR: " + errMsg : ""
    );
  }
}
main().catch(console.error);
