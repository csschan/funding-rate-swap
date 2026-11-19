import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");
const DISC_POSITION = Buffer.from([65, 203, 85, 175, 129, 154, 6, 152]);

function readU64(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 0x1_0000_0000 + lo;
}

function readI64(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getInt32(offset + 4, true);
  return hi * 0x1_0000_0000 + lo;
}

function toB58(bytes: Uint8Array): string {
  return new PublicKey(bytes).toBase58();
}

export async function GET(req: NextRequest) {
  const wallet = req.nextUrl.searchParams.get("wallet");
  if (!wallet) return NextResponse.json({ error: "wallet required" }, { status: 400 });

  const conn = new Connection(RPC_URL, "confirmed");
  const discB64 = DISC_POSITION.toString("base64");

  const [fixedAccts, floatingAccts] = await Promise.all([
    conn.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: discB64, encoding: "base64" as any } },
        { memcmp: { offset: 40, bytes: wallet } },
      ],
    }),
    conn.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: discB64, encoding: "base64" as any } },
        { memcmp: { offset: 72, bytes: wallet } },
      ],
    }),
  ]);

  const seen = new Set<string>();
  const all = [...fixedAccts, ...floatingAccts].filter(({ pubkey }) => {
    const k = pubkey.toBase58();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  const positions = [];
  for (const { pubkey, account } of all) {
    const raw = account.data as Buffer;
    if (raw.length < 226) continue;
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    positions.push({
      publicKey: pubkey.toBase58(),
      market: toB58(raw.slice(8, 40)),
      fixedPayer: toB58(raw.slice(40, 72)),
      floatingPayer: toB58(raw.slice(72, 104)),
      notional: readU64(view, 104),
      fixedRate: readI64(view, 112),
      startTime: readI64(view, 120),
      totalPeriods: view.getUint32(128, true),
      settledPeriods: view.getUint32(132, true),
      lastFundingRate: readI64(view, 136),
      lastSettledAt: readI64(view, 144),
      fixedVault: toB58(raw.slice(152, 184)),
      floatingVault: toB58(raw.slice(184, 216)),
      positionId: readU64(view, 216),
      isActive: raw[224] === 1,
      fixedVaultBalance: 0,
      floatingVaultBalance: 0,
    });
  }

  // Fetch vault balances in parallel
  const vaultKeys = positions.flatMap((p) => [new PublicKey(p.fixedVault), new PublicKey(p.floatingVault)]);
  if (vaultKeys.length > 0) {
    const infos = await conn.getMultipleAccountsInfo(vaultKeys);
    for (let i = 0; i < positions.length; i++) {
      const fInfo = infos[i * 2];
      const flInfo = infos[i * 2 + 1];
      if (fInfo) {
        const v = new DataView(fInfo.data.buffer, fInfo.data.byteOffset, fInfo.data.byteLength);
        positions[i].fixedVaultBalance = readU64(v, 64);
      }
      if (flInfo) {
        const v = new DataView(flInfo.data.buffer, flInfo.data.byteOffset, flInfo.data.byteLength);
        positions[i].floatingVaultBalance = readU64(v, 64);
      }
    }
  }

  return NextResponse.json(positions);
}
