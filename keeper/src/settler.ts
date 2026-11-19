import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { PROGRAM_ID, FUNDING_RATE_CIRCUIT_BREAKER_BPS } from "./config";
import { ActivePosition } from "./positions";
import { FundingRateData } from "./drift";
import * as crypto from "crypto";

// Anchor instruction discriminator = sha256("global:settle")[0..8]
function instructionDiscriminator(name: string): Buffer {
  const hash = crypto.createHash("sha256").update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// sha256("global:settle")[0..8] = [175, 42, 185, 87, 144, 131, 102, 212]
const SETTLE_DISCRIMINATOR = Buffer.from([175, 42, 185, 87, 144, 131, 102, 212]);

export function buildSettleInstruction(
  position: ActivePosition,
  driftPerpMarket: PublicKey,
  keeper: PublicKey,
  tokenProgram: PublicKey
): TransactionInstruction {
  const TOKEN_PROGRAM_ID = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );

  return new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: position.publicKey, isSigner: false, isWritable: true },
      { pubkey: position.fixedVault, isSigner: false, isWritable: true },
      { pubkey: position.floatingVault, isSigner: false, isWritable: true },
      { pubkey: driftPerpMarket, isSigner: false, isWritable: false },
      { pubkey: keeper, isSigner: true, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: SETTLE_DISCRIMINATOR,
  });
}

export async function settlePositions(
  connection: Connection,
  keeper: Keypair,
  positions: ActivePosition[],
  fundingData: FundingRateData,
  driftPerpMarket: PublicKey
): Promise<{ succeeded: number; failed: number }> {
  // Circuit breaker: skip if funding rate is anomalous
  const rateAbsBps = fundingData.lastFundingRate < 0n
    ? -fundingData.lastFundingRate
    : fundingData.lastFundingRate;

  if (rateAbsBps > BigInt(FUNDING_RATE_CIRCUIT_BREAKER_BPS)) {
    console.warn(
      `⚠️  Circuit breaker triggered: funding_rate=${fundingData.lastFundingRate}bps exceeds threshold ${FUNDING_RATE_CIRCUIT_BREAKER_BPS}bps. Skipping settlement.`
    );
    return { succeeded: 0, failed: 0 };
  }

  // Filter positions that need settling this period
  const toSettle = positions.filter(
    (p) => fundingData.lastFundingRateTs > p.lastSettledAt
  );

  if (toSettle.length === 0) {
    console.log("No positions to settle this period.");
    return { succeeded: 0, failed: 0 };
  }

  console.log(`Settling ${toSettle.length} positions...`);

  const TOKEN_PROGRAM_ID = new PublicKey(
    "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
  );

  let succeeded = 0;
  let failed = 0;

  // Batch into groups of 5 to stay within transaction size limits
  const BATCH_SIZE = 5;
  for (let i = 0; i < toSettle.length; i += BATCH_SIZE) {
    const batch = toSettle.slice(i, i + BATCH_SIZE);
    const tx = new Transaction();

    for (const position of batch) {
      tx.add(
        buildSettleInstruction(
          position,
          driftPerpMarket,
          keeper.publicKey,
          TOKEN_PROGRAM_ID
        )
      );
    }

    try {
      const sig = await sendAndConfirmTransaction(connection, tx, [keeper], {
        commitment: "confirmed",
        maxRetries: 3,
      });
      console.log(
        `✅ Settled batch ${i / BATCH_SIZE + 1}: ${batch.length} positions — tx: ${sig}`
      );
      succeeded += batch.length;
    } catch (err) {
      console.error(`❌ Batch ${i / BATCH_SIZE + 1} failed:`, err);
      // Try settling individually to identify the failing position
      for (const position of batch) {
        try {
          const singleTx = new Transaction().add(
            buildSettleInstruction(
              position,
              driftPerpMarket,
              keeper.publicKey,
              TOKEN_PROGRAM_ID
            )
          );
          const sig = await sendAndConfirmTransaction(
            connection,
            singleTx,
            [keeper],
            { commitment: "confirmed", maxRetries: 3 }
          );
          console.log(`  ✅ ${position.publicKey.toBase58().slice(0, 8)}... settled — tx: ${sig}`);
          succeeded++;
        } catch (singleErr) {
          console.error(`  ❌ ${position.publicKey.toBase58().slice(0, 8)}... failed:`, singleErr);
          failed++;
        }
      }
    }
  }

  return { succeeded, failed };
}
