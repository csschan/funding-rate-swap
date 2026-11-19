import { Connection, PublicKey } from "@solana/web3.js";
import {
  RPC_URL,
  PROGRAM_ID,
  DRIFT_SOL_PERP_MARKET,
  POLL_INTERVAL_MS,
  loadKeypair,
} from "./config";
import {
  readDriftFundingRate,
  subscribeToFundingRateChanges,
  FundingRateData,
} from "./drift";
import { fetchActivePositions } from "./positions";
import { settlePositions } from "./settler";
import { matchOrders } from "./matcher";

async function main() {
  const keeper = loadKeypair();
  const connection = new Connection(RPC_URL, {
    commitment: "confirmed",
    wsEndpoint: RPC_URL.replace("https://", "wss://").replace("http://", "ws://"),
  });

  console.log(`🤖 Keeper Bot starting`);
  console.log(`   Keeper:  ${keeper.publicKey.toBase58()}`);
  console.log(`   Program: ${PROGRAM_ID.toBase58()}`);
  console.log(`   RPC:     ${RPC_URL}`);
  console.log(`   Market:  ${DRIFT_SOL_PERP_MARKET.toBase58()}`);

  // Derive swap market PDA
  const [swapMarket] = PublicKey.findProgramAddressSync(
    [Buffer.from("swap_market"), DRIFT_SOL_PERP_MARKET.toBuffer()],
    PROGRAM_ID
  );

  let lastProcessedTs = 0n;

  // --- Subscribe to Drift funding rate updates ---
  console.log("\n📡 Subscribing to Drift PerpMarket account changes...");
  subscribeToFundingRateChanges(
    connection,
    DRIFT_SOL_PERP_MARKET,
    async (fundingData: FundingRateData) => {
      if (fundingData.lastFundingRateTs <= lastProcessedTs) return;

      console.log(
        `\n⚡ Drift funding rate updated: ${fundingData.lastFundingRate}bps at ts=${fundingData.lastFundingRateTs}`
      );
      await runSettlement(connection, keeper, swapMarket, fundingData);
      lastProcessedTs = fundingData.lastFundingRateTs;
    }
  );

  // --- Polling fallback: scan every POLL_INTERVAL_MS in case WebSocket misses events ---
  console.log(`\n⏱  Polling every ${POLL_INTERVAL_MS / 1000}s as fallback...\n`);

  // Run once immediately on startup to catch any missed settlements
  await runSettlementCycle(connection, keeper, swapMarket);

  setInterval(async () => {
    await runSettlementCycle(connection, keeper, swapMarket);
  }, POLL_INTERVAL_MS);

  // --- Order matching: scan and match open SwapOrders every 30 seconds ---
  const MATCH_INTERVAL_MS = 30_000;
  console.log(`\n Matching orders every ${MATCH_INTERVAL_MS / 1000}s...\n`);

  await runMatchCycle(connection, keeper);

  setInterval(async () => {
    await runMatchCycle(connection, keeper);
  }, MATCH_INTERVAL_MS);
}

async function runSettlementCycle(
  connection: Connection,
  keeper: ReturnType<typeof loadKeypair>,
  swapMarket: PublicKey
) {
  try {
    const fundingData = await readDriftFundingRate(connection, DRIFT_SOL_PERP_MARKET);
    if (fundingData.lastFundingRateTs <= 0n) return;
    await runSettlement(connection, keeper, swapMarket, fundingData);
  } catch (err) {
    console.error("Error in settlement cycle:", err);
  }
}

async function runSettlement(
  connection: Connection,
  keeper: ReturnType<typeof loadKeypair>,
  swapMarket: PublicKey,
  fundingData: FundingRateData
) {
  try {
    const positions = await fetchActivePositions(connection, swapMarket);
    console.log(`Found ${positions.length} active positions`);

    if (positions.length === 0) return;

    const { succeeded, failed } = await settlePositions(
      connection,
      keeper,
      positions,
      fundingData,
      DRIFT_SOL_PERP_MARKET
    );

    console.log(`Settlement complete: ${succeeded} succeeded, ${failed} failed`);
  } catch (err) {
    console.error("Settlement run failed:", err);
  }
}

async function runMatchCycle(
  connection: Connection,
  keeper: ReturnType<typeof loadKeypair>
) {
  try {
    const { matched, failed } = await matchOrders(connection, keeper);
    if (matched > 0 || failed > 0) {
      console.log(`Match cycle complete: ${matched} matched, ${failed} failed`);
    }
  } catch (err) {
    console.error("Error in match cycle:", err);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
