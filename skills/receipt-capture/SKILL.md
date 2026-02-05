---
name: receipt-capture
description: "Capture receipts and screenshots to add transactions to Saffa Finances. Send an image and say 'add this receipt', 'log this expense', or 'capture this transaction'."
metadata: {"clawdbot":{"emoji":"🧾","triggers":["add receipt","log receipt","capture receipt","add this expense","scan receipt","receipt to finance","log this expense","add this to finance","capture transaction"]}}
---

# Receipt Capture

Capture receipts, invoices, and screenshots to automatically extract transaction data and add them to Saffa Finances.

> **⚠️ CRITICAL**: Receipts are EXPENSES. When saving to Firestore, **always use NEGATIVE amounts** (e.g., `-99.00` not `99.00`). The dashboard determines income/expense by the sign of the amount.

## When to Use This Skill

- User sends an image attachment (receipt, invoice, screenshot)
- User asks to "add this receipt" or "log this expense"
- User wants to quickly capture a transaction from a payment confirmation
- User sends a screenshot of a charge/payment

> **Tip**: For email receipts/invoices, users can also forward to **ct2@ctribefestival.com** - see the `email-receipt` skill.

## How It Works

1. User sends image with trigger phrase ("add this receipt", "log this expense")
2. Claude Vision analyzes the image and extracts:
   - Merchant name
   - Date
   - Amount (and currency)
   - Line items (if visible)
   - Description
3. System suggests category and entity based on merchant/keywords
4. User confirms or provides corrections
5. Transaction saved to Saffa Finances (Firestore)

## Usage

### Basic Receipt Capture

Send an image and say:
- "Add this receipt"
- "Log this expense"
- "Capture this to finance"
- "Add this to finances"

### With Entity Context

Specify which business entity:
- "Add this receipt - it's for CT Networks"
- "Log this expense as Sahr Auto supplies"
- "Capture this for ctribe festival"

### With Category Override

Specify the category:
- "Add this receipt as software"
- "Log this as marketing expense"

## Entity Matching

**IMPORTANT**: Always ask user to confirm or specify the business entity. Multiple can be selected if expense is shared.

| Entity ID | Short Name | Type | Keywords/Context |
|-----------|------------|------|------------------|
| `sahr-auto` | Sahr Auto | business | sahr, auto, detailing, car wash, mobile detailing, cleaning supplies |
| `ct-networks` | CT Net | business | ct networks, consulting, tech services, software dev |
| `ctribe-profit` | C-Tribe | business | ctribe, festival, event production (for-profit side) |
| `ctribe-nonprofit` | C-Tribe NP | nonprofit | ctribe foundation, grants, nonprofit programs |
| `cotton-tree-vs` | CTVS | holding | venture studios, investments, holding company |
| `nimbus-creative` | Nimbus | business | nimbus, creative agency, design, US clients |
| `revive-ai` | Revive | investment | revive, AI platform |
| `black-talent-initiative` | BTI | charity | bti, black talent, board expenses |
| `cappsule` | Cappsule | business | cappsule, app |
| `personal` | Personal | personal | groceries, personal items, home |

**Note**: Transactions can have **multiple entities** if the expense is shared (e.g., software used by both CT Networks and Nimbus).

## Account Matching

**CRITICAL**: Always identify which card/account the expense came from based on receipt details.

| Account ID | Name | Last 4 | Bank | Entity | Currency |
|------------|------|--------|------|--------|----------|
| `amex-platinum-72000` | Amex Platinum | 2000 | Amex | personal | CAD |
| `amex-cobalt-13005` | Amex Cobalt | 3005 | Amex | personal | CAD |
| `capitalone-mc-7798` | Capital One MC | 7798 | Capital One | personal | CAD |
| `capitalone-mc-8048` | Capital One MC #2 | 8048 | Capital One | personal | CAD |
| `rbc-chequing-95` | RBC Chequing | 1595 | RBC | personal | CAD |
| `rbc-chequing-95` | RBC Visa Debit | 1886 | RBC | personal | CAD |
| `rbc-house-6234` | RBC House | 6234 | RBC | personal | CAD |
| `atb-ctribe-np-7779` | C-Tribe NP Chequing | 7779 | ATB | ctribe-nonprofit | CAD |
| `mercury-nimbus-2442` | Nimbus Checking | 2442 | Mercury | nimbus-creative | USD |
| `sahr-auto-cash` | Sahr Cash | CASH | Cash | sahr-auto | CAD |

