/**
 * Sahr Auto Detailing CRM Plugin for Clawdbot (CT2)
 *
 * Provides customer, booking, and vehicle management for Sahr's auto detailing business.
 * Integrates with saffa-finances Firebase/Firestore.
 */

import type { ClawdbotPluginApi } from "clawdbot/plugin-sdk";
import { Type } from "@sinclair/typebox";
import { initializeApp, getApps, type FirebaseApp } from "firebase/app";
import {
  getFirestore,
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  getDoc,
  getDocs,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  type Firestore,
} from "firebase/firestore";

// ============================================================================
// TYPES
// ============================================================================

interface SahrCustomer {
  id?: string;
  name: string;
  phone?: string;
  email?: string;
  preferredContact?: "phone" | "text" | "email";
  address?: string;
  locationArea?: string;
  tags?: string[];
  priceTier?: "standard" | "referral" | "loyalty";
  referralSource?: string;
  competitorIntel?: {
    name?: string;
    price?: number;
    notes?: string;
  };
  notes?: string;
  lastServiceAt?: Date;
  nextAppointmentAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SahrVehicle {
  id?: string;
  customerId: string;
  year?: number;
  make?: string;
  model?: string;
  trim?: string;
  color?: string;
  plate?: string;
  vin?: string;
  nickname?: string;
  notes?: string;
  createdAt?: Date;
}

interface SahrBooking {
  id?: string;
  customerId: string;
  customerName?: string;
  vehicleId?: string;
  serviceType: "full_detail" | "interior" | "exterior" | "coating" | "wash" | "other";
  addons?: string[];
  price?: number;
  tip?: number;
  status: "scheduled" | "confirmed" | "in_progress" | "completed" | "cancelled" | "no_show";
  appointmentAt?: Date;
  completedAt?: Date;
  location?: string;
  locationType?: "mobile" | "wash_bay" | "customer_home";
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface SahrCommunication {
  id?: string;
  customerId: string;
  channel: "sms" | "imessage" | "call" | "email" | "discord";
  direction: "inbound" | "outbound";
  summary: string;
  rawContent?: string;
  actionItems?: string[];
  createdAt?: Date;
}

// ============================================================================
// CRM DATABASE CLASS
// ============================================================================

class SahrCRM {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;

  constructor(
    private projectId: string,
    private apiKey: string,
    private logger: { info: (msg: string) => void; error: (msg: string) => void }
  ) {}

  private async init(): Promise<Firestore> {
    if (this.db) return this.db;

    const existingApp = getApps().find((a) => a.name === "sahr-crm");
    if (existingApp) {
      this.app = existingApp;
    } else {
      this.app = initializeApp(
        {
          apiKey: this.apiKey,
          projectId: this.projectId,
          authDomain: `${this.projectId}.firebaseapp.com`,
        },
        "sahr-crm"
      );
    }

    this.db = getFirestore(this.app);
    this.logger.info("Sahr CRM: Firebase initialized");
    return this.db;
  }

  // ---------------------------------------------------------------------------
  // CUSTOMERS
  // ---------------------------------------------------------------------------

  async createCustomer(data: Omit<SahrCustomer, "id" | "createdAt" | "updatedAt">): Promise<SahrCustomer> {
    const db = await this.init();
    const now = new Date();
    const docData = {
      ...data,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };
    const docRef = await addDoc(collection(db, "sahr_customers"), docData);
    this.logger.info(`Sahr CRM: Created customer ${data.name} (${docRef.id})`);
    return { ...data, id: docRef.id, createdAt: now, updatedAt: now };
  }

  async updateCustomer(id: string, data: Partial<SahrCustomer>): Promise<void> {
    const db = await this.init();
    const docRef = doc(db, "sahr_customers", id);
    await updateDoc(docRef, {
      ...data,
      updatedAt: Timestamp.fromDate(new Date()),
    });
    this.logger.info(`Sahr CRM: Updated customer ${id}`);
  }

