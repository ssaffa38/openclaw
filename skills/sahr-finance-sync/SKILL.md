---
name: sahr-finance-sync
description: "Sync Sahr Auto Detailing revenue to Saffa Finances dashboard. Use for logging payments, recording tips, tracking expenses, and generating revenue reports."
metadata: {"clawdbot":{"emoji":"💰","triggers":["sync to finance","log payment","record income","revenue report","how much did we make","record expense","customer ltv"]}}
---

# Sahr Finance Sync

You can sync Sahr Auto Detailing booking revenue to the Saffa Finances dashboard, track tips and expenses, and generate revenue reports.

## When to Use This Skill

- Booking is completed and paid - sync to finance
- Tip received from customer - record it
- Business expense incurred - log it
- User asks "how much did we make?" - generate report
- User asks about customer value - calculate LTV
- Check what needs to be synced - list unsynced bookings

## Sync Workflow

### After a Booking is Completed

1. Mark booking as completed in CRM (`sahr_crm_update_booking`)
2. Sync to finance: `sahr_finance_sync_booking`
3. Tip is automatically recorded as separate transaction

```
sahr_finance_sync_booking({
  bookingId: "booking_123",
  paymentMethod: "etransfer"
})
```

### What Gets Created

**Service Transaction:**
```json
{
  "date": "2026-02-01",
  "description": "Full Detail - Marwa",
  "amount": 115,
  "category": "auto-detailing",
  "entity": "sahr-auto",
  "source": "sahr-crm"
}
```

**Tip Transaction (if applicable):**
```json
{
  "date": "2026-02-01",
  "description": "Tip - Marwa",
  "amount": 20,
  "category": "tips",
  "entity": "sahr-auto"
}
```

## Payment Methods & Accounts

| Payment Method | Account ID |
|---------------|------------|
| E-transfer | `sahr-etransfer` |
| Stripe | `sahr-stripe` |
| Cash | `sahr-cash` |
| Debit/Credit | `sahr-debit` |

## Recording Income

### Sync Single Booking

```
sahr_finance_sync_booking({
  bookingId: "booking_123",
  paymentMethod: "etransfer",
  notes: "Loyal customer discount applied"
})
```

### Record Standalone Tip

For tips received separately from a booking:

```
sahr_finance_record_tip({
  customerName: "Marwa",
  amount: 25,
  date: "2026-02-01",
  paymentMethod: "cash"
})
```

### Bulk Sync Multiple Bookings

When catching up on multiple bookings:

```
sahr_finance_bulk_sync({
  bookingIds: ["booking_1", "booking_2", "booking_3"],
  defaultPaymentMethod: "etransfer"
})
```

## Recording Expenses

Track business expenses for accurate profit calculation:

```
sahr_finance_record_expense({
  description: "Car wash soap and microfiber towels",
  amount: 85.50,
  category: "supplies",
  vendor: "Canadian Tire",
  receipt: true
})
```

**Expense Categories:**
| Category | Examples |
|----------|----------|
| `supplies` | Soap, towels, brushes, chemicals |
| `equipment` | Pressure washer, vacuum, polisher |
| `fuel` | Gas for service vehicle |
| `insurance` | Business liability insurance |
| `marketing` | Business cards, ads |
| `maintenance` | Vehicle repairs, equipment servicing |
| `other` | Miscellaneous |

## Revenue Reports

### Generate Period Report

```
sahr_finance_revenue_report({
  startDate: "2026-01-01",
  endDate: "2026-01-31",
  includeCustomerBreakdown: true
})
```

**Report Includes:**
- Total service revenue
- Total tips
- Gross income
- Expenses
- Net income
- Average booking value
- Breakdown by service type
- Top customers (if requested)

### Sample Report Output

```
**Sahr Auto Detailing Revenue Report**
📅 2026-01-01 to 2026-01-31

**Summary:**
| Metric | Amount |
|--------|--------|
| Service Revenue | $1,840.00 |
| Tips | $185.00 |
| **Gross Income** | **$2,025.00** |
| Expenses | $312.50 |
| **Net Income** | **$1,712.50** |

**Booking Stats:**
- Total Bookings: 16
- Average Booking: $115.00
- Average Tip: $11.56

**By Service Type:**
- full detail: 12 bookings, $1,380.00 (avg $115.00)
- interior: 3 bookings, $270.00 (avg $90.00)
- wash: 1 booking, $190.00 (avg $190.00)
```

## Customer Lifetime Value

Calculate revenue history for a specific customer:

```
sahr_finance_customer_ltv({
  customerName: "Marwa"
})
```

**Output includes:**
- Total revenue from customer
- Total tips received
- Number of bookings
- Average booking value
- Customer tenure (months)
- Monthly value
- Recent transaction history

## Finding Unsynced Bookings

Check what completed bookings need to be synced:

```
sahr_finance_list_unsynced({
  limit: 10
})
```

This shows:
- Customer name
- Date
- Service type
- Amount (including tips)
- Booking ID for syncing

## Integration with Other Skills

### Full Booking Completion Flow

1. **sahr-chat-parser**: Extract booking completion from chat
2. **sahr-crm**: Update booking status to completed
3. **sahr-finance-sync**: Sync to finance dashboard
4. **sahr-scheduler**: Create follow-up reminder

### Example Complete Workflow

```
// After customer pays
1. sahr_crm_update_booking({ bookingId: "123", status: "completed", tipAmount: 20 })
2. sahr_finance_sync_booking({ bookingId: "123", paymentMethod: "etransfer" })
3. sahr_scheduler_create_reminder({ type: "follow_up", ... })
4. sahr_scheduler_suggest_rebooking({ customerName: "Marwa", ... })
```

## Tools Reference

| Tool | Purpose |
|------|---------|
| `sahr_finance_sync_booking` | Sync completed booking to finance |
| `sahr_finance_record_tip` | Record standalone tip |
| `sahr_finance_record_expense` | Log business expense |
| `sahr_finance_revenue_report` | Generate revenue report |
| `sahr_finance_customer_ltv` | Calculate customer lifetime value |
| `sahr_finance_list_unsynced` | List unsynced completed bookings |
| `sahr_finance_bulk_sync` | Sync multiple bookings at once |

## Best Practices

### Sync Timing
- Sync bookings as soon as payment is received
- Don't wait to batch sync (risk of forgetting)
- Use bulk sync for catching up

### Expense Tracking
- Record expenses as they occur
- Always note if receipt is available
- Include vendor name for tax purposes

### Report Frequency
- Weekly quick check: revenue this week
- Monthly detailed: full report with customer breakdown
- Quarterly: compare months, identify trends

## Common Scenarios

### "How much did we make last week?"

```
sahr_finance_revenue_report({
  startDate: "2026-01-27",
  endDate: "2026-02-02"
})
```

### "What's Marwa's total spend with us?"

```
sahr_finance_customer_ltv({
  customerName: "Marwa"
})
```

### "Log the supplies I bought today"

```
sahr_finance_record_expense({
  description: "Detailing supplies",
  amount: 156.99,
  category: "supplies",
  vendor: "Amazon",
  date: "2026-02-02",
  receipt: true
})
```

### "Sync all unsynced bookings"

```
// First, get the list
sahr_finance_list_unsynced({ limit: 20 })

// Then bulk sync
sahr_finance_bulk_sync({
  bookingIds: ["id1", "id2", "id3"],
  defaultPaymentMethod: "etransfer"
})
```
