# Screenshots

Drop four PNGs here, then uncomment the Screenshots block near the top of the
root `README.md` — remove the `<!--` line above it and the `-->` line below.

| File | Screen | What to have on it |
| --- | --- | --- |
| `home.png` | Home | A month with real spending, so the category bars are not empty |
| `review.png` | Review | Two or three captured transactions waiting to be confirmed |
| `rules.png` | Rules | The rule editor open, with a condition filled in |
| `categories.png` | Categories | The list, ideally with one of your own categories in it |

## Capturing them

With the app running on a connected device:

```bash
adb exec-out screencap -p > docs/screenshots/home.png
```

Repeat for each screen, changing the filename.

## Before you commit them

These are pictures of your own bank transactions. Check each one for anything
you would not want public:

- payee names of people rather than shops
- account numbers and the last four digits shown next to a transaction
- payment references (UTRs)
- balances

Editing a couple of transactions to harmless names before capturing is easier
than blurring afterwards.
