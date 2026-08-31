import { z } from "zod";
import { pgTable, serial, text, integer, timestamp, jsonb, index, boolean, uniqueIndex } from "drizzle-orm/pg-core";

export type ChangeType = 'new_hire' | 'departure' | 'title_change' | 'promotion';
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

// ============================================================================
// DATABASE TABLES (Drizzle ORM) - For persistent staff contact storage
// ============================================================================

// School Directories table - tracks staff directory URLs and extraction status
export const schoolDirectories = pgTable("school_directories", {
  id: serial("id").primaryKey(),
  schoolId: text("school_id").notNull().unique(),
  schoolName: text("school_name").notNull(),
  schoolFullName: text("school_full_name").notNull(),
  logoUrl: text("logo_url"),
  ncaaUrl: text("ncaa_url").notNull(),
  directoryUrl: text("directory_url"),
  division: text("division"),
  conference: text("conference"),
  status: text("status").notNull().default("pending"),
  lastExtractedAt: timestamp("last_extracted_at"),
  lastAttemptedAt: timestamp("last_attempted_at"),
  extractionError: text("extraction_error"),
  contactsCount: integer("contacts_count").default(0),
  avgConfidence: integer("avg_confidence").default(0),
  // GTM Intelligence: Account Planning Fields
  fiscalYearEnd: text("fiscal_year_end").default("06-30"), // Default fiscal year end for .edu
  techStack: jsonb("tech_stack").$type<string[]>(), // Detected technologies e.g. ["Sidearm", "Ticketmaster"]
  buyingWindowStatus: text("buying_window_status"), // 'open', 'closed', 'planning'
  // Priority Score System (0-100) - inspired by Discolike scoring
  priorityScore: integer("priority_score").default(0), // Computed from tier + staff count + freshness
  // Redirect Chain Tracking - detect URL changes
  resolvedUrl: text("resolved_url"), // Final URL after redirects
  failureReason: text("failure_reason"), // Categorized: url_not_found, timeout, blocked, no_contacts, parse_error
  extractionAttempts: integer("extraction_attempts").default(0), // Counter for retry tracking
  lastSuccessfulMethod: text("last_successful_method"), // e.g. 'playwright', 'proxy', 'playwright-direct'
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Usage Events table - tracks app activity for reporting
export const usageEvents = pgTable("usage_events", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  schoolId: text("school_id"),
  schoolName: text("school_name"),
  sessionId: text("session_id"),
  ipHash: text("ip_hash"),
  userAgent: text("user_agent"),
  details: jsonb("details"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Staff Members table with Full Text Search Index
export const staffMembers = pgTable("staff_members", {
  id: serial("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  name: text("name").notNull(),
  title: text("title"),
  email: text("email").notNull(),
  phone: text("phone"),
  department: text("department"),
  office: text("office"),
  linkedinUrl: text("linkedin_url"),
  twitterHandle: text("twitter_handle"),
  bioUrl: text("bio_url"),
  imageUrl: text("image_url"),
  hiredYear: integer("hired_year"),
  confidence: jsonb("confidence").$type<{
    name: number;
    title: number;
    email: number;
    phone: number;
    overall: number;
    emailBase?: number;
  }>(),
  // Provenance of the email address, per the data-quality standard in CLAUDE.md:
  // 'confirmed' (bounce-verified) | 'extracted' (AI-parsed from page) | 'inferred' (guessed from school pattern)
  emailConfidence: text("email_confidence"),
  // Email deliverability verification (free tier: DNS/MX + heuristics, no SMTP probe).
  // Values: 'verified' | 'risky' | 'undeliverable' | 'unverified'. null = never checked.
  emailVerificationStatus: text("email_verification_status"),
  emailVerifiedAt: timestamp("email_verified_at"),
  // Contact-accuracy feedback loop: set when a user reports the contact as wrong.
  reportedInaccurateAt: timestamp("reported_inaccurate_at"),
  // GTM Intelligence: Persona Mapping Fields
  buyerPersona: text("buyer_persona"), // 'champion', 'signer', 'blocker', 'influencer', 'user'
  functionalArea: text("functional_area"), // 'executive', 'operations', 'finance', 'external', 'performance', 'general'
  // Department Tags - AI-classified sport/department categories
  departmentTags: jsonb("department_tags").$type<string[]>(), // e.g. ["Football", "Basketball", "Admin"]
  extractedAt: timestamp("extracted_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
  lastScrapedAt: timestamp("last_scraped_at"),
}, (table) => ({
  searchIdx: index("staff_search_idx").using("gin", sql`to_tsvector('english', ${table.name} || ' ' || coalesce(${table.title}, '') || ' ' || coalesce(${table.department}, ''))`),
  schoolIdx: index("staff_school_idx").on(table.schoolId),
  emailIdx: index("staff_email_idx").on(table.email),
  personaIdx: index("staff_persona_idx").on(table.buyerPersona),
}));

// Saved Lists table - for organizing prospects
export const savedLists = pgTable("saved_lists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  description: text("description"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Saved List Items table - contacts in a list
export const savedListItems = pgTable("saved_list_items", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull(),
  staffId: integer("staff_id").notNull(),
  notes: text("notes"),
  addedAt: timestamp("added_at").defaultNow().notNull(),
}, (table) => ({
  listIdx: index("list_items_list_idx").on(table.listId),
  staffIdx: index("list_items_staff_idx").on(table.staffId),
}));

// Extraction Jobs Table for Background Processing
export interface SchoolExtractionMeta {
  method: string;
  fetchReason: string;
  waitStrategy?: string;
  contentWaitMs?: number;
  scrollSteps?: number;
  timeTakenMs: number;
  contactsFound: number;
  parserUsed?: string;
  bioEmailsRecovered?: number;
  bioPagesFetched?: number;
  bioCacheHits?: number;
}

export const extractionJobs = pgTable("extraction_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(),
  targetId: text("target_id"),
  status: text("status").notNull().default("pending"),
  totalSchools: integer("total_schools").default(0),
  processedSchools: integer("processed_schools").default(0),
  contactsFound: integer("contacts_found").default(0),
  logs: jsonb("logs").$type<string[]>(),
  extractionMetadata: jsonb("extraction_metadata").$type<Record<string, SchoolExtractionMeta>>(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// Staff Change Logs Table for Turnover Tracking
export const staffChangeLogs = pgTable("staff_change_logs", {
  id: serial("id").primaryKey(),
  schoolId: text("school_id").notNull(),
  staffId: integer("staff_id"),
  name: text("name").notNull(),
  changeType: text("change_type").notNull(),
  oldValue: text("old_value"),
  newValue: text("new_value"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
}, (table) => ({
  schoolIdx: index("change_log_school_idx").on(table.schoolId),
  changeTypeIdx: index("change_log_type_idx").on(table.changeType),
  detectedAtIdx: index("change_log_detected_idx").on(table.detectedAt),
}));

// Target Lists Table - for ABM account matching
export const targetLists = pgTable("target_lists", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  name: text("name").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Target List Items Table - individual accounts in a target list
export const targetListItems = pgTable("target_list_items", {
  id: serial("id").primaryKey(),
  listId: integer("list_id").notNull(),
  schoolId: text("school_id"),
  rawName: text("raw_name").notNull(),
  status: text("status").default("pending"),
}, (table) => ({
  listIdx: index("target_list_items_list_idx").on(table.listId),
  statusIdx: index("target_list_items_status_idx").on(table.status),
}));

// School Aliases Table - learned mappings for fuzzy matching
export const schoolAliases = pgTable("school_aliases", {
  id: serial("id").primaryKey(),
  alias: text("alias").notNull().unique(),
  schoolId: text("school_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  aliasIdx: index("school_aliases_alias_idx").on(table.alias),
}));

// ============================================================================
// EXTERNAL API TABLES - For GTM integrations (Clay, HubSpot, Zapier)
// ============================================================================

// API Keys for external tools
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // Optional: link to user if auth is implemented
  keyPrefix: text("key_prefix").notNull(), // e.g., "sk_live_abc123"
  hashedKey: text("hashed_key").notNull(), // SHA-256 hash of the full key
  label: text("label"), // e.g., "Clay Integration"
  scopes: jsonb("scopes").$type<string[]>(), // e.g., ['read:staff', 'read:schools']
  lastUsedAt: timestamp("last_used_at"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  keyPrefixIdx: index("api_keys_prefix_idx").on(table.keyPrefix),
  hashedKeyIdx: index("api_keys_hashed_idx").on(table.hashedKey),
}));

// Webhook Subscriptions (Destinations for events)
export const webhookSubscriptions = pgTable("webhook_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"), // Optional: link to user
  url: text("url").notNull(), // The Zapier/Slack hook URL
  eventTypes: jsonb("event_types").$type<string[]>(), // ['staff.new_hire', 'staff.departure']
  isActive: boolean("is_active").default(true),
  secret: text("secret").notNull(), // For signing payloads (HMAC)
  description: text("description"),
  lastTriggeredAt: timestamp("last_triggered_at"),
  failureCount: integer("failure_count").default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  activeIdx: index("webhook_active_idx").on(table.isActive),
}));

// Webhook Delivery Logs - track webhook attempts
export const webhookDeliveryLogs = pgTable("webhook_delivery_logs", {
  id: serial("id").primaryKey(),
  subscriptionId: integer("subscription_id").notNull(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload"),
  responseStatus: integer("response_status"),
  responseBody: text("response_body"),
  success: boolean("success").default(false),
  attemptedAt: timestamp("attempted_at").defaultNow().notNull(),
}, (table) => ({
  subIdx: index("webhook_logs_sub_idx").on(table.subscriptionId),
  attemptIdx: index("webhook_logs_attempt_idx").on(table.attemptedAt),
}));

// ============================================================================
// GTM INTELLIGENCE TABLES - For Account Planning & Persona Mapping
// ============================================================================

// Career History Table - Track where people worked before (The Graph Edge)
export const careerHistory = pgTable("career_history", {
  id: serial("id").primaryKey(),
  staffId: integer("staff_id").notNull(), // Link to the person
  schoolId: text("school_id").notNull(),  // Where they worked
  title: text("title"),                   // What they did
  startYear: integer("start_year"),
  endYear: integer("end_year"),
  technologiesUsed: jsonb("technologies_used").$type<string[]>(), // e.g. ["Catapult", "Teamworks"]
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  staffIdx: index("career_history_staff_idx").on(table.staffId),
  schoolIdx: index("career_history_school_idx").on(table.schoolId),
}));

// Signals Table - High-intent events and alerts
export const signals = pgTable("signals", {
  id: serial("id").primaryKey(),
  schoolId: text("school_id"),
  staffId: integer("staff_id"), // Optional: related staff member
  type: text("type").notNull(), // 'new_hire', 'tech_drop', 'tech_add', 'warm_path', 'departure'
  description: text("description"), // e.g. "Dropped Ticketmaster for Paciolan"
  metadata: jsonb("metadata").$type<{
    oldSchool?: string;
    oldSchoolName?: string;
    newSchool?: string;
    newSchoolName?: string;
    techDropped?: string[];
    techAdded?: string[];
    staffName?: string;
    staffTitle?: string;
    pathCount?: number;
    // network_connection fields
    userId?: number;
    connectionName?: string;
    connectionHeadline?: string;
    connectionProfileUrl?: string;
    matchConfidence?: number;
    // title_change fields
    oldTitle?: string;
    newTitle?: string;
    schoolName?: string;
    // AI signal enrichment (server/lib/graph-engine.ts)
    relevanceScore?: number;
    relevanceReason?: string;
    // Provenance: 'news_monitor' | 'job_board' | undefined (scrape-detected)
    source?: string;
    // news_monitor fields
    articleTitle?: string;
    articleUrl?: string;
    // job_posting fields
    jobTitle?: string;
    postingUrl?: string;
    sourceBoard?: string;
    department?: string;
  }>(),
  detectedAt: timestamp("detected_at").defaultNow(),
  isActioned: boolean("is_actioned").default(false), // Has the user used this signal?
}, (table) => ({
  schoolIdx: index("signals_school_idx").on(table.schoolId),
  typeIdx: index("signals_type_idx").on(table.type),
  detectedIdx: index("signals_detected_idx").on(table.detectedAt),
}));

// LinkedIn Connections - per-user 1st-degree network synced via Whistle Connect extension
export const linkedinConnections = pgTable("linkedin_connections", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  entityUrn: text("entity_urn").notNull(),
  fullName: text("full_name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  headline: text("headline"),
  profileUrl: text("profile_url"),
  publicIdentifier: text("public_identifier"),
  connectedAt: timestamp("connected_at"),
  syncedAt: timestamp("synced_at").defaultNow().notNull(),
  // Match results (filled by matcher)
  matchedStaffId: integer("matched_staff_id"),
  matchedSchoolId: text("matched_school_id"),
  matchConfidence: integer("match_confidence"), // 0-100
  matchedAt: timestamp("matched_at"),
}, (table) => ({
  userEntityUnique: uniqueIndex("linkedin_connections_user_entity_unique").on(table.userId, table.entityUrn),
  userIdx: index("linkedin_connections_user_idx").on(table.userId),
  matchedStaffIdx: index("linkedin_connections_matched_staff_idx").on(table.matchedStaffId),
  matchedSchoolIdx: index("linkedin_connections_matched_school_idx").on(table.matchedSchoolId),
  publicIdentifierIdx: index("linkedin_connections_public_identifier_idx").on(table.publicIdentifier),
}));

// Persona Rules table - maps raw job titles to buyer personas
export const personaRules = pgTable("persona_rules", {
  id: serial("id").primaryKey(),
  titleKeyword: text("title_keyword").notNull(), // e.g. "Operations", "CFO", "Athletic Director"
  mappedPersona: text("mapped_persona").notNull(), // 'champion', 'signer', 'blocker', 'influencer'
  mappedArea: text("mapped_area").notNull(), // 'executive', 'operations', 'finance', 'external'
  priority: integer("priority").default(0), // Higher priority rules are matched first
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  keywordIdx: index("persona_rules_keyword_idx").on(table.titleKeyword),
}));

// Relations
export const schoolDirectoriesRelations = relations(schoolDirectories, ({ many }) => ({
  staffMembers: many(staffMembers),
}));

export const staffMembersRelations = relations(staffMembers, ({ one }) => ({
  school: one(schoolDirectories, {
    fields: [staffMembers.schoolId],
    references: [schoolDirectories.schoolId],
  }),
}));

// Insert schemas
export const insertSchoolDirectorySchema = createInsertSchema(schoolDirectories).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStaffMemberSchema = createInsertSchema(staffMembers).omit({
  id: true,
  extractedAt: true,
  updatedAt: true,
});

export const insertUsageEventSchema = createInsertSchema(usageEvents).omit({
  id: true,
  createdAt: true,
});

export const insertExtractionJobSchema = createInsertSchema(extractionJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertStaffChangeLogSchema = createInsertSchema(staffChangeLogs).omit({
  id: true,
  detectedAt: true,
});

export const insertSavedListSchema = createInsertSchema(savedLists).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export const insertSavedListItemSchema = createInsertSchema(savedListItems).omit({
  id: true,
  addedAt: true,
});

export const insertTargetListSchema = createInsertSchema(targetLists).omit({
  id: true,
  createdAt: true,
});

export const insertTargetListItemSchema = createInsertSchema(targetListItems).omit({
  id: true,
});

export const insertSchoolAliasSchema = createInsertSchema(schoolAliases).omit({
  id: true,
  createdAt: true,
});

export const insertApiKeySchema = createInsertSchema(apiKeys).omit({
  id: true,
  createdAt: true,
  lastUsedAt: true,
});

export const insertWebhookSubscriptionSchema = createInsertSchema(webhookSubscriptions).omit({
  id: true,
  createdAt: true,
  lastTriggeredAt: true,
  failureCount: true,
});

export const insertWebhookDeliveryLogSchema = createInsertSchema(webhookDeliveryLogs).omit({
  id: true,
  attemptedAt: true,
});

export const insertPersonaRuleSchema = createInsertSchema(personaRules).omit({
  id: true,
  createdAt: true,
});

export const insertCareerHistorySchema = createInsertSchema(careerHistory).omit({
  id: true,
  createdAt: true,
});

export const insertSignalSchema = createInsertSchema(signals).omit({
  id: true,
  detectedAt: true,
});

export const insertLinkedinConnectionSchema = createInsertSchema(linkedinConnections).omit({
  id: true,
  syncedAt: true,
  matchedStaffId: true,
  matchedSchoolId: true,
  matchConfidence: true,
  matchedAt: true,
});

// Schema the Whistle Connect Chrome extension POSTs to the ingestion endpoint
export const linkedinSyncBatchSchema = z.object({
  connections: z.array(z.object({
    entityUrn: z.string().min(1),
    fullName: z.string().optional().nullable(),
    firstName: z.string().optional().nullable(),
    lastName: z.string().optional().nullable(),
    headline: z.string().optional().nullable(),
    profileUrl: z.string().optional().nullable(),
    publicIdentifier: z.string().optional().nullable(),
    connectedAt: z.string().optional().nullable(),
  })).min(1).max(500),
  syncMode: z.enum(['full', 'delta']).optional(),
});

export type LinkedinSyncBatch = z.infer<typeof linkedinSyncBatchSchema>;

// Types
export type SchoolDirectory = typeof schoolDirectories.$inferSelect;
export type InsertSchoolDirectory = z.infer<typeof insertSchoolDirectorySchema>;
export type StaffMember = typeof staffMembers.$inferSelect;
export type InsertStaffMember = z.infer<typeof insertStaffMemberSchema>;

// Email deliverability verification status (free tier: DNS/MX + heuristics).
export type EmailVerificationStatus = "verified" | "risky" | "undeliverable" | "unverified";
export type UsageEvent = typeof usageEvents.$inferSelect;
export type InsertUsageEvent = z.infer<typeof insertUsageEventSchema>;
export type ExtractionJob = typeof extractionJobs.$inferSelect;
export type InsertExtractionJob = z.infer<typeof insertExtractionJobSchema>;
export type StaffChangeLog = typeof staffChangeLogs.$inferSelect;
export type InsertStaffChangeLog = z.infer<typeof insertStaffChangeLogSchema>;
export type SavedList = typeof savedLists.$inferSelect;
export type InsertSavedList = z.infer<typeof insertSavedListSchema>;
export type SavedListItem = typeof savedListItems.$inferSelect;
export type InsertSavedListItem = z.infer<typeof insertSavedListItemSchema>;
export type TargetList = typeof targetLists.$inferSelect;
export type InsertTargetList = z.infer<typeof insertTargetListSchema>;
export type TargetListItem = typeof targetListItems.$inferSelect;
export type InsertTargetListItem = z.infer<typeof insertTargetListItemSchema>;
export type SchoolAlias = typeof schoolAliases.$inferSelect;
export type InsertSchoolAlias = z.infer<typeof insertSchoolAliasSchema>;
export type ApiKey = typeof apiKeys.$inferSelect;
export type InsertApiKey = z.infer<typeof insertApiKeySchema>;
export type WebhookSubscription = typeof webhookSubscriptions.$inferSelect;
export type InsertWebhookSubscription = z.infer<typeof insertWebhookSubscriptionSchema>;
export type WebhookDeliveryLog = typeof webhookDeliveryLogs.$inferSelect;
export type InsertWebhookDeliveryLog = z.infer<typeof insertWebhookDeliveryLogSchema>;
export type PersonaRule = typeof personaRules.$inferSelect;
export type InsertPersonaRule = z.infer<typeof insertPersonaRuleSchema>;
export type CareerHistory = typeof careerHistory.$inferSelect;
export type InsertCareerHistory = z.infer<typeof insertCareerHistorySchema>;
export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type LinkedinConnection = typeof linkedinConnections.$inferSelect;
export type InsertLinkedinConnection = z.infer<typeof insertLinkedinConnectionSchema>;

// Buyer Persona Types
export type BuyerPersona = 'champion' | 'signer' | 'blocker' | 'influencer' | 'user';
export type FunctionalArea = 'executive' | 'operations' | 'finance' | 'external' | 'performance' | 'general';
export type BuyingWindowStatus = 'open' | 'closed' | 'planning';

// Confidence Score Schema
export const confidenceScoreSchema = z.object({
  name: z.number().min(0).max(100),
  title: z.number().min(0).max(100),
  email: z.number().min(0).max(100),
  phone: z.number().min(0).max(100),
  overall: z.number().min(0).max(100),
});

export type ConfidenceScore = z.infer<typeof confidenceScoreSchema>;

// Contact Person Schema
export const contactPersonSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  title: z.string(),
  email: z.string().email(),
  phone: z.string().optional(),
  department: z.string().optional(),
  office: z.string().optional(),
  linkedinUrl: z.string().optional(),
  bioUrl: z.string().optional(),
  confidence: confidenceScoreSchema.optional(),
});

export type ContactPerson = z.infer<typeof contactPersonSchema>;
export type InsertContactPerson = Omit<ContactPerson, "id">;

// AI Analysis Response
export const aiAnalysisSchema = z.object({
  content: z.string(),
  timestamp: z.string(),
});

export type AIAnalysis = z.infer<typeof aiAnalysisSchema>;

// Email Draft
export const emailDraftSchema = z.object({
  subject: z.string(),
  body: z.string(),
  recipientName: z.string(),
  recipientEmail: z.string(),
  context: z.string().optional(),
});

export type EmailDraft = z.infer<typeof emailDraftSchema>;

// Meeting Prep
export const meetingPrepSchema = z.object({
  content: z.string(),
  recipientName: z.string(),
  topic: z.string(),
  timestamp: z.string(),
});

export type MeetingPrep = z.infer<typeof meetingPrepSchema>;

// HTML Parse Request
export const parseHtmlRequestSchema = z.object({
  html: z.string(),
});

export type ParseHtmlRequest = z.infer<typeof parseHtmlRequestSchema>;

// URL Fetch Request
export const fetchUrlRequestSchema = z.object({
  url: z.string().url(),
});

export type FetchUrlRequest = z.infer<typeof fetchUrlRequestSchema>;

// AI Request Schemas
export const aiAnalysisRequestSchema = z.object({
  contacts: z.array(contactPersonSchema),
});

export const aiCleanDataRequestSchema = z.object({
  contacts: z.array(contactPersonSchema),
});

export const aiEmailRequestSchema = z.object({
  recipient: contactPersonSchema,
  context: z.string(),
});

export const aiMeetingPrepRequestSchema = z.object({
  recipient: contactPersonSchema,
  topic: z.string(),
});

// Extraction Diagnostics Schema
export const extractionDiagnosticsSchema = z.object({
  totalEmailLinksFound: z.number(),
  cloudflareEmailsFound: z.number(),
  mailtoLinksFound: z.number(),
  plainTextEmailsFound: z.number(),
  containersDetected: z.number(),
  contactsExtracted: z.number(),
  averageConfidence: z.number(),
  failureReason: z.string().optional(),
  suggestions: z.array(z.string()).optional(),
});

export type ExtractionDiagnostics = z.infer<typeof extractionDiagnosticsSchema>;

// Parse Result with Diagnostics
export const parseResultSchema = z.object({
  contacts: z.array(contactPersonSchema),
  diagnostics: extractionDiagnosticsSchema,
});

export type ParseResult = z.infer<typeof parseResultSchema>;

// NCAA School Schema
export const ncaaSchoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  fullName: z.string(),
  logoUrl: z.string().optional(),
  schoolUrl: z.string(),
  division: z.enum(['Division I', 'Division II', 'Division III']).optional(),
  conference: z.string().optional(),
});

export type NCAASchool = z.infer<typeof ncaaSchoolSchema>;

// NCAA Schools Response
export const ncaaSchoolsResponseSchema = z.object({
  schools: z.array(ncaaSchoolSchema),
  totalCount: z.number(),
  lastUpdated: z.string(),
});

export type NCAASchoolsResponse = z.infer<typeof ncaaSchoolsResponseSchema>;

// Job Creation Schema
export const createJobSchema = z.object({
  type: z.enum(['single', 'bulk', 'conference']),
  targetId: z.string(),
  schoolIds: z.array(z.string()).optional(),
});

export type CreateJobRequest = z.infer<typeof createJobSchema>;

// ============================================================================
// AUTHENTICATION TABLES - Enterprise B2B User System
// ============================================================================

// Users table - stores user accounts with Argon2id password hashes
export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  // Nullable so OAuth (e.g. Google) users can exist without a password.
  passwordHash: text("password_hash"),
  googleId: text("google_id").unique(),
  fullName: text("full_name").notNull(),
  role: text("role").default("user"), // 'admin', 'user'
  isVerified: boolean("is_verified").default(false),
  // Credit system
  creditsBalance: integer("credits_balance").default(0).notNull(),
  // Subscription tier tracking
  subscriptionTier: text("subscription_tier").default("free"), // 'free', 'payg', 'pro', 'team', 'enterprise'
  monthlyCreditsAllocation: integer("monthly_credits_allocation").default(0), // Credits included in subscription
  creditsUsedThisPeriod: integer("credits_used_this_period").default(0), // Track usage for overage
  overageRate: integer("overage_rate").default(100), // Cents per credit for overage (100 = $1.00)
  // Stripe subscription fields
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  subscriptionStatus: text("subscription_status").default("inactive"), // 'active', 'past_due', 'canceled', 'inactive'
  priceId: text("price_id"), // Track which tier they bought
  currentPeriodEnd: timestamp("current_period_end"), // When access expires
  currentPeriodStart: timestamp("current_period_start"), // When billing period started
  createdAt: timestamp("created_at").defaultNow(),
  lastLoginAt: timestamp("last_login_at"),
  // When the user clicked "I accept" on the Terms of Service / Privacy Policy.
  // Required before they can pay, but free signups are recorded too.
  tosAcceptedAt: timestamp("tos_accepted_at"),
  organizationId: integer("organization_id"),
});

