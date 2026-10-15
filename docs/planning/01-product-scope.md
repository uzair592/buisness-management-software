# Product scope

## Purpose

Build a simple business operating system for everyday sales, purchasing, stock, dues and money. A shopkeeper should be able to create a bill quickly while an owner or accountant sees reliable business records on another authorised device. The application must continue a documented set of operations during internet outages.

The reference is Vyapar's ease of use and connected workflows. Use an original product name, visual system and implementation. This plan does not claim feature parity or reproduce an internal Vyapar design.

## Confirmed direction and assumptions

| Type | Requirement or working assumption |
| --- | --- |
| User requested | Easy, clean business software inspired by Vyapar |
| User requested | Online and offline operation |
| User requested | Multi-device support |
| User requested | Project maps, flow diagrams, coding-agent prompts and GitHub delivery before implementation |
| User requested, unspecified | Additional features; keep candidates proposed until selected |
| Working assumption | Pakistan-first general retail, wholesale and service use, not restaurant-specific operations |
| Working assumption | One business currency at launch; default PKR and Asia/Karachi |
| Working assumption | PWA first for laptop, tablet and mobile; same business shared through cloud sync |
| Working assumption | Multiple businesses isolated from the start, initially one active location per business |

## Primary users

| User | Main jobs |
| --- | --- |
| Owner | See daily position, approve users/devices, control stock and money, recover data |
| Accountant | Purchases, payments, expenses, party statements, reconciliation and reports |
| Cashier or salesperson | Search items, create bills, collect permitted payments, print receipts |
| Stock manager | Receive, count and move stock within permitted locations |
| Viewer | Read selected reports with freshness clearly shown |

These are proposed role presets, not inherited requirements from other software projects. Start with presets and explicit permissions; avoid a complex custom-role designer before the core works.

## Release boundaries

**Core pilot after M11:** enrol business and devices; catalogue and parties; opening balances; sales and credit sales online; permitted offline cash sales, purchases and simple cash expenses; payments; returns/refunds; stock; reports; printing; backup/recovery; responsive PWA. Multiple online devices and disconnected-then-reconnected devices must pass the same accounting checks.

**Extended v1 after M12:** quotations, purchase orders, partial conversion and warehouse transfers. The general pilot in M13 verifies only the features enabled for that pilot; a core-only pilot may start after M11 if M12 is explicitly disabled and documented.

**Later optional product work:** SaaS subscriptions and platform administration, Android/Windows wrappers, batch/expiry/serial inventory, customer price lists, Urdu/RTL, advanced manufacturing, payroll, loyalty, messaging and integrations.

## Product success criteria

- A trained cashier can create a basic five-line sale without leaving the billing workspace; item search and the cart stay visible at 1366 × 768.
- A saved offline cash bill survives an ordinary app close and reopen, prints from its saved snapshot, and appears exactly once in shared records after reconnecting.
- Two devices cannot create duplicate financial effects by retrying the same command; simultaneous different sales remain separate sales.
- A customer balance, stock summary, cash/bank book and accounting report reconcile to their source records.
- Device-local and company-wide data are labelled accurately. No device claims to know another disconnected device's unsynced transactions.
- An owner can recover a verified backup without silently overwriting current records or replaying old queues.
- Features described as live have persisted behaviour, access checks and acceptance evidence.

## Explicit exclusions from the first release

Indian GST filing/e-way-bill systems and Pakistan FBR/KPRA submission; legal compliance certification; automatic bank statement access; card processing; strict stock reservation across disconnected devices; multi-currency consolidation; restaurant table/KOT flows; car-wash workflow; payroll and manufacturing; unattended silent browser printing/cutting; permanent offline multi-device networking with no cloud contact.

Generic editable tax rates and manually recorded bank payments are in scope. Their presence does not make the application tax-certified or a payment processor.
