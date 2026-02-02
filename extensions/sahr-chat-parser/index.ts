/**
 * Sahr Chat Parser Plugin for Clawdbot (CT2)
 *
 * Provides tools to structure and process parsed chat data from iMessage/SMS screenshots.
 * Works in conjunction with Claude's vision capabilities and the sahr-crm plugin.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { Type } from "@sinclair/typebox";

// ============================================================================
// TYPES
// ============================================================================

interface ParsedCustomerData {
  name: string;
  phone?: string;
  address?: string;
  locationArea?: string;
  referralSource?: string;
  vehicleType?: string;
  vehicleDetails?: {
    year?: number;
    make?: string;
    model?: string;
    color?: string;
    nickname?: string;
  };
  priceTier?: "standard" | "referral" | "loyalty";
  preferredContact?: "phone" | "text" | "email";
  communicationStyle?: string;
  notes?: string;
}

interface ParsedBookingData {
  serviceType?: string;
  date?: string;
  time?: string;
  location?: string;
  locationType?: "mobile" | "wash_bay" | "customer_home";
  price?: number;
  priceNotes?: string;
  status?: string;
  recurringSchedule?: string;
}

interface ParsedCompetitorIntel {
  name?: string;
  contact?: string;
  price?: number;
  notes?: string;
}

interface ParsedFamilyContact {
  relation: string;
  name?: string;
  address?: string;
  vehicleType?: string;
  notes?: string;
}

interface ActionItem {
  type: "create_customer" | "create_booking" | "update_booking" | "add_vehicle" | "follow_up" | "send_message" | "apply_credit";
  priority: "high" | "medium" | "low";
  description: string;
  data?: Record<string, unknown>;
}

interface ChatParseResult {
  conversationId?: string;
  participants: string[];
  dateRange?: {
    start?: string;
    end?: string;
  };
  customer: ParsedCustomerData;
  booking?: ParsedBookingData;
  competitorIntel?: ParsedCompetitorIntel;
  familyContacts?: ParsedFamilyContact[];
  paymentInfo?: {
    method?: string;
    email?: string;
    tipReceived?: boolean;
    tipAmount?: number;
  };
  communicationHighlights?: string[];
  actionItems: ActionItem[];
  rawNotes?: string;
}

// ============================================================================
// PLUGIN DEFINITION
// ============================================================================

const sahrChatParserPlugin = {
  id: "sahr-chat-parser",
  name: "Sahr Chat Parser",
  description: "Parse iMessage/SMS screenshots into structured CRM data",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const, default: true },
      autoCreateRecords: { type: "boolean" as const, default: false },
    },
  },

  register(api: ClawdbotPluginApi) {
    const config = api.pluginConfig as {
      enabled: boolean;
      autoCreateRecords: boolean;
    };

    if (!config.enabled) {
      api.logger.info("Sahr Chat Parser: Plugin disabled via config");
      return;
    }

    // -------------------------------------------------------------------------
    // TOOL: Structure Chat Parse Result
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_chat_structure_parse",
      description: "Structure extracted chat data into a standardized format for CRM import. Use after analyzing a chat screenshot with vision.",
      parameters: Type.Object({
        // Customer info
        customerName: Type.String({ description: "Customer's name" }),
        customerPhone: Type.Optional(Type.String({ description: "Phone number if visible" })),
        customerAddress: Type.Optional(Type.String({ description: "Full address" })),
        customerArea: Type.Optional(Type.String({ description: "Neighborhood/area (e.g., 'North end, Cy Becker')" })),
        referralSource: Type.Optional(Type.String({ description: "Who referred them" })),

        // Vehicle info
        vehicleType: Type.Optional(Type.String({ description: "Vehicle type (truck, SUV, sedan, etc.)" })),
        vehicleYear: Type.Optional(Type.Number({ description: "Vehicle year" })),
        vehicleMake: Type.Optional(Type.String({ description: "Vehicle make" })),
        vehicleModel: Type.Optional(Type.String({ description: "Vehicle model" })),
        vehicleColor: Type.Optional(Type.String({ description: "Vehicle color" })),
        vehicleNickname: Type.Optional(Type.String({ description: "Customer's nickname for vehicle" })),

        // Booking info
        serviceType: Type.Optional(Type.String({ description: "Service type discussed" })),
        appointmentDate: Type.Optional(Type.String({ description: "Appointment date (YYYY-MM-DD or description)" })),
        appointmentTime: Type.Optional(Type.String({ description: "Appointment time" })),
        location: Type.Optional(Type.String({ description: "Service location" })),
        locationType: Type.Optional(Type.Union([
          Type.Literal("mobile"),
          Type.Literal("wash_bay"),
          Type.Literal("customer_home"),
        ])),
        price: Type.Optional(Type.Number({ description: "Agreed price" })),
        priceNotes: Type.Optional(Type.String({ description: "Price context (referral discount, loyalty rate, etc.)" })),
        recurringSchedule: Type.Optional(Type.String({ description: "Recurring schedule mentioned" })),

        // Competitor intel
        competitorName: Type.Optional(Type.String({ description: "Competitor business name" })),
        competitorPrice: Type.Optional(Type.Number({ description: "Competitor's price mentioned" })),
        competitorNotes: Type.Optional(Type.String({ description: "Other competitor details" })),

        // Payment
        paymentMethod: Type.Optional(Type.String({ description: "Payment method discussed" })),
        tipReceived: Type.Optional(Type.Boolean({ description: "Whether tip was mentioned/received" })),
        tipAmount: Type.Optional(Type.Number({ description: "Tip amount if mentioned" })),

        // Family/referrals
        familyContacts: Type.Optional(Type.Array(Type.Object({
          relation: Type.String({ description: "Relation (mom, dad, friend, etc.)" }),
          name: Type.Optional(Type.String()),
          address: Type.Optional(Type.String()),
          vehicleType: Type.Optional(Type.String()),
        }))),

        // Action items
        actionItems: Type.Array(Type.Object({
          type: Type.Union([
            Type.Literal("create_customer"),
            Type.Literal("create_booking"),
            Type.Literal("update_booking"),
            Type.Literal("add_vehicle"),
            Type.Literal("follow_up"),
            Type.Literal("send_message"),
            Type.Literal("apply_credit"),
          ]),
          priority: Type.Union([
            Type.Literal("high"),
            Type.Literal("medium"),
            Type.Literal("low"),
          ]),
          description: Type.String({ description: "What needs to be done" }),
        })),

        // Additional context
        communicationHighlights: Type.Optional(Type.Array(Type.String(), { description: "Key points from the conversation" })),
        rawNotes: Type.Optional(Type.String({ description: "Additional notes or context" })),
      }),
      async execute(_toolCallId, params) {
        // Structure the parsed data
        const result: ChatParseResult = {
          participants: ["Sahr", params.customerName],
          customer: {
            name: params.customerName,
            phone: params.customerPhone,
            address: params.customerAddress,
            locationArea: params.customerArea,
            referralSource: params.referralSource,
            vehicleType: params.vehicleType,
            vehicleDetails: (params.vehicleYear || params.vehicleMake || params.vehicleModel || params.vehicleColor || params.vehicleNickname) ? {
              year: params.vehicleYear,
              make: params.vehicleMake,
              model: params.vehicleModel,
              color: params.vehicleColor,
              nickname: params.vehicleNickname,
            } : undefined,
            priceTier: params.referralSource ? "referral" : (params.recurringSchedule ? "loyalty" : "standard"),
          },
          actionItems: params.actionItems || [],
          communicationHighlights: params.communicationHighlights,
          rawNotes: params.rawNotes,
        };

        // Add booking if present
        if (params.serviceType || params.appointmentDate || params.price) {
          result.booking = {
            serviceType: params.serviceType,
            date: params.appointmentDate,
            time: params.appointmentTime,
            location: params.location,
            locationType: params.locationType,
            price: params.price,
            priceNotes: params.priceNotes,
            recurringSchedule: params.recurringSchedule,
          };
        }

        // Add competitor intel if present
        if (params.competitorName || params.competitorPrice) {
          result.competitorIntel = {
            name: params.competitorName,
            price: params.competitorPrice,
            notes: params.competitorNotes,
          };
        }

        // Add payment info if present
        if (params.paymentMethod || params.tipReceived) {
          result.paymentInfo = {
            method: params.paymentMethod,
            tipReceived: params.tipReceived,
            tipAmount: params.tipAmount,
          };
        }

        // Add family contacts if present
        if (params.familyContacts && params.familyContacts.length > 0) {
          result.familyContacts = params.familyContacts;
        }

        // Generate summary
        const summaryParts: string[] = [];
        summaryParts.push(`**Customer:** ${result.customer.name}`);

        if (result.customer.vehicleDetails || result.customer.vehicleType) {
          const vehicle = result.customer.vehicleDetails;
          const vehicleDesc = vehicle
            ? [vehicle.year, vehicle.make, vehicle.model, vehicle.color].filter(Boolean).join(" ")
            : result.customer.vehicleType;
          summaryParts.push(`**Vehicle:** ${vehicleDesc}${vehicle?.nickname ? ` "${vehicle.nickname}"` : ""}`);
        }

        if (result.booking) {
          summaryParts.push(`**Booking:** ${result.booking.serviceType || "Detail"} on ${result.booking.date || "TBD"} at ${result.booking.time || "TBD"} - $${result.booking.price || "TBD"}`);
        }

        if (result.customer.referralSource) {
          summaryParts.push(`**Referral:** From ${result.customer.referralSource}`);
        }

        if (result.competitorIntel) {
          summaryParts.push(`**Competitor Intel:** ${result.competitorIntel.name || "Unknown"} @ $${result.competitorIntel.price || "?"}`);
        }

        if (result.familyContacts && result.familyContacts.length > 0) {
          const familyList = result.familyContacts.map(f => f.relation).join(", ");
          summaryParts.push(`**Family/Referrals:** ${familyList}`);
        }

        if (result.actionItems.length > 0) {
          const highPriority = result.actionItems.filter(a => a.priority === "high");
          summaryParts.push(`\n**Action Items (${result.actionItems.length} total, ${highPriority.length} high priority):**`);
          result.actionItems.forEach(item => {
            const icon = item.priority === "high" ? "🔴" : item.priority === "medium" ? "🟡" : "🟢";
            summaryParts.push(`${icon} [${item.type}] ${item.description}`);
          });
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Chat parsed successfully!\n\n${summaryParts.join("\n")}`,
            },
          ],
          details: { parseResult: result },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Generate CRM Commands from Parse Result
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_chat_generate_crm_commands",
      description: "Generate suggested CRM tool calls from a parsed chat result",
      parameters: Type.Object({
        customerName: Type.String({ description: "Customer name" }),
        customerPhone: Type.Optional(Type.String()),
        customerAddress: Type.Optional(Type.String()),
        customerArea: Type.Optional(Type.String()),
        referralSource: Type.Optional(Type.String()),
        priceTier: Type.Optional(Type.Union([
          Type.Literal("standard"),
          Type.Literal("referral"),
          Type.Literal("loyalty"),
        ])),
        vehicleYear: Type.Optional(Type.Number()),
        vehicleMake: Type.Optional(Type.String()),
        vehicleModel: Type.Optional(Type.String()),
        vehicleColor: Type.Optional(Type.String()),
        vehicleNickname: Type.Optional(Type.String()),
        serviceType: Type.Optional(Type.String()),
        appointmentDate: Type.Optional(Type.String()),
        appointmentTime: Type.Optional(Type.String()),
        price: Type.Optional(Type.Number()),
        location: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const commands: string[] = [];

        // Customer creation command
        const customerArgs: string[] = [`name: "${params.customerName}"`];
        if (params.customerPhone) customerArgs.push(`phone: "${params.customerPhone}"`);
        if (params.customerAddress) customerArgs.push(`address: "${params.customerAddress}"`);
        if (params.customerArea) customerArgs.push(`locationArea: "${params.customerArea}"`);
        if (params.referralSource) customerArgs.push(`referralSource: "${params.referralSource}"`);
        if (params.priceTier) customerArgs.push(`priceTier: "${params.priceTier}"`);

        commands.push(`1. Create customer:\n   sahr_crm_create_customer({ ${customerArgs.join(", ")} })`);

        // Vehicle creation command (if vehicle info provided)
        if (params.vehicleMake || params.vehicleModel || params.vehicleYear) {
          const vehicleArgs: string[] = [`customerId: "<customer_id>"`];
          if (params.vehicleYear) vehicleArgs.push(`year: ${params.vehicleYear}`);
          if (params.vehicleMake) vehicleArgs.push(`make: "${params.vehicleMake}"`);
          if (params.vehicleModel) vehicleArgs.push(`model: "${params.vehicleModel}"`);
          if (params.vehicleColor) vehicleArgs.push(`color: "${params.vehicleColor}"`);
          if (params.vehicleNickname) vehicleArgs.push(`nickname: "${params.vehicleNickname}"`);

          commands.push(`2. Add vehicle:\n   sahr_crm_add_vehicle({ ${vehicleArgs.join(", ")} })`);
        }

        // Booking creation command (if booking info provided)
        if (params.serviceType || params.appointmentDate) {
          const bookingArgs: string[] = [
            `customerId: "<customer_id>"`,
            `customerName: "${params.customerName}"`,
          ];

          // Map service type
          let serviceTypeEnum = "full_detail";
          const st = (params.serviceType || "").toLowerCase();
          if (st.includes("interior")) serviceTypeEnum = "interior";
          else if (st.includes("exterior")) serviceTypeEnum = "exterior";
          else if (st.includes("coating") || st.includes("ceramic")) serviceTypeEnum = "coating";
          else if (st.includes("wash")) serviceTypeEnum = "wash";

          bookingArgs.push(`serviceType: "${serviceTypeEnum}"`);
          if (params.appointmentDate) bookingArgs.push(`appointmentDate: "${params.appointmentDate}"`);
          if (params.appointmentTime) bookingArgs.push(`appointmentTime: "${params.appointmentTime}"`);
          if (params.price) bookingArgs.push(`price: ${params.price}`);
          if (params.location) bookingArgs.push(`location: "${params.location}"`);

          commands.push(`3. Create booking:\n   sahr_crm_create_booking({ ${bookingArgs.join(", ")} })`);
        }

        const output = `**Suggested CRM Commands:**\n\n${commands.join("\n\n")}\n\n_Replace <customer_id> with the actual ID after creating the customer._`;

        return {
          content: [{ type: "text" as const, text: output }],
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Quick Parse Summary
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_chat_quick_summary",
      description: "Generate a quick summary of key data points from a chat for review before CRM entry",
      parameters: Type.Object({
        customerName: Type.String(),
        keyPoints: Type.Array(Type.String(), { description: "List of key data points extracted" }),
        actionNeeded: Type.Array(Type.String(), { description: "Actions that need to be taken" }),
        questionsToAsk: Type.Optional(Type.Array(Type.String(), { description: "Clarifying questions if data is ambiguous" })),
      }),
      async execute(_toolCallId, params) {
        let output = `**Quick Parse Summary: ${params.customerName}**\n\n`;

        output += "**Key Data Points:**\n";
        params.keyPoints.forEach(point => {
          output += `• ${point}\n`;
        });

        output += "\n**Actions Needed:**\n";
        params.actionNeeded.forEach((action, i) => {
          output += `${i + 1}. ${action}\n`;
        });

        if (params.questionsToAsk && params.questionsToAsk.length > 0) {
          output += "\n**Needs Clarification:**\n";
          params.questionsToAsk.forEach(q => {
            output += `❓ ${q}\n`;
          });
        }

        return {
          content: [{ type: "text" as const, text: output }],
        };
      },
    });

    // -------------------------------------------------------------------------
    // SERVICE REGISTRATION
    // -------------------------------------------------------------------------
    api.registerService({
      id: "sahr-chat-parser",
      start: () => {
        api.logger.info("Sahr Chat Parser service started");
      },
      stop: () => {
        api.logger.info("Sahr Chat Parser service stopped");
      },
    });

    api.logger.info("Sahr Chat Parser: Plugin registered with 3 tools");
  },
};

export default sahrChatParserPlugin;
