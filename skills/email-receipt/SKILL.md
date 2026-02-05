---
name: email-receipt
description: "Process forwarded email receipts and invoices to add transactions to Saffa Finances. Forward receipts/invoices to ct2@ctribefestival.com or share email screenshots in Discord."
metadata:
  {
    "clawdbot":
      {
        "emoji": "📧",
        "triggers":
          [
            "forwarded receipt",
            "email receipt",
            "invoice email",
            "forward this receipt",
            "process this invoice",
            "add this invoice",
            "email expense",
          ],
      },
  }
---

# Email Receipt Capture

Process forwarded email receipts, invoices, and purchase confirmations to automatically extract transaction data and add them to Saffa Finances.

> **CRITICAL**: Receipts and invoices are EXPENSES. When saving to Firestore, **always use NEGATIVE amounts** (e.g., `-99.00` not `99.00`). The dashboard determines income/expense by the sign of the amount.

## When to Use

- User forwards a receipt/invoice email to ct2@ctribefestival.com
- User shares a screenshot of an email receipt in Discord
- User asks to process a forwarded invoice
- Email contains purchase confirmation, subscription charge, or invoice

## Email Forwarding Setup

Emails forwarded to **ct2@ctribefestival.com** are monitored. When a receipt/invoice is forwarded:

1. CT2 receives notification via the email gateway
2. CT2 extracts transaction details from:
   - Email body text
   - PDF attachments (invoices)
   - Image attachments (receipt scans)
3. CT2 posts to Discord for confirmation
4. On confirmation, saves to Saffa Finances

### Prerequisites

1. **gog CLI** must be installed and authenticated:

   ```bash
   brew install steipete/tap/gogcli
   gog auth credentials /path/to/client_secret.json
   gog auth add us@ctribefestival.com --services gmail
   ```

2. **Email alias**: ct2@ctribefestival.com should forward to (or be an alias for) the monitored mailbox

### Manual Check for Forwarded Receipts

User can ask: "Check for forwarded receipts" or "Any new invoices?"

CT2 will search recent emails:

```bash
gog gmail messages search "to:ct2@ctribefestival.com newer_than:1d" --max 10 --account us@ctribefestival.com
```

## Workflow

### Step 1: Receive Forward

When you receive a forwarded email or screenshot:

```
📧 I received a forwarded email from [original sender]

**Analyzing for transaction details...**
```

### Step 2: Extract Details

Parse the email for:

- **Merchant/Vendor**: Company name (from header, logo, or email domain)
- **Date**: Invoice date, transaction date, or email date
- **Amount**: Total amount due/paid
- **Currency**: USD, CAD, etc.
- **Description**: Service/product details
- **Invoice Number**: If present (for reference)

Use `gog gmail messages get <messageId>` to fetch full email content if needed.

### Step 3: Present for Confirmation

Show extracted data and ask for confirmation:

```
📧 Receipt from [Merchant]

**Extracted:**
• **Merchant:** Anthropic
• **Date:** Feb 5, 2026
• **Amount:** $100.00 USD
• **Description:** Claude API usage - January 2026
• **Invoice #:** INV-2026-0123

**Suggested:**
• Category: software
• Entity: ct-networks

Does this look correct? Reply **confirm** to save, or tell me what to change.
```

### Step 4: Save Transaction

After user confirms:

```
✅ Transaction saved to Saffa Finances!

**Saved:**
• -$100.00 USD to CT Networks (software)
• Anthropic - Claude API usage - January 2026
• Date: 2026-02-05

🔗 View: https://saffa-finances.web.app
```

## Reading Emails with gog

Use the `gog` CLI to access forwarded emails:

```bash
# Search for forwarded receipts
gog gmail messages search "to:ct2@ctribefestival.com newer_than:1d" --max 10 --account us@ctribefestival.com

# Get specific message with attachments
gog gmail messages get <messageId> --account us@ctribefestival.com

# List attachments
gog gmail attachments list <messageId> --account us@ctribefestival.com

# Download attachment
gog gmail attachments download <messageId> <attachmentId> --out /tmp/invoice.pdf --account us@ctribefestival.com
```

## Attachment Handling

### PDF Invoices

- Download the PDF attachment
- Extract text/data from the PDF
- Look for: Total, Amount Due, Invoice Total, Grand Total

### Image Attachments

- Download the image
- Use vision capabilities to extract text
- Same extraction logic as receipt-capture skill

### Email Body

- Parse HTML/plain text for transaction details
- Look for structured data (tables, lists)
- Extract from confirmation templates (Stripe, PayPal, etc.)

## Entity Matching

