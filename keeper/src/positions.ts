import { Connection, PublicKey } from "@solana/web3.js";
import { Program } from "@coral-xyz/anchor";
import { PROGRAM_ID } from "./config";

export interface ActivePosition {
  publicKey: PublicKey;
  market: PublicKey;
  fixedPayer: PublicKey;
  floatingPayer: PublicKey;
  notional: bigint;
  fixedRate: bigint;
  totalPeriods: number;
  settledPeriods: number;
  lastSettledAt: bigint;
  fixedVault: PublicKey;
  floatingVault: PublicKey;
  positionId: bigint;
  isActive: boolean;
}

// 8-byte Anchor account discriminator for SwapPosition
// sha256("account:SwapPosition")[0..8]
const SWAP_POSITION_DISCRIMINATOR = Buffer.from([65, 203, 85, 175, 129, 154, 6, 152]);

export async function fetchActivePositions(
  connection: Connection,
  marketKey: PublicKey
): Promise<ActivePosition[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: SWAP_POSITION_DISCRIMINATOR.toString("base64"), encoding: "base64" } },
      // Filter by market address at offset 8
      { memcmp: { offset: 8, bytes: marketKey.toBase58() } },
    ],
  });

  const positions: ActivePosition[] = [];
  for (const { pubkey, account } of accounts) {
    const pos = decodePosition(pubkey, account.data);
    if (pos && pos.isActive && pos.settledPeriods < pos.totalPeriods) {
      positions.push(pos);
    }
  }
  return positions;
}

function decodePosition(pubkey: PublicKey, data: Buffer): ActivePosition | null {
  try {
    let offset = 8; // skip discriminator
    const market = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const fixedPayer = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const floatingPayer = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const notional = data.readBigUInt64LE(offset); offset += 8;
    const fixedRate = data.readBigInt64LE(offset); offset += 8;
    offset += 8; // start_time
    const totalPeriods = data.readUInt32LE(offset); offset += 4;
    const settledPeriods = data.readUInt32LE(offset); offset += 4;
    offset += 8; // last_funding_rate
    const lastSettledAt = data.readBigInt64LE(offset); offset += 8;
    const fixedVault = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const floatingVault = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const positionId = data.readBigUInt64LE(offset); offset += 8;
    const isActive = data[offset] === 1;

    return {
      publicKey: pubkey,
      market,
      fixedPayer,
      floatingPayer,
      notional,
      fixedRate,
      totalPeriods,
      settledPeriods,
      lastSettledAt,
      fixedVault,
      floatingVault,
      positionId,
      isActive,
    };
  } catch {
    return null;
  }
}

export function derivePositionVaults(positionKey: PublicKey, programId: PublicKey) {
  const [fixedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), positionKey.toBuffer(), Buffer.from("fixed")],
    programId
  );
  const [floatingVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), positionKey.toBuffer(), Buffer.from("floating")],
    programId
  );
  return { fixedVault, floatingVault };
}
