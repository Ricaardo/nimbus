import type { Address, Hex } from "viem";

export function validateAddress(value: string): Address {
  if (!/^0x[a-fA-F0-9]{40}$/.test(value)) {
    throw new Error(`Invalid address: ${value}`);
  }
  return value as Address;
}

export function validatePrivateKey(value: string): Hex {
  if (!/^0x[a-fA-F0-9]{64}$/.test(value)) {
    throw new Error("Invalid private key format");
  }
  return value as Hex;
}

export function validatePositiveNumber(value: string, name: string): number {
  const num = parseFloat(value);
  if (isNaN(num) || num <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
  return num;
}

export function validatePositiveInteger(value: string, name: string): number {
  const num = parseInt(value, 10);
  if (isNaN(num) || num <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return num;
}

export function validateSide(value: string): "buy" | "sell" {
  const lower = value.toLowerCase();
  if (lower !== "buy" && lower !== "sell") {
    throw new Error('Side must be "buy" or "sell"');
  }
  return lower as "buy" | "sell";
}

export function validateTif(value: string): "Gtc" | "Ioc" | "Alo" {
  const mapping: Record<string, "Gtc" | "Ioc" | "Alo"> = {
    gtc: "Gtc",
    ioc: "Ioc",
    alo: "Alo",
  };
  const result = mapping[value.toLowerCase()];
  if (!result) {
    throw new Error('Time-in-force must be "Gtc", "Ioc", or "Alo"');
  }
  return result;
}
