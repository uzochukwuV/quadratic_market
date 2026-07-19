import type { Idl } from "@coral-xyz/anchor";
import { sha256 } from "@noble/hashes/sha256";
import quadraticMarketIdl from "@/idl/quadratic_market.json";

function discriminator(namespace: "global" | "account", name: string) {
  const preimageName = namespace === "global" ? name.replace(/[A-Z]/g, (match) => `_${match.toLowerCase()}`) : name;
  return Array.from(sha256(new TextEncoder().encode(`${namespace}:${preimageName}`)).slice(0, 8));
}

function eventDiscriminator(name: string) {
  return Array.from(sha256(new TextEncoder().encode(`event:${name}`)).slice(0, 8));
}

function normalizeIdlTypes(value: unknown): unknown {
  if (value === "publicKey") return "pubkey";
  if (Array.isArray(value)) return value.map(normalizeIdlTypes);
  if (!value || typeof value !== "object") return value;

  if ("defined" in value && typeof (value as { defined: unknown }).defined === "string") {
    return {
      ...Object.fromEntries(
        Object.entries(value).map(([key, nested]) => [key, key === "defined" ? nested : normalizeIdlTypes(nested)]),
      ),
      defined: { name: (value as { defined: string }).defined },
    };
  }

  const normalized = Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [key, normalizeIdlTypes(nested)]),
  ) as Record<string, unknown>;

  if ("isMut" in normalized && !("writable" in normalized)) {
    normalized.writable = normalized.isMut;
  }
  if ("isSigner" in normalized && !("signer" in normalized)) {
    normalized.signer = normalized.isSigner;
  }

  return normalized;
}

function normalizeIdl(value: typeof quadraticMarketIdl) {
  const normalized = normalizeIdlTypes(value) as {
    instructions?: Array<{ name: string; discriminator?: number[] }>;
    accounts?: Array<{ name: string; discriminator?: number[]; type?: unknown }>;
    events?: Array<{ name: string; discriminator?: number[]; fields?: unknown[] }>;
    types?: Array<{ name: string; type: unknown }>;
    [key: string]: unknown;
  };

  normalized.instructions = normalized.instructions?.map((instruction) => ({
    ...instruction,
    discriminator: instruction.discriminator ?? discriminator("global", instruction.name),
  }));

  normalized.accounts = normalized.accounts?.map((account) => ({
    ...account,
    discriminator: account.discriminator ?? discriminator("account", account.name),
  }));

  normalized.events = normalized.events?.map((event) => ({
    ...event,
    discriminator: event.discriminator ?? eventDiscriminator(event.name),
  }));

  const types = normalized.types ?? [];
  const typeNames = new Set(types.map((type) => type.name));
  const accountTypes = (normalized.accounts ?? [])
    .filter((account): account is { name: string; discriminator?: number[]; type: unknown } => Boolean(account.type) && !typeNames.has(account.name))
    .map((account) => ({ name: account.name, type: account.type }));
  const eventTypes = (normalized.events ?? [])
    .filter((event): event is { name: string; discriminator?: number[]; fields: unknown[] } => Boolean(event.fields) && !typeNames.has(event.name))
    .map((event) => ({ name: event.name, type: { kind: "struct", fields: event.fields } }));
  normalized.types = [...types, ...accountTypes, ...eventTypes];

  return normalized;
}

export const quadraticMarketIdlJson = normalizeIdl(quadraticMarketIdl) as unknown as Idl;

export type QuadraticMarketIdl = typeof quadraticMarketIdl;
