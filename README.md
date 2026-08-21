# Hisab Kitab

Android expense tracker that reads your transactions instead of asking you to type them.

Bank SMS and payment-app notifications are captured automatically, parsed into transactions,
and queued for a one-tap confirm. Cash is the only thing you enter by hand.

## Why this exists

Manual expense apps fail because you forget. Hisab Kitab inverts that: the phone already knows about
every card swipe, UPI payment and bank transfer, because your bank sends an SMS and your payment
app posts a notification. Hisab Kitab listens to both.

## How capture works

| Channel | Covers | Mechanism |
| --- | --- | --- |
| Bank SMS | credit card, debit card, UPI, NEFT/IMPS, ATM | `BroadcastReceiver` on `SMS_RECEIVED` |
| Payment notifications | GPay, PhonePe, Paytm, CRED, BHIM, Amazon Pay | `NotificationListenerService` |
| Cash | cash spends | manual quick-add |
| Anything | expenses **and** income you enter yourself | Add tab |
| Statement PDF | back-filling months of history | PDFBox text extraction + parser |

### Statement import

**Setup → Import a statement** takes a PhonePe transaction statement PDF and queues every payment
in it for review. Text is extracted natively with PDFBox-Android (which also handles
password-protected PDFs — there is a password field above the button).

Verified against a real 46-transaction statement: 46/46 rows parsed, 0 skipped, every row with an
exact timestamp, merchant, source-account mask, and a UTR / Transaction ID.

The UTR is used as the dedup key, so re-importing the same statement imports nothing twice.
Imported rows are also checked against transactions already captured from SMS and notifications, so
a payment caught live is not counted again.

Accounts are auto-created from the statement's `Paid by` mask — a 4-digit mask becomes
`Card ••9823`, a shorter one becomes `UPI ••10`.

Two honest limits:

- **Only PhonePe is supported so far.** Any other statement is rejected with a preview of what was
  extracted, rather than silently mis-parsed. Bank statements differ per bank and need their own
  parser; the importer is structured so adding one means a new module in `src/import/`.
- **Person-to-person payments land in "Other."** On the real statement, 38 of 46 rows were people
  and small local shops (`Dad`, `Mahesh super shopeee`) that no keyword list can classify.
  Categorize a payee once in Review and the learned rule handles it forever after.

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

Expense and income have separate lists, so you only ever see relevant options. Defined in
`src/db/schema.ts` — `category` is a plain `TEXT` column with no constraint, so adding one needs
no migration.

**Expense (31)** — Food & Dining, Groceries, Transport, Fuel, Travel, Shopping, Clothing,
Electronics, Bills & Utilities, Mobile & Internet, Rent, Household, Domestic Help, Health, Fitness,
Personal Care, Education, Kids & Family, Pets, Entertainment, Subscriptions, Insurance, Loan & EMI,
Credit Card Payment, Taxes & Fees, Bank Charges, Gifts & Donations, Cash Withdrawal, Investments,
Transfers, Other

**Income (10)** — Salary, Freelance, Business, Interest & Dividends, Refunds & Cashback,
Rent Received, Gifts Received, Investments, Transfers, Other Income

Auto-categorization matches ~300 Indian merchant keywords in `src/parse/categorize.ts` — Swiggy →
Food & Dining, HPCL → Fuel, Netflix → Subscriptions, ATM → Cash Withdrawal, and so on. Income
keywords only apply to credits and expense keywords only to debits, so a "refund" credit can never
be filed as a purchase.

To add a category, append it to `EXPENSE_CATEGORIES` or `INCOME_CATEGORIES` and optionally add
keywords to `KEYWORD_MAP`. Nothing else needs touching.

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

```bash
npm run test:import
```

Runs the statement parser against all three PDF text-extraction shapes.

```bash
npm run test:dedup
```

Runs the cross-source deduplication logic — reference extraction from SMS, reference and merchant
matching, and guards that two different payees or two unrelated references must **not** collapse.

## Backup

Local-only by design — bank SMS never leaves the device. **Setup → Export** writes a JSON file and
opens the share sheet, so you can save it to Google Drive yourself. **Restore** reads it back and
replaces all data.

There is no cloud sync and no server. Nothing is uploaded anywhere.

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
src/db/schema.ts                 migrations, category list
src/db/repo.ts                   queries, near-duplicate lookup, summaries
src/parse/parse.ts               SMS/notification → transaction
src/parse/parse.test.ts          parser tests against real formats
src/parse/categorize.ts          merchant → category, learned rules
src/sync.ts                      drain queue → parse → insert
src/labels.ts                    provenance tags (SMS / NOTIF / PDF / MANUAL)
src/import/phonepe.ts            PhonePe statement PDF parser
src/import/statement.ts          extract -> detect -> parse -> dedup -> queue
src/screens/                     Home, Review, Add, History, Setup
modules/hisab-capture/           native Kotlin capture module
  android/.../SmsReceiver.kt             SMS broadcast receiver
  android/.../HisabNotificationListener.kt  payment-app notifications
  android/.../CaptureStore.kt             native SQLite queue
  android/.../TxnHeuristics.kt            pre-filter, payment app allowlist
```

## Not built yet

- Credit-card billing cycles and due-date reminders
- Budgets and per-category limits
- Home-screen widget / quick-settings tile for cash
- Recurring-payment detection
- Statement parsers for banks other than PhonePe (HDFC, ICICI, SBI, Axis)
- CSV / Excel statement import (more reliable than PDF where the bank offers it)
