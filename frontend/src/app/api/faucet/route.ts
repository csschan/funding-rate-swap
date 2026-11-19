import { NextRequest, NextResponse } from "next/server";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { USDC_MINT_DEVNET } from "@/lib/constants";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const MINT_AMOUNT = 10_000_000_000; // 10,000 USDC (6 decimals)

function loadPayer(): Keypair {
  const keyPath = path.join(os.homedir(), ".config/solana/deploy-keypair.json");
  const key = JSON.parse(fs.readFileSync(keyPath, "utf-8"));
  return Keypair.fromSecretKey(Buffer.from(key));
}

export async function POST(req: NextRequest) {
  try {
    const { wallet } = await req.json();
    if (!wallet) {
      return NextResponse.json({ error: "Missing wallet" }, { status: 400 });
    }

    const recipient = new PublicKey(wallet);
    const conn = new Connection("https://api.devnet.solana.com", "confirmed");
    const payer = loadPayer();

    const ata = await getOrCreateAssociatedTokenAccount(
      conn,
      payer,
      USDC_MINT_DEVNET,
      recipient
    );

    await mintTo(conn, payer, USDC_MINT_DEVNET, ata.address, payer, MINT_AMOUNT);

    return NextResponse.json({
      success: true,
      amount: "10,000 USDC",
      ata: ata.address.toBase58(),
    });
  } catch (err: any) {
    console.error("Faucet error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