// Payment failures — every off-session charge attempt that Stripe rejects
// gets a row here so we can show actionable UX and email the user once
// per failure event (debounced via emailedAt).
export const paymentFailures = pgTable("payment_failures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  stripeCustomerId: text("stripe_customer_id"),
  source: text("source").notNull(), // 'payg' | 'overage'
  amountCents: integer("amount_cents").notNull(),
  errorCode: text("error_code"), // e.g. card_declined, authentication_required
  declineCode: text("decline_code"), // e.g. insufficient_funds, expired_card
  message: text("message"),
  paymentIntentId: text("payment_intent_id"),
  staffId: integer("staff_id"),
  emailedAt: timestamp("emailed_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("payment_failures_user_idx").on(table.userId),
  createdIdx: index("payment_failures_created_idx").on(table.createdAt),
}));
export type PaymentFailure = typeof paymentFailures.$inferSelect;

// Credit Transactions table - tracks credit purchases and usage
export const creditTransactions = pgTable("credit_transactions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  amount: integer("amount").notNull(), // positive for purchases, negative for usage
  reason: text("reason").notNull(), // 'purchase', 'export', 'refund'
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("credit_transactions_user_idx").on(table.userId),
  // Idempotency guard: a given Stripe purchase (payment intent / checkout
  // session) can only ever record one credit-grant row, so a duplicate webhook
  // delivery (Stripe is at-least-once) cannot double-credit. Multiple NULLs are
  // allowed by Postgres, so usage/renewal rows without a payment id are unaffected.
  stripePiUnique: uniqueIndex("credit_transactions_stripe_pi_unique").on(table.stripePaymentIntentId),
}));