**IMPORTANT**: Always ask user to confirm or specify the business entity. Multiple can be selected if expense is shared.

| Entity ID                 | Short Name | Type       | Keywords/Context                                                     |
| ------------------------- | ---------- | ---------- | -------------------------------------------------------------------- |
| `sahr-auto`               | Sahr Auto  | business   | sahr, auto, detailing, car wash, mobile detailing, cleaning supplies |
| `ct-networks`             | CT Net     | business   | ct networks, consulting, tech services, software dev                 |
| `ctribe-profit`           | C-Tribe    | business   | ctribe, festival, event production (for-profit side)                 |
| `ctribe-nonprofit`        | C-Tribe NP | nonprofit  | ctribe foundation, grants, nonprofit programs                        |
| `cotton-tree-vs`          | CTVS       | holding    | venture studios, investments, holding company                        |
| `nimbus-creative`         | Nimbus     | business   | nimbus, creative agency, design, US clients                          |
| `revive-ai`               | Revive     | investment | revive, AI platform                                                  |
| `black-talent-initiative` | BTI        | charity    | bti, black talent, board expenses                                    |
| `cappsule`                | Cappsule   | business   | cappsule, app                                                        |
| `personal`                | Personal   | personal   | groceries, personal items, home                                      |

**Note**: Transactions can have **multiple entities** if the expense is shared.

## Account Matching

**CRITICAL**: Always identify which card/account the expense came from. For email invoices, this may not be visible - ASK the user.

| Account ID            | Name                | Last 4 | Bank        | Entity           | Currency |
| --------------------- | ------------------- | ------ | ----------- | ---------------- | -------- |
| `amex-platinum-72000` | Amex Platinum       | 2000   | Amex        | personal         | CAD      |
| `amex-cobalt-13005`   | Amex Cobalt         | 3005   | Amex        | personal         | CAD      |
| `capitalone-mc-7798`  | Capital One MC      | 7798   | Capital One | personal         | CAD      |
| `capitalone-mc-8048`  | Capital One MC #2   | 8048   | Capital One | personal         | CAD      |
| `rbc-chequing-95`     | RBC Chequing        | 1595   | RBC         | personal         | CAD      |
| `rbc-chequing-95`     | RBC Visa Debit      | 1886   | RBC         | personal         | CAD      |
| `rbc-house-6234`      | RBC House           | 6234   | RBC         | personal         | CAD      |
| `atb-ctribe-np-7779`  | C-Tribe NP Chequing | 7779   | ATB         | ctribe-nonprofit | CAD      |
| `mercury-nimbus-2442` | Nimbus Checking     | 2442   | Mercury     | nimbus-creative  | USD      |
| `sahr-auto-cash`      | Sahr Cash           | CASH   | Cash        | sahr-auto        | CAD      |

**Account Detection Tips**:

- Look for last 4 digits in email (e.g., "Charged to card ending in 2000")
- **Visa ending in 1886** = RBC Chequing (Visa Debit)
- USD invoices often come from Mercury (Nimbus)
- If payment method isn't in the email, ASK the user

## Category Matching

| Keywords                                                    | Category      |
| ----------------------------------------------------------- | ------------- |
| api, subscription, saas, software, cloud, anthropic, openai | `software`    |
| hosting, domain, server, aws, vercel, cloudflare            | `hosting`     |
| ads, advertising, meta, google ads, facebook                | `advertising` |
| supplies, equipment, materials                              | `supplies`    |
| travel, flight, hotel, airbnb, uber, air canada             | `travel`      |
| food, restaurant, doordash, uber eats                       | `meals`       |
| phone, internet, utilities, telus, shaw                     | `utilities`   |
| insurance, liability                                        | `insurance`   |

## Currency Detection

**IMPORTANT**: Always determine the currency. If unclear, ASK the user.

| Indicator                                                    | Currency    |
| ------------------------------------------------------------ | ----------- |
| "CAD", "CA$", "CDN$", "C$"                                   | CAD         |
| "USD", "US$", "U.S."                                         | USD         |
| Canadian vendors (Telus, Shaw, ATB, etc.)                    | CAD         |
| Mercury account charges                                      | USD         |
| US-based SaaS (Anthropic, OpenAI, Vercel, AWS, Stripe, etc.) | Usually USD |

**If the invoice just shows "$" with no country indicator:**

- ASK: "Is this $XX.XX in CAD or USD?"
- Don't assume - incorrect currency affects financial reporting

## Common Email Formats

### Stripe Receipts

```
From: receipts@stripe.com
Subject: Receipt from [Business Name]
Amount: Look for "Amount paid" or total
Date: Receipt date in email body
```

### PayPal

