import { PublicKey } from "@solana/web3.js";
import { PROGRAM_ID } from "./constants";

function u64ToLeBytes(n: bigint): Uint8Array {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setBigUint64(0, n, true);
  return new Uint8Array(buf);
}

function textToBytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

export function deriveSwapMarket(marketSeed: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("swap_market"), marketSeed.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function deriveSwapOrder(marketKey: PublicKey, orderId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("swap_order"), marketKey.toBuffer(), u64ToLeBytes(orderId)],
    PROGRAM_ID
  );
  return pda;
}

export function deriveOrderVault(orderKey: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("order_vault"), orderKey.toBuffer()],
    PROGRAM_ID
  );
  return pda;
}

export function deriveSwapPosition(marketKey: PublicKey, positionId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("swap_position"), marketKey.toBuffer(), u64ToLeBytes(positionId)],
    PROGRAM_ID
  );
  return pda;
}

export function derivePositionVault(positionKey: PublicKey, side: "fixed" | "floating"): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("vault"), positionKey.toBuffer(), textToBytes(side)],
    PROGRAM_ID
  );
  return pda;
}

export function deriveProtocolAmm(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("protocol_amm")],
    PROGRAM_ID
  );
  return pda;
}

export function deriveAmmTreasury(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("amm_treasury")],
    PROGRAM_ID
  );
  return pda;
}

export function deriveAmmPosition(ammKey: PublicKey, positionId: bigint): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [textToBytes("amm_pos"), ammKey.toBuffer(), u64ToLeBytes(positionId)],
    PROGRAM_ID
  );
  return pda;
}
