import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");
const DISC_ORDER = Buffer.from([120, 0, 228, 80, 167, 248, 73, 201]);
const AMM_DISC = Buffer.from([4, 160, 230, 2, 39, 192, 95, 33]);

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");

  const orders = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: (DISC_ORDER as any).toString('base64'), encoding: "base64" as any } }]
  });
  console.log("SwapOrder accounts:", orders.length);

  const amm = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: (AMM_DISC as any).toString('base64'), encoding: "base64" as any } }]
  });
  console.log("ProtocolAmm accounts:", amm.length);
  
  if (amm.length > 0) {
    const raw = amm[0].account.data as Buffer;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    const posCount = view.getBigUint64(40, true);
    console.log("  position_count:", posCount.toString());
  }
}
main().catch(console.error);
