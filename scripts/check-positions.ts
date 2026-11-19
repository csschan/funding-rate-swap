import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");
const DISC_POS = Buffer.from([65, 203, 85, 175, 129, 154, 6, 152]);
const WALLET = "8TcQfQY12sMweH9EkvrrXbcgSeB5KGLTUPA4Jmixpm74";

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");

  const all = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [{ memcmp: { offset: 0, bytes: (DISC_POS as any).toString('base64'), encoding: "base64" as any } }]
  });
  console.log("Total SwapPosition accounts:", all.length);

  for (const { pubkey, account } of all) {
    const raw = account.data as Buffer;
    const fixedPayer = new PublicKey(raw.slice(40, 72)).toBase58();
    const floatingPayer = new PublicKey(raw.slice(72, 104)).toBase58();
    const isActive = raw[224];
    console.log(`pubkey=${pubkey.toBase58().slice(0,10)} fixed=${fixedPayer.slice(0,10)} floating=${floatingPayer.slice(0,10)} active=${isActive} size=${raw.length}`);
  }
}
main().catch(console.error);
