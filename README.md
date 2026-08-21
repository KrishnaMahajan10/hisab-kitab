# Hisab Kitab

**Android expense tracker that reads your transactions instead of asking you to type them.**

Bank SMS and payment-app notifications are captured automatically, parsed into transactions, and
queued for a one-tap confirm. Bank statements in PDF, XLS and CSV back-fill the history. Everything
is stored on the phone — no account, no server, no data leaving the device.

Built for Indian banking: UPI, NEFT/IMPS/RTGS, card swipes, ATM withdrawals, and the SMS formats
that HDFC, ICICI, SBI, Axis, Kotak and Bank of Baroda actually send.

React Native · Expo SDK 57 · TypeScript (strict) · SQLite · a hand-written Kotlin native module

---

<!--
SCREENSHOTS — delete this comment marker (this line and the closing one below)
once the four PNGs are in docs/screenshots/. See docs/screenshots/README.md.

## Screenshots

| Home | Review | Rules | Categories |
| --- | --- | --- | --- |
| <img src="docs/screenshots/home.png" width="200" alt="Spending summary for the month, broken down by category"> | <img src="docs/screenshots/review.png" width="200" alt="Captured transactions waiting for a one-tap confirm"> | <img src="docs/screenshots/rules.png" width="200" alt="Editing a category rule"> | <img src="docs/screenshots/categories.png" width="200" alt="Adding a custom category"> |

-->

## Why this exists

Manual expense apps fail because you forget. Hisab Kitab inverts that: the phone already knows about
every card swipe, UPI payment and bank transfer, because your bank sends an SMS and your payment
app posts a notification. Hisab Kitab listens to both.

## Engineering highlights

The parts of this project that were actually hard, and what they demonstrate.

**A spreadsheet reader written from scratch, in TypeScript.**
Bank `.xls` exports are legacy BIFF8 workbooks inside an OLE2 compound file. Rather than ship a
heavyweight dependency into a React Native bundle, the format is parsed directly:
[`ole2.ts`](src/import/ole2.ts) walks the FAT, DIFAT and mini-FAT sector chains to find the workbook
stream; [`biff.ts`](src/import/biff.ts) decodes the record stream, including the shared-string table
that spills across `CONTINUE` records — where a single string can be cut in half and the
continuation restates its own character width. Verified against a real ICICI export: 15/15
transactions, correct to the paisa against the statement's own running balance.

