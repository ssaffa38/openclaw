/**
 * Sahr Finance Sync Plugin for Clawdbot (CT2)
 *
 * Syncs Sahr Auto Detailing CRM data (bookings, tips, refunds) to the
 * Saffa Finances dashboard. Creates transactions, tracks revenue, and
 * generates financial reports.
 */

import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { initializeApp, getApps, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  query,
  where,
  getDocs,
  getDoc,
  addDoc,
  updateDoc,
  doc,
  Timestamp,
  orderBy,
  Firestore,
  limit,
} from "firebase/firestore";

// ============================================================================
// TYPES
// ============================================================================

interface Transaction {
  id?: string;
  date: string;
  description: string;
  amount: number;
  currency: string;
  account?: string;
  accountId?: string;
  category: string;
  categorySource: "auto" | "manual" | "crm-sync";
  entity: string;
  source: string;
  importedAt: string;
  metadata?: {
    bookingId?: string;
    customerId?: string;
    customerName?: string;
    serviceType?: string;
    tipAmount?: number;
    syncedAt?: string;
  };
}

interface BookingData {
  id: string;
  customerId: string;
  customerName: string;
  serviceType: string;
  appointmentDate: string;
  appointmentTime?: string;
  price: number;
  tipAmount?: number;
  status: string;
  paymentMethod?: string;
  completedAt?: Date;
  financeSynced?: boolean;
  financeTransactionId?: string;
}

interface RevenueReport {
  period: string;
  totalRevenue: number;
  totalTips: number;
  bookingCount: number;
  averageBookingValue: number;
  byServiceType: Record<string, { count: number; revenue: number }>;
  byCustomer: Array<{ name: string; revenue: number; bookings: number }>;
  topCustomers: Array<{ name: string; ltv: number }>;
}

// ============================================================================
// CONSTANTS
// ============================================================================

const SERVICE_CATEGORIES: Record<string, string> = {
  full_detail: "auto-detailing",
  interior: "auto-detailing",
  exterior: "auto-detailing",
  coating: "auto-detailing",
  wash: "auto-detailing",
};

const PAYMENT_ACCOUNTS: Record<string, string> = {
  etransfer: "sahr-etransfer",
  "e-transfer": "sahr-etransfer",
  stripe: "sahr-stripe",
  cash: "sahr-cash",
  debit: "sahr-debit",
  credit: "sahr-debit",
};

// ============================================================================
// HELPERS
// ============================================================================

function generateTransactionId(prefix: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `${prefix}_${timestamp}${random}`;
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency: "CAD",
  }).format(amount);
}

function getServiceDescription(serviceType: string, customerName: string): string {
  const serviceNames: Record<string, string> = {
    full_detail: "Full Detail",
    interior: "Interior Detail",
    exterior: "Exterior Detail",
    coating: "Ceramic Coating",
    wash: "Car Wash",
  };
  return `${serviceNames[serviceType] || "Detail"} - ${customerName}`;
}

// ============================================================================
// PLUGIN DEFINITION
// ============================================================================

