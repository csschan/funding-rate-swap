import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");
const DISC_POSITION = Buffer.from([65, 203, 85, 175, 129, 154, 6, 152]);
const WALLET = new PublicKey("8TcQfQY12sMweH9EkvrrXbcgSeB5KGLTUPA4Jmixpm74");

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const walletB58 = WALLET.toBase58();

  // exact same query as fetchPortfolio
  const discB64 = Buffer.from(DISC_POSITION).toString("base64");
  console.log("disc b64:", discB64);
  console.log("wallet:", walletB58);

  const fixedAccts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: discB64, encoding: "base64" as any } },
      { memcmp: { offset: 40, bytes: walletB58 } },
    ],
  });
  console.log("fixedPayer matches:", fixedAccts.length);

  const floatAccts = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: discB64, encoding: "base64" as any } },
      { memcmp: { offset: 72, bytes: walletB58 } },
    ],
  });
  console.log("floatingPayer matches:", floatAccts.length);

  // raw scan - all SwapPosition accounts
  const all = await conn.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: discB64, encoding: "base64" as any } },
    ],
  });
  console.log("total SwapPositions:", all.length);
  for (const { pubkey, account } of all) {
    const d = account.data;
    const fp = new PublicKey(d.slice(40, 72)).toBase58();
    const flp = new PublicKey(d.slice(72, 104)).toBase58();
    console.log("  key:", pubkey.toBase58().slice(0,10), "fixedPayer:", fp.slice(0,10), "floatingPayer:", flp.slice(0,10));
  }
}
main().catch(console.error);
