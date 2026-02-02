---
name: sahr-chat-parser
description: "Parse iMessage/SMS chat screenshots to extract customer, booking, and business intelligence data for Sahr Auto Detailing CRM. Use when images of text conversations are shared."
metadata: {"clawdbot":{"emoji":"📱","triggers":["parse chat","extract from screenshot","analyze conversation"]}}
---

# Sahr Chat Parser

You can analyze iMessage/SMS screenshots to extract CRM data for Sahr Auto Detailing. When a user shares chat screenshots, carefully read the conversation and extract all relevant business data.

## When to Use This Skill

- User shares screenshots of text conversations
- User asks to "parse this chat" or "extract customer info"
- User wants to update CRM from a conversation
- User mentions customer names and wants to log interaction

## Data Extraction Guide

### 1. Customer Information

**Look for these patterns:**

| Pattern | Extract |
|---------|---------|
| Greeting ("Hey Marwa", "Hi Sarah") | Customer name |
| "My friend [name] referred me" | Referral source |
| "I'm in [area]", "North end" | Location area |
| Full street address with number | Service address |
| "Text me at...", phone numbers | Phone number |
| "My truck", "I have a..." | Vehicle type |
| Vehicle nicknames ("Black Panther") | Vehicle nickname (emotional attachment!) |

**Vehicle Details to Capture:**
```
Year: 2019, 2022, etc.
Make: Toyota, RAM, Ford, Mazda
Model: 4Runner, 1500, F-150, CX-5
Color: Black, White, Grey
Trim: Limited, Sport, etc.
Special notes: "Ceramic coated", "White leather interior"
```

### 2. Booking Information

**Time Patterns:**
| Customer Says | Parse As |
|--------------|----------|
| "Tomorrow evening" | Next day, ~18:00 |
| "Wednesday around 6" | Weekday + approximate time |
| "The 27th at 6:30" | Day of month + time |
| "After 3pm" | Earliest time constraint |
| "Between 12-8pm" | Time window |

**Location Types:**
| Indicator | Type |
|-----------|------|
| Full address given | `customer_home` |
| "At the wash bay", "meet at car wash" | `wash_bay` |
| "Your place", "I'll come to you" | `mobile` |
| Winter/Edmonton weather mentioned | Likely `wash_bay` |

**Service Types:**
| Phrase | Service |
|--------|---------|
| "Full detail", "the works" | `full_detail` |
| "Just the inside", "interior only" | `interior` |
| "Outside only", "exterior" | `exterior` |
| "Ceramic coating", "protection" | `coating` |
| "Quick wash", "just a wash" | `wash` |

### 3. Pricing Intelligence

**Price Tier Indicators:**

| Indicator | Tier | Price |
|-----------|------|-------|
| New customer, no referral | Standard | $160 |
| "My friend referred me" | Referral | $135 |
| "Every month", "6+ times/year" | Loyalty | $115 |
| Explicit discount negotiation | Custom | As stated |

**Competitor Intel to Capture:**
- Competitor name (e.g., "In and Out Auto Spa")
- Competitor contact name (e.g., "Kal")
- Competitor price mentioned
- Frequency with competitor
- Why they're switching

### 4. Communication Patterns

**Watch for these relationship indicators:**

| Pattern | Meaning | Action |
|---------|---------|--------|
| "My friend would like..." | Referral opportunity | Track family contact |
| "Would your parents..." | Family expansion | Note relation |
| Customer names car | Emotional attachment | Save nickname |
| "Running late" | Schedule flexibility | Log graceful handling |
| "Sorry to reschedule" | Pattern change | Update booking |
| Mentions competitor | Price sensitivity | Record intel |
| "Every [X] weeks" | Recurring customer | Note frequency |

**Payment Method Indicators:**
| Phrase | Method |
|--------|--------|
| "E-transfer", "Interac" | E-transfer (saffacompany@gmail.com) |
| "Stripe", "pay online" | Stripe portal |
| "Cash", "I have cash" | Cash |
| "Debit/credit" | Card |
| Security question mentioned | E-transfer with password |

### 5. Action Items to Identify

**High Priority:**
- Create new customer record
- Schedule confirmed booking
- Apply referral credit

**Medium Priority:**
- Add vehicle to profile
- Update next appointment
- Follow up on family referral
- Reschedule existing booking

**Low Priority:**
- Log communication summary
- Update customer notes
- Record competitor intel

## Extraction Workflow

### Step 1: Read the Full Conversation

Read all screenshots in order. Note:
- Who is speaking (Sahr = gray bubbles, Customer = blue/green bubbles)
- Date/time stamps visible
- The flow of negotiation/scheduling

