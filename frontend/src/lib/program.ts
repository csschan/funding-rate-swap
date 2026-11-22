import {
  Connection,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddress,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { PROGRAM_ID, USDC_MINT_DEVNET } from "./constants";
import { deriveSwapMarket, deriveSwapOrder, deriveOrderVault, deriveProtocolAmm, deriveAmmTreasury, deriveAmmPosition, derivePositionVault } from "./pda";

// Instruction discriminators (sha256("global:<name>")[0..8])
const DISC: Record<string, Uint8Array> = {
  initialize_market: new Uint8Array([35, 35, 189, 193, 155, 48, 170, 203]),
  place_order: new Uint8Array([51, 194, 155, 175, 109, 130, 96, 106]),
  cancel_order: new Uint8Array([95, 129, 237, 240, 8, 49, 223, 132]),
  match_orders: new Uint8Array([17, 1, 201, 93, 7, 51, 251, 134]),
  settle: new Uint8Array([175, 42, 185, 87, 144, 131, 102, 212]),
  add_collateral: new Uint8Array([127, 82, 121, 42, 161, 176, 249, 206]),
  close_position: new Uint8Array([123, 134, 81, 0, 49, 68, 98, 98]),
  liquidate: new Uint8Array([223, 179, 226, 125, 48, 46, 39, 74]),
  initialize_amm: new Uint8Array([44, 175, 253, 31, 47, 138, 50, 68]),
  open_position_amm: new Uint8Array([220, 36, 153, 183, 130, 129, 246, 24]),
  early_close_amm: new Uint8Array([91, 220, 155, 137, 219, 212, 53, 244]),
};

export enum Direction {
  FixedPayer = 0,
  FloatingPayer = 1,
}

function encodeU64(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigUint64(0, n, true);
  return new Uint8Array(buf);
}

function encodeI64(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  new DataView(buf).setBigInt64(0, n, true);
  return new Uint8Array(buf);
}

function encodeU32(n: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setUint32(0, n, true);
  return new Uint8Array(buf);
}

function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ── initialize_market ──────────────────────────────────────────
export async function buildInitializeMarketTx(
  connection: Connection,
  authority: PublicKey,
  marketSeed: PublicKey
): Promise<Transaction> {
  const market = deriveSwapMarket(marketSeed);

  const data = concatBytes(DISC.initialize_market, marketSeed.toBytes());

  const ix = new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: market, isSigner: false, isWritable: true },
      { pubkey: authority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.from(data),
  });

  const tx = new Transaction().add(ix);
  tx.feePayer = authority;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

// ── place_order ────────────────────────────────────────────────
export async function buildPlaceOrderTx(
  connection: Connection,
  owner: PublicKey,
  marketSeed: PublicKey,
  params: {
    direction: Direction;
    notional: bigint;      // USDC raw (6 decimals)
    fixedRate: bigint;     // bps per 8h
    durationPeriods: number;
    collateralAmount: bigint;
  }
): Promise<Transaction> {
  const market = deriveSwapMarket(marketSeed);

  // Fetch current order_count from market account to derive order PDA
  const marketInfo = await connection.getAccountInfo(market);
  let orderCount = BigInt(0);
  if (marketInfo) {
    // order_count at offset 8+32+32+8+1 = 81
    const view = new DataView(marketInfo.data.buffer, marketInfo.data.byteOffset, marketInfo.data.byteLength);
    orderCount = view.getBigUint64(81, true);
  }

  const order = deriveSwapOrder(market, orderCount);
  const orderVault = deriveOrderVault(order);

  const ownerUsdc = await getAssociatedTokenAddress(USDC_MINT_DEVNET, owner);

  // Encode args: direction(1) + notional(8) + fixed_rate(8) + duration_periods(4) + collateral_amount(8)
  const data = concatBytes(
    DISC.place_order,
    new Uint8Array([params.direction]),
    encodeU64(params.notional),
    encodeI64(params.fixedRate),
    encodeU32(params.durationPeriods),
    encodeU64(params.collateralAmount),
  );

  const tx = new Transaction();

  // Create owner's USDC ATA if needed
  const ownerUsdcInfo = await connection.getAccountInfo(ownerUsdc);
  if (!ownerUsdcInfo) {
    tx.add(
      createAssociatedTokenAccountInstruction(owner, ownerUsdc, owner, USDC_MINT_DEVNET)
    );
  }

  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: order, isSigner: false, isWritable: true },
        { pubkey: orderVault, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: ownerUsdc, isSigner: false, isWritable: true },
        { pubkey: USDC_MINT_DEVNET, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    })
  );

  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

