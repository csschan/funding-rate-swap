/**
 * Initialize the Protocol AMM on devnet and fund its treasury.
 * Run with:
 *   npx ts-node scripts/init-amm.ts
 */

import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getOrCreateAssociatedTokenAccount,
  transfer,
} from "@solana/spl-token";
import * as fs from "fs";
import * as os from "os";

const PROGRAM_ID = new PublicKey("EeQyJqzDEMYBSFJt7mwRkKgy5HFMGJQ3as6eKgxH8NUC");
const USDC_MINT  = new PublicKey("8RDUcZTDGpqWdDeSDRowwqAvgDjQq5eVop7M7CLr9sof");
const RPC_URL    = "https://api.devnet.solana.com";

function disc(name: string): Buffer {
  const crypto = require("crypto");
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function deriveAmm(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("protocol_amm")], PROGRAM_ID);
}

function deriveAmmTreasury(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("amm_treasury")], PROGRAM_ID);
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");

  // Load deployer keypair
  const keypairPath = process.env.KEYPAIR_PATH ?? `${os.homedir()}/.config/solana/deploy-keypair.json`;
  const raw = JSON.parse(fs.readFileSync(keypairPath, "utf8"));
  const payer = Keypair.fromSecretKey(new Uint8Array(raw));
  console.log("Payer:", payer.publicKey.toBase58());

  const [ammKey] = deriveAmm();
  const [treasuryKey] = deriveAmmTreasury();
  console.log("AMM PDA:", ammKey.toBase58());
  console.log("Treasury:", treasuryKey.toBase58());

  // Check if AMM already initialized
  const existing = await connection.getAccountInfo(ammKey);
  if (existing) {
    console.log("AMM already initialized. Treasury balance will be shown.");
  } else {
    // Build initialize_amm ix
    const initIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        // Order must match Rust struct field order:
        // amm, amm_treasury, usdc_mint, admin, token_program, system_program, rent
        { pubkey: ammKey,                  isSigner: false, isWritable: true },
        { pubkey: treasuryKey,             isSigner: false, isWritable: true },
        { pubkey: USDC_MINT,               isSigner: false, isWritable: false },
        { pubkey: payer.publicKey,         isSigner: true,  isWritable: true },
        { pubkey: TOKEN_PROGRAM_ID,        isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: SYSVAR_RENT_PUBKEY,      isSigner: false, isWritable: false },
      ],
      data: disc("initialize_amm"),
    });

    const tx = new Transaction().add(initIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { commitment: "confirmed" });
    console.log("AMM initialized! Tx:", sig);
  }

  // Fund the treasury with USDC
  const fundAmount = process.argv[2] ? parseFloat(process.argv[2]) : 10000; // default 10k USDC
  if (fundAmount > 0) {
    const payerAta = await getOrCreateAssociatedTokenAccount(
      connection, payer, USDC_MINT, payer.publicKey
    );
    console.log("Payer USDC:", payerAta.address.toBase58(), "balance:", Number(payerAta.amount) / 1e6, "USDC");

    const fundRaw = BigInt(Math.floor(fundAmount * 1_000_000));
    if (Number(payerAta.amount) < Number(fundRaw)) {
      console.log(`Insufficient USDC balance. Need ${fundAmount} USDC, have ${Number(payerAta.amount) / 1e6}.`);
      console.log("Mint some test USDC first.");
    } else {
      const sig = await transfer(
        connection, payer, payerAta.address, treasuryKey, payer, fundRaw
      );
      console.log(`Funded treasury with ${fundAmount} USDC. Tx:`, sig);
    }
  }

  // Show final state
  const treasuryInfo = await connection.getAccountInfo(treasuryKey);
  if (treasuryInfo) {
    // token account: amount at offset 64, 8 bytes LE
    const view = new DataView(treasuryInfo.data.buffer, treasuryInfo.data.byteOffset, treasuryInfo.data.byteLength);
    const balance = view.getBigUint64(64, true);
    console.log("Treasury balance:", Number(balance) / 1e6, "USDC");
  }
}

main().catch(console.error);