  async getCustomer(id: string): Promise<SahrCustomer | null> {
    const db = await this.init();
    const docRef = doc(db, "sahr_customers", id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      id: snapshot.id,
      ...data,
      lastServiceAt: data.lastServiceAt?.toDate(),
      nextAppointmentAt: data.nextAppointmentAt?.toDate(),
      createdAt: data.createdAt?.toDate(),
      updatedAt: data.updatedAt?.toDate(),
    } as SahrCustomer;
  }

  async searchCustomers(searchTerm: string, maxResults = 10): Promise<SahrCustomer[]> {
    const db = await this.init();
    // Firestore doesn't support full-text search, so we fetch recent and filter client-side
    const q = query(
      collection(db, "sahr_customers"),
      orderBy("updatedAt", "desc"),
      limit(100)
    );
    const snapshot = await getDocs(q);
    const term = searchTerm.toLowerCase();
    const results: SahrCustomer[] = [];

    for (const docSnap of snapshot.docs) {
      const data = docSnap.data();
      const name = (data.name || "").toLowerCase();
      const phone = (data.phone || "").toLowerCase();
      const address = (data.address || "").toLowerCase();
      const notes = (data.notes || "").toLowerCase();

      if (
        name.includes(term) ||
        phone.includes(term) ||
        address.includes(term) ||
        notes.includes(term)
      ) {
        results.push({
          id: docSnap.id,
          ...data,
          lastServiceAt: data.lastServiceAt?.toDate(),
          nextAppointmentAt: data.nextAppointmentAt?.toDate(),
          createdAt: data.createdAt?.toDate(),
          updatedAt: data.updatedAt?.toDate(),
        } as SahrCustomer);
        if (results.length >= maxResults) break;
      }
    }

    return results;
  }

  async listCustomers(maxResults = 20): Promise<SahrCustomer[]> {
    const db = await this.init();
    const q = query(
      collection(db, "sahr_customers"),
      orderBy("updatedAt", "desc"),
      limit(maxResults)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        lastServiceAt: data.lastServiceAt?.toDate(),
        nextAppointmentAt: data.nextAppointmentAt?.toDate(),
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
      } as SahrCustomer;
    });
  }

  // ---------------------------------------------------------------------------
  // VEHICLES
  // ---------------------------------------------------------------------------

  async createVehicle(data: Omit<SahrVehicle, "id" | "createdAt">): Promise<SahrVehicle> {
    const db = await this.init();
    const now = new Date();
    const docData = {
      ...data,
      createdAt: Timestamp.fromDate(now),
    };
    const docRef = await addDoc(collection(db, "sahr_vehicles"), docData);
    this.logger.info(`Sahr CRM: Created vehicle for customer ${data.customerId}`);
    return { ...data, id: docRef.id, createdAt: now };
  }

