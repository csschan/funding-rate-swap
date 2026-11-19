import * as anchor from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
} from "@solana/web3.js";
import {
  createMint,
  createAccount,
  mintTo,
  getAccount,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { assert } from "chai";

const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");

function deriveMarket(driftMarket: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("swap_market"), driftMarket.toBuffer()], PROGRAM_ID
  )[0];
}
function deriveOrder(market: PublicKey, orderId: bigint): PublicKey {
  const b = Buffer.alloc(8); b.writeBigUInt64LE(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("swap_order"), market.toBuffer(), b], PROGRAM_ID
  )[0];
}
function deriveOrderVault(order: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_vault"), order.toBuffer()], PROGRAM_ID
  )[0];
}

const DISC = {
  initialize_market: Buffer.from([35, 35, 189, 193, 155, 48, 170, 203]),
  place_order:       Buffer.from([51, 194, 155, 175, 109, 130, 96, 106]),
  cancel_order:      Buffer.from([95, 129, 237, 240, 8, 49, 223, 132]),
};

describe("funding-rate-swap", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let usdcMint: PublicKey;
  let driftMarketKp: Keypair;
  let fixedPayerKp: Keypair;
  let floatingPayerKp: Keypair;
  let fixedPayerUsdc: PublicKey;
  let floatingPayerUsdc: PublicKey;
  let market: PublicKey;

  const NOTIONAL  = BigInt(10_000_000); // 10 USDC
  const FIXED_RATE = BigInt(50);         // 50 bps/8h
  const DURATION  = 7;
  const COLLATERAL = BigInt(1_000_000);  // 1 USDC

  before(async () => {
    usdcMint = await createMint(connection, payer, payer.publicKey, null, 6);

    fixedPayerKp    = Keypair.generate();
    floatingPayerKp = Keypair.generate();

    // Fund wallets
    for (const kp of [fixedPayerKp, floatingPayerKp]) {
      await provider.sendAndConfirm(new Transaction().add(
        SystemProgram.transfer({ fromPubkey: payer.publicKey, toPubkey: kp.publicKey, lamports: 1_000_000_000 })
      ));
    }

    fixedPayerUsdc    = await createAccount(connection, payer, usdcMint, fixedPayerKp.publicKey);
    floatingPayerUsdc = await createAccount(connection, payer, usdcMint, floatingPayerKp.publicKey);
    await Promise.all([
      mintTo(connection, payer, usdcMint, fixedPayerUsdc,    payer, 50_000_000),
      mintTo(connection, payer, usdcMint, floatingPayerUsdc, payer, 50_000_000),
    ]);

    // Create a mock Drift PerpMarket account (System-owned, 400 bytes)
    driftMarketKp = Keypair.generate();
    const lamports = await connection.getMinimumBalanceForRentExemption(400);
    await provider.sendAndConfirm(new Transaction().add(
      SystemProgram.createAccount({
        fromPubkey: payer.publicKey,
        newAccountPubkey: driftMarketKp.publicKey,
        lamports,
        space: 400,
        programId: SystemProgram.programId,
      })
    ), [driftMarketKp]);

    market = deriveMarket(driftMarketKp.publicKey);
  });

  it("initialize_market creates the market account", async () => {
    const data = Buffer.concat([DISC.initialize_market, driftMarketKp.publicKey.toBuffer()]);
    await provider.sendAndConfirm(new Transaction().add({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: market, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }));

    const info = await connection.getAccountInfo(market);
    assert.isNotNull(info, "Market account should be created");
    // disc(8) + drift_market(32) + authority(32) + total_volume(8) + is_active(1) = 81
    // order_count(8) starts at 81
    const orderCount = info!.data.readBigUInt64LE(81);
    assert.equal(orderCount, BigInt(0), "order_count starts at 0");
  });

  it("place_order locks collateral in vault", async () => {
    const info = await connection.getAccountInfo(market);
    const orderCount = info!.data.readBigUInt64LE(81);
    const order = deriveOrder(market, orderCount);
    const orderVault = deriveOrderVault(order);

    const args = Buffer.alloc(1 + 8 + 8 + 4 + 8);
    let o = 0;
    args[o++] = 0; // FixedPayer
    args.writeBigUInt64LE(NOTIONAL, o);   o += 8;
    args.writeBigInt64LE(FIXED_RATE, o);  o += 8;
    args.writeUInt32LE(DURATION, o);      o += 4;
    args.writeBigUInt64LE(COLLATERAL, o);

    await provider.sendAndConfirm(new Transaction().add({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: market,              isSigner: false, isWritable: true },
        { pubkey: order,               isSigner: false, isWritable: true },
        { pubkey: orderVault,          isSigner: false, isWritable: true },
        { pubkey: fixedPayerKp.publicKey, isSigner: true, isWritable: true },
        { pubkey: fixedPayerUsdc,      isSigner: false, isWritable: true },
        { pubkey: usdcMint,            isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY,  isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([DISC.place_order, args]),
    }), [fixedPayerKp]);

    const vault = await getAccount(connection, orderVault);
    assert.equal(vault.amount, COLLATERAL, "Vault holds the collateral");

    const updatedMarket = await connection.getAccountInfo(market);
    assert.equal(updatedMarket!.data.readBigUInt64LE(81), BigInt(1), "order_count incremented");
  });

  it("cancel_order returns collateral", async () => {
    // Place a new order then cancel it
    const info = await connection.getAccountInfo(market);
    const orderCount = info!.data.readBigUInt64LE(81);
    const order = deriveOrder(market, orderCount);
    const orderVault = deriveOrderVault(order);

    const args = Buffer.alloc(1 + 8 + 8 + 4 + 8);
    let o = 0;
    args[o++] = 0;
    args.writeBigUInt64LE(NOTIONAL, o);   o += 8;
    args.writeBigInt64LE(FIXED_RATE, o);  o += 8;
    args.writeUInt32LE(DURATION, o);      o += 4;
    args.writeBigUInt64LE(COLLATERAL, o);

    await provider.sendAndConfirm(new Transaction().add({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: market,              isSigner: false, isWritable: true },
        { pubkey: order,               isSigner: false, isWritable: true },
        { pubkey: orderVault,          isSigner: false, isWritable: true },
        { pubkey: fixedPayerKp.publicKey, isSigner: true, isWritable: true },
        { pubkey: fixedPayerUsdc,      isSigner: false, isWritable: true },
        { pubkey: usdcMint,            isSigner: false, isWritable: false },
        { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY,  isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([DISC.place_order, args]),
    }), [fixedPayerKp]);

    const balanceBefore = (await getAccount(connection, fixedPayerUsdc)).amount;

    await provider.sendAndConfirm(new Transaction().add({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: order,               isSigner: false, isWritable: true },
        { pubkey: orderVault,          isSigner: false, isWritable: true },
        { pubkey: fixedPayerUsdc,      isSigner: false, isWritable: true },
        { pubkey: fixedPayerKp.publicKey, isSigner: true, isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID,    isSigner: false, isWritable: false },
      ],
      data: DISC.cancel_order,
    }), [fixedPayerKp]);

    const balanceAfter = (await getAccount(connection, fixedPayerUsdc)).amount;
    assert.equal(balanceAfter - balanceBefore, COLLATERAL, "Full collateral returned");

    const orderInfo = await connection.getAccountInfo(order);
    assert.isNull(orderInfo, "Order account closed after cancel");
  });
});
