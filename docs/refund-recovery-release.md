# Refund recovery release

## Scope and acceptance

This change continues PR #207 on the current main branch. It must prevent a
second provider refund after an uncertain first attempt and expose resumable
post-refund processing in the owner admin panel.

Acceptance criteria:

1. No provider refund before a durable, acknowledged launch claim.
2. Concurrent requests and requests after reload/restart cannot repeat an
   unresolved financial operation, including when local persistence fails.
   A committed partial refund also rejects replay of the same operation key.
3. Confirmed provider success can resume local order, access, audit and invoice
   processing without calling the refund provider again.
4. Recovery preserves later legitimate purchases and grants. Historical cases
   without sufficient provenance remain explicit manual-review cases.
5. The admin reads persistent status and offers a separate recovery action;
   unknown, malformed and stale responses cannot enable a new refund.
6. Existing owner authentication, same-origin checks and external collection
   write restrictions remain effective.
7. Node 24 checks include synthetic fault injection, PostgreSQL concurrency,
   admin browser behavior, full CI and two independent reviews before release.

No real payment or customer data is used for validation. No dependency,
production-variable or migration change is part of this patch. Release remains
on HOLD until the criteria above and current-main integration gates are met.

## Operational boundaries

An uncertain provider response is not evidence that no money moved. Recovery
must not blindly repeat a provider refund. Cases that cannot be correlated to
positive provider evidence remain visible for an operator to reconcile.

The existing refund-intents collection is owner-readable and externally
write-denied. Activating its writer retains actor/order relationships; the
Phase A human retention review remains a required activation gate. The existing
mandatory relationships can prevent deletion of referenced orders and actors.
This patch neither changes those constraints nor supplies a retention period.

## Recovery contract

- Every monetary request supplies a canonical random 32-byte application key.
  Only its domain-separated digest is persisted on the server. A SQL claim,
  acknowledged before the provider call, authorizes a single submission.
- The browser retains an uncertain operation across reloads. An absent record
  is not proof that an in-flight request cannot later claim it: an unseen
  operation may only be retried with its original key, not silently replaced.
- Refund success requires correlated payment, transaction, amount and status
  evidence. The original merchant transaction identifier is included in the
  request. Payment-level success alone does not prove a refund.
- Recovery never calls the refund provider. Order history, access processing,
  audit and invoice completion are separate acknowledged phases. An uncertain
  invoice submission must not be repeated blindly.
- GET status is owner-only, read-only and non-cacheable. The optional application
  key is a request header, never a URL parameter or response field. The separate
  recovery POST retains the existing owner and same-origin checks.

Primary contract references: [Barion refund request](https://docs.barion.com/TransactionToRefund),
[refund response](https://docs.barion.com/RefundedTransaction), and
[official refund example](https://docs.barion.com/Marketplace_Example), checked
on 2026-09-05. These documents do not establish a safe blind-retry policy.

## Evidence

The current integration base is
`3da0a89ea26589786d1469afe42732cf97bf8f61`. All application changes are scoped to
refund processing, its existing invoice callers, and the admin UI. Dependency,
lockfile, migration and collection access-policy bytes match that exact base.

Local verification uses Node 24.20.0 and PostgreSQL 18.6 in a disposable,
task-labelled container. All users, orders and transport responses are synthetic.
The application processes cannot read environment files or contact external
providers. No actual refund, document issuance, email delivery or production
deployment was tested or performed.

Current production-source snapshot: `release-candidate-01`, captured in
`/tmp/kineticare-pr207-validation/snapshots/1788608015498-429681921589`.
The recorded Git HEAD is `4296819215896f6032f513b68d1e1f2473f8dc8b`; because it
contains uncommitted changes, the adjacent file-hash manifest, not HEAD alone,
identifies the tested bytes.

- Build and its TypeScript phase passed for those application bytes. The local
  browser variant uses `http://localhost:3007` because another application owns
  port 3000. Log: `2026-09-05T11-33-59.576Z-build-35600.log`.
- The latest focused invoice/service/wire-contract batch passed 27 tests,
  including 11 actual invoice-helper tests with synthetic transport.
  Log: `2026-09-05T11-24-05.843Z-tests-26054.log`.
- The final admin component/key/amount batch passed 109 tests. Full lint then
  passed with three existing warnings. Logs:
  `2026-09-05T11-32-05.962Z-tests-34345.log` and
  `2026-09-05T11-32-12.869Z-lint-34432.log`.
- Final composed Vitest run: **6588 passed / 0 failed, 288 files**, including
  both real PostgreSQL suites. Snapshot `release-candidate-02`; log
  `2026-09-05T11-59-54.484Z-tests-43786.log`. Vitest exited 0. The surrounding
  source-stability harness exited 1 because normal onInit created 60 image
  derivatives under `media/`. Independent classification verified all 1105
  baseline files unchanged and no deleted files; added files have valid
  PNG/JPEG/WebP signatures. The original harness receipt remains unchanged,
  not relabelled as passing. Classification:
  `/tmp/kineticare-pr207-validation/release-candidate-02-artifact-classification.json`.
- Final full typecheck and lint passed on `release-types-01`, including the
  PostgreSQL lifecycle helper. Logs: `2026-09-05T12-06-13.509Z-typecheck-45767.log`
  and `2026-09-05T12-06-14.691Z-lint-45787.log`. Source and parent matched;
  lint retains only the same three pre-existing warnings.
- Independent real access-store batch: **6/6 passed**, no skips or teardown
  timeout, with the baseline reread from JSONB storage. Log:
  `2026-09-05T11-54-55.915Z-tests-42810.log`. It covers grant replacement,
  competing orders, commit/rollback contention and atomic deletion/receipt.

All named logs are under `/tmp/kineticare-pr207-validation/logs`. Subsequent
changes to this document only record evidence; they do not change tested code.

## Remaining Release Gates

- The required final independent review is incomplete: one review invocation
  was stopped by the platform. Earlier reviewer findings were addressed, but
  this is not a final approval and is not bypassed by passing tests.
- Browser validation is incomplete. The isolated Next server started, but the
  isolated Chrome launch failed while creating its process-singleton directory.
  No visual, real-browser login or interactive acceptance is claimed. The local
  server and failed browser processes were stopped.
- Human review of the actor/order retention and deletion behavior remains open.
  No new retention period or automatic deletion policy is introduced here.
- The eventual pushed head still requires its own automatic GitHub checks.
  Production Railway health can only be checked for the actual merged SHA;
  neither an older green PR head nor a local build proves deployment health.

Nonblocking existing warnings: two CoursePlayer effect warnings, an unused
analytics-test parameter, deprecated Next middleware naming, and broad dynamic
filesystem tracing in media-restore. The isolated build also reports no cache;
disabled workers and missing Turnstile keys are intentional local-fixture
conditions, not evidence of production misconfiguration.

## Learning Harvest

- An advisory lock does not establish durable single-submission permission.
  Launch claims require atomic storage and acknowledged independent readback.
- A generic idempotent receipt must not authorize a fresh external effect.
  Invoice claims are create-only and bind readback to that invocation.
- Every invoice entry point, including background tasks, must validate the
  same refund identity, amount, sequence, type and provider snapshot.
- An absent operation record cannot distinguish a cancelled request from one
  still waiting to claim. Browser retries retain the original operation key.
- Payload relation updates are not a reliable parent-timestamp clock. Access
  cleanup uses bounded row-version evidence and exact relation identities;
  deletion and its completion receipt commit in one SQL transaction.
- JSONB does not preserve object key order. Persisted proof fingerprints hash
  canonical field tuples, and tests must include a real JSONB round trip.