  async getVehiclesByCustomer(customerId: string): Promise<SahrVehicle[]> {
    const db = await this.init();
    const q = query(
      collection(db, "sahr_vehicles"),
      where("customerId", "==", customerId)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        createdAt: data.createdAt?.toDate(),
      } as SahrVehicle;
    });
  }

  // ---------------------------------------------------------------------------
  // BOOKINGS
  // ---------------------------------------------------------------------------

  async createBooking(data: Omit<SahrBooking, "id" | "createdAt" | "updatedAt">): Promise<SahrBooking> {
    const db = await this.init();
    const now = new Date();
    const docData = {
      ...data,
      appointmentAt: data.appointmentAt ? Timestamp.fromDate(data.appointmentAt) : null,
      createdAt: Timestamp.fromDate(now),
      updatedAt: Timestamp.fromDate(now),
    };
    const docRef = await addDoc(collection(db, "sahr_bookings"), docData);
    this.logger.info(`Sahr CRM: Created booking for ${data.customerName || data.customerId}`);

    // Update customer's next appointment
    if (data.customerId && data.appointmentAt) {
      await this.updateCustomer(data.customerId, {
        nextAppointmentAt: data.appointmentAt,
      });
    }

    return { ...data, id: docRef.id, createdAt: now, updatedAt: now };
  }

  async updateBooking(id: string, data: Partial<SahrBooking>): Promise<void> {
    const db = await this.init();
    const docRef = doc(db, "sahr_bookings", id);
    const updateData: Record<string, unknown> = {
      ...data,
      updatedAt: Timestamp.fromDate(new Date()),
    };

    if (data.appointmentAt) {
      updateData.appointmentAt = Timestamp.fromDate(data.appointmentAt);
    }
    if (data.completedAt) {
      updateData.completedAt = Timestamp.fromDate(data.completedAt);
    }

    await updateDoc(docRef, updateData);
    this.logger.info(`Sahr CRM: Updated booking ${id}`);

    // If completed, update customer's last service date
    if (data.status === "completed" && data.customerId) {
      await this.updateCustomer(data.customerId, {
        lastServiceAt: new Date(),
      });
    }
  }

  async getBooking(id: string): Promise<SahrBooking | null> {
    const db = await this.init();
    const docRef = doc(db, "sahr_bookings", id);
    const snapshot = await getDoc(docRef);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      id: snapshot.id,
      ...data,
      appointmentAt: data.appointmentAt?.toDate(),
      completedAt: data.completedAt?.toDate(),
      createdAt: data.createdAt?.toDate(),
      updatedAt: data.updatedAt?.toDate(),
    } as SahrBooking;
  }

  async listBookings(
    options: { customerId?: string; status?: string; limit?: number } = {}
  ): Promise<SahrBooking[]> {
    const db = await this.init();
    let q = query(collection(db, "sahr_bookings"));

    if (options.customerId) {
      q = query(q, where("customerId", "==", options.customerId));
    }
    if (options.status) {
      q = query(q, where("status", "==", options.status));
    }

    q = query(q, orderBy("appointmentAt", "desc"), limit(options.limit || 20));

    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        appointmentAt: data.appointmentAt?.toDate(),
        completedAt: data.completedAt?.toDate(),
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
      } as SahrBooking;
    });
  }

  async getUpcomingBookings(days = 7): Promise<SahrBooking[]> {
    const db = await this.init();
    const now = new Date();
    const future = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);

    const q = query(
      collection(db, "sahr_bookings"),
      where("appointmentAt", ">=", Timestamp.fromDate(now)),
      where("appointmentAt", "<=", Timestamp.fromDate(future)),
      where("status", "in", ["scheduled", "confirmed"]),
      orderBy("appointmentAt", "asc")
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        appointmentAt: data.appointmentAt?.toDate(),
        completedAt: data.completedAt?.toDate(),
        createdAt: data.createdAt?.toDate(),
        updatedAt: data.updatedAt?.toDate(),
      } as SahrBooking;
    });
  }

  // ---------------------------------------------------------------------------
  // COMMUNICATIONS
  // ---------------------------------------------------------------------------

  async logCommunication(data: Omit<SahrCommunication, "id" | "createdAt">): Promise<SahrCommunication> {
    const db = await this.init();
    const now = new Date();
    const docData = {
      ...data,
      createdAt: Timestamp.fromDate(now),
    };
    const docRef = await addDoc(collection(db, "sahr_communication_logs"), docData);
    this.logger.info(`Sahr CRM: Logged ${data.direction} ${data.channel} communication`);
    return { ...data, id: docRef.id, createdAt: now };
  }

  async getCustomerCommunications(customerId: string, maxResults = 20): Promise<SahrCommunication[]> {
    const db = await this.init();
    const q = query(
      collection(db, "sahr_communication_logs"),
      where("customerId", "==", customerId),
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );
    const snapshot = await getDocs(q);
    return snapshot.docs.map((docSnap) => {
      const data = docSnap.data();
      return {
        id: docSnap.id,
        ...data,
        createdAt: data.createdAt?.toDate(),
      } as SahrCommunication;
    });
  }

  // ---------------------------------------------------------------------------
  // CUSTOMER HISTORY (AGGREGATE)
  // ---------------------------------------------------------------------------

  async getCustomerHistory(customerId: string): Promise<{
    customer: SahrCustomer | null;
    vehicles: SahrVehicle[];
    bookings: SahrBooking[];
    communications: SahrCommunication[];
    stats: {
      totalBookings: number;
      completedBookings: number;
      totalRevenue: number;
      totalTips: number;
      averageBookingValue: number;
    };
  }> {
    const [customer, vehicles, bookings, communications] = await Promise.all([
      this.getCustomer(customerId),
      this.getVehiclesByCustomer(customerId),
      this.listBookings({ customerId, limit: 50 }),
      this.getCustomerCommunications(customerId, 20),
    ]);

    const completedBookings = bookings.filter((b) => b.status === "completed");
    const totalRevenue = completedBookings.reduce((sum, b) => sum + (b.price || 0), 0);
    const totalTips = completedBookings.reduce((sum, b) => sum + (b.tip || 0), 0);

    return {
      customer,
      vehicles,
      bookings,
      communications,
      stats: {
        totalBookings: bookings.length,
        completedBookings: completedBookings.length,
        totalRevenue,
        totalTips,
        averageBookingValue: completedBookings.length > 0 ? totalRevenue / completedBookings.length : 0,
      },
    };
  }
}

