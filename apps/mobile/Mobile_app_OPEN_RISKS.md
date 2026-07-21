# MarineX360 — Offline Engine: Open Risks (S0-6)

Owner: Mobile. Severity = likelihood × impact on the field workflow. Items needing a
decision are routed to the PM via the handoff; items I own are marked (MOB).

| # | Risk | Sev | Mitigation / who |
|---|---|---|---|
| R-1 | **`APPLIED_FLAGGED` status not in the contract enum.** SYNC-13 can't be expressed; mapping it to `FORBIDDEN` would wrongly look like rejection, `APPLIED` would hide the flag. | High | **CC-MOB-2** — PM/BE ratify the status + `reviewState`. Web needs a supervisor accept/reject queue. Engine already handles it (scenario 7). |
| R-2 | **Server-assigned vs client-assigned row id.** Engine assumes client-generated `id` (CC-MOB-1). If TL wants server-assigned ids, the engine needs an id-reconciliation pass and photo/edit references get harder. | High | **CC-MOB-1** — TL/BE decide. Prefer client UUID. |
| R-3 | **Binary upload is a separate channel.** Photos + signature image can't ride in `/sync/batch` JSON; they need a presigned-S3-PUT (or proxy) endpoint. The metadata op `blocks_on` the upload. If the endpoint shape is undefined, photo sync can't be finished. | High | **BE** to provide presigned-PUT endpoint; Mobile owns the two-phase ordering + retry of the upload. |
| R-4 | **Clock trust offline.** `clientTime`, `signedAt`, `startedAt`, photo `takenAt` all come from a device clock that may be wrong after days at sea. | Med | (MOB) capture device clock but also stamp a server-receive time on apply; never use client time for ordering authority. Surface "device time looked off" if skew is large at sync. |
| R-5 | **Long-lived refresh family is a theft risk** (multi-day offline session unlocked by biometric/PIN). | Med | (MOB) store only in Keychain/Keystore (secure enclave), require biometric/PIN to unlock; server-side family revoke on reuse (already in auth design). SQLCipher for the on-device DB (pending PM/TL security call). |
| R-6 | **GNSS unavailable inside a hull** → null geo on photos/e-signature. | Med | (MOB) tolerate null geo (don't block the write); record a "geo unavailable" reason. Confirm with OD-06 that null geo is acceptable evidence. |
| R-7 | **Large queue after a long voyage** (hundreds of photos + logs) → one giant batch. | Med | (MOB) chunk `/sync/batch` into bounded pages; upload binaries first; show aggregate `N queued` progress (UX §3). Confirm a max batch size with BE. |
| R-8 | **Conflict reconcile needs the fresh server row.** Engine relies on the trailing `/sync/assigned` delta to supply it; if the delta doesn't include the conflicting child row, reconcile can't show server values. | Med | **BE** confirm `/sync/assigned` returns changed execution child rows (worklog/checklist/material), not just JO headers. |
| R-9 | **Checklist `results` schema undefined (G-4).** `ChecklistInstance.results_json` shape is a placeholder; offline checklist UI can't be finalised. | Med | **TL/BE** ratify checklist item/response schema. |
| R-10 | **iOS build prerequisites.** Native iOS needs a Mac build host + Apple Developer Program account; not yet procured. Blocks device testing of the engine on real iOS hardware. | Med | **PM** to procure (already on the horizon). Android can proceed first. |
| R-11 | **No real backend yet** to integration-test against (local-first per D-001). Prototype proves engine logic, not wire compatibility. | Low | Re-run scenarios against BE's real `/sync/*` once the endpoints land; QA harness asserts the same disposition table. |
