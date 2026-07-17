import * as anchor from "@coral-xyz/anchor";

const TXLINE_API_BASE = "https://txline-dev.txodds.com/api";

function toBytes32(value: string | number[] | Uint8Array): number[] {
  if (typeof value === "string") {
    const raw = value.startsWith("0x") ? value.slice(2) : value;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Array.from(Buffer.from(raw, "hex"));
    }
    return Array.from(Buffer.from(raw, "base64"));
  }
  return Array.from(value as any);
}

function toProofNodes(nodes: any[] = []) {
  return nodes.map((node) => ({
    hash: toBytes32(node.hash),
    isRightSibling: Boolean(node.isRightSibling ?? node.is_right_sibling ?? false),
  }));
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const resp = await fetch(url, init);
  if (!resp.ok) {
    throw new Error(`${url} -> ${resp.status} ${await resp.text()}`);
  }
  return resp.json();
}

export async function buildFinalSettlementProof(
  jwt: string,
  apiToken: string,
  fixtureId: number,
  seq: number,
): Promise<{
  validationTimestamp: number;
  homeScore: number;
  awayScore: number;
  proposedOutcome: number;
  validationInput: any;
  strategy: any;
}> {
  const validation = await fetchJson(`${TXLINE_API_BASE}/scores/stat-validation?fixtureId=${fixtureId}&seq=${seq}&statKeys=1002,1003`, {
    headers: {
      authorization: `Bearer ${jwt}`,
      "x-api-token": apiToken,
    },
  });

  const updateStats = validation.summary.updateStats;
  const statsToProve = validation.statsToProve ?? [];
  const statProofs = validation.statProofs ?? [];

  if (statsToProve.length < 2) {
    throw new Error("TxLINE proof payload requires at least two stats");
  }

  const validationTimestamp = Number(updateStats.minTimestamp);
  const homeScore = Number(statsToProve[0].value ?? 0);
  const awayScore = Number(statsToProve[1].value ?? 0);

  return {
    validationTimestamp,
    homeScore,
    awayScore,
    proposedOutcome: homeScore > awayScore ? 0 : awayScore > homeScore ? 2 : 1,
    validationInput: {
      ts: new anchor.BN(validationTimestamp),
      fixtureSummary: {
        fixtureId: new anchor.BN(Number(validation.summary.fixtureId)),
        updateStats: {
          updateCount: Number(updateStats.updateCount),
          minTimestamp: new anchor.BN(Number(updateStats.minTimestamp)),
          maxTimestamp: new anchor.BN(Number(updateStats.maxTimestamp)),
        },
        eventsSubtreeRoot: toBytes32(
          validation.summary.eventStatsSubTreeRoot ?? validation.summary.eventsSubTreeRoot,
        ),
      },
      fixtureProof: toProofNodes(validation.subTreeProof),
      mainTreeProof: toProofNodes(validation.mainTreeProof),
      eventStatRoot: toBytes32(validation.eventStatRoot),
      stats: statsToProve.map((stat: any, index: number) => ({
        stat,
        statProof: toProofNodes(statProofs[index] ?? []),
      })),
    },
    strategy: {
      geometricTargets: [],
      distancePredicate: null,
      discretePredicates: [
        {
          single: {
            index: 0,
            predicate: {
              threshold: Number(statsToProve[0].value),
              comparison: { equalTo: {} },
            },
          },
        },
        {
          single: {
            index: 1,
            predicate: {
              threshold: Number(statsToProve[1].value),
              comparison: { equalTo: {} },
            },
          },
        },
      ],
    },
  };
}