// ============================================================================
// PLUGIN DEFINITION
// ============================================================================

const sahrCrmPlugin = {
  id: "sahr-crm",
  name: "Sahr Auto CRM",
  description: "Customer and booking management for Sahr Auto Detailing",

  configSchema: {
    type: "object" as const,
    additionalProperties: false,
    properties: {
      firebaseApiKey: { type: "string" as const },
      firebaseProjectId: { type: "string" as const, default: "saffa-finances" },
      enabled: { type: "boolean" as const, default: true },
    },
    required: ["firebaseApiKey"] as const,
  },

  register(api: ClawdbotPluginApi) {
    const config = api.pluginConfig as {
      firebaseApiKey: string;
      firebaseProjectId: string;
      enabled: boolean;
    };

    if (!config.enabled) {
      api.logger.info("Sahr CRM: Plugin disabled via config");
      return;
    }

    const crm = new SahrCRM(
      config.firebaseProjectId || "saffa-finances",
      config.firebaseApiKey,
      api.logger
    );

    // -------------------------------------------------------------------------
    // TOOL: Create Customer
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_create_customer",
      description: "Create a new customer in Sahr Auto CRM",
      parameters: Type.Object({
        name: Type.String({ description: "Customer's full name" }),
        phone: Type.Optional(Type.String({ description: "Phone number" })),
        email: Type.Optional(Type.String({ description: "Email address" })),
        address: Type.Optional(Type.String({ description: "Full address" })),
        locationArea: Type.Optional(Type.String({ description: "Neighborhood/area (e.g., 'North end, Cy Becker')" })),
        preferredContact: Type.Optional(Type.Union([
          Type.Literal("phone"),
          Type.Literal("text"),
          Type.Literal("email"),
        ])),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Tags like 'vip', 'referral', 'recurring'" })),
        priceTier: Type.Optional(Type.Union([
          Type.Literal("standard"),
          Type.Literal("referral"),
          Type.Literal("loyalty"),
        ])),
        referralSource: Type.Optional(Type.String({ description: "Who referred this customer" })),
        notes: Type.Optional(Type.String({ description: "Additional notes" })),
      }),
      async execute(_toolCallId, params) {
        const customer = await crm.createCustomer(params);
        return {
          content: [
            {
              type: "text" as const,
              text: `Created customer: ${customer.name} (ID: ${customer.id})`,
            },
          ],
          details: { customer },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Update Customer
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_update_customer",
      description: "Update an existing customer in Sahr Auto CRM",
      parameters: Type.Object({
        customerId: Type.String({ description: "Customer ID to update" }),
        name: Type.Optional(Type.String()),
        phone: Type.Optional(Type.String()),
        email: Type.Optional(Type.String()),
        address: Type.Optional(Type.String()),
        locationArea: Type.Optional(Type.String()),
        preferredContact: Type.Optional(Type.Union([
          Type.Literal("phone"),
          Type.Literal("text"),
          Type.Literal("email"),
        ])),
        tags: Type.Optional(Type.Array(Type.String())),
        priceTier: Type.Optional(Type.Union([
          Type.Literal("standard"),
          Type.Literal("referral"),
          Type.Literal("loyalty"),
        ])),
        notes: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const { customerId, ...updateData } = params;
        await crm.updateCustomer(customerId, updateData);
        const updated = await crm.getCustomer(customerId);
        return {
          content: [
            {
              type: "text" as const,
              text: `Updated customer: ${updated?.name || customerId}`,
            },
          ],
          details: { customer: updated },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Search Customers
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_search_customers",
      description: "Search for customers by name, phone, address, or notes",
      parameters: Type.Object({
        query: Type.String({ description: "Search term" }),
        limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
      }),
      async execute(_toolCallId, params) {
        const customers = await crm.searchCustomers(params.query, params.limit || 10);
        const summary = customers.map((c) => `- ${c.name} (${c.id}): ${c.phone || "no phone"}, ${c.address || "no address"}`).join("\n");
        return {
          content: [
            {
              type: "text" as const,
              text: customers.length > 0
                ? `Found ${customers.length} customer(s):\n${summary}`
                : `No customers found matching "${params.query}"`,
            },
          ],
          details: { customers },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Get Customer History
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_get_customer_history",
      description: "Get full customer history including vehicles, bookings, communications, and revenue stats",
      parameters: Type.Object({
        customerId: Type.String({ description: "Customer ID" }),
      }),
      async execute(_toolCallId, params) {
        const history = await crm.getCustomerHistory(params.customerId);

        if (!history.customer) {
          return {
            content: [{ type: "text" as const, text: `Customer ${params.customerId} not found` }],
          };
        }

        const vehiclesSummary = history.vehicles
          .map((v) => `  - ${v.year || ""} ${v.make || ""} ${v.model || ""} ${v.nickname ? `"${v.nickname}"` : ""}`.trim())
          .join("\n");

        const bookingsSummary = history.bookings
          .slice(0, 5)
          .map((b) => `  - ${b.appointmentAt?.toLocaleDateString() || "TBD"}: ${b.serviceType} ($${b.price || 0}) - ${b.status}`)
          .join("\n");

        const text = `
**Customer: ${history.customer.name}**
- Phone: ${history.customer.phone || "N/A"}
- Address: ${history.customer.address || "N/A"}
- Price Tier: ${history.customer.priceTier || "standard"}
- Tags: ${history.customer.tags?.join(", ") || "none"}

**Vehicles (${history.vehicles.length}):**
${vehiclesSummary || "  None on file"}

**Recent Bookings (${history.stats.totalBookings} total):**
${bookingsSummary || "  No bookings"}

**Revenue Stats:**
- Total Revenue: $${history.stats.totalRevenue}
- Total Tips: $${history.stats.totalTips}
- Completed Bookings: ${history.stats.completedBookings}
- Avg Booking Value: $${history.stats.averageBookingValue.toFixed(2)}
`.trim();

        return {
          content: [{ type: "text" as const, text }],
          details: history,
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Create Booking
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_create_booking",
      description: "Create a new booking/appointment for a customer",
      parameters: Type.Object({
        customerId: Type.String({ description: "Customer ID" }),
        customerName: Type.Optional(Type.String({ description: "Customer name (for display)" })),
        serviceType: Type.Union([
          Type.Literal("full_detail"),
          Type.Literal("interior"),
          Type.Literal("exterior"),
          Type.Literal("coating"),
          Type.Literal("wash"),
          Type.Literal("other"),
        ], { description: "Type of service" }),
        appointmentDate: Type.String({ description: "Appointment date (YYYY-MM-DD)" }),
        appointmentTime: Type.String({ description: "Appointment time (HH:MM, 24hr format)" }),
        price: Type.Optional(Type.Number({ description: "Service price in dollars" })),
        location: Type.Optional(Type.String({ description: "Service location/address" })),
        locationType: Type.Optional(Type.Union([
          Type.Literal("mobile"),
          Type.Literal("wash_bay"),
          Type.Literal("customer_home"),
        ])),
        addons: Type.Optional(Type.Array(Type.String(), { description: "Add-on services" })),
        notes: Type.Optional(Type.String({ description: "Booking notes" })),
      }),
      async execute(_toolCallId, params) {
        const appointmentAt = new Date(`${params.appointmentDate}T${params.appointmentTime}:00`);

        const booking = await crm.createBooking({
          customerId: params.customerId,
          customerName: params.customerName,
          serviceType: params.serviceType,
          appointmentAt,
          price: params.price,
          location: params.location,
          locationType: params.locationType,
          addons: params.addons,
          notes: params.notes,
          status: "scheduled",
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Booking created for ${params.customerName || params.customerId}:\n` +
                `- Service: ${params.serviceType}\n` +
                `- Date: ${appointmentAt.toLocaleDateString()} at ${appointmentAt.toLocaleTimeString()}\n` +
                `- Price: $${params.price || "TBD"}\n` +
                `- ID: ${booking.id}`,
            },
          ],
          details: { booking },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Update Booking
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_update_booking",
      description: "Update a booking (status, time, price, etc.)",
      parameters: Type.Object({
        bookingId: Type.String({ description: "Booking ID to update" }),
        status: Type.Optional(Type.Union([
          Type.Literal("scheduled"),
          Type.Literal("confirmed"),
          Type.Literal("in_progress"),
          Type.Literal("completed"),
          Type.Literal("cancelled"),
          Type.Literal("no_show"),
        ])),
        appointmentDate: Type.Optional(Type.String({ description: "New date (YYYY-MM-DD)" })),
        appointmentTime: Type.Optional(Type.String({ description: "New time (HH:MM)" })),
        price: Type.Optional(Type.Number()),
        tip: Type.Optional(Type.Number()),
        notes: Type.Optional(Type.String()),
      }),
      async execute(_toolCallId, params) {
        const { bookingId, appointmentDate, appointmentTime, ...updateData } = params;

        if (appointmentDate && appointmentTime) {
          (updateData as Partial<SahrBooking>).appointmentAt = new Date(`${appointmentDate}T${appointmentTime}:00`);
        }

        if (updateData.status === "completed") {
          (updateData as Partial<SahrBooking>).completedAt = new Date();
        }

        // Get booking to get customerId for update
        const existingBooking = await crm.getBooking(bookingId);
        if (existingBooking) {
          (updateData as Partial<SahrBooking>).customerId = existingBooking.customerId;
        }

        await crm.updateBooking(bookingId, updateData as Partial<SahrBooking>);
        const updated = await crm.getBooking(bookingId);

        return {
          content: [
            {
              type: "text" as const,
              text: `Updated booking ${bookingId}:\n` +
                `- Status: ${updated?.status}\n` +
                `- Date: ${updated?.appointmentAt?.toLocaleDateString() || "N/A"}\n` +
                `- Price: $${updated?.price || 0}${updated?.tip ? ` + $${updated.tip} tip` : ""}`,
            },
          ],
          details: { booking: updated },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: List Bookings
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_list_bookings",
      description: "List bookings, optionally filtered by customer or status",
      parameters: Type.Object({
        customerId: Type.Optional(Type.String({ description: "Filter by customer ID" })),
        status: Type.Optional(Type.String({ description: "Filter by status" })),
        limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
      }),
      async execute(_toolCallId, params) {
        const bookings = await crm.listBookings({
          customerId: params.customerId,
          status: params.status,
          limit: params.limit,
        });

        const summary = bookings
          .map((b) => `- ${b.appointmentAt?.toLocaleDateString() || "TBD"} ${b.appointmentAt?.toLocaleTimeString() || ""}: ${b.customerName || b.customerId} - ${b.serviceType} ($${b.price || 0}) [${b.status}]`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: bookings.length > 0
                ? `Found ${bookings.length} booking(s):\n${summary}`
                : "No bookings found",
            },
          ],
          details: { bookings },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Get Upcoming Bookings
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_upcoming_bookings",
      description: "Get upcoming scheduled/confirmed bookings for the next N days",
      parameters: Type.Object({
        days: Type.Optional(Type.Number({ description: "Number of days to look ahead (default 7)" })),
      }),
      async execute(_toolCallId, params) {
        const bookings = await crm.getUpcomingBookings(params.days || 7);

        const summary = bookings
          .map((b) => `- ${b.appointmentAt?.toLocaleDateString()} at ${b.appointmentAt?.toLocaleTimeString()}: ${b.customerName || b.customerId} - ${b.serviceType} @ ${b.location || "TBD"}`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: bookings.length > 0
                ? `Upcoming bookings (next ${params.days || 7} days):\n${summary}`
                : `No upcoming bookings in the next ${params.days || 7} days`,
            },
          ],
          details: { bookings },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Log Communication
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_log_communication",
      description: "Log a customer communication (SMS, call, email, etc.)",
      parameters: Type.Object({
        customerId: Type.String({ description: "Customer ID" }),
        channel: Type.Union([
          Type.Literal("sms"),
          Type.Literal("imessage"),
          Type.Literal("call"),
          Type.Literal("email"),
          Type.Literal("discord"),
        ]),
        direction: Type.Union([
          Type.Literal("inbound"),
          Type.Literal("outbound"),
        ]),
        summary: Type.String({ description: "Brief summary of the communication" }),
        rawContent: Type.Optional(Type.String({ description: "Full message content if available" })),
        actionItems: Type.Optional(Type.Array(Type.String(), { description: "Follow-up action items identified" })),
      }),
      async execute(_toolCallId, params) {
        const comm = await crm.logCommunication(params);
        return {
          content: [
            {
              type: "text" as const,
              text: `Logged ${params.direction} ${params.channel} communication for customer ${params.customerId}:\n"${params.summary}"`,
            },
          ],
          details: { communication: comm },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: Add Vehicle
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_add_vehicle",
      description: "Add a vehicle to a customer's profile",
      parameters: Type.Object({
        customerId: Type.String({ description: "Customer ID" }),
        year: Type.Optional(Type.Number({ description: "Vehicle year" })),
        make: Type.Optional(Type.String({ description: "Vehicle make (e.g., Toyota)" })),
        model: Type.Optional(Type.String({ description: "Vehicle model (e.g., 4Runner)" })),
        trim: Type.Optional(Type.String({ description: "Trim level" })),
        color: Type.Optional(Type.String({ description: "Vehicle color" })),
        plate: Type.Optional(Type.String({ description: "License plate" })),
        nickname: Type.Optional(Type.String({ description: "Customer's nickname for the vehicle (e.g., 'Black Panther')" })),
        notes: Type.Optional(Type.String({ description: "Notes about the vehicle" })),
      }),
      async execute(_toolCallId, params) {
        const vehicle = await crm.createVehicle(params);
        const desc = [params.year, params.make, params.model].filter(Boolean).join(" ") || "Vehicle";
        return {
          content: [
            {
              type: "text" as const,
              text: `Added vehicle to customer ${params.customerId}:\n- ${desc}${params.nickname ? ` "${params.nickname}"` : ""}\n- ID: ${vehicle.id}`,
            },
          ],
          details: { vehicle },
        };
      },
    });

    // -------------------------------------------------------------------------
    // TOOL: List Customers
    // -------------------------------------------------------------------------
    api.registerTool({
      name: "sahr_crm_list_customers",
      description: "List recent customers",
      parameters: Type.Object({
        limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
      }),
      async execute(_toolCallId, params) {
        const customers = await crm.listCustomers(params.limit || 20);
        const summary = customers
          .map((c) => `- ${c.name} (${c.id}): ${c.priceTier || "standard"} tier, last service: ${c.lastServiceAt?.toLocaleDateString() || "never"}`)
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text: customers.length > 0
                ? `Recent customers (${customers.length}):\n${summary}`
                : "No customers found",
            },
          ],
          details: { customers },
        };
      },
    });

    // -------------------------------------------------------------------------
    // SERVICE REGISTRATION
    // -------------------------------------------------------------------------
    api.registerService({
      id: "sahr-crm",
      start: () => {
        api.logger.info("Sahr CRM service started");
      },
      stop: () => {
        api.logger.info("Sahr CRM service stopped");
      },
    });

    api.logger.info("Sahr CRM: Plugin registered with 12 tools");
  },
};

export default sahrCrmPlugin;