// ── cancel_order ───────────────────────────────────────────────
export async function buildCancelOrderTx(
  connection: Connection,
  owner: PublicKey,
  orderKey: PublicKey
): Promise<Transaction> {
  const orderVault = deriveOrderVault(orderKey);
  const ownerUsdc = await getAssociatedTokenAddress(USDC_MINT_DEVNET, owner);

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: orderKey, isSigner: false, isWritable: true },
        { pubkey: orderVault, isSigner: false, isWritable: true },
        { pubkey: ownerUsdc, isSigner: false, isWritable: true },
        { pubkey: owner, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(DISC.cancel_order),
    })
  );
  tx.feePayer = owner;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

// ── add_collateral ─────────────────────────────────────────────
export async function buildAddCollateralTx(
  connection: Connection,
  user: PublicKey,
  positionKey: PublicKey,
  fixedVault: PublicKey,
  floatingVault: PublicKey,
  amount: bigint,
  side: "fixed" | "floating"
): Promise<Transaction> {
  const userUsdc = await getAssociatedTokenAddress(USDC_MINT_DEVNET, user);

  // side enum: Fixed=0, Floating=1
  const sideEnum = side === "fixed" ? 0 : 1;

  const data = concatBytes(
    DISC.add_collateral,
    encodeU64(amount),
    new Uint8Array([sideEnum]),
  );

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: positionKey, isSigner: false, isWritable: false },
        { pubkey: fixedVault, isSigner: false, isWritable: true },
        { pubkey: floatingVault, isSigner: false, isWritable: true },
        { pubkey: user, isSigner: true, isWritable: true },
        { pubkey: userUsdc, isSigner: false, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    })
  );
  tx.feePayer = user;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

// ── close_position ─────────────────────────────────────────────
export async function buildClosePositionTx(
  connection: Connection,
  caller: PublicKey,
  positionKey: PublicKey,
  fixedVault: PublicKey,
  floatingVault: PublicKey,
  fixedPayerUsdc: PublicKey,
  floatingPayerUsdc: PublicKey,
): Promise<Transaction> {
  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: positionKey,       isSigner: false, isWritable: true },
        { pubkey: fixedVault,        isSigner: false, isWritable: true },
        { pubkey: floatingVault,     isSigner: false, isWritable: true },
        { pubkey: fixedPayerUsdc,    isSigner: false, isWritable: true },
        { pubkey: floatingPayerUsdc, isSigner: false, isWritable: true },
        { pubkey: caller,            isSigner: true,  isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID,  isSigner: false, isWritable: false },
      ],
      data: Buffer.from(DISC.close_position),
    })
  );
  tx.feePayer = caller;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}

// ── Fetch market order count ───────────────────────────────────
export async function fetchMarketOrderCount(
  connection: Connection,
  marketSeed: PublicKey
): Promise<bigint> {
  const market = deriveSwapMarket(marketSeed);
  const info = await connection.getAccountInfo(market);
  if (!info) return BigInt(0);
  const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  return view.getBigUint64(81, true);
}

export async function isMarketInitialized(
  connection: Connection,
  marketSeed: PublicKey
): Promise<boolean> {
  const market = deriveSwapMarket(marketSeed);
  const info = await connection.getAccountInfo(market);
  return info !== null;
}

// ── AMM: get next position_id from ProtocolAmm account ───────────
export async function fetchAmmPositionCount(connection: Connection): Promise<bigint> {
  const amm = deriveProtocolAmm();
  const info = await connection.getAccountInfo(amm);
  if (!info) return BigInt(0);
  // ProtocolAmm layout: 8 (discriminator) + 32 (authority) + 8 (position_count)
  const view = new DataView(info.data.buffer, info.data.byteOffset, info.data.byteLength);
  return view.getBigUint64(40, true); // offset: 8 + 32 = 40
}

