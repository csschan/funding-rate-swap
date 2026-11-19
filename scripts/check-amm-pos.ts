import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");
const AMM = new PublicKey("JDMRgqodDHFGCAStE92KrcV8qPBs3whsHopiMC4UMs67");

function u64ToBytes(n: number): Buffer {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return b;
}

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");

  for (let id = 0; id < 3; id++) {
    const [pos] = PublicKey.findProgramAddressSync(
      [Buffer.from("amm_pos"), AMM.toBuffer(), u64ToBytes(id)],
      PROGRAM_ID
    );
    const info = await conn.getAccountInfo(pos);
    if (info) {
      const disc = Array.from(info.data.slice(0, 8));
      const isActive = info.data[224];
      console.log("pos id=" + id + " key=" + pos.toBase58().slice(0,10) + " disc=" + JSON.stringify(disc) + " active=" + isActive + " size=" + info.data.length);
    } else {
      console.log("pos id=" + id + " key=" + pos.toBase58().slice(0,10) + " NOT FOUND");
    }
  }

  const sigs = await conn.getSignaturesForAddress(AMM, { limit: 5 });
  console.log("\nRecent AMM transactions:");
  for (const s of sigs) {
    console.log(" ", s.signature.slice(0,20), s.err ? "FAILED" : "OK", s.blockTime ? new Date(s.blockTime * 1000).toISOString() : "");
  }
}
main().catch(console.error);