**Account Detection Tips**:
- Look for last 4 digits on receipt (e.g., "Card ending in 2000" → Amex Platinum)
- Look for card type (Amex, Mastercard, Visa)
- **Visa ending in 1886** = RBC Chequing (Visa Debit)
- USD transactions often come from Mercury (Nimbus)
- If unclear, ASK the user which card it came from

## Category Matching

| Keywords | Category |
|----------|----------|
| software, subscription, api, saas, app, cloud, anthropic, openai, vercel | `software` |
| supplies, materials, equipment, tools, canadian tire | `supplies` |
| food, restaurant, coffee, lunch, dinner, uber eats, doordash | `meals` |
| uber, lyft, flight, hotel, airbnb, travel, air canada | `travel` |
| ads, advertising, meta, google ads, facebook, marketing | `advertising` |
| phone, internet, utilities, hydro, electric, telus, shaw | `utilities` |
| office, rent, coworking, regus | `rent` |
| insurance, liability | `insurance` |
| gas, fuel, parking, shell, petro | `fuel` |
| amazon, online, ecommerce | `general` |

## Workflow

### Step 1: Image Analysis

When you receive an image attachment with a trigger phrase, analyze it:

```
📸 Analyzing receipt...

**Extracted Data:**
- Merchant: Apollo.io
- Date: 2026-02-04
- Amount: $99.00 USD
- Card: Amex ending in 2000
- Description: Monthly subscription

**Suggested:**
- Account: Amex Platinum (2000)
- Category: software
- Entity: CT Net

Does this look correct? Reply **confirm** to save, or tell me what to change.
```

**IMPORTANT**: Always try to identify the payment card from the receipt. Look for:
- "Card ending in XXXX"
- Card network logos (Amex, Visa, Mastercard)
- Bank name references

### Step 2: User Confirmation

Wait for user response:
- "confirm" / "yes" / "save it" → Save transaction
- "change entity to sahr auto" → Update and re-confirm
- "amount is 89.99" → Correct and re-confirm
- "cancel" / "nevermind" → Abort

### Step 3: Save Transaction

After confirmation, save to Firestore:

```
✅ Transaction saved to Saffa Finances!

**Saved:**
• -$99.00 USD
• Amex Platinum (2000) → CT Net
• Category: software
• Apollo.io - Monthly subscription
• Date: 2026-02-04

🔗 View: https://saffa-finances.web.app
```

## Extraction Guidelines

When analyzing receipt images, extract:

1. **Merchant Name**: The business/store name (prioritize header/logo)
2. **Date**: Transaction date (look for date stamps, "Date:", receipt date)
3. **Total Amount**: Final amount paid (look for "Total", "Amount Due", "Grand Total")
4. **Currency**: USD, CAD, etc. (default to CAD if ambiguous)
5. **Payment Method**: Card type if visible (for reference only)
6. **Line Items**: Individual items if clearly visible

### Handling Ambiguity

- If date is unclear, use today's date and note "date estimated"
- If amount is unclear, ask user to confirm
- If merchant is unclear, describe what's visible
- Always prioritize the TOTAL over subtotals

## Example Conversations

### Quick Capture

```
User: [image] add this receipt

CT2: 📸 Got it! Here's what I extracted:

• **Merchant:** Canadian Tire
• **Date:** Feb 3, 2026
• **Amount:** $47.89 CAD
• **Card:** Mastercard ending in 7798
• **Items:** Microfiber towels, car wash soap

**Suggested:**
• Account: Capital One MC (7798)
• Category: supplies
• Entity: Sahr Auto

Confirm to save?

User: yes

CT2: ✅ Saved! -$47.89 CAD
• Capital One MC (7798) → Sahr Auto (supplies)
• Canadian Tire - Microfiber towels, car wash soap
```

### With Correction

```
User: [image] log this expense

CT2: 📸 Extracted from receipt:

• **Merchant:** Uber Eats
• **Date:** Feb 4, 2026
• **Amount:** $32.15 CAD
• **Card:** Amex ending in 2000

**Suggested:**
• Account: Amex Platinum (2000)
• Category: meals
• Entity: Personal

Confirm?

User: this was for a client meeting, ct networks

CT2: Got it! Updated:

• Account: Amex Platinum (2000)
• Category: meals
• Entity: CT Net

Confirm?

User: confirm

CT2: ✅ Saved! -$32.15 CAD
• Amex Platinum → CT Net (meals)
```