export const insertCreditTransactionSchema = createInsertSchema(creditTransactions).omit({
  id: true,
  createdAt: true,
});

export type InsertCreditTransaction = z.infer<typeof insertCreditTransactionSchema>;
export type CreditTransaction = typeof creditTransactions.$inferSelect;

// Contact Reveals - tracks per-user reveals of staff contact data (90-day re-reveal grace)
export const contactReveals = pgTable("contact_reveals", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  staffId: integer("staff_id").notNull(),
  revealedAt: timestamp("revealed_at").defaultNow().notNull(),
  chargedCredits: integer("charged_credits").default(0).notNull(), // 0 if free-tier or re-reveal
  source: text("source").notNull(), // 'free', 'subscription', 'payg', 'overage', 'regrant'
}, (table) => ({
  userStaffIdx: uniqueIndex("contact_reveals_user_staff_idx").on(table.userId, table.staffId),
  userIdx: index("contact_reveals_user_idx").on(table.userId),
  revealedAtIdx: index("contact_reveals_revealed_at_idx").on(table.revealedAt),
}));

export const insertContactRevealSchema = createInsertSchema(contactReveals).omit({
  id: true,
  revealedAt: true,
});
export type InsertContactReveal = z.infer<typeof insertContactRevealSchema>;
export type ContactReveal = typeof contactReveals.$inferSelect;

