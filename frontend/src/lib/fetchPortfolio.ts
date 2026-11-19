import { Connection, PublicKey } from "@solana/web3.js";
import { getAccount } from "@solana/spl-token";
import { PROGRAM_ID } from "./constants";
import { Position, Order } from "@/store/useAppStore";

// Account discriminators (Anchor: sha256("account:<TypeName>")[0..8])
const DISC_POSITION = new Uint8Array([65, 203, 85, 175, 129, 154, 6, 152]);
const DISC_ORDER    = new Uint8Array([120, 0, 228, 80, 167, 248, 73, 201]);

// base58 encode a Uint8Array as a Solana address string
function toBase58(bytes: Uint8Array): string {
  return new PublicKey(bytes).toBase58();
}

// Read a little-endian u64 from a DataView and return as number.
// Safe up to 2^53 — sufficient for USDC amounts and IDs within our range.
function readU64(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getUint32(offset + 4, true);
  return hi * 0x1_0000_0000 + lo;
}

// Read a little-endian i64 from a DataView and return as number.
function readI64(view: DataView, offset: number): number {
  const lo = view.getUint32(offset, true);
  const hi = view.getInt32(offset + 4, true);
  return hi * 0x1_0000_0000 + lo;
}

function decodePosition(pubkey: PublicKey, raw: Uint8Array): Position | null {
  try {
    // Minimum size check: discriminator(8) + all fixed fields up through bump(1) = 226 bytes
    if (raw.length < 226) return null;

    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    // SwapPosition layout (offsets after discriminator already at 0, fields start at 8)
    const market         = toBase58(raw.slice(8,   40));   // Pubkey  offset 8
    const fixedPayer     = toBase58(raw.slice(40,  72));   // Pubkey  offset 40
    const floatingPayer  = toBase58(raw.slice(72,  104));  // Pubkey  offset 72
    const notional       = readU64(view, 104);              // u64     offset 104
    const fixedRate      = readI64(view, 112);              // i64     offset 112
    const startTime      = readI64(view, 120);              // i64     offset 120
    const totalPeriods   = view.getUint32(128, true);       // u32     offset 128
    const settledPeriods = view.getUint32(132, true);       // u32     offset 132
    const lastFundingRate = readI64(view, 136);             // i64     offset 136
    const lastSettledAt  = readI64(view, 144);              // i64     offset 144
    const fixedVault     = toBase58(raw.slice(152, 184));   // Pubkey  offset 152
    const floatingVault  = toBase58(raw.slice(184, 216));   // Pubkey  offset 184
    const positionId     = readU64(view, 216);              // u64     offset 216
    const isActive       = raw[224] === 1;                  // bool    offset 224

    return {
      publicKey: pubkey.toBase58(),
      market,
      fixedPayer,
      floatingPayer,
      notional,
      fixedRate,
      startTime,
      totalPeriods,
      settledPeriods,
      lastFundingRate,
      lastSettledAt,
      fixedVault,
      floatingVault,
      positionId,
      isActive,
      fixedVaultBalance: 0,
      floatingVaultBalance: 0,
    };
  } catch {
    return null;
  }
}

function decodeOrder(pubkey: PublicKey, raw: Uint8Array): Order | null {
  try {
    // Minimum size: discriminator(8) + market(32) + owner(32) + direction(1) + notional(8)
    //             + fixed_rate(8) + duration_periods(4) + created_at(8) + order_id(8) = 109 bytes
    if (raw.length < 109) return null;

    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);

    // SwapOrder layout (offsets after discriminator)
    const market          = toBase58(raw.slice(8,  40));   // Pubkey  offset 8
    const owner           = toBase58(raw.slice(40, 72));   // Pubkey  offset 40
    const directionByte   = raw[72];                        // u8      offset 72
    const direction       = directionByte === 0 ? "FixedPayer" : "FloatingPayer";
    const notional        = readU64(view, 73);              // u64     offset 73
    const fixedRate       = readI64(view, 81);              // i64     offset 81
    const durationPeriods = view.getUint32(89, true);       // u32     offset 89
    const createdAt       = readI64(view, 93);              // i64     offset 93
    // order_id at offset 101, not needed in Order interface but decoded for completeness

    return {
      publicKey: pubkey.toBase58(),
      market,
      owner,
      direction: direction as "FixedPayer" | "FloatingPayer",
      notional,
      fixedRate,
      durationPeriods,
      createdAt,
    };
  } catch {
    return null;
  }
}

// Encode a discriminator as base64 for the memcmp filter
function discToBase64(disc: Uint8Array): string {
  return btoa(String.fromCharCode(...disc));
}

export async function fetchMyPositions(
  connection: Connection,
  walletKey: PublicKey
): Promise<Position[]> {
  const walletB58 = walletKey.toBase58();

  // Positions where fixedPayer = wallet (offset 40) OR floatingPayer = wallet (offset 72)
  const [fixedPayerAccounts, floatingPayerAccounts] = await Promise.all([
    connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: discToBase64(DISC_POSITION), encoding: "base64" as const } },
        { memcmp: { offset: 40, bytes: walletB58 } },
      ],
    }),
    connection.getProgramAccounts(PROGRAM_ID, {
      filters: [
        { memcmp: { offset: 0, bytes: discToBase64(DISC_POSITION), encoding: "base64" as const } },
        { memcmp: { offset: 72, bytes: walletB58 } },
      ],
    }),
  ]);

  // Deduplicate (a position can't be both, but guard anyway)
  const fixedKeySet = new Set(fixedPayerAccounts.map((a) => a.pubkey.toBase58()));
  const allAccounts = [
    ...fixedPayerAccounts,
    ...floatingPayerAccounts.filter((a) => !fixedKeySet.has(a.pubkey.toBase58())),
  ];

  const positions: Position[] = [];
  for (const { pubkey, account } of allAccounts) {
    const data = account.data instanceof Uint8Array
      ? account.data
      : new Uint8Array((account.data as Buffer).buffer, (account.data as Buffer).byteOffset, (account.data as Buffer).byteLength);

    const pos = decodePosition(pubkey, data);
    if (!pos) continue;

    // Fetch vault token balances
    try {
      const [fixedVaultInfo, floatingVaultInfo] = await Promise.all([
        getAccount(connection, new PublicKey(pos.fixedVault)),
        getAccount(connection, new PublicKey(pos.floatingVault)),
      ]);
      pos.fixedVaultBalance    = Number(fixedVaultInfo.amount);
      pos.floatingVaultBalance = Number(floatingVaultInfo.amount);
    } catch {
      // Vault may not exist if position is closed/never created
    }

    positions.push(pos);
  }

  return positions;
}

export async function fetchMyOrders(
  connection: Connection,
  walletKey: PublicKey
): Promise<Order[]> {
  // Owner at offset 8+32 = 40
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      { memcmp: { offset: 0, bytes: discToBase64(DISC_ORDER), encoding: "base64" as const } },
      { memcmp: { offset: 40, bytes: walletKey.toBase58() } },
    ],
  });

  return accounts
    .map(({ pubkey, account }) => {
      const data = account.data instanceof Uint8Array
        ? account.data
        : new Uint8Array((account.data as Buffer).buffer, (account.data as Buffer).byteOffset, (account.data as Buffer).byteLength);
      return decodeOrder(pubkey, data);
    })
    .filter((o): o is Order => o !== null);
}