### Screenshot Capture (USD)

```
User: [screenshot of Stripe charge] capture this

CT2: 📸 I see a Stripe payment confirmation:

• **Merchant:** Anthropic
• **Date:** Feb 4, 2026
• **Amount:** $100.00 USD
• **Description:** Claude API credits

This is a USD charge. Which account was this from?
- Mercury Nimbus (2442) - USD
- Amex Platinum (2000) - CAD
- Another card?

User: nimbus

CT2: Got it!

• Account: Mercury Nimbus Checking (2442)
• Category: software
• Entity: Nimbus (since it's from the Nimbus account)

Confirm?

User: actually this is for ct networks, shared expense

CT2: Updated - shared expense across Nimbus and CT Net:

• Account: Mercury Nimbus Checking (2442)
• Category: software
• Entities: Nimbus, CT Net

Confirm?

User: yes

CT2: ✅ Saved! -$100.00 USD
• Mercury Nimbus → Nimbus + CT Net (software)
```

### Unknown Card

```
User: [image] add this

CT2: 📸 Extracted:

• **Merchant:** Vercel
• **Date:** Feb 5, 2026
• **Amount:** $20.00 USD
• **Description:** Pro plan

I couldn't identify the payment card from the receipt. Which account was this charged to?

User: amex platinum

CT2: Got it!

• Account: Amex Platinum (2000)
• Category: software (hosting)
• Entity: ?

Which business is this for?

User: ct networks

CT2: ✅ Saved! -$20.00 USD
• Amex Platinum → CT Net (software)
```

## Error Handling

### Can't Read Image

```
CT2: 🤔 I'm having trouble reading this image. Could you:
- Make sure the receipt is in focus
- Try a clearer photo with good lighting
- Or just tell me the details and I'll add it manually
```

### Missing Critical Info

```
CT2: 📸 I can see this is from **Tim Hortons** but the total is cut off.
What was the amount?
```

### No Image Attached

```
CT2: 🧾 I don't see an image attached. Send a photo of your receipt and I'll capture it!
```

## Integration

This skill saves transactions to:
- **Firestore**: `saffa-finances` project, `transactions` collection
- **Dashboard**: https://saffa-finances.web.app

### Transaction Format

**CRITICAL: Expenses must have NEGATIVE amounts.** The dashboard determines income vs expense by the sign:
- **Negative amount** = Expense (e.g., -99.00)
- **Positive amount** = Income (e.g., +150.00)

Receipts and purchases are almost always **expenses**, so use negative amounts:

```json
{
  "date": "2026-02-04",
  "description": "Apollo.io - Monthly subscription",
  "amount": -99.00,
  "category": "software",
  "entities": ["ct-networks"],
  "account": "amex-platinum-72000",
  "currency": "USD",
  "source": "receipt-capture",
  "importedAt": "2026-02-04T15:30:00Z"
}
```

**Required fields**:
- `date` - Transaction date
- `description` - Merchant + brief description
- `amount` - NEGATIVE for expenses
- `account` - Which card/account (use account ID from table above)
- `entities` - Array of business entity IDs (can be multiple if shared expense)

## Notes

- **IMPORTANT**: All receipts/purchases/invoices are EXPENSES - use NEGATIVE amounts
- The only time you'd use a positive amount is for income (e.g., refunds, deposits)
- Receipts are analyzed using Claude's vision capabilities
- All amounts default to CAD unless clearly marked otherwise
- USD amounts are noted with `"currency": "USD"` and stored as-is (no conversion)
- Original images are not stored (privacy)
- Transaction source is marked as "receipt-capture" for tracking

## Correcting Mistakes

If a transaction was saved incorrectly (wrong amount, wrong sign, wrong category):

1. **Delete the incorrect transaction** - User should go to https://saffa-finances.web.app, click the transaction, and use the Delete button
2. **Re-capture** - Send the receipt again with the correct information

Currently there's no edit-in-place for transaction type via Discord, so delete + re-upload is the workflow.
