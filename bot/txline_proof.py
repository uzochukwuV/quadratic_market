from __future__ import annotations

import base64
from typing import Any


def _to_bytes32(value: str | list[int] | bytes | bytearray | memoryview) -> list[int]:
    if isinstance(value, str):
        raw = value[2:] if value.startswith("0x") else value
        if len(raw) == 64 and all(c in "0123456789abcdefABCDEF" for c in raw):
            data = bytes.fromhex(raw)
        else:
            data = base64.b64decode(raw)
    else:
        data = bytes(value)
    if len(data) != 32:
        raise ValueError(f"Expected 32 bytes, got {len(data)}")
    return list(data)


def _to_proof_nodes(nodes: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    if not nodes:
        return []
    return [
        {
            "hash": _to_bytes32(node["hash"]),
            "isRightSibling": bool(node.get("isRightSibling", node.get("is_right_sibling", False))),
        }
        for node in nodes
    ]


def build_final_settlement_proof_bundle(validation: dict[str, Any], final_record: Any) -> dict[str, Any]:
    update_stats = validation["summary"]["updateStats"]
    stats_to_prove = validation.get("statsToProve", [])
    stat_proofs = validation.get("statProofs", [])

    if len(stats_to_prove) < 2:
        raise ValueError("TxLINE settlement proof requires at least two stats")

    target_ts = int(update_stats["minTimestamp"])
    payload = {
        "ts": target_ts,
        "fixtureSummary": {
            "fixtureId": int(validation["summary"]["fixtureId"]),
            "updateStats": {
                "updateCount": int(update_stats["updateCount"]),
                "minTimestamp": target_ts,
                "maxTimestamp": int(update_stats["maxTimestamp"]),
            },
            "eventsSubtreeRoot": _to_bytes32(
                validation["summary"].get("eventStatsSubTreeRoot", validation["summary"].get("eventsSubTreeRoot"))
            ),
        },
        "fixtureProof": _to_proof_nodes(validation.get("subTreeProof")),
        "mainTreeProof": _to_proof_nodes(validation.get("mainTreeProof")),
        "eventStatRoot": _to_bytes32(validation["eventStatRoot"]),
        "stats": [
            {
                "stat": stat,
                "statProof": _to_proof_nodes(stat_proofs[index]),
            }
            for index, stat in enumerate(stats_to_prove)
        ],
    }

    strategy = {
        "geometricTargets": [],
        "distancePredicate": None,
        "discretePredicates": [
            {
                "single": {
                    "index": 0,
                    "predicate": {
                        "threshold": int(stats_to_prove[0]["value"]),
                        "comparison": {"equalTo": {}},
                    },
                }
            },
            {
                "single": {
                    "index": 1,
                    "predicate": {
                        "threshold": int(stats_to_prove[1]["value"]),
                        "comparison": {"equalTo": {}},
                    },
                }
            },
        ],
    }

    proposed_outcome = 0
    if final_record.home_score < final_record.away_score:
        proposed_outcome = 2
    elif final_record.home_score == final_record.away_score:
        proposed_outcome = 1

    return {
        "seq": final_record.seq,
        "validation_timestamp": target_ts,
        "home_score": final_record.home_score,
        "away_score": final_record.away_score,
        "proposed_outcome": proposed_outcome,
        "validation_input": payload,
        "strategy": strategy,
    }
