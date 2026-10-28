# Operational Runbook: Incident Response, Recovery & Epoch Fencing

## 1. Recovery Objectives (RPO & RTO)

- **Recovery Point Objective (RPO)**:
  - Database WAL / PITR: $\le 5$ minutes on managed PostgreSQL.
  - Exported Tenant Archives: $\le 24$ hours (scheduled daily encrypted business backups).
  - Unsaved browser tabs / offline drafts: No cloud RPO guaranteed until posted online.
- **Recovery Time Objective (RTO)**:
  - Service restart / process failover: $\le 2$ minutes.
  - Complete tenant archive restore & verification: $\le 15$ minutes for pilot-scale dataset.

---

## 2. Lost or Compromised Billing Device

If a cashier terminal or mobile tablet is lost, stolen, or compromised:
1. **Immediate Revocation**:
   An Owner or Administrator navigates to **Settings -> Enrolled Devices** and clicks **Revoke** on the compromised device, or invokes:
   ```http
   POST /v1/devices/revoke
   x-csrf-token: <csrf>
   { "deviceEnrollmentId": "<device-uuid>" }
   ```
2. **Effect**:
   - The device enrollment is marked `status = 'Revoked'` and `revoked_at = NOW()`.
   - The device can no longer issue or number new sales. Any subsequent command submission fails with `Device revoked`.

---

## 3. Disaster Recovery: Isolated Restore & Dataset Epoch Fencing

When restoring a business from an encrypted archive:
1. **Validation & Inspection (Zero Writes)**:
   Submit the archive bundle to `POST /v1/backup/inspect` with the archive passphrase. The system decrypts with AES-256-GCM, validates the SHA-256 manifest checksum, and presents a dry-run diff of accounts, inventory, sales, and dues.
2. **Promotion & Atomic Epoch Fencing**:
   Upon owner confirmation via `POST /v1/backup/promote`:
   - Increments `Business.datasetEpoch` atomically ($N \to N+1$).
   - Synchronizes `SyncHead.datasetEpoch` to $N+1$.
   - Revokes all existing cashier sessions and device enrollments.
   - **Epoch Fencing Protection**:
     Any older device or offline client attempting to submit a command signed with the previous epoch ($N$) is immediately rejected with:
     ```json
     { "error": "Dataset epoch mismatch" }
     ```
     This strictly prevents historical or deleted transactions from silently replaying into the restored dataset.

---

## 4. Spreadsheet Formula Injection Protection

Exported CSV files (`/v1/export/items.csv`, `/v1/export/parties.csv`) and imported CSVs are sanitized against formula injection (CSV Injection). Any cell starting with `=, +, -, @, \t, \r` is prefixed with `'` to ensure opening in Microsoft Excel or LibreOffice Calc cannot execute DDE macros or external commands.
