export type QuadraticMarket = {
  "version": "0.1.0",
  "name": "quadratic_market",
  "instructions": [
    {
      "name": "initializeProtocol",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "oraclePubkey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "maxMarketExposure",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeLpMint",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpMint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "transferAdmin",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "pause",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "unpause",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "maxMarketExposure",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "challengeWindowSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "settlementDeadlineSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "epochDurationSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "withdrawalCooldownSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "maxSingleBet",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "minOddsBps",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "maxOddsBps",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "houseFeeBps",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "oraclePubkey",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "addOperator",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "operator",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "removeOperator",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "operator",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "createMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Epoch account for the current epoch — must match global_config.current_epoch.",
            "Markets are always created under the active epoch so the epoch can track",
            "how many markets need to settle before LP withdrawals are unlocked."
          ]
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "startTime",
          "type": "i64"
        },
        {
          "name": "numOutcomes",
          "type": "u8"
        },
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "category",
          "type": "u8"
        },
        {
          "name": "marketType",
          "type": {
            "defined": "MarketType"
          }
        },
        {
          "name": "initialOdds",
          "type": {
            "vec": "u64"
          }
        },
        {
          "name": "txlineFixtureId",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "initOutcomeMint",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "outcomeMint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "outcomeId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "suspendMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "resumeMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "voidMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "voidIfExpired",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "settleMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "winningOutcome",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settleWithProof",
      "docs": [
        "Settle market using TxLINE on-chain proof validation.",
        "Only authorized operators/admin can call this with valid proof data.",
        "",
        "Flow:",
        "1. Bot fetches proof from TxLINE API",
        "2. Bot calls this instruction with Txoracle payload + strategy",
        "3. Program validates proof via CPI to Txoracle",
        "4. Market is settled with the derived outcome"
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "dailyScoresMerkleRoots",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "PDA for daily scores Merkle roots."
          ]
        },
        {
          "name": "txoracleProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "caller",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "The caller (must be an admin or authorized operator)"
          ]
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "proposedOutcome",
          "type": "u8"
        },
        {
          "name": "txlineFixtureId",
          "type": "u64"
        },
        {
          "name": "validationTimestamp",
          "type": "i64"
        },
        {
          "name": "homeScore",
          "type": "i64"
        },
        {
          "name": "awayScore",
          "type": "i64"
        },
        {
          "name": "validationInput",
          "type": {
            "defined": "StatValidationInput"
          }
        },
        {
          "name": "strategy",
          "type": {
            "defined": "NDimensionalStrategy"
          }
        }
      ]
    },
    {
      "name": "claimPayout",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimerOutcomeAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "claimerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "outcomeMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimPausedBet",
      "docs": [
        "Refund a user's original stake when the protocol is paused."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "betSlip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "claimerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createMarketGroup",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "marketGroup",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u64"
        },
        {
          "name": "maxGroupExposure",
          "type": "u64"
        },
        {
          "name": "eventStartTime",
          "type": "i64"
        },
        {
          "name": "title",
          "type": "string"
        }
      ]
    },
    {
      "name": "addMarketToGroup",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "marketGroup",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u64"
        },
        {
          "name": "marketIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "updateMarketOdds",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "newOdds",
          "type": {
            "vec": "u64"
          }
        }
      ]
    },
    {
      "name": "updateMarketOddsWithProof",
      "docs": [
        "Update market odds after validating a TxLINE proof bundle on-chain."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "dailyScoresMerkleRoots",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "txoracleProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "newOdds",
          "type": {
            "vec": "u64"
          }
        },
        {
          "name": "validationInput",
          "type": {
            "defined": "StatValidationInput"
          }
        },
        {
          "name": "strategy",
          "type": {
            "defined": "NDimensionalStrategy"
          }
        }
      ]
    },
    {
      "name": "placeSlipAwait",
      "docs": [
        "Place slip await: escrows stake, records legs, locks fixed odds.",
        "Backend then fires N × buy_leg_for_slip."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "ownerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "legs",
          "type": {
            "vec": {
              "defined": "SlipLeg"
            }
          }
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "cancelDeadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "buyLegForSlip",
      "docs": [
        "Buy one leg for slip. Backend calls this N times after place_slip_await."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "buyerOutcomeAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "outcomeMint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "buyer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        },
        {
          "name": "legIndex",
          "type": "u8"
        },
        {
          "name": "outcomeId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "cancelSlip",
      "docs": [
        "Cancel slip if deadline passed or legs not bought."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "cancellerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleSlipLeg",
      "docs": [
        "Settle one leg of a slip. Permissionless."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "caller",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        },
        {
          "name": "legIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "resolveSlip",
      "docs": [
        "Resolve slip: finalize payout after all legs settled."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "outcomeMint",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "outcomeId",
          "type": "u8"
        },
        {
          "name": "side",
          "type": {
            "defined": "OrderSide"
          }
        },
        {
          "name": "numShares",
          "type": "u64"
        },
        {
          "name": "pricePerShare",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "fillOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "fillerBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "fillerOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "filler",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "fillShares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expireOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "caller",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Anyone can call expire — they receive the PDA rent."
          ]
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initEpoch",
      "docs": [
        "Create the on-chain Epoch account for the current epoch.",
        "Must be called before any markets can be created in a new epoch."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "startNextEpoch",
      "docs": [
        "Advance to the next active epoch and create its epoch vault."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "currentEpoch",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "nextEpoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "nextEpochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "nextEpochId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pauseEpoch",
      "docs": [
        "Pause epoch — blocks deposits, withdrawals, and market creation.",
        "Admin can pause at any time (e.g. between epochs or for emergency)."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "unpauseEpoch",
      "docs": [
        "Unpause epoch — re-enables deposits, withdrawals, and market creation."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "closeEpoch",
      "docs": [
        "Manually close an epoch and enable LP withdrawals.",
        "Normally auto-triggered when the last market in the epoch settles."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "publishEpoch",
      "docs": [
        "Publish an epoch and its vault — announcement LPs see before opting in."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        },
        {
          "name": "marketIds",
          "type": {
            "vec": "u64"
          }
        }
      ]
    },
    {
      "name": "optInEpochLiquidity",
      "docs": [
        "Opt into an epoch's liquidity pool."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpPosition",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lp",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawEpochLiquidity",
      "docs": [
        "Withdraw liquidity after epoch settlement."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpPosition",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "lp",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        },
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "enableEpochWithdrawals",
      "docs": [
        "Enable withdrawals on an epoch vault (called when epoch settles)."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "slip",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "slipId",
            "type": "u64"
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "numLegs",
            "type": "u8"
          },
          {
            "name": "legMarketIds",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "legOutcomeIds",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "legsBoughtMask",
            "type": "u16"
          },
          {
            "name": "legsSettledMask",
            "type": "u16"
          },
          {
            "name": "legsWonMask",
            "type": "u16"
          },
          {
            "name": "totalStake",
            "type": "u64"
          },
          {
            "name": "totalCost",
            "type": "u64"
          },
          {
            "name": "potentialPayout",
            "type": "u64"
          },
          {
            "name": "lockedAmount",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": "SlipStatus"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "cancelDeadline",
            "type": "i64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochVault",
      "docs": [
        "Tracks liquidity provided by LPs who opted into a specific epoch.",
        "Each epoch has its own vault, isolating capital and preventing cross-epoch contamination."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epochId",
            "docs": [
              "The epoch this vault belongs to"
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposits",
            "docs": [
              "Total base tokens deposited by LPs who opted into this epoch"
            ],
            "type": "u64"
          },
          {
            "name": "totalWithdrawals",
            "docs": [
              "Total base tokens withdrawn by LPs after epoch settlement"
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "docs": [
              "Total LP shares minted for this epoch"
            ],
            "type": "u64"
          },
          {
            "name": "numLps",
            "docs": [
              "Number of LPs who have opted in"
            ],
            "type": "u32"
          },
          {
            "name": "createdAt",
            "docs": [
              "Timestamp when the epoch started"
            ],
            "type": "i64"
          },
          {
            "name": "closedAt",
            "docs": [
              "Timestamp when the epoch ended (set at close)"
            ],
            "type": "i64"
          },
          {
            "name": "withdrawalsEnabled",
            "docs": [
              "Whether withdrawals are enabled"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochLpPosition",
      "docs": [
        "Tracks an individual LP's position in an epoch vault"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "The LP's public key"
            ],
            "type": "publicKey"
          },
          {
            "name": "epochId",
            "docs": [
              "The epoch this position belongs to"
            ],
            "type": "u64"
          },
          {
            "name": "shares",
            "docs": [
              "Number of LP shares held"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "docs": [
              "Whether the LP has withdrawn their position"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "Tracks the state of an epoch — a time-bounded period during which",
        "markets are created and settled. LPs can only withdraw after their",
        "epoch's markets have all settled."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "endTime",
            "type": "i64"
          },
          {
            "name": "totalLiquidityAdded",
            "type": "u64"
          },
          {
            "name": "totalLiquidityRemoved",
            "type": "u64"
          },
          {
            "name": "numMarkets",
            "type": "u16"
          },
          {
            "name": "numSettledMarkets",
            "type": "u16"
          },
          {
            "name": "allMarketsSettled",
            "type": "bool"
          },
          {
            "name": "withdrawalsEnabled",
            "type": "bool"
          },
          {
            "name": "lpSharesAtClose",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "docs": [
        "Simplified GlobalConfig for fixed odds sports betting"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "publicKey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "oraclePubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxMarketExposure",
            "type": "u64"
          },
          {
            "name": "lockedPayouts",
            "type": "u64"
          },
          {
            "name": "totalLpSupply",
            "type": "u64"
          },
          {
            "name": "lpMint",
            "type": "publicKey"
          },
          {
            "name": "baseMint",
            "type": "publicKey"
          },
          {
            "name": "treasury",
            "type": "publicKey"
          },
          {
            "name": "treasuryBump",
            "type": "u8"
          },
          {
            "name": "nextMarketId",
            "type": "u64"
          },
          {
            "name": "challengeWindowSeconds",
            "type": "i64"
          },
          {
            "name": "settlementDeadlineSeconds",
            "type": "i64"
          },
          {
            "name": "minFirstLiquidity",
            "type": "u64"
          },
          {
            "name": "nextSlipId",
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "type": "u64"
          },
          {
            "name": "epochDurationSeconds",
            "type": "i64"
          },
          {
            "name": "withdrawalCooldownSeconds",
            "type": "i64"
          },
          {
            "name": "maxSingleBet",
            "type": "u64"
          },
          {
            "name": "minOddsBps",
            "type": "u64"
          },
          {
            "name": "maxOddsBps",
            "type": "u64"
          },
          {
            "name": "houseFeeBps",
            "type": "u64"
          },
          {
            "name": "operators",
            "type": {
              "array": [
                "publicKey",
                8
              ]
            }
          },
          {
            "name": "numOperators",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "nextOrderId",
            "type": "u64"
          },
          {
            "name": "orderCollateralLocked",
            "type": "u64"
          },
          {
            "name": "epochPaused",
            "type": "bool"
          },
          {
            "name": "nextEpochStart",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketGroup",
      "docs": [
        "MarketGroup with correlation matrix for LP protection.",
        "Each market (1X2, O/U, GG/NG) settles independently with its own oracle submission.",
        "Correlation matrix reduces bonus/payout for correlated leg combinations."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "groupId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "publicKey"
          },
          {
            "name": "totalGroupExposure",
            "type": "u64"
          },
          {
            "name": "maxGroupExposure",
            "type": "u64"
          },
          {
            "name": "numMarkets",
            "type": "u8"
          },
          {
            "name": "marketIds",
            "docs": [
              "Market IDs in order: 1X2(0), O/U(1), GG/NG(2)"
            ],
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "eventStartTime",
            "type": "i64"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "correlationMatrix",
            "docs": [
              "Correlation matrix between markets in this group"
            ],
            "type": {
              "defined": "CorrelationMatrix"
            }
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "Simplified Market for fixed odds sports betting",
        "Odds are stored as basis points (e.g., 200 = 2.00x payout)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "publicKey"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": "MarketStatus"
            }
          },
          {
            "name": "numOutcomes",
            "type": "u8"
          },
          {
            "name": "odds",
            "docs": [
              "Fixed odds per outcome in basis points (10000 = 1.0x, 20000 = 2.0x)",
              "For 1X2: [home_odds, draw_odds, away_odds]",
              "For O/U: [over_odds, under_odds]",
              "For GG/NG: [gg_odds, ng_odds]"
            ],
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "exposure",
            "type": "u64"
          },
          {
            "name": "settlementTime",
            "type": "i64"
          },
          {
            "name": "winningOutcome",
            "type": "u8"
          },
          {
            "name": "outcomeMints",
            "type": {
              "array": [
                "publicKey",
                8
              ]
            }
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "marketType",
            "type": {
              "defined": "MarketType"
            }
          },
          {
            "name": "category",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "groupId",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "settledInEpoch",
            "type": "bool"
          },
          {
            "name": "txlineFixtureId",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "txlineProofVerified",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "limitOrder",
      "docs": [
        "A peer-to-peer limit order for outcome tokens.",
        "",
        "Sell orders: creator locks outcome tokens in escrow at placement.",
        "Buy orders:  creator locks USDC collateral in treasury at placement.",
        "Either side can be partially filled. The creator can cancel at any time",
        "to recover locked assets. Anyone can expire an order past its deadline."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "publicKey"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "outcomeId",
            "type": "u8"
          },
          {
            "name": "side",
            "type": {
              "defined": "OrderSide"
            }
          },
          {
            "name": "numShares",
            "type": "u64"
          },
          {
            "name": "filledShares",
            "type": "u64"
          },
          {
            "name": "pricePerShare",
            "type": "u64"
          },
          {
            "name": "collateralLocked",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": "OrderStatus"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pendingLiquidity",
      "docs": [
        "Tracks LP shares that are minted but locked until activation_time.",
        "Shares count toward total_lp_supply from deposit time (invariant-safe),",
        "but cannot be used for withdrawal until the activation delay passes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lp",
            "type": "publicKey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "activationTime",
            "type": "i64"
          },
          {
            "name": "amountDeposited",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawalRequest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lp",
            "type": "publicKey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "requestedAt",
            "type": "i64"
          },
          {
            "name": "cooldownEnd",
            "type": "i64"
          },
          {
            "name": "navSnapshot",
            "type": "u64"
          },
          {
            "name": "sharePriceSnapshot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "ProofNode",
      "docs": [
        "Proof node for Merkle proof validation"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "isRightSibling",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ScoresUpdateStats",
      "docs": [
        "TxLINE proof payload types. These mirror the pinned devnet IDL."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "updateCount",
            "type": "i32"
          },
          {
            "name": "minTimestamp",
            "type": "i64"
          },
          {
            "name": "maxTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ScoresBatchSummary",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "updateStats",
            "type": {
              "defined": "ScoresUpdateStats"
            }
          },
          {
            "name": "eventsSubtreeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ScoreStat",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "u32"
          },
          {
            "name": "value",
            "type": "i32"
          },
          {
            "name": "period",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "StatLeaf",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stat",
            "type": {
              "defined": "ScoreStat"
            }
          },
          {
            "name": "statProof",
            "type": {
              "vec": {
                "defined": "ProofNode"
              }
            }
          }
        ]
      }
    },
    {
      "name": "StatValidationInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "fixtureSummary",
            "type": {
              "defined": "ScoresBatchSummary"
            }
          },
          {
            "name": "fixtureProof",
            "type": {
              "vec": {
                "defined": "ProofNode"
              }
            }
          },
          {
            "name": "mainTreeProof",
            "type": {
              "vec": {
                "defined": "ProofNode"
              }
            }
          },
          {
            "name": "eventStatRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "stats",
            "type": {
              "vec": {
                "defined": "StatLeaf"
              }
            }
          }
        ]
      }
    },
    {
      "name": "GeometricTarget",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "statIndex",
            "type": "u8"
          },
          {
            "name": "prediction",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "TraderPredicate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "threshold",
            "type": "i32"
          },
          {
            "name": "comparison",
            "type": {
              "defined": "Comparison"
            }
          }
        ]
      }
    },
    {
      "name": "NDimensionalStrategy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "geometricTargets",
            "type": {
              "vec": {
                "defined": "GeometricTarget"
              }
            }
          },
          {
            "name": "distancePredicate",
            "type": {
              "option": {
                "defined": "TraderPredicate"
              }
            }
          },
          {
            "name": "discretePredicates",
            "type": {
              "vec": {
                "defined": "StatPredicate"
              }
            }
          }
        ]
      }
    },
    {
      "name": "SlipLeg",
      "docs": [
        "Input struct for slip legs - used when placing a slip"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "outcomeId",
            "type": "u8"
          },
          {
            "name": "numShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CorrelationMatrix",
      "docs": [
        "Default correlation matrix for soccer markets (basis points).",
        "Same-market outcomes are 0 (mutually exclusive within same market).",
        "Cross-market correlations are empirical estimates."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "correlations",
            "docs": [
              "Correlation scores as basis points (0-10000).",
              "Stored as upper triangle: [1X2↔OU, 1X2↔GGNG, OU↔GGNG]",
              "Index mapping: [0]=1X2↔OU, [1]=1X2↔GGNG, [2]=OU↔GGNG"
            ],
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "Comparison",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "GreaterThan"
          },
          {
            "name": "LessThan"
          },
          {
            "name": "EqualTo"
          }
        ]
      }
    },
    {
      "name": "BinaryExpression",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Add"
          },
          {
            "name": "Subtract"
          }
        ]
      }
    },
    {
      "name": "StatPredicate",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Single",
            "fields": [
              {
                "name": "index",
                "type": "u8"
              },
              {
                "name": "predicate",
                "type": {
                  "defined": "TraderPredicate"
                }
              }
            ]
          },
          {
            "name": "Binary",
            "fields": [
              {
                "name": "index_a",
                "type": "u8"
              },
              {
                "name": "index_b",
                "type": "u8"
              },
              {
                "name": "op",
                "type": {
                  "defined": "BinaryExpression"
                }
              },
              {
                "name": "predicate",
                "type": {
                  "defined": "TraderPredicate"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "SlipStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Pending"
          },
          {
            "name": "Active"
          },
          {
            "name": "Won"
          },
          {
            "name": "Lost"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    },
    {
      "name": "MarketStatus",
      "docs": [
        "Market status - simplified for fixed odds sports betting"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Suspended"
          },
          {
            "name": "AwaitingResult"
          },
          {
            "name": "Proposed"
          },
          {
            "name": "Settled"
          },
          {
            "name": "Voided"
          }
        ]
      }
    },
    {
      "name": "MarketType",
      "docs": [
        "Market type for categorization"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "OneXTwo"
          },
          {
            "name": "OverUnder"
          },
          {
            "name": "GoalNoGoal"
          }
        ]
      }
    },
    {
      "name": "OrderSide",
      "docs": [
        "Which side of the order book the creator is on."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Sell"
          },
          {
            "name": "Buy"
          }
        ]
      }
    },
    {
      "name": "OrderStatus",
      "docs": [
        "Lifecycle state of a limit order."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "PartiallyFilled"
          },
          {
            "name": "Filled"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "EpochPublished",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        },
        {
          "name": "startTime",
          "type": "i64",
          "index": false
        },
        {
          "name": "endTime",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "EpochLiquidityOptedIn",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        },
        {
          "name": "lp",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "amount",
          "type": "u64",
          "index": false
        },
        {
          "name": "sharesMinted",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "EpochLiquidityWithdrawn",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        },
        {
          "name": "lp",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "sharesBurned",
          "type": "u64",
          "index": false
        },
        {
          "name": "amountWithdrawn",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "EpochWithdrawalsEnabled",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "MarketSettledWithProof",
      "fields": [
        {
          "name": "marketId",
          "type": "u64",
          "index": false
        },
        {
          "name": "winningOutcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "txlineFixtureId",
          "type": "u64",
          "index": false
        },
        {
          "name": "validationTimestamp",
          "type": "i64",
          "index": false
        },
        {
          "name": "homeScore",
          "type": "i64",
          "index": false
        },
        {
          "name": "awayScore",
          "type": "i64",
          "index": false
        },
        {
          "name": "caller",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "SlipAwaited",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "owner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "numLegs",
          "type": "u8",
          "index": false
        },
        {
          "name": "stake",
          "type": "u64",
          "index": false
        },
        {
          "name": "cancelDeadline",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "SlipLegBought",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "legIndex",
          "type": "u8",
          "index": false
        },
        {
          "name": "marketId",
          "type": "u64",
          "index": false
        },
        {
          "name": "outcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "stake",
          "type": "u64",
          "index": false
        },
        {
          "name": "payout",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "SlipCancelled",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "owner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "refund",
          "type": "u64",
          "index": false
        },
        {
          "name": "legsBought",
          "type": "u32",
          "index": false
        }
      ]
    },
    {
      "name": "SlipLegSettled",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "legIndex",
          "type": "u8",
          "index": false
        },
        {
          "name": "marketId",
          "type": "u64",
          "index": false
        },
        {
          "name": "outcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "winningOutcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "won",
          "type": "bool",
          "index": false
        }
      ]
    },
    {
      "name": "SlipResolved",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "owner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "status",
          "type": "string",
          "index": false
        },
        {
          "name": "payout",
          "type": "u64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "Unauthorized",
      "msg": "Not authorized"
    },
    {
      "code": 6001,
      "name": "Paused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6002,
      "name": "InvalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6003,
      "name": "InsufficientLiquidity",
      "msg": "Insufficient liquidity"
    },
    {
      "code": 6004,
      "name": "MathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6005,
      "name": "MathUnderflow",
      "msg": "Math underflow"
    },
    {
      "code": 6100,
      "name": "MarketNotOpen",
      "msg": "Market not open for trading"
    },
    {
      "code": 6101,
      "name": "MarketAlreadyStarted",
      "msg": "Market has already started"
    },
    {
      "code": 6102,
      "name": "InvalidOutcomeId",
      "msg": "Invalid outcome ID"
    },
    {
      "code": 6103,
      "name": "MaxExposureReached",
      "msg": "Maximum exposure reached"
    },
    {
      "code": 6104,
      "name": "MarketAlreadySettled",
      "msg": "Market already settled"
    },
    {
      "code": 6105,
      "name": "InvalidNumOutcomes",
      "msg": "Invalid number of outcomes"
    },
    {
      "code": 6106,
      "name": "MarketNotSettled",
      "msg": "Market not settled"
    },
    {
      "code": 6108,
      "name": "MarketNotVoidable",
      "msg": "Market not voidable"
    },
    {
      "code": 6109,
      "name": "InvalidMarketStatus",
      "msg": "Invalid market status for this operation"
    },
    {
      "code": 6110,
      "name": "MarketExpired",
      "msg": "Market has expired for new positions"
    },
    {
      "code": 6111,
      "name": "SettlementDeadlineNotPassed",
      "msg": "Market settlement deadline has not passed"
    },
    {
      "code": 6200,
      "name": "InsufficientShares",
      "msg": "Insufficient shares to sell"
    },
    {
      "code": 6201,
      "name": "SlippageExceeded",
      "msg": "Slippage exceeded: minimum shares not received"
    },
    {
      "code": 6202,
      "name": "LmsrCostExceedsMax",
      "msg": "Trade cost exceeds maximum payment"
    },
    {
      "code": 6203,
      "name": "LmsrSellBelowMin",
      "msg": "Trade sell price below minimum"
    },
    {
      "code": 6204,
      "name": "BetTooLarge",
      "msg": "Bet size exceeds maximum allowed"
    },
    {
      "code": 6205,
      "name": "OddsFloor",
      "msg": "Outcome probability is below the minimum floor — odds too short"
    },
    {
      "code": 6300,
      "name": "ChallengeWindowActive",
      "msg": "Challenge window still active"
    },
    {
      "code": 6301,
      "name": "ChallengeWindowExpired",
      "msg": "Challenge window has expired"
    },
    {
      "code": 6305,
      "name": "InvalidProposedOutcome",
      "msg": "Invalid proposed outcome"
    },
    {
      "code": 6400,
      "name": "AmountTooSmall",
      "msg": "Amount too small for first deposit"
    },
    {
      "code": 6401,
      "name": "InsufficientLpShares",
      "msg": "Insufficient LP shares"
    },
    {
      "code": 6402,
      "name": "WithdrawalAlreadyExists",
      "msg": "Withdrawal request already exists"
    },
    {
      "code": 6403,
      "name": "NoWithdrawalRequest",
      "msg": "No withdrawal request found"
    },
    {
      "code": 6404,
      "name": "InsufficientFreeLiquidity",
      "msg": "Insufficient free liquidity for withdrawal"
    },
    {
      "code": 6405,
      "name": "CooldownNotElapsed",
      "msg": "Withdrawal cooldown has not elapsed"
    },
    {
      "code": 6406,
      "name": "NoPendingLiquidity",
      "msg": "No pending liquidity to activate"
    },
    {
      "code": 6407,
      "name": "SharesStillLocked",
      "msg": "LP shares are still locked pending activation"
    },
    {
      "code": 6500,
      "name": "NoWinningPositions",
      "msg": "No winning positions to claim"
    },
    {
      "code": 6501,
      "name": "PayoutAlreadyClaimed",
      "msg": "Payout already claimed"
    },
    {
      "code": 6502,
      "name": "WrongOutcomeToken",
      "msg": "Wrong outcome token for claim"
    },
    {
      "code": 6600,
      "name": "SwapBelowMinimum",
      "msg": "Swap amount below minimum"
    },
    {
      "code": 6601,
      "name": "SwapFailed",
      "msg": "Swap failed"
    },
    {
      "code": 6700,
      "name": "MarketGroupNotFound",
      "msg": "Market group not found"
    },
    {
      "code": 6701,
      "name": "MarketAlreadyInGroup",
      "msg": "Market already belongs to a group"
    },
    {
      "code": 6702,
      "name": "MarketGroupFull",
      "msg": "Market group is full"
    },
    {
      "code": 6703,
      "name": "CorrelationOutOfBounds",
      "msg": "Correlation weight exceeds maximum"
    },
    {
      "code": 6704,
      "name": "GroupExposureExceeded",
      "msg": "Group exposure cap exceeded"
    },
    {
      "code": 6705,
      "name": "MarketNotInGroup",
      "msg": "Market is not in the specified group"
    },
    {
      "code": 6706,
      "name": "SlipNoLegs",
      "msg": "Bet slip has no legs"
    },
    {
      "code": 6707,
      "name": "SlipTooManyLegs",
      "msg": "Bet slip has too many legs"
    },
    {
      "code": 6708,
      "name": "SlipCostExceeded",
      "msg": "Bet slip cost exceeds maximum payment"
    },
    {
      "code": 6709,
      "name": "SlipNotSettled",
      "msg": "Bet slip not fully settled"
    },
    {
      "code": 6710,
      "name": "SlipAlreadyClaimed",
      "msg": "Bet slip already claimed"
    },
    {
      "code": 6711,
      "name": "CorrelationOverflow",
      "msg": "Correlation calculation overflow"
    },
    {
      "code": 6712,
      "name": "GroupEventStarted",
      "msg": "Market group event has started"
    },
    {
      "code": 6713,
      "name": "CorrelationMatrixLocked",
      "msg": "Correlation matrix is locked after first trade"
    },
    {
      "code": 6714,
      "name": "InvalidRemainingAccount",
      "msg": "Invalid account in remaining_accounts"
    },
    {
      "code": 6715,
      "name": "SlipLockUpdateFailed",
      "msg": "Slip lock update failed"
    },
    {
      "code": 6716,
      "name": "SlipPartiallyVoided",
      "msg": "Bet slip has a voided leg — refunding stake"
    },
    {
      "code": 6717,
      "name": "OperatorListFull",
      "msg": "Operator list is full"
    },
    {
      "code": 6718,
      "name": "OperatorNotFound",
      "msg": "Operator not found"
    },
    {
      "code": 6719,
      "name": "DirectTradingDisabled",
      "msg": "Direct share trading is disabled on fixed-odds markets"
    },
    {
      "code": 6720,
      "name": "OrderNotCancellable",
      "msg": "Order is not in a cancellable state"
    },
    {
      "code": 6721,
      "name": "OrderNotExpired",
      "msg": "Order has not expired"
    },
    {
      "code": 6725,
      "name": "OrderExpired",
      "msg": "Order has expired"
    },
    {
      "code": 6722,
      "name": "OrderNotFillable",
      "msg": "Order is not open for filling"
    },
    {
      "code": 6723,
      "name": "FillExceedsOrder",
      "msg": "Fill amount exceeds remaining order quantity"
    },
    {
      "code": 6724,
      "name": "SlipAlreadyCashedOut",
      "msg": "Bet slip has already been cashed out"
    },
    {
      "code": 6726,
      "name": "SlipExpired",
      "msg": "Bet slip has expired"
    },
    {
      "code": 6727,
      "name": "SlipNotExpired",
      "msg": "Bet slip has not expired yet"
    },
    {
      "code": 6800,
      "name": "EpochNotComplete",
      "msg": "Epoch has not completed — not all markets are settled"
    },
    {
      "code": 6801,
      "name": "EpochWithdrawalsNotEnabled",
      "msg": "Withdrawals are not yet enabled for this epoch"
    },
    {
      "code": 6802,
      "name": "EpochPaused",
      "msg": "Epoch is paused — no deposits or withdrawals allowed"
    },
    {
      "code": 6803,
      "name": "MarketEpochMismatch",
      "msg": "Market does not belong to the specified epoch"
    },
    {
      "code": 6804,
      "name": "EpochAccountMismatch",
      "msg": "Epoch account does not match the market's epoch"
    },
    {
      "code": 6805,
      "name": "NoActiveEpoch",
      "msg": "No active epoch — call init_epoch first"
    },
    {
      "code": 6806,
      "name": "NotPaused",
      "msg": "Bet is not refundable — protocol is not paused"
    },
    {
      "code": 6916,
      "name": "InvalidTxlineFixtureId",
      "msg": "Invalid TxLINE fixture ID"
    },
    {
      "code": 6917,
      "name": "TxlineProofValidationFailed",
      "msg": "TxLINE proof validation failed"
    },
    {
      "code": 6919,
      "name": "CorrelatedLegsMutuallyExclusive",
      "msg": "Legs from same market with different outcomes are mutually exclusive"
    }
  ]
};

export const IDL: QuadraticMarket = {
  "version": "0.1.0",
  "name": "quadratic_market",
  "instructions": [
    {
      "name": "initializeProtocol",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "oraclePubkey",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        },
        {
          "name": "maxMarketExposure",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initializeLpMint",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpMint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "transferAdmin",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "newAdmin",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "pause",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "unpause",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "updateConfig",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "maxMarketExposure",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "challengeWindowSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "settlementDeadlineSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "epochDurationSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "withdrawalCooldownSeconds",
          "type": {
            "option": "i64"
          }
        },
        {
          "name": "maxSingleBet",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "minOddsBps",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "maxOddsBps",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "houseFeeBps",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "oraclePubkey",
          "type": {
            "option": {
              "array": [
                "u8",
                32
              ]
            }
          }
        }
      ]
    },
    {
      "name": "addOperator",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "operator",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "removeOperator",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "operator",
          "type": "publicKey"
        }
      ]
    },
    {
      "name": "createMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false,
          "docs": [
            "Epoch account for the current epoch — must match global_config.current_epoch.",
            "Markets are always created under the active epoch so the epoch can track",
            "how many markets need to settle before LP withdrawals are unlocked."
          ]
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "startTime",
          "type": "i64"
        },
        {
          "name": "numOutcomes",
          "type": "u8"
        },
        {
          "name": "title",
          "type": "string"
        },
        {
          "name": "description",
          "type": "string"
        },
        {
          "name": "category",
          "type": "u8"
        },
        {
          "name": "marketType",
          "type": {
            "defined": "MarketType"
          }
        },
        {
          "name": "initialOdds",
          "type": {
            "vec": "u64"
          }
        },
        {
          "name": "txlineFixtureId",
          "type": {
            "option": "u64"
          }
        }
      ]
    },
    {
      "name": "initOutcomeMint",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "outcomeMint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "rent",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "outcomeId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "suspendMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "resumeMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "voidMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "voidIfExpired",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "settleMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "winningOutcome",
          "type": "u8"
        }
      ]
    },
    {
      "name": "settleWithProof",
      "docs": [
        "Settle market using TxLINE on-chain proof validation.",
        "Only authorized operators/admin can call this with valid proof data.",
        "",
        "Flow:",
        "1. Bot fetches proof from TxLINE API",
        "2. Bot calls this instruction with Txoracle payload + strategy",
        "3. Program validates proof via CPI to Txoracle",
        "4. Market is settled with the derived outcome"
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "dailyScoresMerkleRoots",
          "isMut": false,
          "isSigner": false,
          "docs": [
            "PDA for daily scores Merkle roots."
          ]
        },
        {
          "name": "txoracleProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "caller",
          "isMut": false,
          "isSigner": true,
          "docs": [
            "The caller (must be an admin or authorized operator)"
          ]
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "proposedOutcome",
          "type": "u8"
        },
        {
          "name": "txlineFixtureId",
          "type": "u64"
        },
        {
          "name": "validationTimestamp",
          "type": "i64"
        },
        {
          "name": "homeScore",
          "type": "i64"
        },
        {
          "name": "awayScore",
          "type": "i64"
        },
        {
          "name": "validationInput",
          "type": {
            "defined": "StatValidationInput"
          }
        },
        {
          "name": "strategy",
          "type": {
            "defined": "NDimensionalStrategy"
          }
        }
      ]
    },
    {
      "name": "claimPayout",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimerOutcomeAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "claimerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "outcomeMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "closeMarket",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "claimPausedBet",
      "docs": [
        "Refund a user's original stake when the protocol is paused."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "betSlip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "claimerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "createMarketGroup",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "marketGroup",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u64"
        },
        {
          "name": "maxGroupExposure",
          "type": "u64"
        },
        {
          "name": "eventStartTime",
          "type": "i64"
        },
        {
          "name": "title",
          "type": "string"
        }
      ]
    },
    {
      "name": "addMarketToGroup",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "marketGroup",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "groupId",
          "type": "u64"
        },
        {
          "name": "marketIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "updateMarketOdds",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "newOdds",
          "type": {
            "vec": "u64"
          }
        }
      ]
    },
    {
      "name": "updateMarketOddsWithProof",
      "docs": [
        "Update market odds after validating a TxLINE proof bundle on-chain."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "dailyScoresMerkleRoots",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "txoracleProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "newOdds",
          "type": {
            "vec": "u64"
          }
        },
        {
          "name": "validationInput",
          "type": {
            "defined": "StatValidationInput"
          }
        },
        {
          "name": "strategy",
          "type": {
            "defined": "NDimensionalStrategy"
          }
        }
      ]
    },
    {
      "name": "placeSlipAwait",
      "docs": [
        "Place slip await: escrows stake, records legs, locks fixed odds.",
        "Backend then fires N × buy_leg_for_slip."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "ownerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "legs",
          "type": {
            "vec": {
              "defined": "SlipLeg"
            }
          }
        },
        {
          "name": "stake",
          "type": "u64"
        },
        {
          "name": "cancelDeadline",
          "type": "i64"
        }
      ]
    },
    {
      "name": "buyLegForSlip",
      "docs": [
        "Buy one leg for slip. Backend calls this N times after place_slip_await."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "buyerOutcomeAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "outcomeMint",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "buyer",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        },
        {
          "name": "legIndex",
          "type": "u8"
        },
        {
          "name": "outcomeId",
          "type": "u8"
        }
      ]
    },
    {
      "name": "cancelSlip",
      "docs": [
        "Cancel slip if deadline passed or legs not bought."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "cancellerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "settleSlipLeg",
      "docs": [
        "Settle one leg of a slip. Permissionless."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "caller",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        },
        {
          "name": "legIndex",
          "type": "u8"
        }
      ]
    },
    {
      "name": "resolveSlip",
      "docs": [
        "Resolve slip: finalize payout after all legs settled."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "slip",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "owner",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "claimerBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "slipId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "placeOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "market",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "outcomeMint",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "marketId",
          "type": "u64"
        },
        {
          "name": "outcomeId",
          "type": "u8"
        },
        {
          "name": "side",
          "type": {
            "defined": "OrderSide"
          }
        },
        {
          "name": "numShares",
          "type": "u64"
        },
        {
          "name": "pricePerShare",
          "type": "u64"
        },
        {
          "name": "expiresAt",
          "type": "i64"
        }
      ]
    },
    {
      "name": "fillOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "fillerBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "fillerOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "filler",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        },
        {
          "name": "fillShares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "cancelOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "creator",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "expireOrder",
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "order",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "escrowOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorOutcomeAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "creatorBaseAta",
          "isMut": true,
          "isSigner": false,
          "isOptional": true
        },
        {
          "name": "treasuryBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "baseMint",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "caller",
          "isMut": true,
          "isSigner": true,
          "docs": [
            "Anyone can call expire — they receive the PDA rent."
          ]
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "orderId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "initEpoch",
      "docs": [
        "Create the on-chain Epoch account for the current epoch.",
        "Must be called before any markets can be created in a new epoch."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "startNextEpoch",
      "docs": [
        "Advance to the next active epoch and create its epoch vault."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "currentEpoch",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "nextEpoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "nextEpochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "nextEpochId",
          "type": "u64"
        }
      ]
    },
    {
      "name": "pauseEpoch",
      "docs": [
        "Pause epoch — blocks deposits, withdrawals, and market creation.",
        "Admin can pause at any time (e.g. between epochs or for emergency)."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "unpauseEpoch",
      "docs": [
        "Unpause epoch — re-enables deposits, withdrawals, and market creation."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "admin",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "closeEpoch",
      "docs": [
        "Manually close an epoch and enable LP withdrawals.",
        "Normally auto-triggered when the last market in the epoch settles."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": false,
          "isSigner": true
        }
      ],
      "args": []
    },
    {
      "name": "publishEpoch",
      "docs": [
        "Publish an epoch and its vault — announcement LPs see before opting in."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "authority",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        },
        {
          "name": "marketIds",
          "type": {
            "vec": "u64"
          }
        }
      ]
    },
    {
      "name": "optInEpochLiquidity",
      "docs": [
        "Opt into an epoch's liquidity pool."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpPosition",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lp",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "associatedTokenProgram",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "systemProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        },
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdrawEpochLiquidity",
      "docs": [
        "Withdraw liquidity after epoch settlement."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpPosition",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "lpBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultBaseAta",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVaultAuthority",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "lp",
          "isMut": false,
          "isSigner": true
        },
        {
          "name": "tokenProgram",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        },
        {
          "name": "shares",
          "type": "u64"
        }
      ]
    },
    {
      "name": "enableEpochWithdrawals",
      "docs": [
        "Enable withdrawals on an epoch vault (called when epoch settles)."
      ],
      "accounts": [
        {
          "name": "globalConfig",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epochVault",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "epoch",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "epochId",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "slip",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "type": "publicKey"
          },
          {
            "name": "slipId",
            "type": "u64"
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "numLegs",
            "type": "u8"
          },
          {
            "name": "legMarketIds",
            "type": {
              "array": [
                "u64",
                5
              ]
            }
          },
          {
            "name": "legOutcomeIds",
            "type": {
              "array": [
                "u8",
                5
              ]
            }
          },
          {
            "name": "legsBoughtMask",
            "type": "u16"
          },
          {
            "name": "legsSettledMask",
            "type": "u16"
          },
          {
            "name": "legsWonMask",
            "type": "u16"
          },
          {
            "name": "totalStake",
            "type": "u64"
          },
          {
            "name": "totalCost",
            "type": "u64"
          },
          {
            "name": "potentialPayout",
            "type": "u64"
          },
          {
            "name": "lockedAmount",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": "SlipStatus"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "cancelDeadline",
            "type": "i64"
          },
          {
            "name": "claimed",
            "type": "bool"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochVault",
      "docs": [
        "Tracks liquidity provided by LPs who opted into a specific epoch.",
        "Each epoch has its own vault, isolating capital and preventing cross-epoch contamination."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epochId",
            "docs": [
              "The epoch this vault belongs to"
            ],
            "type": "u64"
          },
          {
            "name": "totalDeposits",
            "docs": [
              "Total base tokens deposited by LPs who opted into this epoch"
            ],
            "type": "u64"
          },
          {
            "name": "totalWithdrawals",
            "docs": [
              "Total base tokens withdrawn by LPs after epoch settlement"
            ],
            "type": "u64"
          },
          {
            "name": "totalShares",
            "docs": [
              "Total LP shares minted for this epoch"
            ],
            "type": "u64"
          },
          {
            "name": "numLps",
            "docs": [
              "Number of LPs who have opted in"
            ],
            "type": "u32"
          },
          {
            "name": "createdAt",
            "docs": [
              "Timestamp when the epoch started"
            ],
            "type": "i64"
          },
          {
            "name": "closedAt",
            "docs": [
              "Timestamp when the epoch ended (set at close)"
            ],
            "type": "i64"
          },
          {
            "name": "withdrawalsEnabled",
            "docs": [
              "Whether withdrawals are enabled"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epochLpPosition",
      "docs": [
        "Tracks an individual LP's position in an epoch vault"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "The LP's public key"
            ],
            "type": "publicKey"
          },
          {
            "name": "epochId",
            "docs": [
              "The epoch this position belongs to"
            ],
            "type": "u64"
          },
          {
            "name": "shares",
            "docs": [
              "Number of LP shares held"
            ],
            "type": "u64"
          },
          {
            "name": "withdrawn",
            "docs": [
              "Whether the LP has withdrawn their position"
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "epoch",
      "docs": [
        "Tracks the state of an epoch — a time-bounded period during which",
        "markets are created and settled. LPs can only withdraw after their",
        "epoch's markets have all settled."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "endTime",
            "type": "i64"
          },
          {
            "name": "totalLiquidityAdded",
            "type": "u64"
          },
          {
            "name": "totalLiquidityRemoved",
            "type": "u64"
          },
          {
            "name": "numMarkets",
            "type": "u16"
          },
          {
            "name": "numSettledMarkets",
            "type": "u16"
          },
          {
            "name": "allMarketsSettled",
            "type": "bool"
          },
          {
            "name": "withdrawalsEnabled",
            "type": "bool"
          },
          {
            "name": "lpSharesAtClose",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "globalConfig",
      "docs": [
        "Simplified GlobalConfig for fixed odds sports betting"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "admin",
            "type": "publicKey"
          },
          {
            "name": "paused",
            "type": "bool"
          },
          {
            "name": "oraclePubkey",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "maxMarketExposure",
            "type": "u64"
          },
          {
            "name": "lockedPayouts",
            "type": "u64"
          },
          {
            "name": "totalLpSupply",
            "type": "u64"
          },
          {
            "name": "lpMint",
            "type": "publicKey"
          },
          {
            "name": "baseMint",
            "type": "publicKey"
          },
          {
            "name": "treasury",
            "type": "publicKey"
          },
          {
            "name": "treasuryBump",
            "type": "u8"
          },
          {
            "name": "nextMarketId",
            "type": "u64"
          },
          {
            "name": "challengeWindowSeconds",
            "type": "i64"
          },
          {
            "name": "settlementDeadlineSeconds",
            "type": "i64"
          },
          {
            "name": "minFirstLiquidity",
            "type": "u64"
          },
          {
            "name": "nextSlipId",
            "type": "u64"
          },
          {
            "name": "currentEpoch",
            "type": "u64"
          },
          {
            "name": "epochDurationSeconds",
            "type": "i64"
          },
          {
            "name": "withdrawalCooldownSeconds",
            "type": "i64"
          },
          {
            "name": "maxSingleBet",
            "type": "u64"
          },
          {
            "name": "minOddsBps",
            "type": "u64"
          },
          {
            "name": "maxOddsBps",
            "type": "u64"
          },
          {
            "name": "houseFeeBps",
            "type": "u64"
          },
          {
            "name": "operators",
            "type": {
              "array": [
                "publicKey",
                8
              ]
            }
          },
          {
            "name": "numOperators",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "nextOrderId",
            "type": "u64"
          },
          {
            "name": "orderCollateralLocked",
            "type": "u64"
          },
          {
            "name": "epochPaused",
            "type": "bool"
          },
          {
            "name": "nextEpochStart",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "marketGroup",
      "docs": [
        "MarketGroup with correlation matrix for LP protection.",
        "Each market (1X2, O/U, GG/NG) settles independently with its own oracle submission.",
        "Correlation matrix reduces bonus/payout for correlated leg combinations."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "groupId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "publicKey"
          },
          {
            "name": "totalGroupExposure",
            "type": "u64"
          },
          {
            "name": "maxGroupExposure",
            "type": "u64"
          },
          {
            "name": "numMarkets",
            "type": "u8"
          },
          {
            "name": "marketIds",
            "docs": [
              "Market IDs in order: 1X2(0), O/U(1), GG/NG(2)"
            ],
            "type": {
              "array": [
                "u64",
                3
              ]
            }
          },
          {
            "name": "eventStartTime",
            "type": "i64"
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "correlationMatrix",
            "docs": [
              "Correlation matrix between markets in this group"
            ],
            "type": {
              "defined": "CorrelationMatrix"
            }
          }
        ]
      }
    },
    {
      "name": "market",
      "docs": [
        "Simplified Market for fixed odds sports betting",
        "Odds are stored as basis points (e.g., 200 = 2.00x payout)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "publicKey"
          },
          {
            "name": "startTime",
            "type": "i64"
          },
          {
            "name": "status",
            "type": {
              "defined": "MarketStatus"
            }
          },
          {
            "name": "numOutcomes",
            "type": "u8"
          },
          {
            "name": "odds",
            "docs": [
              "Fixed odds per outcome in basis points (10000 = 1.0x, 20000 = 2.0x)",
              "For 1X2: [home_odds, draw_odds, away_odds]",
              "For O/U: [over_odds, under_odds]",
              "For GG/NG: [gg_odds, ng_odds]"
            ],
            "type": {
              "array": [
                "u64",
                8
              ]
            }
          },
          {
            "name": "exposure",
            "type": "u64"
          },
          {
            "name": "settlementTime",
            "type": "i64"
          },
          {
            "name": "winningOutcome",
            "type": "u8"
          },
          {
            "name": "outcomeMints",
            "type": {
              "array": [
                "publicKey",
                8
              ]
            }
          },
          {
            "name": "title",
            "type": "string"
          },
          {
            "name": "description",
            "type": "string"
          },
          {
            "name": "marketType",
            "type": {
              "defined": "MarketType"
            }
          },
          {
            "name": "category",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          },
          {
            "name": "groupId",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "epochId",
            "type": "u64"
          },
          {
            "name": "settledInEpoch",
            "type": "bool"
          },
          {
            "name": "txlineFixtureId",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "txlineProofVerified",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "limitOrder",
      "docs": [
        "A peer-to-peer limit order for outcome tokens.",
        "",
        "Sell orders: creator locks outcome tokens in escrow at placement.",
        "Buy orders:  creator locks USDC collateral in treasury at placement.",
        "Either side can be partially filled. The creator can cancel at any time",
        "to recover locked assets. Anyone can expire an order past its deadline."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "orderId",
            "type": "u64"
          },
          {
            "name": "creator",
            "type": "publicKey"
          },
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "outcomeId",
            "type": "u8"
          },
          {
            "name": "side",
            "type": {
              "defined": "OrderSide"
            }
          },
          {
            "name": "numShares",
            "type": "u64"
          },
          {
            "name": "filledShares",
            "type": "u64"
          },
          {
            "name": "pricePerShare",
            "type": "u64"
          },
          {
            "name": "collateralLocked",
            "type": "u64"
          },
          {
            "name": "status",
            "type": {
              "defined": "OrderStatus"
            }
          },
          {
            "name": "createdAt",
            "type": "i64"
          },
          {
            "name": "expiresAt",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "pendingLiquidity",
      "docs": [
        "Tracks LP shares that are minted but locked until activation_time.",
        "Shares count toward total_lp_supply from deposit time (invariant-safe),",
        "but cannot be used for withdrawal until the activation delay passes."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lp",
            "type": "publicKey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "activationTime",
            "type": "i64"
          },
          {
            "name": "amountDeposited",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "withdrawalRequest",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "lp",
            "type": "publicKey"
          },
          {
            "name": "shares",
            "type": "u64"
          },
          {
            "name": "requestedAt",
            "type": "i64"
          },
          {
            "name": "cooldownEnd",
            "type": "i64"
          },
          {
            "name": "navSnapshot",
            "type": "u64"
          },
          {
            "name": "sharePriceSnapshot",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "types": [
    {
      "name": "ProofNode",
      "docs": [
        "Proof node for Merkle proof validation"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "hash",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "isRightSibling",
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "ScoresUpdateStats",
      "docs": [
        "TxLINE proof payload types. These mirror the pinned devnet IDL."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "updateCount",
            "type": "i32"
          },
          {
            "name": "minTimestamp",
            "type": "i64"
          },
          {
            "name": "maxTimestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ScoresBatchSummary",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "fixtureId",
            "type": "i64"
          },
          {
            "name": "updateStats",
            "type": {
              "defined": "ScoresUpdateStats"
            }
          },
          {
            "name": "eventsSubtreeRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          }
        ]
      }
    },
    {
      "name": "ScoreStat",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "key",
            "type": "u32"
          },
          {
            "name": "value",
            "type": "i32"
          },
          {
            "name": "period",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "StatLeaf",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "stat",
            "type": {
              "defined": "ScoreStat"
            }
          },
          {
            "name": "statProof",
            "type": {
              "vec": {
                "defined": "ProofNode"
              }
            }
          }
        ]
      }
    },
    {
      "name": "StatValidationInput",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "ts",
            "type": "i64"
          },
          {
            "name": "fixtureSummary",
            "type": {
              "defined": "ScoresBatchSummary"
            }
          },
          {
            "name": "fixtureProof",
            "type": {
              "vec": {
                "defined": "ProofNode"
              }
            }
          },
          {
            "name": "mainTreeProof",
            "type": {
              "vec": {
                "defined": "ProofNode"
              }
            }
          },
          {
            "name": "eventStatRoot",
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "stats",
            "type": {
              "vec": {
                "defined": "StatLeaf"
              }
            }
          }
        ]
      }
    },
    {
      "name": "GeometricTarget",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "statIndex",
            "type": "u8"
          },
          {
            "name": "prediction",
            "type": "i32"
          }
        ]
      }
    },
    {
      "name": "TraderPredicate",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "threshold",
            "type": "i32"
          },
          {
            "name": "comparison",
            "type": {
              "defined": "Comparison"
            }
          }
        ]
      }
    },
    {
      "name": "NDimensionalStrategy",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "geometricTargets",
            "type": {
              "vec": {
                "defined": "GeometricTarget"
              }
            }
          },
          {
            "name": "distancePredicate",
            "type": {
              "option": {
                "defined": "TraderPredicate"
              }
            }
          },
          {
            "name": "discretePredicates",
            "type": {
              "vec": {
                "defined": "StatPredicate"
              }
            }
          }
        ]
      }
    },
    {
      "name": "SlipLeg",
      "docs": [
        "Input struct for slip legs - used when placing a slip"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "marketId",
            "type": "u64"
          },
          {
            "name": "outcomeId",
            "type": "u8"
          },
          {
            "name": "numShares",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "CorrelationMatrix",
      "docs": [
        "Default correlation matrix for soccer markets (basis points).",
        "Same-market outcomes are 0 (mutually exclusive within same market).",
        "Cross-market correlations are empirical estimates."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "correlations",
            "docs": [
              "Correlation scores as basis points (0-10000).",
              "Stored as upper triangle: [1X2↔OU, 1X2↔GGNG, OU↔GGNG]",
              "Index mapping: [0]=1X2↔OU, [1]=1X2↔GGNG, [2]=OU↔GGNG"
            ],
            "type": {
              "array": [
                "u16",
                3
              ]
            }
          }
        ]
      }
    },
    {
      "name": "Comparison",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "GreaterThan"
          },
          {
            "name": "LessThan"
          },
          {
            "name": "EqualTo"
          }
        ]
      }
    },
    {
      "name": "BinaryExpression",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Add"
          },
          {
            "name": "Subtract"
          }
        ]
      }
    },
    {
      "name": "StatPredicate",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Single",
            "fields": [
              {
                "name": "index",
                "type": "u8"
              },
              {
                "name": "predicate",
                "type": {
                  "defined": "TraderPredicate"
                }
              }
            ]
          },
          {
            "name": "Binary",
            "fields": [
              {
                "name": "index_a",
                "type": "u8"
              },
              {
                "name": "index_b",
                "type": "u8"
              },
              {
                "name": "op",
                "type": {
                  "defined": "BinaryExpression"
                }
              },
              {
                "name": "predicate",
                "type": {
                  "defined": "TraderPredicate"
                }
              }
            ]
          }
        ]
      }
    },
    {
      "name": "SlipStatus",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Pending"
          },
          {
            "name": "Active"
          },
          {
            "name": "Won"
          },
          {
            "name": "Lost"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    },
    {
      "name": "MarketStatus",
      "docs": [
        "Market status - simplified for fixed odds sports betting"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "Suspended"
          },
          {
            "name": "AwaitingResult"
          },
          {
            "name": "Proposed"
          },
          {
            "name": "Settled"
          },
          {
            "name": "Voided"
          }
        ]
      }
    },
    {
      "name": "MarketType",
      "docs": [
        "Market type for categorization"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "OneXTwo"
          },
          {
            "name": "OverUnder"
          },
          {
            "name": "GoalNoGoal"
          }
        ]
      }
    },
    {
      "name": "OrderSide",
      "docs": [
        "Which side of the order book the creator is on."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Sell"
          },
          {
            "name": "Buy"
          }
        ]
      }
    },
    {
      "name": "OrderStatus",
      "docs": [
        "Lifecycle state of a limit order."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Open"
          },
          {
            "name": "PartiallyFilled"
          },
          {
            "name": "Filled"
          },
          {
            "name": "Cancelled"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "EpochPublished",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        },
        {
          "name": "startTime",
          "type": "i64",
          "index": false
        },
        {
          "name": "endTime",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "EpochLiquidityOptedIn",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        },
        {
          "name": "lp",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "amount",
          "type": "u64",
          "index": false
        },
        {
          "name": "sharesMinted",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "EpochLiquidityWithdrawn",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        },
        {
          "name": "lp",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "sharesBurned",
          "type": "u64",
          "index": false
        },
        {
          "name": "amountWithdrawn",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "EpochWithdrawalsEnabled",
      "fields": [
        {
          "name": "epochId",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "MarketSettledWithProof",
      "fields": [
        {
          "name": "marketId",
          "type": "u64",
          "index": false
        },
        {
          "name": "winningOutcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "txlineFixtureId",
          "type": "u64",
          "index": false
        },
        {
          "name": "validationTimestamp",
          "type": "i64",
          "index": false
        },
        {
          "name": "homeScore",
          "type": "i64",
          "index": false
        },
        {
          "name": "awayScore",
          "type": "i64",
          "index": false
        },
        {
          "name": "caller",
          "type": "publicKey",
          "index": false
        }
      ]
    },
    {
      "name": "SlipAwaited",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "owner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "numLegs",
          "type": "u8",
          "index": false
        },
        {
          "name": "stake",
          "type": "u64",
          "index": false
        },
        {
          "name": "cancelDeadline",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "SlipLegBought",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "legIndex",
          "type": "u8",
          "index": false
        },
        {
          "name": "marketId",
          "type": "u64",
          "index": false
        },
        {
          "name": "outcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "stake",
          "type": "u64",
          "index": false
        },
        {
          "name": "payout",
          "type": "u64",
          "index": false
        }
      ]
    },
    {
      "name": "SlipCancelled",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "owner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "refund",
          "type": "u64",
          "index": false
        },
        {
          "name": "legsBought",
          "type": "u32",
          "index": false
        }
      ]
    },
    {
      "name": "SlipLegSettled",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "legIndex",
          "type": "u8",
          "index": false
        },
        {
          "name": "marketId",
          "type": "u64",
          "index": false
        },
        {
          "name": "outcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "winningOutcome",
          "type": "u8",
          "index": false
        },
        {
          "name": "won",
          "type": "bool",
          "index": false
        }
      ]
    },
    {
      "name": "SlipResolved",
      "fields": [
        {
          "name": "slipId",
          "type": "u64",
          "index": false
        },
        {
          "name": "owner",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "status",
          "type": "string",
          "index": false
        },
        {
          "name": "payout",
          "type": "u64",
          "index": false
        }
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "Unauthorized",
      "msg": "Not authorized"
    },
    {
      "code": 6001,
      "name": "Paused",
      "msg": "Protocol is paused"
    },
    {
      "code": 6002,
      "name": "InvalidAmount",
      "msg": "Invalid amount"
    },
    {
      "code": 6003,
      "name": "InsufficientLiquidity",
      "msg": "Insufficient liquidity"
    },
    {
      "code": 6004,
      "name": "MathOverflow",
      "msg": "Math overflow"
    },
    {
      "code": 6005,
      "name": "MathUnderflow",
      "msg": "Math underflow"
    },
    {
      "code": 6100,
      "name": "MarketNotOpen",
      "msg": "Market not open for trading"
    },
    {
      "code": 6101,
      "name": "MarketAlreadyStarted",
      "msg": "Market has already started"
    },
    {
      "code": 6102,
      "name": "InvalidOutcomeId",
      "msg": "Invalid outcome ID"
    },
    {
      "code": 6103,
      "name": "MaxExposureReached",
      "msg": "Maximum exposure reached"
    },
    {
      "code": 6104,
      "name": "MarketAlreadySettled",
      "msg": "Market already settled"
    },
    {
      "code": 6105,
      "name": "InvalidNumOutcomes",
      "msg": "Invalid number of outcomes"
    },
    {
      "code": 6106,
      "name": "MarketNotSettled",
      "msg": "Market not settled"
    },
    {
      "code": 6108,
      "name": "MarketNotVoidable",
      "msg": "Market not voidable"
    },
    {
      "code": 6109,
      "name": "InvalidMarketStatus",
      "msg": "Invalid market status for this operation"
    },
    {
      "code": 6110,
      "name": "MarketExpired",
      "msg": "Market has expired for new positions"
    },
    {
      "code": 6111,
      "name": "SettlementDeadlineNotPassed",
      "msg": "Market settlement deadline has not passed"
    },
    {
      "code": 6200,
      "name": "InsufficientShares",
      "msg": "Insufficient shares to sell"
    },
    {
      "code": 6201,
      "name": "SlippageExceeded",
      "msg": "Slippage exceeded: minimum shares not received"
    },
    {
      "code": 6202,
      "name": "LmsrCostExceedsMax",
      "msg": "Trade cost exceeds maximum payment"
    },
    {
      "code": 6203,
      "name": "LmsrSellBelowMin",
      "msg": "Trade sell price below minimum"
    },
    {
      "code": 6204,
      "name": "BetTooLarge",
      "msg": "Bet size exceeds maximum allowed"
    },
    {
      "code": 6205,
      "name": "OddsFloor",
      "msg": "Outcome probability is below the minimum floor — odds too short"
    },
    {
      "code": 6300,
      "name": "ChallengeWindowActive",
      "msg": "Challenge window still active"
    },
    {
      "code": 6301,
      "name": "ChallengeWindowExpired",
      "msg": "Challenge window has expired"
    },
    {
      "code": 6305,
      "name": "InvalidProposedOutcome",
      "msg": "Invalid proposed outcome"
    },
    {
      "code": 6400,
      "name": "AmountTooSmall",
      "msg": "Amount too small for first deposit"
    },
    {
      "code": 6401,
      "name": "InsufficientLpShares",
      "msg": "Insufficient LP shares"
    },
    {
      "code": 6402,
      "name": "WithdrawalAlreadyExists",
      "msg": "Withdrawal request already exists"
    },
    {
      "code": 6403,
      "name": "NoWithdrawalRequest",
      "msg": "No withdrawal request found"
    },
    {
      "code": 6404,
      "name": "InsufficientFreeLiquidity",
      "msg": "Insufficient free liquidity for withdrawal"
    },
    {
      "code": 6405,
      "name": "CooldownNotElapsed",
      "msg": "Withdrawal cooldown has not elapsed"
    },
    {
      "code": 6406,
      "name": "NoPendingLiquidity",
      "msg": "No pending liquidity to activate"
    },
    {
      "code": 6407,
      "name": "SharesStillLocked",
      "msg": "LP shares are still locked pending activation"
    },
    {
      "code": 6500,
      "name": "NoWinningPositions",
      "msg": "No winning positions to claim"
    },
    {
      "code": 6501,
      "name": "PayoutAlreadyClaimed",
      "msg": "Payout already claimed"
    },
    {
      "code": 6502,
      "name": "WrongOutcomeToken",
      "msg": "Wrong outcome token for claim"
    },
    {
      "code": 6600,
      "name": "SwapBelowMinimum",
      "msg": "Swap amount below minimum"
    },
    {
      "code": 6601,
      "name": "SwapFailed",
      "msg": "Swap failed"
    },
    {
      "code": 6700,
      "name": "MarketGroupNotFound",
      "msg": "Market group not found"
    },
    {
      "code": 6701,
      "name": "MarketAlreadyInGroup",
      "msg": "Market already belongs to a group"
    },
    {
      "code": 6702,
      "name": "MarketGroupFull",
      "msg": "Market group is full"
    },
    {
      "code": 6703,
      "name": "CorrelationOutOfBounds",
      "msg": "Correlation weight exceeds maximum"
    },
    {
      "code": 6704,
      "name": "GroupExposureExceeded",
      "msg": "Group exposure cap exceeded"
    },
    {
      "code": 6705,
      "name": "MarketNotInGroup",
      "msg": "Market is not in the specified group"
    },
    {
      "code": 6706,
      "name": "SlipNoLegs",
      "msg": "Bet slip has no legs"
    },
    {
      "code": 6707,
      "name": "SlipTooManyLegs",
      "msg": "Bet slip has too many legs"
    },
    {
      "code": 6708,
      "name": "SlipCostExceeded",
      "msg": "Bet slip cost exceeds maximum payment"
    },
    {
      "code": 6709,
      "name": "SlipNotSettled",
      "msg": "Bet slip not fully settled"
    },
    {
      "code": 6710,
      "name": "SlipAlreadyClaimed",
      "msg": "Bet slip already claimed"
    },
    {
      "code": 6711,
      "name": "CorrelationOverflow",
      "msg": "Correlation calculation overflow"
    },
    {
      "code": 6712,
      "name": "GroupEventStarted",
      "msg": "Market group event has started"
    },
    {
      "code": 6713,
      "name": "CorrelationMatrixLocked",
      "msg": "Correlation matrix is locked after first trade"
    },
    {
      "code": 6714,
      "name": "InvalidRemainingAccount",
      "msg": "Invalid account in remaining_accounts"
    },
    {
      "code": 6715,
      "name": "SlipLockUpdateFailed",
      "msg": "Slip lock update failed"
    },
    {
      "code": 6716,
      "name": "SlipPartiallyVoided",
      "msg": "Bet slip has a voided leg — refunding stake"
    },
    {
      "code": 6717,
      "name": "OperatorListFull",
      "msg": "Operator list is full"
    },
    {
      "code": 6718,
      "name": "OperatorNotFound",
      "msg": "Operator not found"
    },
    {
      "code": 6719,
      "name": "DirectTradingDisabled",
      "msg": "Direct share trading is disabled on fixed-odds markets"
    },
    {
      "code": 6720,
      "name": "OrderNotCancellable",
      "msg": "Order is not in a cancellable state"
    },
    {
      "code": 6721,
      "name": "OrderNotExpired",
      "msg": "Order has not expired"
    },
    {
      "code": 6725,
      "name": "OrderExpired",
      "msg": "Order has expired"
    },
    {
      "code": 6722,
      "name": "OrderNotFillable",
      "msg": "Order is not open for filling"
    },
    {
      "code": 6723,
      "name": "FillExceedsOrder",
      "msg": "Fill amount exceeds remaining order quantity"
    },
    {
      "code": 6724,
      "name": "SlipAlreadyCashedOut",
      "msg": "Bet slip has already been cashed out"
    },
    {
      "code": 6726,
      "name": "SlipExpired",
      "msg": "Bet slip has expired"
    },
    {
      "code": 6727,
      "name": "SlipNotExpired",
      "msg": "Bet slip has not expired yet"
    },
    {
      "code": 6800,
      "name": "EpochNotComplete",
      "msg": "Epoch has not completed — not all markets are settled"
    },
    {
      "code": 6801,
      "name": "EpochWithdrawalsNotEnabled",
      "msg": "Withdrawals are not yet enabled for this epoch"
    },
    {
      "code": 6802,
      "name": "EpochPaused",
      "msg": "Epoch is paused — no deposits or withdrawals allowed"
    },
    {
      "code": 6803,
      "name": "MarketEpochMismatch",
      "msg": "Market does not belong to the specified epoch"
    },
    {
      "code": 6804,
      "name": "EpochAccountMismatch",
      "msg": "Epoch account does not match the market's epoch"
    },
    {
      "code": 6805,
      "name": "NoActiveEpoch",
      "msg": "No active epoch — call init_epoch first"
    },
    {
      "code": 6806,
      "name": "NotPaused",
      "msg": "Bet is not refundable — protocol is not paused"
    },
    {
      "code": 6916,
      "name": "InvalidTxlineFixtureId",
      "msg": "Invalid TxLINE fixture ID"
    },
    {
      "code": 6917,
      "name": "TxlineProofValidationFailed",
      "msg": "TxLINE proof validation failed"
    },
    {
      "code": 6919,
      "name": "CorrelatedLegsMutuallyExclusive",
      "msg": "Legs from same market with different outcomes are mutually exclusive"
    }
  ]
};