```
From: service@paypal.com
Subject: Receipt for your payment to [Merchant]
Amount: Look for "Total" amount
Date: Transaction date
```

### Amazon

```
From: auto-confirm@amazon.com / digital-no-reply@amazon.com
Subject: Your Amazon order / Your Amazon.com order
Amount: "Order Total" or "Grand Total"
Date: Order date
```

### Apple/App Store

```
From: no_reply@email.apple.com
Subject: Your receipt from Apple
Amount: "Total" in receipt
Date: Receipt date
```

### Google/GCP

```
From: payments-noreply@google.com
Subject: Your Google Cloud invoice
Amount: "Amount due" or "Total"
Date: Invoice date
```

## Transaction Format

**CRITICAL: Expenses must have NEGATIVE amounts.**

```json
{
  "date": "2026-02-05",
  "description": "Anthropic - Claude API usage January 2026",
  "amount": -100.0,
  "category": "software",
  "entities": ["ct-networks"],
  "account": "amex-platinum-72000",
  "currency": "USD",
  "source": "email-receipt",
  "importedAt": "2026-02-05T10:30:00Z",
  "metadata": {
    "invoiceNumber": "INV-2026-0123",
    "emailFrom": "billing@anthropic.com",
    "emailSubject": "Your January 2026 Invoice"
  }
}
```

**Required fields**:

- `date` - Transaction/invoice date
- `description` - Merchant + brief description
- `amount` - NEGATIVE for expenses
- `account` - Which card/account (use account ID from table above)
- `entities` - Array of business entity IDs (can be multiple if shared expense)

## Example Conversations

### Forwarded Email Notification

```
User: I just forwarded a Vercel invoice to ct2

CT2: 📧 Got it! Let me check that email...

Found invoice from Vercel:
• **Merchant:** Vercel Inc
• **Date:** Feb 1, 2026
• **Amount:** $20.00 USD
• **Description:** Pro plan - February 2026
• **Invoice #:** VER-2026-020145

I don't see a payment method in the invoice. Which account was this charged to?

User: amex platinum

CT2: Thanks! Here's what I'll save:

• **Account:** Amex Platinum (2000)
• **Category:** hosting
• **Entity:** ?

Which business is this for?

User: ct networks

CT2: ✅ Saved! -$20.00 USD
• Amex Platinum → CT Net (hosting)
• Vercel Inc - Pro plan February 2026
```

### Screenshot of Email (with card visible)

```
User: [screenshot of Stripe receipt] add this

CT2: 📧 I see a Stripe receipt:

• **Merchant:** OpenAI
• **Date:** Feb 4, 2026
• **Amount:** $50.00 USD
• **Card:** Visa ending in 2442
• **Description:** API usage

**Suggested:**
• Account: Mercury Nimbus Checking (2442)
• Category: software
• Entity: Nimbus

Confirm?

User: actually this is shared between nimbus and ct networks

CT2: Updated to shared expense:

• Account: Mercury Nimbus Checking (2442)
• Category: software
• Entities: Nimbus, CT Net

Confirm?

User: yes

CT2: ✅ Saved! -$50.00 USD
• Mercury Nimbus → Nimbus + CT Net (software)
```

### Multiple Invoices

```
User: Check for any forwarded receipts

CT2: 📧 Found 2 new invoices forwarded to ct2@ctribefestival.com:

**1. Anthropic**
• Date: Feb 5, 2026
• Amount: $100.00 USD
• Description: Claude API - January 2026

**2. Cloudflare**
• Date: Feb 4, 2026
• Amount: $25.00 USD
• Description: Pro plan

Which accounts were these charged to?

User: both from amex platinum, both for ct networks

CT2: Got it! I'll save both:

1. Anthropic - $100.00 USD → Amex Platinum → CT Net (software)
2. Cloudflare - $25.00 USD → Amex Platinum → CT Net (hosting)

Confirm?

User: yes

CT2: ✅ Saved both transactions!
```

## Notes

- **IMPORTANT**: All invoices/receipts are EXPENSES - use NEGATIVE amounts
- **IMPORTANT**: If currency is unclear (just "$" with no CAD/USD indicator), ASK before saving
- Forward emails to ct2@ctribefestival.com for automatic processing
- Screenshots work too - just send with "add this" or "log this"
- Invoice numbers are stored in metadata for reference
- Original emails are not stored (only extracted data)
- Transaction source is marked as "email-receipt" for tracking

## Correcting Mistakes

If a transaction was saved incorrectly:

1. **Delete** - Go to https://saffa-finances.web.app, click the transaction, use Delete button
2. **Re-forward** - Forward the email again with corrections noted