**Three-layer deduplication across independent data sources.**
One payment can arrive as a bank SMS, a payment-app notification, and later a statement row, each
with a different timestamp and a different spelling of the payee. Getting this wrong in either
direction is bad: a missed duplicate inflates your spending, an over-eager match silently deletes a
real transaction. The solution layers an exact hash, then UTR matching by containment (banks quote a
6-digit fragment of a 12-digit reference), then a time-and-merchant heuristic whose window widens
*only across sources* — so a statement row and an SMS nine hours apart collapse into one, while two
₹20 chai payments to the same shop on the same day stay two payments. See
[Deduplication](#deduplication).

**A rules engine users can actually drive.**
Categorisation started as a keyword list, became a set of rules learned silently from corrections,
and is now a small predicate language: field × match type × direction × amount band × priority, with
a dry-run that counts how many existing transactions a new rule would move before you commit to it.
[`categorize.ts`](src/parse/categorize.ts) keeps the matching pure so all of it is testable without
a database.

**Correctness where money is involved.**
Amounts are integer paise, never floats. Date ranges are half-open `[from, to)` so a midnight
transaction belongs to exactly one period. Transfers between your own accounts are detected from the
account numbers in the message — not from the words "IMPS" or "transfer", which say nothing about
who the other side belongs to — and excluded from spending totals, because moving your own money
between pockets is not an expense.

**Schema that evolved without losing data.**
Seven migrations, each written to preserve what was already captured: back-filling payment
references by re-parsing stored message bodies, rebuilding the rules table to drop a constraint that
had become wrong, and moving categories from hardcoded arrays into a table while keeping every
existing transaction pointing at the right one.

## Tech stack

| Area | Choice | Why |
| --- | --- | --- |
| App | React Native 0.86, Expo SDK 57, TypeScript `strict` | Single codebase, typed end to end |
| Native | Kotlin Expo module | SMS and notification capture have no JS equivalent |
| Storage | `expo-sqlite`, 7 versioned migrations | Relational queries for the summaries; works offline |
| PDF | PDFBox-Android via the native module | Handles password-protected statements |
| XLS / CSV | Hand-written OLE2 + BIFF8 + RFC 4180 readers | No dependency, works in the RN runtime |
| Auth | `expo-auth-session`, PKCE, `drive.appdata` scope only | Backup cannot read the rest of your Drive |
| Tests | 11 suites of plain assertions run by `tsx` | No framework; each suite runs in under a second |

## What it does

- **Captures automatically** — bank SMS and payment-app notifications become pending transactions
- **Imports statements** — PhonePe PDF, legacy `.xls`, CSV and TSV, mapped without knowing the bank
- **Sorts spending** — ~300 Indian merchant keywords, plus rules you write yourself
- **Categories you control** — add, rename and hide them; renaming updates every transaction
- **Honest totals** — self-transfers, card payments and cash withdrawals are money moved, not spent
- **Filters** — day, week, month, a specific month, year, or a custom range
- **Backup** — one file in a private Google Drive folder, or a JSON export you keep yourself

## How capture works

| Channel | Covers | Mechanism |
| --- | --- | --- |
| Bank SMS | credit card, debit card, UPI, NEFT/IMPS, ATM | `BroadcastReceiver` on `SMS_RECEIVED` |
| Payment notifications | GPay, PhonePe, Paytm, CRED, BHIM, Amazon Pay | `NotificationListenerService` |
| Cash | cash spends | manual quick-add |
| Anything | expenses **and** income you enter yourself | Add tab |
| Statement PDF | back-filling months of history | PDFBox text extraction + parser |
| Statement XLS | bank exports | OLE2 + BIFF8 reader written for this project |
| Statement CSV | bank exports | delimiter sniffing + RFC 4180 reader |

### Statement import

**Setup → Import a statement** takes a statement file — PDF, `.xls`, CSV or TSV — and queues every
payment in it for review. The format is decided by reading the file's first bytes rather than
trusting its extension, because banks hand out `.xls` files that are really CSV.

Whichever path a file takes, imported rows go through the same dedup check as live captures, so a
payment already caught from SMS is not counted again.

**PDF** text is extracted natively with PDFBox-Android, which also handles password-protected files
(there is a password field above the button). Verified against a real 46-transaction PhonePe
statement: 46/46 rows parsed, 0 skipped, every row with an exact timestamp, merchant, source-account
mask, and a UTR. Accounts are auto-created from the `Paid by` mask — a 4-digit mask becomes
`Card ••9823`, a shorter one becomes `UPI ••10`.

**Spreadsheets and delimited files** go through [`table.ts`](src/import/table.ts), which does not
need to know which bank produced the file. The header row is found by scoring column-name synonyms,
and the rows are then read through whichever shape that reveals:

| Shape | Seen in |
| --- | --- |
| Separate withdrawal and deposit columns | ICICI (verified against a real export), HDFC |
| One amount column plus a `DR`/`CR` indicator | Axis |
| One signed amount column | several card exports |

Dates are read day-first (`15/08/2026`, `15-Aug-2026`, `15-Sept-2026`, ISO, and raw Excel serials).
Payment references are pulled out of the narration *by shape* rather than by keyword, because banks
slot the UTR into an unlabelled slash-delimited field — `UPI/SAFA ARBAZ/…/659315937795/ICI71…`.

Three honest limits:

- **`.xlsx` is not supported.** It is a ZIP archive and would need a DEFLATE decoder. The file is
  detected and you are told to re-save as `.xls` or CSV, rather than getting a confusing failure.
- **Only PhonePe PDFs are supported.** Other banks' PDFs lose their table geometry during text
  extraction — Bank of Baroda emits every description, then every debit, then every balance as
  separate blocks, so no line-based parser can pair an amount with its row. Their CSV or XLS export
  works through the table path instead.
- **Person-to-person payments land in "Other."** On a real statement, 38 of 46 rows were people and
  small local shops (`Dad`, `Mahesh super shopeee`) that no keyword list can classify. Categorise a
  payee once in Review and the learned rule handles it from then on.

PDF text extractors disagree about line grouping, so the parser accepts three shapes: one line per
row (`DEBIT ₹100\tPaid to X`), type/amount/detail split across lines, and the combined table row
PDFBox actually produces (`Aug 19, 2026 Paid to X DEBIT ₹100`). All three are covered by tests.

### Adding by hand

The **Add** tab handles both directions. Pick **Expense** or **Income** under *Type* — the category
list and labels follow the choice. Amount has quick-tap buttons (₹20–₹500) so cash entry is two
taps. Direction is stored as `debit` / `credit`; the UI never shows that jargon.

## Home

The dashboard for whatever period you pick — Day, Week, Month, Year, All, or a Custom range. It
shows spent, received, net and entry count for that range, then a category breakdown with bars and a
per-account breakdown.

The range is always named in words above the numbers ("17 Aug 2026 – 23 Aug 2026") so the figures on
screen state what they cover.

Home and History share one filter component (`src/components/PeriodFilter.tsx`) and one range
calculation (`src/period.ts`), so the two screens can never disagree about what "this week" means.

## History

The **History** tab lists every confirmed transaction, newest first, grouped by month, with a
running entry count and spent / received totals for whatever is currently filtered.

Each row carries a **provenance tag** showing how it arrived:

| Tag | Meaning |
| --- | --- |
| `SMS` | Read from a bank SMS |
| `NOTIF` | Read from a payment app notification |
| `PDF` | Imported from a statement PDF |
| `MANUAL` | Entered by hand in the Add tab |

### Filtering

Above the list sits a **search field** and a single compact row: a **Filters** button (badged with
how many filter groups are active) followed by a removable chip per active filter. Stacked chip rows
do not scale — 41 categories cannot live in a chip row — so everything moves into one sheet.

Tapping **Filters** opens a bottom sheet holding every filter at once:

- **Period** — Day, Week (Mon–Sun), Month, Year, All, or **Custom** with From/To date pickers.
  Custom defaults to the last 30 days until you pick dates.
- **Captured from** — All, SMS, Notification, PDF, Manual. Answers "what did the statement import
  actually add?"
- **Category** — multi-select, grouped into Expenses and Income. Selecting none means all.

Edits inside the sheet are a draft: **Apply** commits them, closing or tapping the backdrop discards
them, and **Clear all** returns everything to the default. Each active filter also appears as a chip
in the bar with an ✕, so a single filter can be dropped without opening the sheet.

A summary card under the bar names the active range in words ("August 2026", "Thursday, 20 Aug",
"17 Aug 2026 – 23 Aug 2026") with the entry count and spent / received totals for that range, so the
numbers on screen always state what they cover.

`npm run test:filters` covers the badge count, chip construction, and that removing one chip leaves
the other filters untouched.

Ranges are half-open `[from, to)`, so a transaction at exactly midnight belongs to one period only
and is never counted in two. `npm run test:period` covers the boundaries, Monday week-start,
reversed custom dates, and the midnight case.

Search matches merchant, note and category, and combines with both filters.

Tap any row to open an edit sheet — a bottom-sheet modal over the list, not an inline expansion, so
**Save and Delete stay pinned at the bottom** and are reachable without scrolling past 31 category
chips. Close by tapping the X, the backdrop, or the system back gesture.

Editable: **amount, type (Expense/Income), merchant, category, account, date and note**. Category
options follow the type, so an income row only offers income categories. The sheet also shows the
bank reference (UTR) and the original SMS or statement line the row came from.
Changing a category also writes a learned rule, so the same payee is auto-filed next time — this is
how the person-to-person payments that land in "Other" get trained.

Provenance is deliberately **not** editable. It records how the row actually reached the app, so
letting it be rewritten would make it a lie. The account is editable; the capture source is not.

Delete is available per row, behind a confirmation.

The list pages 50 at a time with a "Load more" button rather than loading a whole year at once.

## Categories

Categories live in a `categories` table, editable from **Setup → Categories**. You can add your own,
rename any of them, hide the ones you never use, and mark a category as *money moved* so it stays
out of your spending totals.

Each category is offered for expenses, for income, or both — so a picker only ever shows relevant
options. The 40 built-in ones are seeded on first run from `src/db/schema.ts` and are marked
`builtin` so they can be told apart from yours.

Transactions store the category as plain `TEXT` rather than a foreign key. That keeps a backup file
readable on its own and avoids a data migration every time the list changes; a rename updates the
transactions and rules in one transaction so nothing is left orphaned.

### How a category gets picked

Three layers, in order:

1. **Rules you wrote** — see below
2. **Rules learned from your corrections** — changing a category in Review writes one automatically
3. **~300 Indian merchant keywords** in `src/parse/categorize.ts` — Swiggy → Food & Dining, HPCL →
   Fuel, Netflix → Subscriptions, ATM → Cash Withdrawal

Income keywords only apply to credits and expense keywords only to debits, so a "refund" credit can
never be filed as a purchase.

### Rules

**Setup → Rules** is a small predicate builder. A rule is a pattern plus any conditions you want:

| Part | Options |
| --- | --- |
| Look at | anywhere · merchant · title · note |
| Match | contains · starts with · ends with · is exactly · regex |
| Applies to | both · expenses · income |
| Amount between | optional floor and ceiling |
| Priority | lower runs first |

So `merchant contains "bharatpe" → Food & Dining`, or the case a keyword list can never handle:
the same payee meaning *rent* over ₹1,000 and *a gift* under it.

**Re-apply** sweeps transactions already stored, but counts first and asks — *"412 of 1,203
transactions would change category"* — because re-categorising cannot be undone.

Picker UX: **Add** shows every category in a wrapping grid. **Review** shows a horizontal row with
the current pick first (one-tap correction), and the full grid under *Edit*.

Captured messages land in a native SQLite queue that survives the app being killed. When the app
next runs it drains the queue, parses each message, and inserts a **pending** transaction. You
confirm, correct the category, or discard.

Corrections are learned: changing a merchant's category writes a rule that applies next time.

### Deduplication

One payment can reach the app three ways — a bank SMS, a payment-app notification, and later a
statement PDF. Three layers stop it being counted more than once, in order of strength:

**1. Exact identity (`UNIQUE` constraint on `dedup_key`).**
Captures key on `source|sender|postedAt|hash(body)`; statement rows key on `stmt|<format>|<UTR>`.
So re-draining the capture queue, re-importing the same PDF, or importing two statements whose
periods overlap can never insert the same row twice. This layer is exact.

**2. Payment reference (`reference` column, indexed).**
Bank SMS quote the payment reference in several shapes; statements carry the full UTR. A matching
reference is proof of the same payment, so this layer ignores timestamps and merchant spelling
entirely. References match on equality *or* containment, because a bank often quotes a 6-digit
fragment of a 12-digit UTR — with a 6-character floor so short numbers cannot collide by chance.

Recognised shapes: `UPI/<utr>/PAYEE`, `UPI:<utr>`, `UPI: <utr>`, `UPI-<utr>-PAYEE`,
`UPI Ref No <utr>`, and the direction-coded block ICICI and Axis send — `UPI/DR/<utr>/PAYEE` and
`UPI/CR/<utr>/PAYEE` — plus `RRN`, `Txn ID`, `Ref`, and `UTR`. The direction codes (`DR`, `CR`,
`P2A`, `P2M`) are spelled out rather than matched loosely, so a payee name is never mistaken for a
reference. Migration v4 re-runs extraction over `raw_body` for any row still missing a reference, so
transactions captured before a pattern was added get it retroactively.

**3. Near-duplicate heuristic.**
When neither side has a usable reference: same amount, same direction, within 10 minutes (12 hours
for date-only statement rows), and a matching merchant. Merchants match by **containment**, not
equality, so `SWIGGY` from a bank SMS matches `Swiggy Limited` from a statement — with a
4-character floor so `Dad` does not collapse into `Dadar`.

Verified on device: a statement row for ₹100 (UTR `585204261401`) was imported, then an SMS for the
same payment arrived **9 hours off in timestamp** — the reference layer collapsed it, while an
unrelated ₹777 SMS in the same batch was still captured normally.

The reference is also shown in the History editor, since it is the number to quote when tracing or
disputing a payment with a bank.

What is *not* deduplicated: two genuinely separate payments of the same amount to the same payee,
close together, with no references on either side. That is indistinguishable from a duplicate given
the available data, so both are kept and left to the review step rather than silently merged.

## Money handling

Amounts are stored as **integer paise**, never floats. `amount_paise INTEGER CHECK (> 0)`, with
direction held separately as `'debit' | 'credit'`.

## Requirements

- Node 20+
- Android SDK (`ANDROID_HOME` set) and JDK 21
- A physical Android device — SMS capture cannot be tested on an emulator without sending
  synthetic broadcasts

## Running it

```bash
npm install
```

For everyday use, build the standalone release APK — it embeds the JS bundle, so it needs no Metro
server and no dev launcher:

```bash
./android/gradlew -p android :app:assembleRelease
```

The APK lands at `android/app/build/outputs/apk/release/app-release.apk` (~29 MB). Install it with
`adb install -r <path>`, or copy it to the phone.

For development with fast refresh, use the dev client instead:

```bash
npx expo run:android
```

**Expo Go will not work** — SMS reading and notification listening require the custom native module
in `modules/hisab-capture`. The dev client also shows Expo's own launcher and developer-menu
overlay on first run; that overlay is Expo's, not this app's. If you see a black screen, you are
looking at the dev launcher waiting for Metro — install the release APK instead.

`android/local.properties` is regenerated per machine and `expo prebuild` deletes it. Either keep
`ANDROID_HOME` set in your environment, or recreate the file with
`sdk.dir=<path-to-android-sdk>`.

After install, open **Setup** and grant:

1. **SMS access** — runtime permission prompt
2. **Notification access** — opens the system special-access screen; toggle Hisab Kitab on
3. **Reminder notifications** — so Hisab Kitab can nudge you when items are waiting

Then use **Import history** to scan SMS already on the phone (last 30 or 90 days) and backfill.

## Checks

```bash
npm run typecheck
```

```bash
npm test
```

`npm test` runs the SMS/notification parser against real Indian bank formats (HDFC, ICICI, SBI,
Axis, Kotak), payment-app notifications, and noise samples (OTPs, promos, balance-only alerts) that
must be rejected.

Eleven suites in total, each a plain assertion script run by `tsx` — no test framework, and every
suite finishes in under a second.

| Script | Covers |
| --- | --- |
| `npm test` | SMS and notification parsing against real bank formats |
| `npm run test:import` | PhonePe PDF parser, all three text-extraction shapes |
| `npm run test:dedup` | Cross-source dedup, plus guards against over-collapsing |
| `npm run test:table` | Bank-agnostic table mapper, and a real `.xls` end to end |
| `npm run test:csv` | Delimiter sniffing, RFC 4180 quoting, human-written numbers |
| `npm run test:rules` | Rule matching, conditions, and priority ordering |
| `npm run test:period` | Period boundaries, leap months, year rollover |
| `npm run test:filters` | Filter state, chips, and clearing |
| `npm run test:labels` | Row titles and provenance tags |
| `npm run test:totals` | Which categories count toward spending |
| `npm run test:backup` | Backup payload, and refusing a newer-schema restore |

Every test asserts a behaviour rather than an implementation detail, and several exist specifically
to pin down a bug that was found and fixed — a spread that would blow the stack on a large sheet, a
date-only statement row slipping past dedup, a filter reset that silently missed a new field.

## Backup

Local-first by design — bank SMS never leaves the device unless you ask it to.

**Setup → Export** writes a JSON file and opens the share sheet, so you can put it wherever you
like. **Restore** reads it back and replaces all data, refusing a backup written by a newer version
of the app rather than applying half of it.

**Google Drive backup** is optional. It signs in with PKCE and requests the `drive.appdata` scope
and nothing else, so the app can only see its own hidden folder — never the rest of your Drive. The
refresh token is kept in the device keystore via `expo-secure-store`. Backups are pruned to the last
ten, so one bad snapshot cannot erase every good one.

There is no server, no account, and no analytics.

## Distribution constraint

Google Play's SMS policy permits `READ_SMS` only for apps that are the user's default SMS handler,
plus a short list of exempt cases. An expense tracker parsing bank SMS is **not** an exempt case,
so this app cannot be published to Play as-is.

For personal use, install it directly (`expo run:android`, or a release APK). If you ever want Play
distribution, drop the SMS receiver and rely on the notification listener alone, which Play does
allow with a disclosure.

## Layout

```
App.tsx                          tabs, DB provider, live capture wiring
src/categories.tsx               the live category list, read by every picker
src/db/schema.ts                 seven migrations, seed category list
src/db/repo.ts                   queries, dedup lookup, summaries, rules, categories
src/parse/parse.ts               SMS/notification → transaction, self-transfer detection
src/parse/categorize.ts          rule matching and the merchant keyword list
src/sync.ts                      drain queue → parse → dedup → insert
src/labels.ts                    row titles, provenance tags (SMS / NOTIF / PDF / MANUAL)
src/period.ts                    half-open date ranges for every filter

src/import/statement.ts          sniff format → parse → dedup → queue
src/import/phonepe.ts            PhonePe statement PDF parser
src/import/table.ts              bank-agnostic column mapper for sheets and CSV
src/import/ole2.ts               OLE2 compound-file reader
src/import/biff.ts               BIFF8 record reader for legacy .xls
src/import/csv.ts                delimited text, RFC 4180 quoting

src/backup/googleAuth.ts         Google OAuth, PKCE, drive.appdata only
src/backup/drive.ts              Drive v3 REST against the hidden app folder
src/backup/payload.ts            build / parse / apply a backup

src/screens/                     Home, Review, Add, History, Setup, Categories, Rules
modules/hisab-capture/           native Kotlin capture module
  android/.../SmsReceiver.kt                 SMS broadcast receiver
  android/.../HisabNotificationListener.kt   payment-app notifications
  android/.../CaptureStore.kt                native SQLite queue
  android/.../PdfTextExtractor.kt            PDFBox text extraction
  android/.../TxnHeuristics.kt               pre-filter, payment app allowlist
```

## Not built yet

- Credit-card billing cycles and due-date reminders
- Budgets and per-category limits
- Home-screen widget / quick-settings tile for cash
- Recurring-payment detection
- `.xlsx` import — needs a DEFLATE decoder to read the ZIP container
- Statement PDF parsers beyond PhonePe — blocked on reading text positions from the native
  extractor, since most banks' PDFs lose their table layout otherwise
- Multi-device sync — the current backup is snapshot restore only, which is a deliberate choice:
  merging two devices would need stable row IDs and tombstones, and this app has one user
