import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { PROGRAM_ID, DRIFT_SOL_PERP_MARKET, USDC_MINT } from "./config";

const TOKEN_PROGRAM_ID = new PublicKey(
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

// Anchor account discriminator for SwapOrder
const SWAP_ORDER_DISCRIMINATOR = Buffer.from([120, 0, 228, 80, 167, 248, 73, 201]);

// match_orders instruction discriminator (provided)
const MATCH_ORDERS_DISCRIMINATOR = Buffer.from([17, 1, 201, 93, 7, 51, 251, 134]);

export interface SwapOrder {
  publicKey: PublicKey;
  market: PublicKey;
  owner: PublicKey;
  direction: number; // 0 = FixedPayer, 1 = FloatingPayer
  notional: bigint;
  fixedRate: bigint;
  durationPeriods: number;
  createdAt: bigint;
  orderId: bigint;
  bump: number;
}

// SwapMarket layout after 8-byte discriminator:
// drift_market: 32, authority: 32, total_volume: 8, is_active: 1,
// order_count: 8, position_count: 8, bump: 1
function decodeSwapMarketPositionCount(data: Buffer): bigint {
  // offset 8 (disc) + 32 (drift_market) + 32 (authority) + 8 (total_volume) + 1 (is_active) + 8 (order_count) = 89
  const offset = 8 + 32 + 32 + 8 + 1 + 8;
  return data.readBigUInt64LE(offset);
}

// SwapOrder layout after 8-byte discriminator:
// market: 32, owner: 32, direction: 1, notional: 8,
// fixed_rate: 8, duration_periods: 4, created_at: 8, order_id: 8, bump: 1
function decodeSwapOrder(pubkey: PublicKey, data: Buffer): SwapOrder | null {
  try {
    let offset = 8; // skip discriminator
    const market = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const owner = new PublicKey(data.slice(offset, offset + 32)); offset += 32;
    const direction = data[offset]; offset += 1;
    const notional = data.readBigUInt64LE(offset); offset += 8;
    const fixedRate = data.readBigInt64LE(offset); offset += 8;
    const durationPeriods = data.readUInt32LE(offset); offset += 4;
    const createdAt = data.readBigInt64LE(offset); offset += 8;
    const orderId = data.readBigUInt64LE(offset); offset += 8;
    const bump = data[offset];

    return { publicKey: pubkey, market, owner, direction, notional, fixedRate, durationPeriods, createdAt, orderId, bump };
  } catch {
    return null;
  }
}

export async function fetchOpenOrders(connection: Connection): Promise<SwapOrder[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: SWAP_ORDER_DISCRIMINATOR.toString("base64"),
          encoding: "base64",
        },
      },
    ],
  });

  const orders: SwapOrder[] = [];
  for (const { pubkey, account } of accounts) {
    const order = decodeSwapOrder(pubkey, account.data);
    if (order) {
      orders.push(order);
    }
  }
  return orders;
}

export interface OrderPair {
  fixedOrder: SwapOrder;
  floatingOrder: SwapOrder;
}

export function findMatchablePairs(orders: SwapOrder[]): OrderPair[] {
  const fixedPayers = orders.filter((o) => o.direction === 0);
  const floatingPayers = orders.filter((o) => o.direction === 1);

  const pairs: OrderPair[] = [];

  for (const fixed of fixedPayers) {
    for (const floating of floatingPayers) {
      // Must be in the same market
      if (!fixed.market.equals(floating.market)) continue;
      // Must have the same duration
      if (fixed.durationPeriods !== floating.durationPeriods) continue;
      // Fixed payer's rate must be >= floating payer's rate (spread exists)
      if (fixed.fixedRate < floating.fixedRate) continue;

      pairs.push({ fixedOrder: fixed, floatingOrder: floating });
    }
  }

  return pairs;
}

function deriveSwapMarket(driftMarket: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_market"), driftMarket.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function deriveOrderVault(orderKey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), orderKey.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

function deriveSwapPosition(marketKey: PublicKey, positionCount: bigint): PublicKey {
  const countBuf = Buffer.allocUnsafe(8);
  countBuf.writeBigUInt64LE(positionCount);
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_position"), marketKey.toBuffer(), countBuf],
    PROGRAM_ID
  );
  return pda;
}

function derivePositionVaults(positionKey: PublicKey): { fixedVault: PublicKey; floatingVault: PublicKey } {
  const [fixedVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), positionKey.toBuffer(), Buffer.from("fixed")],
    PROGRAM_ID
  );
  const [floatingVault] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), positionKey.toBuffer(), Buffer.from("floating")],
    PROGRAM_ID
  );
  return { fixedVault, floatingVault };
}