// Entitlements — single source of truth for plan/quota state. Mirrored from
// Stripe webhooks. Kept in sync with users.* billing columns for back-compat.
export const entitlements = pgTable("entitlements", {
  userId: integer("user_id").primaryKey(),
  tier: text("tier").notNull().default("free"),
  status: text("status").notNull().default("inactive"),
  stripeCustomerId: text("stripe_customer_id"),
  stripeSubscriptionId: text("stripe_subscription_id"),
  monthlyAllocation: integer("monthly_allocation").notNull().default(0),
  usedThisPeriod: integer("used_this_period").notNull().default(0),
  overageRateCents: integer("overage_rate_cents").notNull().default(0),
  creditsBalance: integer("credits_balance").notNull().default(0),
  currentPeriodStart: timestamp("current_period_start"),
  currentPeriodEnd: timestamp("current_period_end"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type Entitlement = typeof entitlements.$inferSelect;

// Enterprise sales inquiries
export const enterpriseInquiries = pgTable("enterprise_inquiries", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull(),
  company: text("company"),
  teamSize: text("team_size"),
  message: text("message").notNull(),
  userId: integer("user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertEnterpriseInquirySchema = createInsertSchema(enterpriseInquiries).omit({
  id: true,
  createdAt: true,
});
export type InsertEnterpriseInquiry = z.infer<typeof insertEnterpriseInquirySchema>;
export type EnterpriseInquiry = typeof enterpriseInquiries.$inferSelect;

export const enterpriseInquiryRequestSchema = z.object({
  name: z.string().min(1, "Name is required"),
  email: z.string().email("Invalid email"),
  company: z.string().optional(),
  teamSize: z.string().optional(),
  message: z.string().min(10, "Please tell us a bit about your use case"),
});

// Auth tokens - email verification and password reset (single-use, time-limited)
export const authTokens = pgTable("auth_tokens", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  token: text("token").notNull().unique(),
  purpose: text("purpose").notNull(), // 'verify_email' | 'reset_password'
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("auth_tokens_user_idx").on(table.userId),
  purposeIdx: index("auth_tokens_purpose_idx").on(table.purpose),
}));
export type AuthToken = typeof authTokens.$inferSelect;

// Sessions table - database-backed sessions for instant revocation
export const sessions = pgTable("sessions", {
  sid: text("sid").primaryKey(),
  sess: text("sess").notNull(),
  expire: timestamp("expire").notNull(),
}, (table) => ({
  expireIdx: index("sessions_expire_idx").on(table.expire),
}));

// ============================================================================
// ALERT SUBSCRIPTIONS - Signal notification preferences
// ============================================================================

export const alertSubscriptions = pgTable("alert_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  schoolId: text("school_id"),            // null = watch all schools
  signalTypes: jsonb("signal_types").$type<string[]>().notNull().default([]), // e.g. ['new_hire','departure']
  frequency: text("frequency").notNull().default("instant"), // 'instant' | 'daily' | 'weekly'
  slackWebhookUrl: text("slack_webhook_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  userIdx: index("alert_subs_user_idx").on(table.userId),
  schoolIdx: index("alert_subs_school_idx").on(table.schoolId),
}));
export type AlertSubscription = typeof alertSubscriptions.$inferSelect;