### Step 2: Extract Core Data

Use `sahr_chat_quick_summary` to create a brief summary:

```
Customer: Marwa
Key Points:
• Referral from Andrey
• Drives a truck
• North end, Cy Becker area
• Address: 17503 46 Street NW
• Agreed to $115 loyalty rate (6+/year)
• First booking: Aug 5 @ 6:30pm

Actions Needed:
1. Create customer record
2. Add vehicle
3. Create booking
4. Log referral source
```

### Step 3: Structure the Data

Use `sahr_chat_structure_parse` with all extracted fields:

```
customerName: "Marwa"
customerArea: "North end, Cy Becker"
customerAddress: "17503 46 Street NW"
referralSource: "Andrey"
vehicleType: "truck"
serviceType: "full_detail"
appointmentDate: "2025-08-05"
appointmentTime: "18:30"
price: 115
priceNotes: "Loyalty rate, 6+ details/year commitment"
locationType: "customer_home"
competitorName: "In and Out Auto Spa"
competitorPrice: 90
actionItems: [
  { type: "create_customer", priority: "high", description: "Create Marwa profile" },
  { type: "add_vehicle", priority: "high", description: "Add truck to profile" },
  { type: "create_booking", priority: "high", description: "Book Aug 5 @ 6:30pm" },
  { type: "follow_up", priority: "medium", description: "Schedule mom's appointment" }
]
```

### Step 4: Generate CRM Commands

Use `sahr_chat_generate_crm_commands` to get ready-to-run tool calls.

### Step 5: Execute with sahr-crm Tools

Use the sahr-crm tools to actually create the records:
1. `sahr_crm_create_customer`
2. `sahr_crm_add_vehicle`
3. `sahr_crm_create_booking`
4. `sahr_crm_log_communication`

## Multi-Screenshot Conversations

When analyzing a series of screenshots (e.g., IMG_0199 through IMG_0205):

1. **Identify the arc** - Initial inquiry → Negotiation → Booking → Follow-up
2. **Track timeline** - Note when conversation spans multiple days
3. **Capture evolution** - Price started at $160, negotiated to $115
4. **Note relationship growth** - From stranger → valued customer → family referrals

## Example Full Parse

**Input:** Screenshots showing conversation with "Marwa"

**Extracted:**
```yaml
Customer:
  name: Marwa
  referral: Andrey
  area: "North end, Cy Becker"
  address: "17503 46 Street NW"
  vehicle: truck
  price_tier: loyalty ($115)
  frequency: "1.5 months summer, monthly winter"

Booking:
  date: August 5, 2025
  time: 6:30 PM
  service: full_detail
  price: $115
  location_type: customer_home

Competitor Intel:
  name: "In and Out Auto Spa"
  contact: Kal
  price: $90/month (grandfather rate)
  notes: "No carpet steam included"

Family Expansion:
  - Mom (different address: 11203 97 Street NW)
  - Friday appointment mentioned

Payment:
  method: flexible (Stripe, debit, credit, cash)
  tip: received (amount not specified)

Action Items:
  1. [HIGH] Create customer: Marwa
  2. [HIGH] Add vehicle: truck
  3. [HIGH] Book: Aug 5 @ 6:30pm, $115
  4. [MEDIUM] Create customer: Marwa's Mom
  5. [MEDIUM] Schedule: Mom's Friday appointment
  6. [LOW] Log: Competitor intel for In and Out
```

## Quality Checks

Before submitting parsed data, verify:

- [ ] Customer name is correctly spelled
- [ ] Address includes full street number
- [ ] Date is in correct format (YYYY-MM-DD)
- [ ] Time is unambiguous (24hr preferred)
- [ ] Price matches agreed amount
- [ ] Referral source is actual person name
- [ ] Action items are prioritized correctly

## Common Mistakes to Avoid

1. **Wrong date format** - Use YYYY-MM-DD, not "tomorrow"
2. **Missing referral credit** - If referred, price should be $135 or note why different
3. **Ignoring family contacts** - These are future customers!
4. **Skipping competitor intel** - Valuable for pricing strategy
5. **Not logging the communication** - Always log after parsing

## Tools Reference

| Tool | When to Use |
|------|-------------|
| `sahr_chat_quick_summary` | Initial review before full parse |
| `sahr_chat_structure_parse` | Full structured extraction |
| `sahr_chat_generate_crm_commands` | Generate ready-to-run CRM calls |
| `sahr_crm_*` | Execute the actual CRM operations |