async function buildMatchOrdersInstruction(
  connection: Connection,
  pair: OrderPair,
  keeper: PublicKey,
  usdcMint: PublicKey
): Promise<TransactionInstruction> {
  const marketKey = deriveSwapMarket(pair.fixedOrder.market);

  // Fetch market to read current position_count
  const marketInfo = await connection.getAccountInfo(marketKey);
  if (!marketInfo) {
    throw new Error(`SwapMarket account not found: ${marketKey.toBase58()}`);
  }
  const positionCount = decodeSwapMarketPositionCount(marketInfo.data);

  const positionKey = deriveSwapPosition(marketKey, positionCount);
  const { fixedVault, floatingVault } = derivePositionVaults(positionKey);

  const fixedOrderVault = deriveOrderVault(pair.fixedOrder.publicKey);
  const floatingOrderVault = deriveOrderVault(pair.floatingOrder.publicKey);

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: marketKey,                        isSigner: false, isWritable: true  }, // market
      { pubkey: pair.fixedOrder.publicKey,         isSigner: false, isWritable: true  }, // fixed_order
      { pubkey: pair.floatingOrder.publicKey,      isSigner: false, isWritable: true  }, // floating_order
      { pubkey: positionKey,                       isSigner: false, isWritable: true  }, // position
      { pubkey: fixedOrderVault,                   isSigner: false, isWritable: true  }, // fixed_order_vault
      { pubkey: floatingOrderVault,                isSigner: false, isWritable: true  }, // floating_order_vault
      { pubkey: fixedVault,                        isSigner: false, isWritable: true  }, // fixed_vault
      { pubkey: floatingVault,                     isSigner: false, isWritable: true  }, // floating_vault
      { pubkey: pair.fixedOrder.owner,             isSigner: false, isWritable: true  }, // fixed_payer
      { pubkey: pair.floatingOrder.owner,          isSigner: false, isWritable: true  }, // floating_payer
      { pubkey: keeper,                            isSigner: true,  isWritable: true  }, // matcher
      { pubkey: usdcMint,                          isSigner: false, isWritable: false }, // usdc_mint
      { pubkey: TOKEN_PROGRAM_ID,                  isSigner: false, isWritable: false }, // token_program
      { pubkey: SystemProgram.programId,           isSigner: false, isWritable: false }, // system_program
      { pubkey: SYSVAR_RENT_PUBKEY,                isSigner: false, isWritable: false }, // rent sysvar
    ],
    data: MATCH_ORDERS_DISCRIMINATOR,
  });
}

export async function matchOrders(
  connection: Connection,
  keeper: Keypair
): Promise<{ matched: number; failed: number }> {
  const usdcMint = new PublicKey(USDC_MINT);

  let orders: SwapOrder[];
  try {
    orders = await fetchOpenOrders(connection);
  } catch (err) {
    console.error("Failed to fetch open orders:", err);
    return { matched: 0, failed: 0 };
  }

  console.log(
    `Matcher: found ${orders.length} open orders ` +
    `(${orders.filter((o) => o.direction === 0).length} fixed, ` +
    `${orders.filter((o) => o.direction === 1).length} floating)`
  );

  const pairs = findMatchablePairs(orders);
  if (pairs.length === 0) {
    console.log("Matcher: no compatible pairs found.");
    return { matched: 0, failed: 0 };
  }

  console.log(`Matcher: ${pairs.length} compatible pair(s) to match.`);

  let matched = 0;
  let failed = 0;

  for (const pair of pairs) {
    try {
      const ix = await buildMatchOrdersInstruction(connection, pair, keeper.publicKey, usdcMint);
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [keeper], {
        commitment: "confirmed",
        maxRetries: 3,
      });
      console.log(
        `  Matched fixed ${pair.fixedOrder.publicKey.toBase58().slice(0, 8)}...` +
        ` <> floating ${pair.floatingOrder.publicKey.toBase58().slice(0, 8)}... — tx: ${sig}`
      );
      matched++;
    } catch (err) {
      console.error(
        `  Failed to match fixed ${pair.fixedOrder.publicKey.toBase58().slice(0, 8)}...` +
        ` <> floating ${pair.floatingOrder.publicKey.toBase58().slice(0, 8)}...:`,
        err
      );
      failed++;
    }
  }

  return { matched, failed };
}
