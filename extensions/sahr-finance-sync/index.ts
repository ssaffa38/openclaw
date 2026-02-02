/**
 * Sahr Finance Sync Plugin for Clawdbot (CT2)
 *
 * Syncs Sahr Auto Detailing CRM data (bookings, tips, refunds) to the
 * Saffa Finances dashboard. Creates transactions, tracks revenue, and
 * generates financial reports.
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

  register(api: ClawdbotPluginApi) {
    const config = api.pluginConfig as {
      enabled: boolean;
      entityId: string;
      defaultAccount: string;
      autoSync: boolean;
    };

    if (!config.enabled) {
      api.logger.info("Sahr Finance Sync: Plugin disabled via config");
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
    // TOOL: Sync Booking to Finance
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_finance_sync_booking",
      description:
        "Create a finance transaction from a completed booking. Use after a booking is marked as paid/completed.",
      parameters: Type.Object({
        bookingId: Type.String({ description: "Booking ID to sync" }),
        overrideAmount: Type.Optional(
          Type.Number({ description: "Override the booking amount if different" })
        ),
        paymentMethod: Type.Optional(
          Type.String({ description: "Payment method used (etransfer, stripe, cash, debit)" })
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
        const accountId = PAYMENT_ACCOUNTS[paymentMethod.toLowerCase()] || config.defaultAccount;

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
          entity: config.entityId,
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
            entity: config.entityId,
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
- Entity: ${config.entityId}`;

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
          PAYMENT_ACCOUNTS[params.paymentMethod?.toLowerCase() || "etransfer"] ||
          config.defaultAccount;

        const transaction: Transaction = {
          id: generateTransactionId("sahr_tip"),
          date: date,
          description: `Tip - ${params.customerName}`,
          amount: params.amount,
          currency: "CAD",
          accountId: accountId,
          category: "tips",
          categorySource: "crm-sync",
          entity: config.entityId,
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
          accountId: config.defaultAccount,
          category: params.category,
          categorySource: "crm-sync",
          entity: config.entityId,
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
      description:
        "Generate a revenue report for Sahr Auto Detailing over a specified period.",
      parameters: Type.Object({
        startDate: Type.String({ description: "Start date (YYYY-MM-DD)" }),
        endDate: Type.String({ description: "End date (YYYY-MM-DD)" }),
        groupBy: Type.Optional(
          Type.Union([
            Type.Literal("day"),
            Type.Literal("week"),
            Type.Literal("month"),
          ])
        ),
        includeCustomerBreakdown: Type.Optional(Type.Boolean()),
      }),
      async execute(_toolCallId, params) {
        // Query transactions for the period
        const transactionsRef = collection(db, "transactions");
        const txQuery = query(
          transactionsRef,
          where("entity", "==", config.entityId),
          where("date", ">=", params.startDate),
          where("date", "<=", params.endDate),
          orderBy("date")
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
          (t) => t.category === "auto-detailing"
        );

        const totalRevenue = serviceTransactions.reduce((sum, t) => sum + t.amount, 0);
        const totalTips = tipTransactions.reduce((sum, t) => sum + t.amount, 0);
        const totalExpenses = Math.abs(
          expenseTransactions.reduce((sum, t) => sum + t.amount, 0)
        );
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
          where("entity", "==", config.entityId),
          where("metadata.customerName", "==", params.customerName),
          orderBy("date")
        );

        const snapshot = await getDocs(txQuery);
        const transactions: Transaction[] = [];

        snapshot.forEach((doc) => {
          transactions.push({ id: doc.id, ...doc.data() } as Transaction);
        });

        // Calculate metrics
        const serviceTransactions = transactions.filter(
          (t) => t.category === "auto-detailing"
        );
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
              (lastBooking.getTime() - firstBooking.getTime()) / (1000 * 60 * 60 * 24 * 30)
            )
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
      description:
        "List completed bookings that haven't been synced to the finance dashboard yet.",
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
          limit(params.limit || 20)
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
          Type.String({ description: "Default payment method if not specified" })
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
            const accountId =
              PAYMENT_ACCOUNTS[paymentMethod.toLowerCase()] || config.defaultAccount;

            const transaction: Transaction = {
              id: generateTransactionId("sahr"),
              date: booking.appointmentDate,
              description: getServiceDescription(booking.serviceType, booking.customerName),
              amount: booking.price,
              currency: "CAD",
              accountId: accountId,
              category: SERVICE_CATEGORIES[booking.serviceType] || "auto-detailing",
              categorySource: "crm-sync",
              entity: config.entityId,
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
                entity: config.entityId,
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

    api.logger.info("Sahr Finance Sync: Plugin registered with 7 tools");
  },
};

export default sahrFinanceSyncPlugin;
