---
name: sahr-scheduler
description: "Manage appointments, check availability, suggest booking times, and handle reminders for Sahr Auto Detailing. Use for scheduling, rebooking, and follow-up coordination."
metadata: {"clawdbot":{"emoji":"📅","triggers":["schedule","book appointment","availability","remind me","when is","next booking"]}}
---

# Sahr Scheduler

You can manage appointments, check availability, suggest optimal booking times, and create reminders for Sahr Auto Detailing customers.

## When to Use This Skill

- User asks about availability for a date/time
- User wants to schedule or book an appointment
- User asks to suggest times for a customer
- User wants to set up reminders or follow-ups
- User mentions rebooking or next appointment
- User asks about Edmonton weather/season for location

## Scheduling Workflow

### 1. Check Availability

Before suggesting times, check existing bookings:

```
sahr_scheduler_check_availability({
  date: "2026-02-10",
  serviceType: "full_detail"
})
```

**Output shows:**
- Existing bookings with times/locations
- Available time slots
- Season awareness (winter → wash bay recommended)

### 2. Suggest Times

For personalized suggestions based on customer preferences:

```
sahr_scheduler_suggest_times({
  customerName: "Marwa",
  preferredDays: ["tuesday", "wednesday"],
  preferredTimeRange: "evening",
  urgency: "this_week"
})
```

**Urgency Options:**
| Urgency | Date Range |
|---------|------------|
| `asap` | Next 3 days |
| `this_week` | Next 7 days |
| `next_week` | Days 7-14 |
| `flexible` | Next 14 days |

**Time Ranges:**
| Range | Hours |
|-------|-------|
| `morning` | 9am - 12pm |
| `afternoon` | 12pm - 5pm |
| `evening` | 5pm - 9pm |

### 3. Generate Confirmation

Create a booking confirmation message:

```
sahr_scheduler_generate_confirmation({
  customerName: "Marwa",
  date: "2026-02-10",
  time: "18:30",
  serviceType: "full_detail",
  locationType: "wash_bay",
  price: 115,
  includeUberOffer: true
})
```

**Output includes:**
- Draft message in Sahr's style
- Payment options (if requested)
- Booking summary

## Service Durations

| Service | Duration | Buffer |
|---------|----------|--------|
| Full Detail | 3 hours | +30 min |
| Interior Only | 1.5 hours | +30 min |
| Exterior Only | 1 hour | +30 min |
| Ceramic Coating | 5 hours | +30 min |
| Wash | 45 min | +30 min |

## Edmonton Weather Awareness

The scheduler automatically considers Edmonton seasons:

| Season | Months | Default Location |
|--------|--------|------------------|
| Winter | Nov - Mar | Wash Bay |
| Shoulder | Apr, Oct | Customer's Home |
| Summer | May - Sep | Customer's Home |

**Winter messaging example:**
> "As we both know the Edmonton weather, we'll plan to meet at the wash bay again."

## Reminders System

### Reminder Types

| Type | When to Use |
|------|-------------|
| `booking_confirmation` | Immediately after booking |
| `day_before` | 24 hours before appointment |
| `follow_up` | 2-3 days after service |
| `rebooking` | Based on customer frequency |
| `custom` | Any other reminder |

### Creating Reminders

```
sahr_scheduler_create_reminder({
  customerId: "cust_123",
  customerName: "Marwa",
  type: "day_before",
  scheduledFor: "2026-02-09T09:00:00",
  message: "Hey Marwa! Just a reminder about tomorrow at 6:30pm. See you then!",
  bookingId: "booking_456"
})
```

### Reminder Timing Best Practices

| Reminder Type | Timing |
|--------------|--------|
| Booking confirmation | Immediately |
| Day before | 9am the day before |
| Follow-up | 2-3 days after service, 10am |
| Rebooking | Based on frequency, evening |

## Rebooking Suggestions

Generate rebooking messages based on customer frequency:

```
sahr_scheduler_suggest_rebooking({
  customerId: "cust_123",
  customerName: "Marwa",
  lastBookingDate: "2026-01-15",
  frequency: "every_1.5_months",
  vehicleNickname: "Black Panther"
})
```

**Frequency Options:**
| Frequency | Days Between |
|-----------|--------------|
| `weekly` | 7 |
| `biweekly` | 14 |
| `monthly` | 30 |
| `every_1.5_months` | 45 |
| `every_2_months` | 60 |
| `quarterly` | 90 |

## Message Style Guide

### Confirmation Messages

**Standard:**
> "Hey Marwa! I've got you booked for Tuesday at 6pm. See you then! - Sahr"

**With location:**
> "Hey Marwa! You're all set for Friday the 14th at 6:30pm at 17503 46 Street NW. See you then! - Sahr"

**Wash bay with Uber:**
> "Hey Marwa! Just confirming for tomorrow at 6pm. We'll meet at the wash bay. I can get an Uber for you when you're ready - just let me know!"

### Rebooking Messages

**Casual:**
> "Hey Marwa! How does Wednesday February 26th around 6pm sound for your next detail?"

**With vehicle nickname:**
> "Marwa! It's been about 6 weeks - time for Black Panther's next glow up? Thursday the 27th is looking good on my end."

### Late/Reschedule Handling

**Running late:**
> "Hey! Just finishing up on the southside, I'll be about 10-15 min late. Drive safe!"

**Customer reschedules:**
> "Yeah absolutely, no problem at all. Just let me know when works better for you."

## Workflow Examples

### New Booking from Scratch

1. Check availability for requested date
2. Suggest 3-5 optimal times
3. Confirm customer's choice
4. Generate confirmation message
5. Create day-before reminder

### Proactive Rebooking

1. Check customer's last booking date
2. Calculate next booking based on frequency
3. Generate rebooking suggestion with 3 message options
4. After confirmation, create booking + reminders

### Schedule Change

1. Look up existing booking
2. Check availability for new date/time
3. Update booking (via sahr-crm)
4. Generate new confirmation
5. Update/cancel existing reminders

## Tools Reference

| Tool | Purpose |
|------|---------|
| `sahr_scheduler_check_availability` | Check open slots for a date |
| `sahr_scheduler_suggest_times` | Get personalized time suggestions |
| `sahr_scheduler_create_reminder` | Create follow-up reminders |
| `sahr_scheduler_generate_confirmation` | Draft confirmation messages |
| `sahr_scheduler_suggest_rebooking` | Generate rebooking suggestions |
| `sahr_scheduler_list_reminders` | View pending reminders |

## Integration with sahr-crm

After scheduling is confirmed:

1. Use `sahr_crm_create_booking` to create the booking record
2. Use `sahr_scheduler_create_reminder` for day-before reminder
3. Use `sahr_scheduler_create_reminder` for follow-up reminder

## Quality Checklist

Before sending any scheduling message:

- [ ] Date is correct and unambiguous
- [ ] Time is in customer-friendly format (6pm not 18:00)
- [ ] Location type matches season (winter → wash bay)
- [ ] Price matches customer's tier
- [ ] Reminder is scheduled appropriately
- [ ] Message matches Sahr's friendly, professional style