export async function isAmmInitialized(connection: Connection): Promise<boolean> {
  const amm = deriveProtocolAmm();
  const info = await connection.getAccountInfo(amm);
  return info !== null;
}

// ── open_position_amm ─────────────────────────────────────────────
export async function buildOpenPositionAmmTx(
  connection: Connection,
  user: PublicKey,
  params: {
    direction: Direction;
    notional: bigint;        // effective notional, 6 decimals
    fixedRate: bigint;       // integer bps per 8h (e.g. 45 = 0.45%)
    durationPeriods: number;
    collateralAmount: bigint; // margin deposit, 6 decimals
  }
): Promise<{ tx: Transaction; positionKey: PublicKey; positionId: bigint }> {
  const amm = deriveProtocolAmm();
  const ammTreasury = deriveAmmTreasury();
  const positionId = await fetchAmmPositionCount(connection);
  const positionKey = deriveAmmPosition(amm, positionId);
  const fixedVault = derivePositionVault(positionKey, "fixed");
  const floatingVault = derivePositionVault(positionKey, "floating");
  const userUsdc = await getAssociatedTokenAddress(USDC_MINT_DEVNET, user);

  const data = concatBytes(
    DISC.open_position_amm,
    new Uint8Array([params.direction]),
    encodeU64(params.notional),
    encodeI64(params.fixedRate),
    encodeU32(params.durationPeriods),
    encodeU64(params.collateralAmount),
  );

  const tx = new Transaction();
  const userUsdcInfo = await connection.getAccountInfo(userUsdc);
  if (!userUsdcInfo) {
    tx.add(createAssociatedTokenAccountInstruction(user, userUsdc, user, USDC_MINT_DEVNET));
  }

  tx.add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: amm,          isSigner: false, isWritable: true },
        { pubkey: ammTreasury,  isSigner: false, isWritable: true },
        { pubkey: positionKey,  isSigner: false, isWritable: true },
        { pubkey: fixedVault,   isSigner: false, isWritable: true },
        { pubkey: floatingVault,isSigner: false, isWritable: true },
        { pubkey: user,         isSigner: true,  isWritable: true },
        { pubkey: userUsdc,     isSigner: false, isWritable: true },
        { pubkey: USDC_MINT_DEVNET, isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    })
  );

  tx.feePayer = user;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return { tx, positionKey, positionId };
}

// ── early_close_amm ───────────────────────────────────────────────
export async function buildEarlyCloseAmmTx(
  connection: Connection,
  caller: PublicKey,
  positionId: bigint,
  currentRate: bigint, // current funding rate in integer bps
): Promise<Transaction> {
  const amm = deriveProtocolAmm();
  const ammTreasury = deriveAmmTreasury();
  const positionKey = deriveAmmPosition(amm, positionId);
  const fixedVault = derivePositionVault(positionKey, "fixed");
  const floatingVault = derivePositionVault(positionKey, "floating");
  const userUsdc = await getAssociatedTokenAddress(USDC_MINT_DEVNET, caller);

  const data = concatBytes(
    DISC.early_close_amm,
    encodeU64(positionId),
    encodeI64(currentRate),
  );

  const tx = new Transaction().add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: amm,           isSigner: false, isWritable: false },
        { pubkey: ammTreasury,   isSigner: false, isWritable: true },
        { pubkey: positionKey,   isSigner: false, isWritable: true },
        { pubkey: fixedVault,    isSigner: false, isWritable: true },
        { pubkey: floatingVault, isSigner: false, isWritable: true },
        { pubkey: userUsdc,      isSigner: false, isWritable: true },
        { pubkey: caller,        isSigner: true,  isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(data),
    })
  );
  tx.feePayer = caller;
  tx.recentBlockhash = (await connection.getLatestBlockhash("confirmed")).blockhash;
  return tx;
}
