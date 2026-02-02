/**
 * Sahr Scheduler Plugin for Clawdbot (CT2)
 *
 * Provides appointment scheduling, availability checking, and reminder management
 * for Sahr Auto Detailing. Integrates with sahr-crm for booking data.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  Timestamp,
  orderBy,
  Firestore,
} from "firebase/firestore";

// ============================================================================
// TYPES
// ============================================================================

interface TimeSlot {
  date: string;
  time: string;
  available: boolean;
  reason?: string;
}

interface Reminder {
  id?: string;
  customerId: string;
  customerName: string;
  type: "booking_confirmation" | "day_before" | "follow_up" | "rebooking" | "custom";
  scheduledFor: Date;
  message: string;
  status: "pending" | "sent" | "cancelled";
  bookingId?: string;
  createdAt: Date;
  sentAt?: Date;
}

interface BookingConflict {
  bookingId: string;
  customerName: string;
  date: string;
  time: string;
  location: string;
  travelTime?: number;
}

// Edmonton seasons for location suggestions
type Season = "winter" | "summer" | "shoulder";

// ============================================================================
// CONSTANTS
// ============================================================================

const EDMONTON_COORDS = { lat: 53.5461, lng: -113.4938 };

// Service durations in minutes
const SERVICE_DURATIONS: Record<string, number> = {
  full_detail: 180,
  interior: 90,
  exterior: 60,
  coating: 300,
  wash: 45,
};

// Buffer time between appointments (travel + setup)
const BUFFER_MINUTES = 30;

// Rebooking intervals by frequency preference
const REBOOKING_INTERVALS: Record<string, number> = {
  weekly: 7,
  biweekly: 14,
  monthly: 30,
  "every_1.5_months": 45,
  "every_2_months": 60,
  quarterly: 90,
};

// ============================================================================
// HELPERS
// ============================================================================

function getCurrentSeason(): Season {
  const month = new Date().getMonth() + 1;
  if (month >= 11 || month <= 3) return "winter";
  if (month >= 5 && month <= 9) return "summer";
  return "shoulder";
}

function getSeasonalLocationSuggestion(season: Season): string {
  switch (season) {
    case "winter":
      return "wash_bay";
    case "summer":
      return "customer_home";
    case "shoulder":
      return "customer_home"; // Default to mobile in shoulder seasons
  }
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function parseDateTime(dateStr: string, timeStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const date = new Date(dateStr);
  date.setHours(hours, minutes, 0, 0);
  return date;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function getDayName(date: Date): string {
  return date.toLocaleDateString("en-US", { weekday: "long" });
}

function getRelativeDay(date: Date): string {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(date);
  target.setHours(0, 0, 0, 0);

  const diffDays = Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "today";
  if (diffDays === 1) return "tomorrow";
  if (diffDays === -1) return "yesterday";
  if (diffDays > 0 && diffDays <= 7) return `this ${getDayName(date)}`;
  return formatDate(date);
}

// ============================================================================
// PLUGIN DEFINITION
// ============================================================================

const sahrSchedulerPlugin = {
  id: "sahr-scheduler",
  name: "Sahr Scheduler",
  description: "Appointment scheduling and reminders for Sahr Auto Detailing",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const, default: true },
      defaultServiceDuration: { type: "number" as const, default: 180 },
      workingHours: {
        type: "object" as const,
        properties: {
          start: { type: "number" as const, default: 9 },
          end: { type: "number" as const, default: 21 },
        },
      },
      rebookingWindowDays: { type: "number" as const, default: 42 },
    },
  },

  register(api: ClawdbotPluginApi) {
    const config = api.pluginConfig as {
      enabled: boolean;
      defaultServiceDuration: number;
      workingHours: { start: number; end: number };
      rebookingWindowDays: number;
    };

    if (!config.enabled) {
      api.logger.info("Sahr Scheduler: Plugin disabled via config");
      return;
    }

    // Initialize Firebase
    let app: FirebaseApp;
    let db: Firestore;

    const firebaseConfig = {
      apiKey: process.env.FIREBASE_API_KEY,
      authDomain: process.env.FIREBASE_AUTH_DOMAIN,
      projectId: process.env.FIREBASE_PROJECT_ID || "saffa-finances",
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.FIREBASE_APP_ID,
    };

    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app);

    // -------------------------------------------------------------------------
    // TOOL: Check Availability
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_scheduler_check_availability",
      description:
        "Check Sahr's availability for a specific date or date range. Returns available time slots and any conflicts.",
      parameters: Type.Object({
        date: Type.String({ description: "Date to check (YYYY-MM-DD)" }),
        endDate: Type.Optional(
          Type.String({ description: "End date for range check (YYYY-MM-DD)" })
        ),
        serviceType: Type.Optional(
          Type.Union([
            Type.Literal("full_detail"),
            Type.Literal("interior"),
            Type.Literal("exterior"),
            Type.Literal("coating"),
            Type.Literal("wash"),
          ])
        ),
        preferredTime: Type.Optional(
          Type.String({ description: "Preferred time (HH:MM)" })
        ),
      }),
      async execute(_toolCallId, params) {
        const startDate = new Date(params.date);
        const endDate = params.endDate ? new Date(params.endDate) : startDate;
        const serviceDuration =
          SERVICE_DURATIONS[params.serviceType || "full_detail"] ||
          config.defaultServiceDuration;

        // Query existing bookings in date range
        const bookingsRef = collection(db, "sahr_bookings");
        const bookingsQuery = query(
          bookingsRef,
          where("appointmentDate", ">=", params.date),
          where("appointmentDate", "<=", params.endDate || params.date),
          where("status", "in", ["scheduled", "confirmed", "in_progress"]),
          orderBy("appointmentDate"),
          orderBy("appointmentTime")
        );

        const snapshot = await getDocs(bookingsQuery);
        const existingBookings: BookingConflict[] = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          existingBookings.push({
            bookingId: doc.id,
            customerName: data.customerName,
            date: data.appointmentDate,
            time: data.appointmentTime,
            location: data.location || "TBD",
          });
        });

        // Generate available slots
        const slots: TimeSlot[] = [];
        const currentDate = new Date(startDate);

        while (currentDate <= endDate) {
          const dateStr = formatDate(currentDate);
          const dayBookings = existingBookings.filter((b) => b.date === dateStr);

          // Check each hour from working hours start to end
          for (
            let hour = config.workingHours.start;
            hour <= config.workingHours.end - serviceDuration / 60;
            hour++
          ) {
            const timeStr = `${hour.toString().padStart(2, "0")}:00`;
            const slotStart = parseDateTime(dateStr, timeStr);
            const slotEnd = addMinutes(slotStart, serviceDuration + BUFFER_MINUTES);

            // Check for conflicts
            let conflict: BookingConflict | undefined;
            for (const booking of dayBookings) {
              const bookingStart = parseDateTime(booking.date, booking.time);
              const bookingEnd = addMinutes(
                bookingStart,
                serviceDuration + BUFFER_MINUTES
              );

              // Check overlap
              if (slotStart < bookingEnd && slotEnd > bookingStart) {
                conflict = booking;
                break;
              }
            }

            slots.push({
              date: dateStr,
              time: timeStr,
              available: !conflict,
              reason: conflict
                ? `Booked: ${conflict.customerName} at ${conflict.time}`
                : undefined,
            });
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Build response
        const availableSlots = slots.filter((s) => s.available);
        const season = getCurrentSeason();
        const suggestedLocation = getSeasonalLocationSuggestion(season);

        let output = `**Availability for ${params.date}${params.endDate ? ` to ${params.endDate}` : ""}**\n\n`;

        if (existingBookings.length > 0) {
          output += `**Existing Bookings:**\n`;
          existingBookings.forEach((b) => {
            output += `- ${b.date} @ ${b.time}: ${b.customerName} (${b.location})\n`;
          });
          output += "\n";
        }

        output += `**Available Slots (${availableSlots.length}):**\n`;
        if (availableSlots.length === 0) {
          output += "_No availability on this date_\n";
        } else {
          // Group by date
          const slotsByDate: Record<string, TimeSlot[]> = {};
          availableSlots.forEach((slot) => {
            if (!slotsByDate[slot.date]) slotsByDate[slot.date] = [];
            slotsByDate[slot.date].push(slot);
          });

          Object.entries(slotsByDate).forEach(([date, dateSlots]) => {
            const dayLabel = getRelativeDay(new Date(date));
            output += `\n**${dayLabel} (${date}):**\n`;
            dateSlots.forEach((slot) => {
              output += `  - ${slot.time}\n`;
            });
          });
        }

        output += `\n**Season:** ${season.charAt(0).toUpperCase() + season.slice(1)}`;
        output += `\n**Suggested Location:** ${suggestedLocation === "wash_bay" ? "Wash Bay (Edmonton weather)" : "Customer's Home (mobile)"}`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            slots,
            existingBookings,
            season,
            suggestedLocation,
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Suggest Booking Times
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_scheduler_suggest_times",
      description:
        "Suggest optimal booking times for a customer based on their preferences and history.",
      parameters: Type.Object({
        customerId: Type.Optional(Type.String({ description: "Customer ID for preference lookup" })),
        customerName: Type.String({ description: "Customer name" }),
        preferredDays: Type.Optional(
          Type.Array(
            Type.Union([
              Type.Literal("monday"),
              Type.Literal("tuesday"),
              Type.Literal("wednesday"),
              Type.Literal("thursday"),
              Type.Literal("friday"),
              Type.Literal("saturday"),
              Type.Literal("sunday"),
            ])
          )
        ),
        preferredTimeRange: Type.Optional(
          Type.Union([
            Type.Literal("morning"),
            Type.Literal("afternoon"),
            Type.Literal("evening"),
          ])
        ),
        serviceType: Type.Optional(Type.String()),
        urgency: Type.Optional(
          Type.Union([
            Type.Literal("asap"),
            Type.Literal("this_week"),
            Type.Literal("next_week"),
            Type.Literal("flexible"),
          ])
        ),
      }),
      async execute(_toolCallId, params) {
        const serviceDuration =
          SERVICE_DURATIONS[params.serviceType || "full_detail"] ||
          config.defaultServiceDuration;

        // Determine date range based on urgency
        const today = new Date();
        let startDate = new Date(today);
        let endDate = new Date(today);

        switch (params.urgency) {
          case "asap":
            endDate.setDate(today.getDate() + 3);
            break;
          case "this_week":
            endDate.setDate(today.getDate() + 7);
            break;
          case "next_week":
            startDate.setDate(today.getDate() + 7);
            endDate.setDate(today.getDate() + 14);
            break;
          default: // flexible
            endDate.setDate(today.getDate() + 14);
        }

        // Time ranges
        const timeRanges: Record<string, { start: number; end: number }> = {
          morning: { start: 9, end: 12 },
          afternoon: { start: 12, end: 17 },
          evening: { start: 17, end: 21 },
        };

        const preferredRange = timeRanges[params.preferredTimeRange || "afternoon"];

        // Query existing bookings
        const bookingsRef = collection(db, "sahr_bookings");
        const bookingsQuery = query(
          bookingsRef,
          where("appointmentDate", ">=", formatDate(startDate)),
          where("appointmentDate", "<=", formatDate(endDate)),
          where("status", "in", ["scheduled", "confirmed"])
        );

        const snapshot = await getDocs(bookingsQuery);
        const existingBookings: Array<{ date: string; time: string }> = [];
        snapshot.forEach((doc) => {
          const data = doc.data();
          existingBookings.push({
            date: data.appointmentDate,
            time: data.appointmentTime,
          });
        });

        // Generate suggestions
        const suggestions: Array<{
          date: string;
          time: string;
          score: number;
          reason: string;
        }> = [];

        const currentDate = new Date(startDate);
        while (currentDate <= endDate) {
          const dateStr = formatDate(currentDate);
          const dayName = getDayName(currentDate).toLowerCase();

          // Check if this day matches preferences
          const dayMatch =
            !params.preferredDays || params.preferredDays.includes(dayName as any);

          // Check each time slot
          for (let hour = preferredRange.start; hour < preferredRange.end; hour++) {
            const timeStr = `${hour.toString().padStart(2, "0")}:00`;

            // Check for conflicts
            const hasConflict = existingBookings.some((b) => {
              if (b.date !== dateStr) return false;
              const bookingHour = parseInt(b.time.split(":")[0]);
              const bookingEnd = bookingHour + Math.ceil(serviceDuration / 60);
              return hour >= bookingHour && hour < bookingEnd;
            });

            if (!hasConflict) {
              let score = 100;
              let reasons: string[] = [];

              // Prefer requested days
              if (dayMatch) {
                score += 20;
                reasons.push("matches preferred day");
              }

              // Prefer earlier in the date range for ASAP
              if (params.urgency === "asap") {
                const daysFromNow = Math.floor(
                  (currentDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
                );
                score += Math.max(0, 30 - daysFromNow * 5);
                if (daysFromNow <= 2) reasons.push("soon");
              }

              // Prefer popular times (5pm, 6pm for evening)
              if (hour === 17 || hour === 18) {
                score += 10;
                reasons.push("popular time");
              }

              suggestions.push({
                date: dateStr,
                time: timeStr,
                score,
                reason: reasons.join(", ") || "available",
              });
            }
          }

          currentDate.setDate(currentDate.getDate() + 1);
        }

        // Sort by score and take top 5
        suggestions.sort((a, b) => b.score - a.score);
        const topSuggestions = suggestions.slice(0, 5);

        // Build response
        let output = `**Suggested Times for ${params.customerName}**\n\n`;

        if (topSuggestions.length === 0) {
          output += "_No available slots found in the requested timeframe._\n";
          output += "\nTry:\n- Expanding the date range\n- Checking different time preferences\n";
        } else {
          output += "**Top Recommendations:**\n\n";
          topSuggestions.forEach((suggestion, i) => {
            const dayLabel = getRelativeDay(new Date(suggestion.date));
            const emoji = i === 0 ? "⭐" : "📅";
            output += `${emoji} **${dayLabel}** at **${suggestion.time}**`;
            if (suggestion.reason) output += ` _(${suggestion.reason})_`;
            output += "\n";
          });

          // Add draft message
          const top = topSuggestions[0];
          const topDayLabel = getRelativeDay(new Date(top.date));
          output += `\n**Draft Message:**\n> "Hey ${params.customerName}! How does ${topDayLabel} around ${top.time.replace(":00", "")}pm sound for your next detail?"`;
        }

        return {
          content: [{ type: "text" as const, text: output }],
          details: { suggestions: topSuggestions },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Create Reminder
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_scheduler_create_reminder",
      description: "Create a reminder for follow-ups, rebooking suggestions, or custom messages.",
      parameters: Type.Object({
        customerId: Type.String({ description: "Customer ID" }),
        customerName: Type.String({ description: "Customer name" }),
        type: Type.Union([
          Type.Literal("booking_confirmation"),
          Type.Literal("day_before"),
          Type.Literal("follow_up"),
          Type.Literal("rebooking"),
          Type.Literal("custom"),
        ]),
        scheduledFor: Type.String({
          description: "When to send the reminder (ISO date or relative like 'tomorrow 9am')",
        }),
        message: Type.String({ description: "Reminder message content" }),
        bookingId: Type.Optional(Type.String({ description: "Associated booking ID" })),
      }),
      async execute(_toolCallId, params) {
        // Parse scheduled time
        let scheduledDate: Date;
        const now = new Date();

        if (params.scheduledFor.toLowerCase() === "tomorrow") {
          scheduledDate = new Date(now);
          scheduledDate.setDate(scheduledDate.getDate() + 1);
          scheduledDate.setHours(9, 0, 0, 0);
        } else if (params.scheduledFor.toLowerCase().includes("tomorrow")) {
          scheduledDate = new Date(now);
          scheduledDate.setDate(scheduledDate.getDate() + 1);
          const timeMatch = params.scheduledFor.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
          if (timeMatch) {
            let hour = parseInt(timeMatch[1]);
            const minute = parseInt(timeMatch[2] || "0");
            if (timeMatch[3]?.toLowerCase() === "pm" && hour < 12) hour += 12;
            scheduledDate.setHours(hour, minute, 0, 0);
          }
        } else {
          scheduledDate = new Date(params.scheduledFor);
        }

        const reminder: Omit<Reminder, "id"> = {
          customerId: params.customerId,
          customerName: params.customerName,
          type: params.type,
          scheduledFor: scheduledDate,
          message: params.message,
          status: "pending",
          bookingId: params.bookingId,
          createdAt: new Date(),
        };

        // Save to Firestore
        const remindersRef = collection(db, "sahr_reminders");
        const docRef = await addDoc(remindersRef, {
          ...reminder,
          scheduledFor: Timestamp.fromDate(scheduledDate),
          createdAt: Timestamp.fromDate(reminder.createdAt),
        });

        const typeEmoji: Record<string, string> = {
          booking_confirmation: "✅",
          day_before: "📅",
          follow_up: "📞",
          rebooking: "🔄",
          custom: "📝",
        };

        const output = `**Reminder Created** ${typeEmoji[params.type] || "📝"}

**Customer:** ${params.customerName}
**Type:** ${params.type.replace(/_/g, " ")}
**Scheduled:** ${getRelativeDay(scheduledDate)} at ${formatTime(scheduledDate)}
**Message:**
> ${params.message}

_Reminder ID: ${docRef.id}_`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: { reminderId: docRef.id, reminder },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Generate Booking Confirmation
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_scheduler_generate_confirmation",
      description:
        "Generate a booking confirmation message in Sahr's communication style.",
      parameters: Type.Object({
        customerName: Type.String(),
        date: Type.String({ description: "Appointment date (YYYY-MM-DD)" }),
        time: Type.String({ description: "Appointment time (HH:MM)" }),
        serviceType: Type.Optional(Type.String()),
        location: Type.Optional(Type.String()),
        locationType: Type.Optional(
          Type.Union([
            Type.Literal("customer_home"),
            Type.Literal("wash_bay"),
            Type.Literal("mobile"),
          ])
        ),
        price: Type.Optional(Type.Number()),
        includePaymentInfo: Type.Optional(Type.Boolean()),
        includeUberOffer: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        const appointmentDate = new Date(params.date);
        const dayLabel = getRelativeDay(appointmentDate);
        const dayName = getDayName(appointmentDate);

        // Format time nicely
        const [hours, minutes] = params.time.split(":").map(Number);
        const timeFormatted = `${hours > 12 ? hours - 12 : hours}${minutes ? `:${minutes.toString().padStart(2, "0")}` : ""}${hours >= 12 ? "pm" : "am"}`;

        // Build confirmation message
        let message = `Hey ${params.customerName}! `;

        // Different styles based on context
        if (dayLabel === "tomorrow") {
          message += `Just confirming for tomorrow at ${timeFormatted}`;
        } else if (dayLabel.startsWith("this")) {
          message += `I've got you booked for ${dayName} at ${timeFormatted}`;
        } else {
          message += `You're all set for ${dayName} the ${appointmentDate.getDate()}${getOrdinal(appointmentDate.getDate())} at ${timeFormatted}`;
        }

        // Add location context
        if (params.locationType === "wash_bay") {
          message += `. We'll meet at the wash bay`;
          if (params.includeUberOffer) {
            message += `. I can get an Uber for you when you're ready - just let me know!`;
          }
        } else if (params.location) {
          message += ` at ${params.location}`;
        }

        message += `. See you then! - Sahr`;

        // Build payment section if requested
        let paymentInfo = "";
        if (params.includePaymentInfo && params.price) {
          paymentInfo = `\n\n**Payment Options:**\n- E-transfer: saffacompany@gmail.com\n- Stripe: [Payment Link]\n- Cash/Debit/Credit on site\n\nTotal: $${params.price}`;
        }

        const output = `**Draft Confirmation Message:**

> ${message}
${paymentInfo}

---
**Booking Details:**
- Customer: ${params.customerName}
- Date: ${params.date} (${dayName})
- Time: ${params.time}
- Service: ${params.serviceType || "Full Detail"}
- Location: ${params.locationType === "wash_bay" ? "Wash Bay" : params.location || "TBD"}
${params.price ? `- Price: $${params.price}` : ""}`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: { message, bookingDetails: params },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Suggest Rebooking
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_scheduler_suggest_rebooking",
      description:
        "Generate a rebooking suggestion for a customer based on their service frequency.",
      parameters: Type.Object({
        customerId: Type.String(),
        customerName: Type.String(),
        lastBookingDate: Type.String({ description: "Last booking date (YYYY-MM-DD)" }),
        frequency: Type.Optional(
          Type.Union([
            Type.Literal("weekly"),
            Type.Literal("biweekly"),
            Type.Literal("monthly"),
            Type.Literal("every_1.5_months"),
            Type.Literal("every_2_months"),
            Type.Literal("quarterly"),
          ])
        ),
        vehicleNickname: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const lastBooking = new Date(params.lastBookingDate);
        const interval = REBOOKING_INTERVALS[params.frequency || "monthly"];
        const suggestedDate = new Date(lastBooking);
        suggestedDate.setDate(suggestedDate.getDate() + interval);

        // If suggested date is in the past, suggest next available
        const today = new Date();
        if (suggestedDate < today) {
          suggestedDate.setTime(today.getTime());
          suggestedDate.setDate(suggestedDate.getDate() + 7);
        }

        const dayName = getDayName(suggestedDate);
        const dateNum = suggestedDate.getDate();
        const monthName = suggestedDate.toLocaleDateString("en-US", { month: "long" });

        // Generate message variations
        const vehicleRef = params.vehicleNickname
          ? `${params.vehicleNickname}'s next glow up`
          : "your next detail";

        const messages = [
          `Hey ${params.customerName}! How does ${dayName} ${monthName} ${dateNum}${getOrdinal(dateNum)} around 6pm sound for ${vehicleRef}?`,
          `Hi ${params.customerName}! Ready to schedule ${vehicleRef}? I have ${dayName} the ${dateNum}${getOrdinal(dateNum)} open if that works for you!`,
          `${params.customerName}! It's been about ${Math.round(interval / 7)} weeks - time for ${vehicleRef}? ${dayName} ${monthName} ${dateNum}${getOrdinal(dateNum)} is looking good on my end.`,
        ];

        // Check season for location suggestion
        const season = getCurrentSeason();
        let locationNote = "";
        if (season === "winter") {
          locationNote = `\n\n_Note: As we both know the Edmonton weather, we'll plan to meet at the wash bay again._`;
        }

        const output = `**Rebooking Suggestion for ${params.customerName}**

**Last Booking:** ${params.lastBookingDate}
**Frequency:** ${params.frequency?.replace(/_/g, " ") || "monthly"}
**Suggested Date:** ${formatDate(suggestedDate)} (${dayName})

**Draft Messages (choose one):**

1. > ${messages[0]}

2. > ${messages[1]}

3. > ${messages[2]}${locationNote}`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            suggestedDate: formatDate(suggestedDate),
            messages,
            season,
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: List Pending Reminders
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_scheduler_list_reminders",
      description: "List pending reminders, optionally filtered by customer or date range.",
      parameters: Type.Object({
        customerId: Type.Optional(Type.String()),
        status: Type.Optional(
          Type.Union([
            Type.Literal("pending"),
            Type.Literal("sent"),
            Type.Literal("cancelled"),
          ])
        ),
        limit: Type.Optional(Type.Number({ description: "Max reminders to return" })),
      }),
      async execute(_toolCallId, params) {
        const remindersRef = collection(db, "sahr_reminders");

        let remindersQuery;
        if (params.customerId) {
          remindersQuery = query(
            remindersRef,
            where("customerId", "==", params.customerId),
            where("status", "==", params.status || "pending"),
            orderBy("scheduledFor")
          );
        } else {
          remindersQuery = query(
            remindersRef,
            where("status", "==", params.status || "pending"),
            orderBy("scheduledFor")
          );
        }

        const snapshot = await getDocs(remindersQuery);
        const reminders: Reminder[] = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          reminders.push({
            id: doc.id,
            customerId: data.customerId,
            customerName: data.customerName,
            type: data.type,
            scheduledFor: data.scheduledFor.toDate(),
            message: data.message,
            status: data.status,
            bookingId: data.bookingId,
            createdAt: data.createdAt.toDate(),
          });
        });

        const limitedReminders = params.limit
          ? reminders.slice(0, params.limit)
          : reminders;

        const typeEmoji: Record<string, string> = {
          booking_confirmation: "✅",
          day_before: "📅",
          follow_up: "📞",
          rebooking: "🔄",
          custom: "📝",
        };

        let output = `**Pending Reminders (${limitedReminders.length})**\n\n`;

        if (limitedReminders.length === 0) {
          output += "_No pending reminders._\n";
        } else {
          limitedReminders.forEach((reminder) => {
            const emoji = typeEmoji[reminder.type] || "📝";
            const scheduledLabel = getRelativeDay(reminder.scheduledFor);
            output += `${emoji} **${reminder.customerName}** - ${reminder.type.replace(/_/g, " ")}\n`;
            output += `   Scheduled: ${scheduledLabel} at ${formatTime(reminder.scheduledFor)}\n`;
            output += `   > ${reminder.message.substring(0, 80)}${reminder.message.length > 80 ? "..." : ""}\n\n`;
          });
        }

        return {
          content: [{ type: "text" as const, text: output }],
          details: { reminders: limitedReminders },
        };
      },
    });

    // -------------------------------------------------------------------------
    // HELPER: Get ordinal suffix
    // -------------------------------------------------------------------------
    function getOrdinal(n: number): string {
      const s = ["th", "st", "nd", "rd"];
      const v = n % 100;
      return s[(v - 20) % 10] || s[v] || s[0];
    }

    // -------------------------------------------------------------------------
    // SERVICE REGISTRATION
    // -------------------------------------------------------------------------
    api.registerService({
      id: "sahr-scheduler",
      start: () => {
        api.logger.info("Sahr Scheduler service started");
      },
      stop: () => {
        api.logger.info("Sahr Scheduler service stopped");
      },
    });

    api.logger.info("Sahr Scheduler: Plugin registered with 6 tools");
  },
};

export default sahrSchedulerPlugin;