// ============================================================================
// JOB POSTINGS - Athletic department job board signal
// ============================================================================

export const jobPostings = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  schoolId: text("school_id"),
  schoolName: text("school_name"),
  jobTitle: text("job_title").notNull(),
  department: text("department"),
  postingUrl: text("posting_url").notNull().unique(),
  sourceBoard: text("source_board"),
  // Classified by function (rule-based, same taxonomy as staff_members.functionalArea)
  // so the public job board can filter "by what you'll do, not the title".
  functionalArea: text("functional_area"), // 'ncaa_market' | 'teamwork_online' | 'higheredJobs'
  postedAt: timestamp("posted_at"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  isActive: boolean("is_active").default(true),
}, (table) => ({
  schoolIdx: index("job_postings_school_idx").on(table.schoolId),
  detectedIdx: index("job_postings_detected_idx").on(table.detectedAt),
}));
export type JobPosting = typeof jobPostings.$inferSelect;

// ============================================================================
// NIL COLLECTIVES - Separate buying entities for top athletic programs
// ============================================================================

export const nilCollectives = pgTable("nil_collectives", {
  id: serial("id").primaryKey(),
  schoolId: text("school_id"),
  name: text("name").notNull(),
  website: text("website"),
  structure: text("structure"), // 'nonprofit' | 'llc' | 'unknown'
  estimatedBudget: text("estimated_budget"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (table) => ({
  schoolIdx: index("nil_collectives_school_idx").on(table.schoolId),
}));
export type NilCollective = typeof nilCollectives.$inferSelect;

// ============================================================================
// ORGANIZATIONS - Multi-seat team billing
// ============================================================================

export const organizations = pgTable("organizations", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ownerUserId: integer("owner_user_id").notNull(),
  seatLimit: integer("seat_limit").notNull().default(1), // 1=Pro, 5=Team, -1=Enterprise unlimited
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
export type Organization = typeof organizations.$inferSelect;

export const organizationMembers = pgTable("organization_members", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  userId: integer("user_id").notNull(),
  role: text("role").notNull().default("member"), // 'owner' | 'member'
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  orgUserUnique: uniqueIndex("org_members_org_user_unique").on(table.organizationId, table.userId),
  orgIdx: index("org_members_org_idx").on(table.organizationId),
  userIdx: index("org_members_user_idx").on(table.userId),
}));
export type OrganizationMember = typeof organizationMembers.$inferSelect;

export const organizationInvites = pgTable("organization_invites", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").notNull(),
  email: text("email").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  acceptedAt: timestamp("accepted_at"),
}, (table) => ({
  tokenIdx: index("org_invites_token_idx").on(table.token),
  orgIdx: index("org_invites_org_idx").on(table.organizationId),
}));
export type OrganizationInvite = typeof organizationInvites.$inferSelect;

export const insertUserSchema = createInsertSchema(users).omit({
  id: true,
  passwordHash: true,
  createdAt: true,
  lastLoginAt: true,
});

export type User = typeof users.$inferSelect;
export type InsertUser = z.infer<typeof insertUserSchema>;

// Auth validation schemas
export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  fullName: z.string().min(1, "Full name is required"),
  acceptedTos: z.literal(true, {
    errorMap: () => ({ message: "You must agree to the Terms and Privacy Policy" }),
  }),
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
