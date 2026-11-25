# Firestore Security Specification (`security_spec.md`)

## 1. Data Invariants
1. **Strict Ownership & Verified Identity**: Every warehouse document under `/users/{userId}/...` belongs exclusively to `userId` (`ownerId == userId == request.auth.uid`), and all reads/writes require `request.auth != null && request.auth.token.email_verified == true`.
2. **PII Isolation**: User email and avatar URL are stored separately in `/users/{userId}/private/profile`, never readable by other authenticated users.
3. **Immutable Ownership & Server Timestamps**: `ownerId` and `createdAt` are immutable after creation; `createdAt == request.time` on create and `updatedAt == request.time` on update.
4. **Master Gate for Subcollections**: An `OpnameCountDoc` under `/users/{userId}/opname_sessions/{sessionId}/counts/{countId}` cannot be created unless the parent `OpnameSessionDoc` exists (or is created in the same atomic batch) and belongs to `request.auth.uid`, and cannot be mutated once the parent session is `completed` (unless admin).
5. **Terminal State Locking**: Once an `OpnameSessionDoc` is `completed`, an `InboundOrderDoc` is `completed`, or an `OutboundOrderDoc` is `dispatched`, non-admin clients cannot modify it.
6. **Zero-Trust Query Enforcement**: Every `allow list` rule evaluates `resource.data.ownerId == request.auth.uid` (or `isAdmin()`) directly on the document without `get()`/`exists()` calls or client-side query delegation.
7. **Branch-Scoped Operator Access Control**:
   - **Nazar Prabowo** (`op-nazar` / `nazar*`): Full access to all 4 warehouses (`Gudang Pusat`/Jakarta, `Gudang Meruya`, `Gudang Denpasar`/Bali, `Gudang Surabaya`).
   - **Atang** (`op-atang` / `atang*`) & **Husein** (`op-husein` / `husein*`): Restricted exclusively to **Gudang Jakarta** (`Gudang Pusat`).
   - **Burhan** (`op-burhan` / `burhan*`): Restricted exclusively to **Gudang Meruya** (`Gudang Meruya`).
   - **Krisna** (`op-krisna` / `krisna*`): Restricted exclusively to **Gudang Bali** (`Gudang Denpasar`).
   - **Ajeng** (`op-ajeng` / `ajeng*`): Restricted exclusively to **Gudang Surabaya** (`Gudang Surabaya`).

## 2. The "Dirty Dozen" + Branch RBAC Adversarial Payloads
1. **Cross-Tenant Read/Write**: Signed-in user `uid_attacker` attempts `get` / `setDoc` on `/users/uid_victim/scan_logs/scan-1` -> **PERMISSION_DENIED**.
2. **Unverified Email Spoof**: Signed-in user with `email_verified: false` (even with admin email string) attempts write -> **PERMISSION_DENIED**.
3. **OwnerId Spoofing on Create**: `uid_attacker` creates `/users/uid_attacker/scan_logs/scan-1` with `ownerId: "uid_victim"` -> **PERMISSION_DENIED**.
4. **Ghost / Shadow Field Injection**: Client sends extra field `isVerified: true` or `role: "admin"` inside `inventory_items` or `users/{uid}` -> **PERMISSION_DENIED** (`keys().hasOnly(...)`).
5. **Document ID Poisoning**: Client attempts to create `/users/uid_1/scan_logs/bad..id/../../x` or 300-char doc ID -> **PERMISSION_DENIED** (`isValidId()`).
6. **Client Timestamp Forgery**: Client sends `createdAt: "2020-01-01"` or `updatedAt: 0` instead of `serverTimestamp()` -> **PERMISSION_DENIED** (`== request.time`).
7. **Immutable Field Mutation**: Client tries to update `ownerId` or `createdAt` on an existing `scan_logs` or `stock_cards` doc -> **PERMISSION_DENIED**.
8. **Terminal State Bypass**: Non-admin tries to update `receivedQty` or `status` on an `inbound_orders` doc whose `status == "completed"` -> **PERMISSION_DENIED**.
9. **Outbound Terminal Bypass**: Non-admin tries to modify `outbound_orders` after `status == "dispatched"` -> **PERMISSION_DENIED**.
10. **Orphaned Opname Count**: Client creates `/users/uid_1/opname_sessions/nonexistent_session/counts/item-1` -> **PERMISSION_DENIED** (`exists` / `existsAfter` Master Gate).
11. **Oversized String / Denial-of-Wallet Payload**: Client sends 5,000-character `notes` or `name` field -> **PERMISSION_DENIED** (`.size() <= maxLength`).
12. **Unbounded Array / Invalid Element Type**: Client sends `items: [123]` or `items.length > 100` on `inbound_orders` -> **PERMISSION_DENIED**.
13. **Jakarta Operator Cross-Branch Write**: `atang@company.com` or `husein@company.com` attempts to write a `scan_logs` doc or switch `activeWarehouse` to `Gudang Meruya` or `Gudang Denpasar` -> **PERMISSION_DENIED**.
14. **Meruya Operator Cross-Branch Write**: `burhan@company.com` attempts to update `stockPusat` on `inventory_items` or write a `scan_logs` doc for `Gudang Pusat` (Jakarta) -> **PERMISSION_DENIED**.
15. **Bali Operator Cross-Branch Write**: `krisna@company.com` attempts to update `stockMeruya` on `inventory_items` or write an inbound/outbound order for `Gudang Pusat` (Jakarta) -> **PERMISSION_DENIED**.
16. **Surabaya Operator Cross-Branch Write**: `ajeng@company.com` attempts to write a `stock_cards` doc or switch `activeWarehouse` to `Gudang Denpasar` (Bali) or `Gudang Pusat` (Jakarta) -> **PERMISSION_DENIED**.
17. **Operator Role Self-Escalation**: Branch-locked user (`krisna@company.com` or `burhan@company.com`) attempts to update `users/{uid}.activeOperatorId` to `op-nazar` or modify `operators/{id}.assignedWarehouse` -> **PERMISSION_DENIED**.