const sahrFinanceSyncPlugin = {
  id: "sahr-finance-sync",
  name: "Sahr Finance Sync",
  description: "Sync Sahr Auto Detailing revenue to Saffa Finances",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      enabled: { type: "boolean" as const, default: true },
      entityId: { type: "string" as const, default: "sahr-auto" },
      defaultAccount: { type: "string" as const, default: "sahr-etransfer" },
      autoSync: { type: "boolean" as const, default: false },
    },
  },

  register(api: OpenClawPluginApi) {
    const config = (api.pluginConfig || {}) as {
      enabled?: boolean;
      firebaseApiKey?: string;
      firebaseProjectId?: string;
      entityId?: string;
      defaultAccount?: string;
      autoSync?: boolean;
    };

    if (config.enabled === false) {
      api.logger.info("Sahr Finance Sync: Plugin disabled via config");
      return;
    }

    // Apply defaults
    const entityId = config.entityId ?? "sahr-auto";
    const defaultAccount = config.defaultAccount ?? "sahr-etransfer";

    // Initialize Firebase
    let app: FirebaseApp;
    let db: Firestore;

    const firebaseConfig = {
      apiKey: config.firebaseApiKey || process.env.FIREBASE_API_KEY,
      projectId: config.firebaseProjectId || process.env.FIREBASE_PROJECT_ID || "saffa-finances",
    };

    if (getApps().length === 0) {
      app = initializeApp(firebaseConfig);
    } else {
      app = getApps()[0];
    }
    db = getFirestore(app);

    // -------------------------------------------------------------------------
    // TOOL: Create Generic Transaction (for receipt capture, manual entry, etc.)
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "saffa_finance_create_transaction",
      description:
        "Create a transaction in Saffa Finances. Use this for receipt capture, manual expense entry, or any transaction that needs to be recorded.",
      parameters: Type.Object({
        date: Type.String({ description: "Transaction date (YYYY-MM-DD)" }),
        description: Type.String({ description: "Transaction description (merchant, purpose)" }),
        amount: Type.Number({ description: "Amount (positive for income, negative for expense)" }),
        category: Type.String({
          description:
            "Category (software, supplies, meals, travel, advertising, utilities, general, subscriptions, tech-infra, dining, transportation, etc.)",
        }),
        entities: Type.Array(Type.String(), {
          description:
            "Business entity IDs (e.g. ['ct-networks', 'nimbus-creative']). Can be multiple for shared expenses.",
        }),
        account: Type.Optional(
          Type.String({
            description:
              "Account ID (e.g. amex-platinum-72000, mercury-nimbus-2442). Required for proper tracking.",
          }),
        ),
        currency: Type.Optional(
          Type.String({ description: "Currency code (CAD, USD). Defaults to CAD" }),
        ),
        source: Type.Optional(
          Type.String({ description: "Source of transaction (receipt-capture, manual, import)" }),
        ),
        metadata: Type.Optional(
          Type.Object({
            merchant: Type.Optional(Type.String()),
            notes: Type.Optional(Type.String()),
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const entitiesArr = params.entities || [];
        const primaryEntity = entitiesArr[0] || "personal";

        const transaction: Transaction = {
          id: generateTransactionId("tx"),
          date: params.date,
          description: params.description,
          amount: params.amount,
          currency: params.currency || "CAD",
          account: params.account,
          category: params.category,
          categorySource: "manual",
          entity: primaryEntity,
          source: params.source || "receipt-capture",
          importedAt: new Date().toISOString(),
          metadata: {
            ...(params.metadata || {}),
            syncedAt: new Date().toISOString(),
          },
        };

        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, {
          ...transaction,
          entities: entitiesArr,
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });

        const amountStr =
          params.amount < 0
            ? `-${formatCurrency(Math.abs(params.amount))}`
            : formatCurrency(params.amount);

        const output = `**Transaction Created** ✅

- **Description:** ${params.description}
- **Amount:** ${amountStr} ${params.currency || "CAD"}
- **Date:** ${params.date}
- **Category:** ${params.category}
- **Business:** ${entitiesArr.join(", ")}
${params.account ? `- **Account:** ${params.account}` : ""}

_Transaction ID: ${docRef.id}_

🔗 View: https://saffa-finances.web.app`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: { transaction, firebaseId: docRef.id },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Sync Booking to Finance
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_sync_booking",
      description:
        "Create a finance transaction from a completed booking. Use after a booking is marked as paid/completed.",
      parameters: Type.Object({
        bookingId: Type.String({ description: "Booking ID to sync" }),
        overrideAmount: Type.Optional(
          Type.Number({ description: "Override the booking amount if different" }),
        ),
        paymentMethod: Type.Optional(
          Type.String({ description: "Payment method used (etransfer, stripe, cash, debit)" }),
        ),
        notes: Type.Optional(Type.String({ description: "Additional notes for the transaction" })),
      }),
      async execute(_toolCallId, params) {
        // Fetch the booking
        const bookingRef = doc(db, "sahr_bookings", params.bookingId);
        const bookingSnap = await getDoc(bookingRef);

        if (!bookingSnap.exists()) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Error:** Booking ${params.bookingId} not found.`,
              },
            ],
          };
        }

        const booking = bookingSnap.data() as BookingData;

        // Check if already synced
        if (booking.financeSynced && booking.financeTransactionId) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Already Synced:** This booking was already synced as transaction ${booking.financeTransactionId}.`,
              },
            ],
          };
        }

        // Determine account based on payment method
        const paymentMethod = params.paymentMethod || booking.paymentMethod || "etransfer";
        const accountId = PAYMENT_ACCOUNTS[paymentMethod.toLowerCase()] || defaultAccount;

        // Create the transaction
        const amount = params.overrideAmount || booking.price;
        const transaction: Transaction = {
          id: generateTransactionId("sahr"),
          date: booking.appointmentDate,
          description: getServiceDescription(booking.serviceType, booking.customerName),
          amount: amount, // Positive for income
          currency: "CAD",
          accountId: accountId,
          category: SERVICE_CATEGORIES[booking.serviceType] || "auto-detailing",
          categorySource: "crm-sync",
          entity: entityId,
          source: "sahr-crm",
          importedAt: new Date().toISOString(),
          metadata: {
            bookingId: params.bookingId,
            customerId: booking.customerId,
            customerName: booking.customerName,
            serviceType: booking.serviceType,
            syncedAt: new Date().toISOString(),
          },
        };

        // Add notes if provided
        if (params.notes) {
          transaction.description += ` (${params.notes})`;
        }

        // Save transaction to Firestore
        const transactionsRef = collection(db, "transactions");
        const txDocRef = await addDoc(transactionsRef, transaction);

        // Update booking with sync status
        await updateDoc(bookingRef, {
          financeSynced: true,
          financeTransactionId: txDocRef.id,
          financeSyncedAt: Timestamp.now(),
        });

        // Handle tip as separate transaction if present
        let tipTransaction: Transaction | null = null;
        if (booking.tipAmount && booking.tipAmount > 0) {
          tipTransaction = {
            id: generateTransactionId("sahr_tip"),
            date: booking.appointmentDate,
            description: `Tip - ${booking.customerName}`,
            amount: booking.tipAmount,
            currency: "CAD",
            accountId: accountId,
            category: "tips",
            categorySource: "crm-sync",
            entity: entityId,
            source: "sahr-crm",
            importedAt: new Date().toISOString(),
            metadata: {
              bookingId: params.bookingId,
              customerId: booking.customerId,
              customerName: booking.customerName,
              tipAmount: booking.tipAmount,
              syncedAt: new Date().toISOString(),
            },
          };

          await addDoc(transactionsRef, tipTransaction);
        }

        // Build response
        let output = `**Booking Synced to Finance** ✅

**Transaction Created:**
- ID: ${transaction.id}
- Date: ${transaction.date}
- Amount: ${formatCurrency(amount)}
- Customer: ${booking.customerName}
- Service: ${booking.serviceType.replace(/_/g, " ")}
- Account: ${accountId}
- Entity: ${entityId}`;

        if (tipTransaction) {
          output += `

**Tip Transaction:**
- Amount: ${formatCurrency(booking.tipAmount!)}
- Category: tips`;
        }

        output += `

_Transaction ID: ${txDocRef.id}_`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            transaction,
            tipTransaction,
            firebaseId: txDocRef.id,
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Record Tip
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_record_tip",
      description: "Record a tip received from a customer as a separate transaction.",
      parameters: Type.Object({
        customerName: Type.String({ description: "Customer name" }),
        customerId: Type.Optional(Type.String({ description: "Customer ID" })),
        amount: Type.Number({ description: "Tip amount" }),
        date: Type.Optional(Type.String({ description: "Date received (YYYY-MM-DD)" })),
        bookingId: Type.Optional(Type.String({ description: "Associated booking ID" })),
        paymentMethod: Type.Optional(Type.String({ description: "Payment method for the tip" })),
      }),
      async execute(_toolCallId, params) {
        const date = params.date || new Date().toISOString().split("T")[0];
        const accountId =
          PAYMENT_ACCOUNTS[params.paymentMethod?.toLowerCase() || "etransfer"] || defaultAccount;

        const transaction: Transaction = {
          id: generateTransactionId("sahr_tip"),
          date: date,
          description: `Tip - ${params.customerName}`,
          amount: params.amount,
          currency: "CAD",
          accountId: accountId,
          category: "tips",
          categorySource: "crm-sync",
          entity: entityId,
          source: "sahr-crm",
          importedAt: new Date().toISOString(),
          metadata: {
            customerId: params.customerId,
            customerName: params.customerName,
            bookingId: params.bookingId,
            tipAmount: params.amount,
            syncedAt: new Date().toISOString(),
          },
        };

        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, transaction);

        const output = `**Tip Recorded** 💵

- Customer: ${params.customerName}
- Amount: ${formatCurrency(params.amount)}
- Date: ${date}
- Account: ${accountId}

_Transaction ID: ${docRef.id}_`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: { transaction, firebaseId: docRef.id },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Record Expense
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_record_expense",
      description: "Record a business expense for Sahr Auto Detailing.",
      parameters: Type.Object({
        description: Type.String({ description: "Expense description" }),
        amount: Type.Number({ description: "Expense amount (positive number)" }),
        category: Type.Union([
          Type.Literal("supplies"),
          Type.Literal("equipment"),
          Type.Literal("fuel"),
          Type.Literal("insurance"),
          Type.Literal("marketing"),
          Type.Literal("maintenance"),
          Type.Literal("other"),
        ]),
        date: Type.Optional(Type.String({ description: "Date (YYYY-MM-DD)" })),
        vendor: Type.Optional(Type.String({ description: "Vendor/supplier name" })),
        receipt: Type.Optional(Type.Boolean({ description: "Receipt available?" })),
      }),
      async execute(_toolCallId, params) {
        const date = params.date || new Date().toISOString().split("T")[0];

        const transaction: Transaction = {
          id: generateTransactionId("sahr_exp"),
          date: date,
          description: params.vendor
            ? `${params.description} - ${params.vendor}`
            : params.description,
          amount: -Math.abs(params.amount), // Negative for expenses
          currency: "CAD",
          accountId: defaultAccount,
          category: params.category,
          categorySource: "crm-sync",
          entity: entityId,
          source: "sahr-crm",
          importedAt: new Date().toISOString(),
          metadata: {
            syncedAt: new Date().toISOString(),
          },
        };

        const transactionsRef = collection(db, "transactions");
        const docRef = await addDoc(transactionsRef, transaction);

        const output = `**Expense Recorded** 📝

- Description: ${transaction.description}
- Amount: ${formatCurrency(Math.abs(params.amount))}
- Category: ${params.category}
- Date: ${date}
${params.receipt ? "- Receipt: ✅ Available" : "- Receipt: ❌ Not recorded"}

_Transaction ID: ${docRef.id}_`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: { transaction, firebaseId: docRef.id },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Generate Revenue Report
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_revenue_report",
      description: "Generate a revenue report for Sahr Auto Detailing over a specified period.",
      parameters: Type.Object({
        startDate: Type.String({ description: "Start date (YYYY-MM-DD)" }),
        endDate: Type.String({ description: "End date (YYYY-MM-DD)" }),
        groupBy: Type.Optional(
          Type.Union([Type.Literal("day"), Type.Literal("week"), Type.Literal("month")]),
        ),
        includeCustomerBreakdown: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        // Query transactions for the period
        const transactionsRef = collection(db, "transactions");
        const txQuery = query(
          transactionsRef,
          where("entity", "==", entityId),
          where("date", ">=", params.startDate),
          where("date", "<=", params.endDate),
          orderBy("date"),
        );

        const snapshot = await getDocs(txQuery);
        const transactions: Transaction[] = [];

        snapshot.forEach((doc) => {
          transactions.push({ id: doc.id, ...doc.data() } as Transaction);
        });

        // Calculate metrics
        const incomeTransactions = transactions.filter((t) => t.amount > 0);
        const expenseTransactions = transactions.filter((t) => t.amount < 0);
        const tipTransactions = transactions.filter((t) => t.category === "tips");
        const serviceTransactions = incomeTransactions.filter(
          (t) => t.category === "auto-detailing",
        );

        const totalRevenue = serviceTransactions.reduce((sum, t) => sum + t.amount, 0);
        const totalTips = tipTransactions.reduce((sum, t) => sum + t.amount, 0);
        const totalExpenses = Math.abs(expenseTransactions.reduce((sum, t) => sum + t.amount, 0));
        const netIncome = totalRevenue + totalTips - totalExpenses;

        // Group by service type
        const byServiceType: Record<string, { count: number; revenue: number }> = {};
        serviceTransactions.forEach((t) => {
          const serviceType = t.metadata?.serviceType || "unknown";
          if (!byServiceType[serviceType]) {
            byServiceType[serviceType] = { count: 0, revenue: 0 };
          }
          byServiceType[serviceType].count++;
          byServiceType[serviceType].revenue += t.amount;
        });

        // Group by customer if requested
        const byCustomer: Record<string, { revenue: number; bookings: number }> = {};
        if (params.includeCustomerBreakdown) {
          serviceTransactions.forEach((t) => {
            const customerName = t.metadata?.customerName || "Unknown";
            if (!byCustomer[customerName]) {
              byCustomer[customerName] = { revenue: 0, bookings: 0 };
            }
            byCustomer[customerName].revenue += t.amount;
            byCustomer[customerName].bookings++;
          });
        }

        // Build report
        let output = `**Sahr Auto Detailing Revenue Report**
📅 ${params.startDate} to ${params.endDate}

---

**Summary:**
| Metric | Amount |
|--------|--------|
| Service Revenue | ${formatCurrency(totalRevenue)} |
| Tips | ${formatCurrency(totalTips)} |
| **Gross Income** | **${formatCurrency(totalRevenue + totalTips)}** |
| Expenses | ${formatCurrency(totalExpenses)} |
| **Net Income** | **${formatCurrency(netIncome)}** |

**Booking Stats:**
- Total Bookings: ${serviceTransactions.length}
- Average Booking: ${formatCurrency(serviceTransactions.length > 0 ? totalRevenue / serviceTransactions.length : 0)}
- Average Tip: ${formatCurrency(tipTransactions.length > 0 ? totalTips / tipTransactions.length : 0)}

**By Service Type:**`;

        Object.entries(byServiceType).forEach(([type, data]) => {
          const avgPrice = data.count > 0 ? data.revenue / data.count : 0;
          output += `\n- ${type.replace(/_/g, " ")}: ${data.count} bookings, ${formatCurrency(data.revenue)} (avg ${formatCurrency(avgPrice)})`;
        });

        if (params.includeCustomerBreakdown && Object.keys(byCustomer).length > 0) {
          output += `\n\n**By Customer:**`;
          const sortedCustomers = Object.entries(byCustomer)
            .sort((a, b) => b[1].revenue - a[1].revenue)
            .slice(0, 10);

          sortedCustomers.forEach(([name, data]) => {
            output += `\n- ${name}: ${data.bookings} bookings, ${formatCurrency(data.revenue)}`;
          });
        }

        if (expenseTransactions.length > 0) {
          output += `\n\n**Expenses Breakdown:**`;
          const expensesByCategory: Record<string, number> = {};
          expenseTransactions.forEach((t) => {
            if (!expensesByCategory[t.category]) {
              expensesByCategory[t.category] = 0;
            }
            expensesByCategory[t.category] += Math.abs(t.amount);
          });

          Object.entries(expensesByCategory)
            .sort((a, b) => b[1] - a[1])
            .forEach(([category, amount]) => {
              output += `\n- ${category}: ${formatCurrency(amount)}`;
            });
        }

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            totalRevenue,
            totalTips,
            totalExpenses,
            netIncome,
            bookingCount: serviceTransactions.length,
            byServiceType,
            byCustomer,
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Customer Lifetime Value
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_customer_ltv",
      description: "Calculate lifetime value and revenue history for a customer.",
      parameters: Type.Object({
        customerId: Type.Optional(Type.String({ description: "Customer ID" })),
        customerName: Type.String({ description: "Customer name" }),
      }),
      async execute(_toolCallId, params) {
        // Query all transactions for this customer
        const transactionsRef = collection(db, "transactions");
        const txQuery = query(
          transactionsRef,
          where("entity", "==", entityId),
          where("metadata.customerName", "==", params.customerName),
          orderBy("date"),
        );

        const snapshot = await getDocs(txQuery);
        const transactions: Transaction[] = [];

        snapshot.forEach((doc) => {
          transactions.push({ id: doc.id, ...doc.data() } as Transaction);
        });

        // Calculate metrics
        const serviceTransactions = transactions.filter((t) => t.category === "auto-detailing");
        const tipTransactions = transactions.filter((t) => t.category === "tips");

        const totalRevenue = serviceTransactions.reduce((sum, t) => sum + t.amount, 0);
        const totalTips = tipTransactions.reduce((sum, t) => sum + t.amount, 0);
        const bookingCount = serviceTransactions.length;
        const avgBookingValue = bookingCount > 0 ? totalRevenue / bookingCount : 0;

        // Find first and last booking dates
        const dates = serviceTransactions.map((t) => new Date(t.date).getTime());
        const firstBooking = dates.length > 0 ? new Date(Math.min(...dates)) : null;
        const lastBooking = dates.length > 0 ? new Date(Math.max(...dates)) : null;

        // Calculate tenure in months
        let tenureMonths = 0;
        if (firstBooking && lastBooking) {
          tenureMonths = Math.max(
            1,
            Math.round(
              (lastBooking.getTime() - firstBooking.getTime()) / (1000 * 60 * 60 * 24 * 30),
            ),
          );
        }

        // Calculate monthly value
        const monthlyValue = tenureMonths > 0 ? (totalRevenue + totalTips) / tenureMonths : 0;

        // Build output
        let output = `**Customer Lifetime Value: ${params.customerName}**

---

**Revenue Summary:**
| Metric | Value |
|--------|-------|
| Total Revenue | ${formatCurrency(totalRevenue)} |
| Total Tips | ${formatCurrency(totalTips)} |
| **Lifetime Value** | **${formatCurrency(totalRevenue + totalTips)}** |

**Booking Stats:**
- Total Bookings: ${bookingCount}
- Average Booking: ${formatCurrency(avgBookingValue)}
- First Booking: ${firstBooking ? firstBooking.toLocaleDateString() : "N/A"}
- Last Booking: ${lastBooking ? lastBooking.toLocaleDateString() : "N/A"}
- Customer Since: ${tenureMonths} month${tenureMonths !== 1 ? "s" : ""}

**Monthly Metrics:**
- Monthly Value: ${formatCurrency(monthlyValue)}
- Booking Frequency: ${(bookingCount / Math.max(tenureMonths, 1)).toFixed(1)}/month`;

        // Recent transactions
        if (transactions.length > 0) {
          output += `\n\n**Recent Transactions (last 5):**`;
          transactions
            .slice(-5)
            .reverse()
            .forEach((t) => {
              const emoji = t.category === "tips" ? "💵" : "🚗";
              output += `\n${emoji} ${t.date}: ${t.description} - ${formatCurrency(t.amount)}`;
            });
        }

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            customerName: params.customerName,
            totalRevenue,
            totalTips,
            ltv: totalRevenue + totalTips,
            bookingCount,
            avgBookingValue,
            tenureMonths,
            monthlyValue,
            firstBooking: firstBooking?.toISOString(),
            lastBooking: lastBooking?.toISOString(),
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: List Unsynced Bookings
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_list_unsynced",
      description: "List completed bookings that haven't been synced to the finance dashboard yet.",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "Max results to return" })),
      }),
      async execute(_toolCallId, params) {
        const bookingsRef = collection(db, "sahr_bookings");
        const unsyncedQuery = query(
          bookingsRef,
          where("status", "==", "completed"),
          where("financeSynced", "in", [false, null]),
          orderBy("appointmentDate", "desc"),
          limit(params.limit || 20),
        );

        const snapshot = await getDocs(unsyncedQuery);
        const unsyncedBookings: BookingData[] = [];

        snapshot.forEach((doc) => {
          unsyncedBookings.push({ id: doc.id, ...doc.data() } as BookingData);
        });

        if (unsyncedBookings.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: "**All Caught Up!** ✅\n\nNo completed bookings waiting to be synced.",
              },
            ],
          };
        }

        let output = `**Unsynced Bookings (${unsyncedBookings.length})**

The following completed bookings haven't been synced to finance yet:

`;

        let totalPending = 0;
        unsyncedBookings.forEach((booking) => {
          totalPending += booking.price;
          output += `- **${booking.customerName}** - ${booking.appointmentDate}\n`;
          output += `  ${booking.serviceType.replace(/_/g, " ")} - ${formatCurrency(booking.price)}`;
          if (booking.tipAmount) {
            output += ` + ${formatCurrency(booking.tipAmount)} tip`;
          }
          output += `\n  _ID: ${booking.id}_\n\n`;
        });

        output += `---\n**Total Pending:** ${formatCurrency(totalPending)}`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: { unsyncedBookings, totalPending },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Job Profitability Analysis
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_job_profitability",
      description:
        "Analyze profitability of a specific booking. Shows revenue, COGS, profit margin, and compares to averages.",
      parameters: Type.Object({
        bookingId: Type.String({ description: "Booking ID to analyze" }),
        includeComparison: Type.Optional(
          Type.Boolean({ description: "Include comparison to average margins" }),
        ),
      }),
      async execute(_toolCallId, params) {
        // Get the booking
        const bookingRef = doc(db, "sahr_bookings", params.bookingId);
        const bookingSnap = await getDoc(bookingRef);

        if (!bookingSnap.exists()) {
          return {
            content: [{ type: "text" as const, text: `Booking ${params.bookingId} not found` }],
          };
        }

        const booking = bookingSnap.data();
        const price = booking.price || 0;
        const costs = booking.costs || {};
        const hasCosts = booking.costs && Object.keys(booking.costs).length > 0;

        if (!hasCosts) {
          return {
            content: [
              {
                type: "text" as const,
                text:
                  `**Booking ${params.bookingId}**\n\n` +
                  `- Customer: ${booking.customerName}\n` +
                  `- Date: ${booking.date || booking.appointmentAt?.toDate?.()?.toLocaleDateString()}\n` +
                  `- Revenue: ${formatCurrency(price)}\n\n` +
                  `⚠️ **No COGS recorded for this booking.**\n` +
                  `Use \`sahr_crm_add_job_costs\` to add cost data for profitability analysis.`,
              },
            ],
          };
        }

        const totalCogs =
          (costs.gas || 0) +
          (costs.carWash || 0) +
          (costs.supplies || 0) +
          (costs.labor || 0) +
          (costs.other || 0);
        const netProfit = price - totalCogs;
        const grossMargin = price > 0 ? (netProfit / price) * 100 : 0;
        const season = booking.season || "unknown";

        let output = `**Job Profitability Analysis**
📊 Booking: ${params.bookingId}

---

**Revenue & Costs:**
| Item | Amount |
|------|--------|
| Revenue | ${formatCurrency(price)} |
| Gas | ${formatCurrency(costs.gas || 0)} |
| Car Wash | ${formatCurrency(costs.carWash || 0)} |
| Supplies | ${formatCurrency(costs.supplies || 0)} |
| Labor | ${formatCurrency(costs.labor || 0)} |
| Other | ${formatCurrency(costs.other || 0)} |
| **Total COGS** | **${formatCurrency(totalCogs)}** |
| **Net Profit** | **${formatCurrency(netProfit)}** |
| **Gross Margin** | **${grossMargin.toFixed(1)}%** |

**Context:**
- Customer: ${booking.customerName}
- Date: ${booking.date || "N/A"}
- Service: ${booking.serviceType?.replace(/_/g, " ") || "Detail"}
- Season: ${season}
${booking.costsNotes ? `- Notes: ${booking.costsNotes}` : ""}`;

        // Add comparison if requested
        if (params.includeComparison) {
          // Query recent bookings with COGS data for comparison
          const bookingsRef = collection(db, "sahr_bookings");
          const recentQuery = query(
            bookingsRef,
            where("status", "==", "completed"),
            orderBy("date", "desc"),
            limit(50),
          );

          const snapshot = await getDocs(recentQuery);
          const bookingsWithCosts: Array<{ margin: number; season: string }> = [];

          snapshot.forEach((docSnap) => {
            const b = docSnap.data();
            if (b.costs && b.price) {
              const bCosts =
                (b.costs.gas || 0) +
                (b.costs.carWash || 0) +
                (b.costs.supplies || 0) +
                (b.costs.labor || 0) +
                (b.costs.other || 0);
              const bProfit = b.price - bCosts;
              const bMargin = (bProfit / b.price) * 100;
              bookingsWithCosts.push({ margin: bMargin, season: b.season || "unknown" });
            }
          });

          if (bookingsWithCosts.length > 1) {
            const avgMargin =
              bookingsWithCosts.reduce((sum, b) => sum + b.margin, 0) / bookingsWithCosts.length;
            const sameSeasonBookings = bookingsWithCosts.filter((b) => b.season === season);
            const seasonAvgMargin =
              sameSeasonBookings.length > 0
                ? sameSeasonBookings.reduce((sum, b) => sum + b.margin, 0) /
                  sameSeasonBookings.length
                : null;

            const marginDiff = grossMargin - avgMargin;
            const performanceEmoji = marginDiff > 5 ? "📈" : marginDiff < -5 ? "📉" : "➡️";

            output += `

---

**Comparison to Averages:**
- Overall Average Margin: ${avgMargin.toFixed(1)}%
- This Job: ${grossMargin.toFixed(1)}% ${performanceEmoji} (${marginDiff > 0 ? "+" : ""}${marginDiff.toFixed(1)}%)`;

            if (seasonAvgMargin !== null) {
              const seasonDiff = grossMargin - seasonAvgMargin;
              output += `
- ${season.charAt(0).toUpperCase() + season.slice(1)} Average: ${seasonAvgMargin.toFixed(1)}% (${seasonDiff > 0 ? "+" : ""}${seasonDiff.toFixed(1)}%)`;
            }

            output += `
- Jobs with COGS data: ${bookingsWithCosts.length}`;
          }
        }

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            bookingId: params.bookingId,
            customerName: booking.customerName,
            date: booking.date,
            price,
            costs,
            totalCogs,
            netProfit,
            grossMargin,
            season,
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Margin Analysis
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_margin_analysis",
      description:
        "Analyze profit margins across bookings by period, customer, service type, or season.",
      parameters: Type.Object({
        period: Type.Optional(
          Type.Union(
            [
              Type.Literal("month"),
              Type.Literal("quarter"),
              Type.Literal("year"),
              Type.Literal("all"),
            ],
            { description: "Time period to analyze" },
          ),
        ),
        groupBy: Type.Optional(
          Type.Union(
            [
              Type.Literal("customer"),
              Type.Literal("service_type"),
              Type.Literal("season"),
              Type.Literal("month"),
            ],
            { description: "How to group the analysis" },
          ),
        ),
      }),
      async execute(_toolCallId, params) {
        const period = params.period || "all";
        const groupBy = params.groupBy || "season";

        // Calculate date range
        const now = new Date();
        let startDate: Date;
        switch (period) {
          case "month":
            startDate = new Date(now.getFullYear(), now.getMonth(), 1);
            break;
          case "quarter":
            const quarterStart = Math.floor(now.getMonth() / 3) * 3;
            startDate = new Date(now.getFullYear(), quarterStart, 1);
            break;
          case "year":
            startDate = new Date(now.getFullYear(), 0, 1);
            break;
          default:
            startDate = new Date(2020, 0, 1); // All time
        }

        // Query bookings with COGS
        const bookingsRef = collection(db, "sahr_bookings");
        const bookingsQuery = query(
          bookingsRef,
          where("status", "==", "completed"),
          orderBy("date", "desc"),
          limit(200),
        );

        const snapshot = await getDocs(bookingsQuery);
        const bookings: Array<{
          id: string;
          customerName: string;
          date: string;
          serviceType: string;
          season: string;
          price: number;
          totalCogs: number;
          netProfit: number;
          grossMargin: number;
        }> = [];

        snapshot.forEach((docSnap) => {
          const b = docSnap.data();
          const bookingDate = new Date(b.date || b.appointmentAt?.toDate?.() || now);

          if (bookingDate >= startDate && b.costs && b.price) {
            const totalCogs =
              (b.costs.gas || 0) +
              (b.costs.carWash || 0) +
              (b.costs.supplies || 0) +
              (b.costs.labor || 0) +
              (b.costs.other || 0);
            const netProfit = b.price - totalCogs;
            const grossMargin = (netProfit / b.price) * 100;

            bookings.push({
              id: docSnap.id,
              customerName: b.customerName || "Unknown",
              date: b.date || bookingDate.toISOString().split("T")[0],
              serviceType: b.serviceType || "full_detail",
              season: b.season || "unknown",
              price: b.price,
              totalCogs,
              netProfit,
              grossMargin,
            });
          }
        });

        if (bookings.length === 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `**Margin Analysis**\n\n⚠️ No bookings with COGS data found for the selected period.\n\nUse \`sahr_crm_add_job_costs\` to record costs for completed bookings.`,
              },
            ],
          };
        }

        // Calculate overall stats
        const totalRevenue = bookings.reduce((sum, b) => sum + b.price, 0);
        const totalCogs = bookings.reduce((sum, b) => sum + b.totalCogs, 0);
        const totalProfit = bookings.reduce((sum, b) => sum + b.netProfit, 0);
        const avgMargin = totalRevenue > 0 ? (totalProfit / totalRevenue) * 100 : 0;

        // Group analysis
        const groups: Record<
          string,
          { count: number; revenue: number; cogs: number; profit: number; margin: number }
        > = {};

        bookings.forEach((b) => {
          let key: string;
          switch (groupBy) {
            case "customer":
              key = b.customerName;
              break;
            case "service_type":
              key = b.serviceType.replace(/_/g, " ");
              break;
            case "month":
              key = b.date.substring(0, 7); // YYYY-MM
              break;
            case "season":
            default:
              key = b.season;
          }

          if (!groups[key]) {
            groups[key] = { count: 0, revenue: 0, cogs: 0, profit: 0, margin: 0 };
          }
          groups[key].count++;
          groups[key].revenue += b.price;
          groups[key].cogs += b.totalCogs;
          groups[key].profit += b.netProfit;
        });

        // Calculate margins for each group
        Object.values(groups).forEach((g) => {
          g.margin = g.revenue > 0 ? (g.profit / g.revenue) * 100 : 0;
        });

        // Sort by margin descending
        const sortedGroups = Object.entries(groups).sort((a, b) => b[1].margin - a[1].margin);

        let output = `**Margin Analysis**
📊 Period: ${period === "all" ? "All Time" : period.charAt(0).toUpperCase() + period.slice(1)}
📈 Grouped by: ${groupBy.replace(/_/g, " ")}

---

**Overall Summary:**
| Metric | Value |
|--------|-------|
| Total Revenue | ${formatCurrency(totalRevenue)} |
| Total COGS | ${formatCurrency(totalCogs)} |
| Total Profit | ${formatCurrency(totalProfit)} |
| **Average Margin** | **${avgMargin.toFixed(1)}%** |
| Jobs Analyzed | ${bookings.length} |

---

**By ${groupBy.replace(/_/g, " ").charAt(0).toUpperCase() + groupBy.replace(/_/g, " ").slice(1)}:**
`;

        sortedGroups.forEach(([key, data]) => {
          const marginIcon = data.margin >= 60 ? "🟢" : data.margin >= 40 ? "🟡" : "🔴";
          output += `\n${marginIcon} **${key}** (${data.count} jobs)`;
          output += `\n   Revenue: ${formatCurrency(data.revenue)} | COGS: ${formatCurrency(data.cogs)} | Profit: ${formatCurrency(data.profit)}`;
          output += `\n   **Margin: ${data.margin.toFixed(1)}%**\n`;
        });

        // Seasonal insight
        if (groupBy === "season" && groups["winter"] && groups["summer"]) {
          const winterMargin = groups["winter"].margin;
          const summerMargin = groups["summer"].margin;
          output += `\n---\n\n**💡 Seasonal Insight:**\n`;
          output += `Summer margin (${summerMargin.toFixed(1)}%) is ${(summerMargin - winterMargin).toFixed(1)}% higher than winter (${winterMargin.toFixed(1)}%).`;
          output += `\nThis is expected due to car wash facility costs in winter (~$43/job).`;
        }

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            period,
            groupBy,
            totalRevenue,
            totalCogs,
            totalProfit,
            avgMargin,
            bookingCount: bookings.length,
            groups,
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Seasonal Revenue Forecast
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_seasonal_forecast",
      description:
        "Project revenue, costs, and profit for upcoming months based on customer schedules and seasonal patterns.",
      parameters: Type.Object({
        months: Type.Number({ description: "Number of months to forecast (1-6)" }),
        includeNewCustomers: Type.Optional(
          Type.Boolean({ description: "Include estimates for new customer growth" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const monthsToForecast = Math.min(Math.max(params.months, 1), 6);

        // Get active customers with schedules
        const customersRef = collection(db, "sahr_customers");
        const customersQuery = query(customersRef, where("status", "==", "active"));
        const customersSnap = await getDocs(customersQuery);

        const customers: Array<{
          id: string;
          name: string;
          standardPrice: number;
          schedule: { summer?: { frequencyWeeks: number }; winter?: { frequencyWeeks: number } };
        }> = [];

        customersSnap.forEach((docSnap) => {
          const data = docSnap.data();
          customers.push({
            id: docSnap.id,
            name: data.name,
            standardPrice: data.standardPrice || 130,
            schedule: data.schedule || {
              summer: { frequencyWeeks: 4 },
              winter: { frequencyWeeks: 4 },
            },
          });
        });

        // Get historical averages for COGS
        const bookingsRef = collection(db, "sahr_bookings");
        const cogsQuery = query(
          bookingsRef,
          where("status", "==", "completed"),
          orderBy("date", "desc"),
          limit(50),
        );
        const cogsSnap = await getDocs(cogsQuery);

        let winterCogs = 61; // Default
        let summerCogs = 18; // Default
        let winterCount = 0;
        let summerCount = 0;

        cogsSnap.forEach((docSnap) => {
          const data = docSnap.data();
          if (data.costs && data.season) {
            const totalCogs =
              (data.costs.gas || 0) + (data.costs.carWash || 0) + (data.costs.supplies || 0);
            if (data.season === "winter") {
              winterCogs = (winterCogs * winterCount + totalCogs) / (winterCount + 1);
              winterCount++;
            } else if (data.season === "summer") {
              summerCogs = (summerCogs * summerCount + totalCogs) / (summerCount + 1);
              summerCount++;
            }
          }
        });

        // Generate forecast for each month
        const forecast: Array<{
          month: string;
          season: string;
          expectedBookings: number;
          projectedRevenue: number;
          projectedCogs: number;
          projectedProfit: number;
          margin: number;
        }> = [];

        const now = new Date();
        for (let i = 0; i < monthsToForecast; i++) {
          const forecastDate = new Date(now.getFullYear(), now.getMonth() + i + 1, 1);
          const monthName = forecastDate.toLocaleString("default", {
            month: "long",
            year: "numeric",
          });
          const monthNum = forecastDate.getMonth() + 1;

          // Determine season
          let season: "winter" | "summer" | "shoulder";
          if (monthNum >= 11 || monthNum <= 3) season = "winter";
          else if (monthNum >= 5 && monthNum <= 9) season = "summer";
          else season = "shoulder";

          // Calculate expected bookings based on customer schedules
          let expectedBookings = 0;
          let projectedRevenue = 0;

          customers.forEach((customer) => {
            const scheduleKey = season === "winter" ? "winter" : "summer";
            const frequencyWeeks = customer.schedule?.[scheduleKey]?.frequencyWeeks || 4;
            const bookingsPerMonth = 4 / frequencyWeeks; // Approximate weeks per month
            expectedBookings += bookingsPerMonth;
            projectedRevenue += bookingsPerMonth * customer.standardPrice;
          });

          // Add new customer estimate if requested
          if (params.includeNewCustomers) {
            const newCustomerEstimate = 0.5; // Assume 0.5 new customers per month
            const avgNewCustomerPrice = 145; // Average between standard and referral
            expectedBookings += newCustomerEstimate;
            projectedRevenue += newCustomerEstimate * avgNewCustomerPrice;
          }

          // Calculate COGS based on season
          const avgCogs =
            season === "winter"
              ? winterCogs
              : season === "summer"
                ? summerCogs
                : (winterCogs + summerCogs) / 2;
          const projectedCogs = expectedBookings * avgCogs;
          const projectedProfit = projectedRevenue - projectedCogs;
          const margin = projectedRevenue > 0 ? (projectedProfit / projectedRevenue) * 100 : 0;

          forecast.push({
            month: monthName,
            season,
            expectedBookings: Math.round(expectedBookings * 10) / 10,
            projectedRevenue: Math.round(projectedRevenue),
            projectedCogs: Math.round(projectedCogs),
            projectedProfit: Math.round(projectedProfit),
            margin: Math.round(margin * 10) / 10,
          });
        }

        // Calculate totals
        const totals = forecast.reduce(
          (acc, f) => ({
            bookings: acc.bookings + f.expectedBookings,
            revenue: acc.revenue + f.projectedRevenue,
            cogs: acc.cogs + f.projectedCogs,
            profit: acc.profit + f.projectedProfit,
          }),
          { bookings: 0, revenue: 0, cogs: 0, profit: 0 },
        );

        let output = `**Seasonal Revenue Forecast**
📅 Next ${monthsToForecast} month${monthsToForecast > 1 ? "s" : ""}
👥 Based on ${customers.length} active customer${customers.length !== 1 ? "s" : ""}
${params.includeNewCustomers ? "📈 Includes new customer growth estimates" : ""}

---

**Monthly Breakdown:**
`;

        forecast.forEach((f) => {
          const seasonEmoji = f.season === "winter" ? "❄️" : f.season === "summer" ? "☀️" : "🍂";
          output += `\n**${f.month}** ${seasonEmoji}\n`;
          output += `- Expected bookings: ${f.expectedBookings}\n`;
          output += `- Revenue: ${formatCurrency(f.projectedRevenue)}\n`;
          output += `- COGS: ${formatCurrency(f.projectedCogs)}\n`;
          output += `- Profit: ${formatCurrency(f.projectedProfit)} (${f.margin}% margin)\n`;
        });

        output += `
---

**${monthsToForecast}-Month Totals:**
| Metric | Projected |
|--------|-----------|
| Bookings | ${Math.round(totals.bookings * 10) / 10} |
| Revenue | ${formatCurrency(totals.revenue)} |
| COGS | ${formatCurrency(totals.cogs)} |
| **Net Profit** | **${formatCurrency(totals.profit)}** |
| Avg Margin | ${totals.revenue > 0 ? ((totals.profit / totals.revenue) * 100).toFixed(1) : 0}% |

---

**Assumptions:**
- Winter COGS: ${formatCurrency(winterCogs)}/job (wash bay required)
- Summer COGS: ${formatCurrency(summerCogs)}/job (mobile service)
- Customer schedules maintained as currently set`;

        return {
          content: [{ type: "text" as const, text: output }],
          details: {
            forecast,
            totals,
            assumptions: { winterCogs, summerCogs, customerCount: customers.length },
          },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Bulk Sync Bookings
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_bulk_sync",
      description: "Sync multiple completed bookings to finance at once.",
      parameters: Type.Object({
        bookingIds: Type.Array(Type.String(), {
          description: "Array of booking IDs to sync",
        }),
        defaultPaymentMethod: Type.Optional(
          Type.String({ description: "Default payment method if not specified" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const results: Array<{
          bookingId: string;
          success: boolean;
          transactionId?: string;
          error?: string;
        }> = [];

        let totalSynced = 0;
        let totalAmount = 0;

        for (const bookingId of params.bookingIds) {
          try {
            const bookingRef = doc(db, "sahr_bookings", bookingId);
            const bookingSnap = await getDoc(bookingRef);

            if (!bookingSnap.exists()) {
              results.push({ bookingId, success: false, error: "Not found" });
              continue;
            }

            const booking = bookingSnap.data() as BookingData;

            if (booking.financeSynced) {
              results.push({
                bookingId,
                success: false,
                error: "Already synced",
              });
              continue;
            }

            const paymentMethod =
              booking.paymentMethod || params.defaultPaymentMethod || "etransfer";
            const accountId = PAYMENT_ACCOUNTS[paymentMethod.toLowerCase()] || defaultAccount;

            const transaction: Transaction = {
              id: generateTransactionId("sahr"),
              date: booking.appointmentDate,
              description: getServiceDescription(booking.serviceType, booking.customerName),
              amount: booking.price,
              currency: "CAD",
              accountId: accountId,
              category: SERVICE_CATEGORIES[booking.serviceType] || "auto-detailing",
              categorySource: "crm-sync",
              entity: entityId,
              source: "sahr-crm",
              importedAt: new Date().toISOString(),
              metadata: {
                bookingId,
                customerId: booking.customerId,
                customerName: booking.customerName,
                serviceType: booking.serviceType,
                syncedAt: new Date().toISOString(),
              },
            };

            const transactionsRef = collection(db, "transactions");
            const txDocRef = await addDoc(transactionsRef, transaction);

            await updateDoc(bookingRef, {
              financeSynced: true,
              financeTransactionId: txDocRef.id,
              financeSyncedAt: Timestamp.now(),
            });

            // Handle tip if present
            if (booking.tipAmount && booking.tipAmount > 0) {
              const tipTx: Transaction = {
                id: generateTransactionId("sahr_tip"),
                date: booking.appointmentDate,
                description: `Tip - ${booking.customerName}`,
                amount: booking.tipAmount,
                currency: "CAD",
                accountId: accountId,
                category: "tips",
                categorySource: "crm-sync",
                entity: entityId,
                source: "sahr-crm",
                importedAt: new Date().toISOString(),
                metadata: {
                  bookingId,
                  customerName: booking.customerName,
                  tipAmount: booking.tipAmount,
                  syncedAt: new Date().toISOString(),
                },
              };
              await addDoc(transactionsRef, tipTx);
              totalAmount += booking.tipAmount;
            }

            results.push({ bookingId, success: true, transactionId: txDocRef.id });
            totalSynced++;
            totalAmount += booking.price;
          } catch (error) {
            results.push({
              bookingId,
              success: false,
              error: error instanceof Error ? error.message : "Unknown error",
            });
          }
        }

        const successCount = results.filter((r) => r.success).length;
        const failCount = results.filter((r) => !r.success).length;

        let output = `**Bulk Sync Complete** ${successCount === params.bookingIds.length ? "✅" : "⚠️"}

**Summary:**
- Synced: ${successCount}/${params.bookingIds.length}
- Total Amount: ${formatCurrency(totalAmount)}
${failCount > 0 ? `- Failed: ${failCount}` : ""}

**Results:**`;

        results.forEach((r) => {
          if (r.success) {
            output += `\n✅ ${r.bookingId} → ${r.transactionId}`;
          } else {
            output += `\n❌ ${r.bookingId}: ${r.error}`;
          }
        });

        return {
          content: [{ type: "text" as const, text: output }],
          details: { results, totalSynced, totalAmount },
        };
      },
    });

    // -------------------------------------------------------------------------
    // SERVICE REGISTRATION
    // -------------------------------------------------------------------------
    api.registerService({
      id: "sahr-finance-sync",
      start: () => {
        api.logger.info("Sahr Finance Sync service started");
      },
      stop: () => {
        api.logger.info("Sahr Finance Sync service stopped");
      },
    });

    api.logger.info("Sahr Finance Sync: Plugin registered with 11 tools");
  },
};

export default sahrFinanceSyncPlugin;
