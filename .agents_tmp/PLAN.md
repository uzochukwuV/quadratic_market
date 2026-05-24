# 1. OBJECTIVE

Fix the 4 failing test suites and ensure all tests run properly. The root cause is that three new test files (`bet_slip_test.ts`, `order_book_test.ts`, `lmsr_integration_test.ts`) and one existing (`security_tests.ts`) are trying to re-initialize the protocol by calling `program.methods.initialize()` even though the protocol is already initialized, and their `before()` hooks attempt market creation that calls `createMarket` without the required `epoch` account parameter.

# 2. CONTEXT SUMMARY

**Project:** Quadratic Market — Anchor/Solana prediction market with LMSR AMM.

**Test Suite Status (from `anchor test` output):**

| Suite | Status | Issue |
|-------|--------|-------|
| `quadratic_market.ts` | ✅ PASS (skipped) | Skip logic works — protocol already initialized |
| `protocol_tests.ts` | ✅ PASS (skipped) | Skip logic works |
| `simulation_test.ts` | ✅ PASS (skipped) | Skip logic works |
| `epoch_user_flow_test.ts` | ✅ PASS | Full epoch lifecycle test passes |
| `security_tests.ts` | ❌ FAIL | `Account globalConfig not provided` in `before()` |
| `bet_slip_test.ts` | ❌ FAIL | `Account globalConfig not provided` in `before()` |
| `order_book_test.ts` | ❌ FAIL | `Account globalConfig not provided` in `before()` |
| `lmsr_integration_test.ts` | ❌ FAIL | `Account epoch not provided` in `before()` |

**Root Cause Analysis:**

1. **`security_tests.ts`** — Uses `program.workspace.QuadraticMarket` (camelCase) but other tests use `program.workspace.quadraticMarket` (lowercase). The camelCase version may not resolve correctly, causing the `globalConfig` account to not be provided when calling `addLiquidity` in the `before()` hook.

2. **`bet_slip_test.ts`, `order_book_test.ts`** — Same `QuadraticMarket` camelCase issue as `security_tests.ts`.

3. **`lmsr_integration_test.ts`** — Uses lowercase `program.workspace.quadraticMarket`, so globalConfig resolves correctly. However, `createMarket` is called without the `epoch` account, which became required after epoch-gated market creation was implemented. The error `AccountNotInitialized` on the `epoch` account confirms this.

**Why existing tests skip properly:**
- `quadratic_market.ts`, `protocol_tests.ts`, `simulation_test.ts` all have this pattern:
  ```typescript
  try { await program.account.globalConfig.fetch(globalConfigPda); skipSuite = true; return; }
  catch (_) { /* not initialized, proceed */ }
  ```
- New test files inherit this pattern but then **continue to call initialization code** (addLiquidity, createMarket) that fails because the globalConfig account is not properly referenced through the workspace.

**Tech Stack:** Rust 1.89.0, Anchor 0.32.1, Solana CLI, TypeScript + Mocha, SPL Token

# 3. APPROACH OVERVIEW

Fix all 4 failing tests by correcting the workspace reference and/or account parameter issues:

1. **Fix `security_tests.ts`** — Change `program.workspace.QuadraticMarket` to `program.workspace.quadraticMarket`
2. **Fix `bet_slip_test.ts`** — Change `program.workspace.QuadraticMarket` to `program.workspace.quadraticMarket`
3. **Fix `order_book_test.ts`** — Change `program.workspace.QuadraticMarket` to `program.workspace.quadraticMarket`
4. **Fix `lmsr_integration_test.ts`** — Add `epoch` account parameter to `createMarket` calls in the `before()` hook, or use the existing epoch from the protocol

The strategy is to make the minimum fix necessary — correct the workspace reference and add the missing `epoch` account. Then verify all 8 test suites pass.

# 4. IMPLEMENTATION STEPS

## Step 1: Fix `security_tests.ts` — Correct workspace reference

**Goal:** Fix `Account 'globalConfig' not provided` error

**Method:**
1. In `security_tests.ts`, line 53, change:
   ```typescript
   const program = anchor.workspace.QuadraticMarket as Program<QuadraticMarket>;
   ```
   to:
   ```typescript
   const program = anchor.workspace.quadraticMarket as Program<QuadraticMarket>;
   ```
2. Verify `before()` hook no longer tries to call initialization methods without proper globalConfig account resolution.

**Reference:** `tests/security_tests.ts:53`

## Step 2: Fix `bet_slip_test.ts` — Correct workspace reference

**Goal:** Fix `Account 'globalConfig' not provided` error

**Method:**
1. In `bet_slip_test.ts`, change workspace reference from `QuadraticMarket` to `quadraticMarket`
2. Ensure `before()` hook works with the correctly-resolved program

**Reference:** `tests/bet_slip_test.ts`

## Step 3: Fix `order_book_test.ts` — Correct workspace reference

**Goal:** Fix `Account 'globalConfig' not provided` error

**Method:**
1. In `order_book_test.ts`, change workspace reference from `QuadraticMarket` to `quadraticMarket`
2. Ensure `before()` hook works with the correctly-resolved program

**Reference:** `tests/order_book_test.ts`

## Step 4: Fix `lmsr_integration_test.ts` — Add missing epoch account

**Goal:** Fix `AccountNotInitialized` (epoch) error on `createMarket` call

**Method:**
1. In `lmsr_integration_test.ts`, the `createMarket` call in `before()` needs an `epoch` account parameter
2. Derive the epoch PDA from `globalConfigPda` and add it to the accounts object:
   ```typescript
   const [epochPda] = PublicKey.findProgramAddressSync(
     [Buffer.from("epoch"), new anchor.BN(0).toArrayLike(Buffer, "le", 8)],
     program.programId
   );
   ```
3. Add `epoch: epochPda` to the `createMarket` accounts

**Reference:** `tests/lmsr_integration_test.ts:164`

## Step 5: Run tests and verify all pass

**Goal:** Verify all 8 test suites pass

**Method:**
1. Run `anchor test` and verify:
   - No more failing tests (4 remaining after fixes)
   - All existing passing tests continue to pass
   - All new test suites run successfully

# 5. TESTING AND VALIDATION

**Build Verification:**
- `anchor build` completes without errors
- `anchor test` runs and shows:
  - 0 failing tests (all 4 fixed)
  - ~66+ passing tests (all existing + new suites)

**Expected Outcomes:**
- `security_tests.ts` passes — all SEC-* tests run
- `bet_slip_test.ts` passes — correlated multi-leg bet slip tests run
- `order_book_test.ts` passes — P2P order book tests run
- `lmsr_integration_test.ts` passes — LMSR pricing correctness tests run
- All existing tests (`quadratic_market.ts`, `protocol_tests.ts`, `simulation_test.ts`, `epoch_user_flow_test.ts`) continue to pass
