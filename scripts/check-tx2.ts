import { Connection, PublicKey } from "@solana/web3.js";
const conn = new Connection("https://api.devnet.solana.com", "confirmed");

async function main() {
  const WALLET = new PublicKey("8TcQfQY12sMweH9EkvrrXbcgSeB5KGLTUPA4Jmixpm74");
  const sigs = await conn.getSignaturesForAddress(WALLET, { limit: 10 });
  for (const { signature, blockTime, err } of sigs) {
    const tx = await conn.getTransaction(signature, { maxSupportedTransactionVersion: 0 });
    if (!tx) continue;
    const logs = tx.meta?.logMessages ?? [];
    const instrs = logs.filter((l: string) => l.includes("Instruction:"));
    console.log(new Date((blockTime??0)*1000).toISOString().slice(11,19), err?"FAIL":"OK", instrs.join(" | "));
  }
}
main().catch(console.error);
