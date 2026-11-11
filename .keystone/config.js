"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// features/keystone/security/readAudit.ts
var readAudit_exports = {};
__export(readAudit_exports, {
  AUDITED_TYPES: () => AUDITED_TYPES,
  actorFromSession: () => actorFromSession2,
  collectReads: () => collectReads,
  readAuditPlugin: () => readAuditPlugin,
  writeReadAudit: () => writeReadAudit
});
function opOf(document, operationName) {
  const ops = document.definitions.filter((d) => d.kind === import_graphql2.Kind.OPERATION_DEFINITION);
  return operationName ? ops.find((o) => o.name?.value === operationName) : ops.length === 1 ? ops[0] : void 0;
}
function fieldsIn(set, fragments, typename, seen = /* @__PURE__ */ new Set()) {
  const out = [];
  for (const s of set.selections) {
    if (s.kind === import_graphql2.Kind.FIELD) out.push(s);
    else if (s.kind === import_graphql2.Kind.INLINE_FRAGMENT) {
      if (!s.typeCondition || !typename || s.typeCondition.name.value === typename) out.push(...fieldsIn(s.selectionSet, fragments, typename, seen));
    } else if (s.kind === import_graphql2.Kind.FRAGMENT_SPREAD && !seen.has(s.name.value)) {
      seen.add(s.name.value);
      const f = fragments.get(s.name.value);
      if (f && (!typename || f.typeCondition.name.value === typename)) out.push(...fieldsIn(f.selectionSet, fragments, typename, seen));
    }
  }
  return out;
}
function collectReads(input) {
  const op2 = opOf(input.document, input.operationName);
  if (!op2 || !input.data || typeof input.data !== "object") return [];
  const fragments = /* @__PURE__ */ new Map();
  for (const d of input.document.definitions) if (d.kind === import_graphql2.Kind.FRAGMENT_DEFINITION) fragments.set(d.name.value, d);
  const refs = /* @__PURE__ */ new Map();
  const visit = (value, typeName, set) => {
    if (value == null || !set) return;
    if (Array.isArray(value)) {
      for (const v of value) visit(v, typeName, set);
      return;
    }
    if (typeof value !== "object") return;
    const obj = value;
    const actualType = typeof obj.__typename === "string" ? obj.__typename : typeName;
    const fields = fieldsIn(set, fragments, actualType);
    if (actualType && AUDITED_TYPES.has(actualType)) {
      const id2 = typeof obj.id === "string" ? obj.id : null;
      const key2 = `${actualType}:${id2 ?? "?"}`;
      const ref = refs.get(key2) ?? { resourceType: actualType, resourceId: id2, fields: /* @__PURE__ */ new Set() };
      for (const f of fields) if (!f.selectionSet && f.name.value !== "__typename") ref.fields.add(f.name.value);
      refs.set(key2, ref);
    }
    for (const f of fields) {
      if (!f.selectionSet) continue;
      const responseKey = f.alias?.value ?? f.name.value;
      const childType = actualType ? input.typeOf(actualType, f.name.value) : null;
      visit(obj[responseKey], childType, f.selectionSet);
    }
  };
  const root = input.rootType ?? (op2.operation === "mutation" ? "Mutation" : "Query");
  visit(input.data, root, op2.selectionSet);
  return [...refs.values()];
}
function actorFromSession2(session) {
  if (!session?.itemId) return null;
  if (session.mcp) return { actorKind: "agent", actorId: `oauth:${session.mcp.clientId}:${session.itemId}`, actorLabel: session.data?.name ?? null };
  if (session.data?.kind === "agent") return { actorKind: "agent", actorId: String(session.itemId), actorLabel: session.data?.name ?? null };
  return { actorKind: "user", actorId: String(session.itemId), actorLabel: session.data?.name ?? null };
}
async function writeReadAudit(prisma, actor, refs, purpose, requestId) {
  if (!refs.length) return 0;
  await prisma.readAudit.createMany({
    data: refs.slice(0, 5e3).map((ref) => ({
      actorKind: actor.actorKind,
      actorId: actor.actorId,
      actorLabel: actor.actorLabel ?? "",
      resourceType: ref.resourceType,
      resourceId: ref.resourceId ?? "",
      ...subjectOf(ref),
      purpose,
      fields: [...ref.fields].sort(),
      requestId: requestId ?? ""
    }))
  });
  return refs.length;
}
function readAuditPlugin(getPrisma) {
  return {
    onExecute({ args }) {
      return {
        async onExecuteDone({ result, setResult }) {
          if (!result || typeof result[Symbol.asyncIterator] === "function") return;
          const actor = actorFromSession2(args?.contextValue?.session);
          if (!actor || !result.data) return;
          try {
            const schema = args.schema;
            const typeOf = (parent, field) => {
              const t = schema?.getType(parent);
              const f = t?.getFields?.()[field];
              if (!f) return null;
              let ft = f.type;
              while (ft?.ofType) ft = ft.ofType;
              return ft?.name ?? null;
            };
            const refs = collectReads({ document: args.document, operationName: args.operationName, data: result.data, typeOf });
            if (!refs.length) return;
            const req = args?.contextValue?.req;
            const asked = String(req?.headers?.["x-access-purpose"] ?? "");
            const purpose = PURPOSES.has(asked) ? asked : actor.actorKind === "agent" ? "agent_tool" : "treatment";
            const requestId = req?.headers?.["x-request-id"] ?? null;
            await writeReadAudit(getPrisma(), actor, refs, purpose, requestId);
          } catch {
            setResult({ data: null, errors: [new import_graphql2.GraphQLError("This read could not be audited, so it was not returned.", { extensions: { code: "READ_AUDIT_FAILED" } })] });
          }
        }
      };
    }
  };
}
var import_graphql2, AUDITED_TYPES, subjectOf, PURPOSES;
var init_readAudit = __esm({
  "features/keystone/security/readAudit.ts"() {
    "use strict";
    import_graphql2 = require("graphql");
    AUDITED_TYPES = /* @__PURE__ */ new Set([
      // Phase 1: clients, people, contact points, consent, comms, records requests
      "Client",
      "ClientPerson",
      "ContactPoint",
      "ConsentRecord",
      "CommsThread",
      "CommsMessage",
      "CallRecord",
      "RecordsRequest",
      "RecordsRelease",
      // Patients and the clinical record
      "Patient",
      "PatientWeight",
      "PatientAlert",
      "PatientAllergy",
      "PatientProblem",
      "Encounter",
      "EncounterSection",
      "Addendum",
      "VitalsSet",
      "Prescription",
      "PrescriptionLine",
      "Dispense",
      "RefillRequest",
      "VaccinationRecord",
      "RabiesCertificate",
      "LabOrder",
      "LabResult",
      "AnaesthesiaRecord",
      "SurgeryRecord",
      "EuthanasiaConsent",
      "TreatmentSheet",
      "Treatment",
      "Estimate",
      "Invoice",
      "Payment",
      "Appointment",
      "Boarding",
      "Hospitalization",
      "ClinicalDocument",
      "ScribeDraft",
      "Referral",
      // Phase 1 lists that carry PHI-grade detail: ownership, weights, chips, VCPR, insurance, schedule, triage, board
      "PatientOwnership",
      "WeightMeasurement",
      "AlertAcknowledgement",
      "Microchip",
      "VcprRecord",
      "PetInsurancePolicy",
      "AppointmentPatient",
      "AppointmentSegment",
      "WaitlistEntry",
      "TriageAssessment",
      "WhiteboardEntry",
      "Suppression",
      "CsContainer",
      "CsLogEntry",
      "CsCount",
      "CsCountLine",
      "CsDiscrepancyCase",
      "CsDestructionRecord",
      "PdmpReport",
      "DispenseLabel",
      "ExternalDispense",
      "WrittenRxExport",
      "RecallExposure",
      "CsWitness",
      "CsOrderForm",
      "CsOrderFormLine",
      "CsTransfer",
      "PdmpSubmission",
      "CabinetAccessEvent",
      // Phase 2: the medical record, orders and treatment, preventive care
      "SoapSection",
      "SoapSectionRevision",
      "VitalsObservation",
      "PhysicalExamFinding",
      "Problem",
      "Diagnosis",
      "ClinicalAttachment",
      "ScribeSession",
      "ClinicalOrder",
      "DoseCalculation",
      "Administration",
      "HospitalStay",
      "CageAssignment",
      "TreatmentSheetOrder",
      "TreatmentTask",
      "MonitoringReading",
      "SurgeryReport",
      "DentalChart",
      "DischargeInstruction",
      "VaccineAdministration",
      "PatientReminder",
      "ReminderSatisfaction",
      "AdverseEventReport"
    ]);
    subjectOf = (ref) => ({
      patientId: ref.resourceType === "Patient" ? ref.resourceId ?? "" : "",
      clientId: ref.resourceType === "Client" ? ref.resourceId ?? "" : ""
    });
    PURPOSES = /* @__PURE__ */ new Set(["treatment", "operations", "records_request", "agent_tool", "audit", "break_glass"]);
  }
});

// keystone.ts
var keystone_exports = {};
__export(keystone_exports, {
  default: () => keystone_default2
});
module.exports = __toCommonJS(keystone_exports);

// features/keystone/index.ts
var import_auth = require("@keystone-6/auth");
var import_core21 = require("@keystone-6/core");
var import_config = require("dotenv/config");

// features/keystone/models/User.ts
var import_core = require("@keystone-6/core");
var import_access = require("@keystone-6/core/access");
var import_fields3 = require("@keystone-6/core/fields");

// features/keystone/models/guardedRelationship.ts
var import_fields = require("@keystone-6/core/fields");
var registry = /* @__PURE__ */ new Map();
function registerListAccess(lists) {
  for (const [key2, list19] of Object.entries(lists)) registry.set(key2, list19.access);
}
var call = async (fn, args) => typeof fn === "function" ? await fn(args) : fn;
async function canReadWholeList(listKey, args) {
  if (!registry.has(listKey)) return false;
  const access = registry.get(listKey);
  const base = { session: args.session, context: args.context, listKey, operation: "query" };
  try {
    if (typeof access === "function") return await access(base) === true;
    const operation = access?.operation;
    const query = typeof operation === "function" ? operation : operation?.query;
    if (query === void 0) return false;
    if (await call(query, base) !== true) return false;
    const filter = access?.filter?.query;
    if (filter === void 0) return true;
    return await call(filter, base) === true;
  } catch {
    return false;
  }
}
var relationFilterRule = (target) => (args) => canReadWholeList(target, args);
var relationship = (config2) => {
  const target = String(config2.ref).split(".")[0];
  const rule2 = relationFilterRule(target);
  return (0, import_fields.relationship)({
    ...config2,
    isFilterable: config2.isFilterable === false ? false : rule2,
    isOrderable: config2.isOrderable === false ? false : rule2
  });
};

// features/keystone/models/trackingFields.ts
var import_fields2 = require("@keystone-6/core/fields");
var trackingFields = {
  createdAt: (0, import_fields2.timestamp)({
    access: { read: () => true, create: () => false, update: () => false },
    validation: { isRequired: true },
    defaultValue: { kind: "now" },
    ui: {
      createView: { fieldMode: "hidden" },
      itemView: { fieldMode: "read" }
    }
  }),
  updatedAt: (0, import_fields2.timestamp)({
    access: { read: () => true, create: () => false, update: () => false },
    db: { updatedAt: true },
    validation: { isRequired: true },
    defaultValue: { kind: "now" },
    ui: {
      createView: { fieldMode: "hidden" },
      itemView: { fieldMode: "read" }
    }
  })
};

// features/keystone/access.ts
var permissionNames = [
  // Starter and fleet-mandatory
  "canSeeOtherPeople",
  "canEditOtherPeople",
  "canManagePeople",
  "canManageRoles",
  "canAccessDashboard",
  "canManageOnboarding",
  "canManagePayments",
  "canIssueRefunds",
  "canReadAudit",
  // Practice
  "canManagePractice",
  "canManageIntegrations",
  "canManagePolicies",
  "canManageFees",
  "canApprovePolicies",
  "canApproveFees",
  // Clients and patients
  "canManageClients",
  "canManagePatients",
  "canMergeRecords",
  "canApproveMerges",
  "canReadClinical",
  "canReadClientPII",
  // Schedule
  "canBook",
  "canOverbook",
  "canCheckIn",
  "canManageSchedules",
  // Clinical ([L] signRecord, prescribe, performSurgery, authoriseEuthanasia)
  "canWriteRecord",
  "canSignRecord",
  "canOrder",
  "canAdminister",
  "canPrescribe",
  "canPerformSurgery",
  "canAuthoriseEuthanasia",
  // Pharmacy
  "canDispense",
  "canFulfilRefill",
  "canManageRefills",
  // Controlled substances (never reachable by agents: I-G4)
  "canAdministerControlled",
  "canWitnessControlled",
  "canCountControlled",
  "canReceiveControlled",
  "canManageControlled",
  "canViewControlled",
  // Inventory
  "canManageInventory",
  "canReceiveStock",
  "canOrderStock",
  "canApprovePurchase",
  "canReleaseQuarantine",
  // Money
  "canTakePayments",
  "canPostInvoices",
  "canAddManualCharge",
  "canDiscount",
  "canApproveDiscount",
  "canApproveWriteOff",
  "canViewFinance",
  // Records
  "canProcessRecordsRequests",
  "canApproveRecordsRelease",
  // Boarding and grooming
  "canManageBoarding",
  "canGroom",
  // Communications
  "canMessageClients",
  "canManageTemplates",
  // Agents
  "canManageAgents",
  "canApproveAgentScopes",
  // Raw override of a clinical read restriction. Never seeded on a default role; every use is audited.
  "canBreakGlass"
];
var approvalPermissions = permissionNames.filter(
  (name) => name.startsWith("canApprove") || name === "canBreakGlass" || name === "canManageControlled" || name === "canIssueRefunds"
);
var isSignedIn = ({ session }) => {
  if (!session) return false;
  const expires = session.data?.accessExpiresAt;
  return !expires || Date.parse(expires) > Date.now();
};
var hasPermission = (session, permission) => isSignedIn({ session }) && session?.data.role?.[permission] === true;
var permissions = Object.fromEntries(
  permissionNames.map((name) => [name, ({ session }) => hasPermission(session, name)])
);
var anyOf = (...names) => ({ session }) => names.some((name) => hasPermission(session, name));
var sys = () => false;
var rules = {
  canReadPeople: ({ session }) => !isSignedIn({ session }) ? false : session.data.role?.canSeeOtherPeople || session.data.role?.canManagePeople ? true : { id: { equals: session.itemId } },
  canUpdatePeople: ({ session }) => !isSignedIn({ session }) ? false : session.data.role?.canEditOtherPeople || session.data.role?.canManagePeople ? true : { id: { equals: session.itemId } }
};

// features/keystone/models/User.ts
var User = (0, import_core.list)({
  access: {
    operation: {
      ...(0, import_access.allOperations)(isSignedIn),
      create: (args) => {
        if (process.env.PUBLIC_SIGNUPS_ALLOWED === "true") {
          return true;
        }
        return permissions.canManagePeople(args);
      },
      delete: permissions.canManagePeople
    },
    filter: {
      query: rules.canReadPeople,
      update: rules.canUpdatePeople
    }
  },
  ui: {
    hideCreate: (args) => !permissions.canManagePeople(args),
    hideDelete: (args) => !permissions.canManagePeople(args),
    listView: {
      initialColumns: ["name", "email", "title", "role", "kind"]
    },
    itemView: {
      defaultFieldMode: ({ session, item }) => {
        if (session?.data.role?.canEditOtherPeople) return "edit";
        if (session?.itemId === item?.id) return "edit";
        return "read";
      }
    }
  },
  fields: {
    name: (0, import_fields3.text)({
      validation: {
        isRequired: true
      }
    }),
    email: (0, import_fields3.text)({
      isFilterable: false,
      isOrderable: false,
      isIndexed: "unique",
      validation: {
        isRequired: true
      }
    }),
    password: (0, import_fields3.password)({
      access: {
        read: import_access.denyAll,
        update: ({ session, item }) => permissions.canManagePeople({ session }) || session?.itemId === item.id
      },
      validation: { isRequired: true }
    }),
    role: relationship({
      ref: "Role.assignedTo",
      access: {
        create: permissions.canManagePeople,
        update: permissions.canManagePeople
      },
      ui: {
        itemView: {
          fieldMode: (args) => permissions.canManagePeople(args) ? "edit" : "read"
        }
      }
    }),
    kind: (0, import_fields3.select)({
      type: "enum",
      options: ["staff", "relief", "auditor", "administrator"].map((value) => ({ label: value, value })),
      defaultValue: "staff",
      access: { create: permissions.canManagePeople, update: permissions.canManagePeople }
    }),
    title: (0, import_fields3.text)(),
    staffMember: relationship({ ref: "StaffMember.user", ui: { description: "The clinical staff record (licences, schedules, DEA)." } }),
    mfaEnrolled: (0, import_fields3.checkbox)({ defaultValue: false, access: { create: () => false, update: () => false } }),
    accessExpiresAt: (0, import_fields3.timestamp)({
      access: { create: permissions.canManagePeople, update: permissions.canManagePeople },
      ui: { description: "Time-boxed access for relief vets, auditors and temporary administrators." }
    }),
    onboardingStatus: (0, import_fields3.select)({
      options: ["not_started", "in_progress", "completed", "dismissed"].map((value) => ({ label: value.replaceAll("_", " "), value })),
      defaultValue: "not_started"
    }),
    ...trackingFields
  }
});

// features/keystone/models/Role.ts
var import_core2 = require("@keystone-6/core");
var import_access3 = require("@keystone-6/core/access");
var import_fields4 = require("@keystone-6/core/fields");
var Role = (0, import_core2.list)({
  access: {
    operation: {
      ...(0, import_access3.allOperations)(permissions.canManageRoles),
      query: isSignedIn
    }
  },
  ui: {
    hideCreate: (args) => !permissions.canManageRoles(args),
    hideDelete: (args) => !permissions.canManageRoles(args),
    listView: {
      initialColumns: ["name", "assignedTo"]
    },
    itemView: {
      defaultFieldMode: (args) => permissions.canManageRoles(args) ? "edit" : "read"
    }
  },
  fields: {
    name: (0, import_fields4.text)({ validation: { isRequired: true } }),
    description: (0, import_fields4.text)({ ui: { displayMode: "textarea" } }),
    ...Object.fromEntries(permissionNames.map((name) => [name, (0, import_fields4.checkbox)({ defaultValue: false })])),
    ...trackingFields,
    assignedTo: relationship({
      ref: "User.role",
      many: true,
      ui: {
        itemView: { fieldMode: "read" }
      }
    })
  }
});

// features/keystone/models/OAuthApp.ts
var import_core3 = require("@keystone-6/core");
var import_fields5 = require("@keystone-6/core/fields");

// features/keystone/mcp-oauth/core.ts
var import_node_crypto = __toESM(require("node:crypto"));
var MCP_SCOPES = ["mcp:read", "mcp:write"];
var MCP_ACCESS_PREFIX = "mcp_at_";
var ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
var REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1e3;
var AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1e3;
var CONSENT_TICKET_TTL_MS = 10 * 60 * 1e3;
var DEVELOPMENT_SECRET = "this secret should only be used in testing";
function secret() {
  return process.env.SESSION_SECRET || DEVELOPMENT_SECRET;
}
function randomToken(prefix, bytes = 32) {
  return `${prefix}${import_node_crypto.default.randomBytes(bytes).toString("base64url")}`;
}
function digestToken(token, purpose = "mcp-oauth-token") {
  return import_node_crypto.default.createHmac("sha256", secret()).update(`${purpose}\0${token}`, "utf8").digest("hex");
}
function bearerToken(header) {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== "string") return null;
  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1] : null;
}
function isMcpAccessToken(token) {
  return typeof token === "string" && token.startsWith(MCP_ACCESS_PREFIX) && token.length > MCP_ACCESS_PREFIX.length;
}
function storedScopes(value) {
  return Array.isArray(value) ? MCP_SCOPES.filter((scope) => value.includes(scope)) : [];
}

// features/keystone/models/OAuthApp.ts
var OAuthApp = (0, import_core3.list)({
  access: {
    operation: {
      query: permissions.canManagePeople,
      create: permissions.canManagePeople,
      update: permissions.canManagePeople,
      delete: permissions.canManagePeople
    }
  },
  fields: {
    name: (0, import_fields5.text)({
      validation: {
        isRequired: true
      }
    }),
    clientId: (0, import_fields5.text)({
      isIndexed: "unique",
      hooks: {
        resolveInput: ({ operation, resolvedData }) => {
          if (operation === "create" && !resolvedData.clientId) {
            return randomToken("mcp_cl_", 18);
          }
          return resolvedData.clientId;
        }
      },
      ui: {
        createView: { fieldMode: "hidden" },
        itemView: { fieldMode: "read" },
        description: "Auto-generated unique identifier for your application."
      }
    }),
    clientSecret: (0, import_fields5.text)({
      access: {
        read: () => false
      },
      // A digest is still an oracle if it can be filtered or sorted on; never through the API.
      isFilterable: false,
      isOrderable: false,
      graphql: { omit: { read: true } },
      hooks: {
        resolveInput: ({ resolvedData }) => {
          if (resolvedData.clientSecret) {
            return digestToken(resolvedData.clientSecret, "oauth-client-secret");
          }
          return void 0;
        }
      },
      ui: {
        createView: { fieldMode: "hidden" },
        itemView: { fieldMode: "hidden" },
        description: "Stored only as a digest. Public MCP clients have no secret."
      }
    }),
    tokenEndpointAuthMethod: (0, import_fields5.select)({
      options: [
        { label: "Client secret (POST)", value: "client_secret_post" },
        { label: "Client secret (Basic)", value: "client_secret_basic" },
        { label: "None (public PKCE client)", value: "none" }
      ],
      defaultValue: "client_secret_post",
      ui: {
        description: "How the app authenticates at the token endpoint. MCP clients are public (none)."
      }
    }),
    redirectUris: (0, import_fields5.json)({
      defaultValue: [],
      ui: {
        description: "Array of allowed redirect URIs for OAuth callbacks"
      }
    }),
    scopes: (0, import_fields5.json)({
      defaultValue: [...MCP_SCOPES],
      ui: {
        description: "Array of allowed OAuth scopes. MCP scopes only narrow the signed-in user's own access."
      }
    }),
    webhookUrl: (0, import_fields5.text)({
      ui: {
        description: "URL to receive webhook notifications"
      }
    }),
    status: (0, import_fields5.select)({
      options: [
        { label: "Active", value: "active" },
        { label: "Suspended", value: "suspended" },
        { label: "Pending", value: "pending" }
      ],
      defaultValue: "active"
    }),
    installUrl: (0, import_fields5.text)({
      ui: {
        description: "URL where users can install this app"
      }
    }),
    uninstallUrl: (0, import_fields5.text)({
      ui: {
        description: "URL to handle app uninstallation"
      }
    }),
    description: (0, import_fields5.text)({
      ui: {
        displayMode: "textarea"
      }
    }),
    metadata: (0, import_fields5.json)({
      defaultValue: {},
      ui: {
        description: "Additional app-specific configuration and settings"
      }
    }),
    developerEmail: (0, import_fields5.text)(),
    privacyPolicyUrl: (0, import_fields5.text)(),
    termsOfServiceUrl: (0, import_fields5.text)(),
    supportUrl: (0, import_fields5.text)(),
    ...trackingFields
  },
  ui: {
    labelField: "name",
    listView: {
      initialColumns: ["name", "clientId", "status", "createdAt"]
    }
  }
});

// features/keystone/models/OAuthToken.ts
var import_core5 = require("@keystone-6/core");
var import_fields6 = require("@keystone-6/core/fields");
var digestTokenInput = {
  resolveInput: ({ resolvedData, fieldKey }) => resolvedData[fieldKey] ? digestToken(resolvedData[fieldKey]) : resolvedData[fieldKey]
};
var OAuthToken = (0, import_core5.list)({
  access: {
    operation: {
      query: permissions.canManagePeople,
      create: permissions.canManagePeople,
      update: permissions.canManagePeople,
      delete: permissions.canManagePeople
    }
  },
  fields: {
    tokenType: (0, import_fields6.select)({
      options: [
        { label: "Authorization Code", value: "authorization_code" },
        { label: "Access Token", value: "access_token" },
        { label: "Refresh Token", value: "refresh_token" }
      ],
      validation: {
        isRequired: true
      }
    }),
    token: (0, import_fields6.text)({
      isFilterable: false,
      isOrderable: false,
      access: { read: () => false },
      validation: {
        isRequired: true
      },
      isIndexed: "unique",
      hooks: digestTokenInput
    }),
    clientId: (0, import_fields6.text)({
      validation: {
        isRequired: true
      },
      isIndexed: true
    }),
    user: relationship({
      ref: "User",
      ui: {
        description: "The user who authorized this token"
      }
    }),
    scopes: (0, import_fields6.json)({
      defaultValue: [],
      ui: {
        description: "Array of granted scopes"
      }
    }),
    redirectUri: (0, import_fields6.text)({
      ui: {
        description: "The redirect URI used during authorization"
      }
    }),
    agentId: (0, import_fields6.text)({
      access: { create: () => false, update: () => false },
      ui: {
        createView: { fieldMode: "hidden" },
        itemView: { fieldMode: "read" },
        description: "The AI agent this token acts as (set when issued to an app bound to an agent; empty for a person's own connection). A token with an agent never acts as the person who approved it."
      }
    }),
    resource: (0, import_fields6.text)({
      ui: {
        description: "The MCP endpoint (RFC 8707 resource) this grant is for"
      }
    }),
    expiresAt: (0, import_fields6.timestamp)({
      ui: {
        description: "When this token expires"
      }
    }),
    isRevoked: (0, import_fields6.select)({
      options: [
        { label: "Active", value: "false" },
        { label: "Revoked", value: "true" }
      ],
      defaultValue: "false"
    }),
    authorizationCode: (0, import_fields6.text)({
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "The authorization code that was exchanged for this token (for access tokens)"
      }
    }),
    refreshToken: (0, import_fields6.text)({
      isFilterable: false,
      isOrderable: false,
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "Associated refresh token (for access tokens)"
      }
    }),
    accessToken: (0, import_fields6.text)({
      isFilterable: false,
      isOrderable: false,
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "Associated access token (for refresh tokens)"
      }
    }),
    state: (0, import_fields6.text)({
      ui: {
        description: "OAuth state parameter for CSRF protection"
      }
    }),
    codeChallenge: (0, import_fields6.text)({
      ui: {
        description: "PKCE code challenge"
      }
    }),
    codeChallengeMethod: (0, import_fields6.select)({
      options: [
        { label: "Plain", value: "plain" },
        { label: "SHA256", value: "S256" }
      ],
      ui: {
        description: "PKCE code challenge method"
      }
    }),
    ...trackingFields
  },
  ui: {
    labelField: "clientId",
    listView: {
      initialColumns: ["tokenType", "clientId", "user", "scopes", "expiresAt", "isRevoked"]
    }
  }
});

// features/keystone/models/platform.ts
var platform_exports = {};
__export(platform_exports, {
  AgentIdentity: () => AgentIdentity,
  ApprovalDecision: () => ApprovalDecision,
  ApprovalPolicy: () => ApprovalPolicy,
  ApprovalRequest: () => ApprovalRequest,
  AuditEvent: () => AuditEvent,
  BreakGlassEvent: () => BreakGlassEvent,
  BusinessCalendar: () => BusinessCalendar,
  CalendarException: () => CalendarException,
  CommandReceipt: () => CommandReceipt,
  Document: () => Document,
  ExternalId: () => ExternalId,
  IntegrationConnection: () => IntegrationConnection,
  Notification: () => Notification,
  ProviderObservation: () => ProviderObservation,
  ReadAudit: () => ReadAudit,
  SecretBox: () => SecretBox,
  Sequence: () => Sequence
});
var import_core7 = require("@keystone-6/core");
var import_fields8 = require("@keystone-6/core/fields");

// features/keystone/models/domainFields.ts
var import_fields7 = require("@keystone-6/core/fields");
var minor = (options = {}) => (0, import_fields7.bigInt)({
  ...options.defaultValue !== void 0 ? { defaultValue: options.defaultValue } : {},
  validation: { isRequired: options.required ?? options.defaultValue !== void 0 },
  ...options.description ? { ui: { description: options.description } } : {}
});
var exact = (precision, scale) => (options = {}) => (0, import_fields7.decimal)({
  precision,
  scale,
  validation: { isRequired: options.required ?? false },
  ...options.description ? { ui: { description: options.description } } : {}
});
var qty = exact(18, 6);
var rate = exact(12, 6);
var wt = exact(10, 4);
var geo = exact(9, 6);
var UNITS = ["mg", "mcg", "g", "kg", "mL", "L", "tablet", "capsule", "unit", "IU", "each", "dose", "application", "drop", "cm", "in", "lb", "oz"];
var unit = (initial = null) => choice(UNITS, initial);
var WEIGHT_UNITS = ["kg", "lb", "g"];
var option = (value) => ({ label: value.replaceAll("_", " ").replaceAll(".", " \xB7 "), value });
var lifecycle = (values, initial = values[0]) => (0, import_fields7.select)({
  type: "string",
  options: values.map(option),
  defaultValue: initial,
  validation: { isRequired: true },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});
var choice = (values, initial = values[0]) => (0, import_fields7.select)({
  type: "string",
  options: values.map(option),
  ...initial !== null ? { defaultValue: initial } : {},
  validation: { isRequired: initial !== null }
});
var versionField = () => (0, import_fields7.integer)({
  defaultValue: 0,
  validation: { isRequired: true },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});
var systemText = (options = {}) => (0, import_fields7.text)({
  ...options.secret ? { isFilterable: false, isOrderable: false } : {},
  ...options.indexed ? { isIndexed: options.indexed } : {},
  ...options.nullable ? { db: { isNullable: true } } : {},
  validation: { isRequired: options.required ?? false },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});
var hiddenHash = (options = {}) => (0, import_fields7.text)({
  ...options.indexed ? { isIndexed: options.indexed } : {},
  validation: { isRequired: options.required ?? false },
  access: { read: () => false, create: () => false, update: () => false },
  isFilterable: false,
  isOrderable: false,
  graphql: { omit: { read: true, create: true, update: true } },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "hidden" }, listView: { fieldMode: "hidden" } }
});
var readOnly = { access: { create: () => false, update: () => false }, ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } } };
var fixedChoice = (values) => (0, import_fields7.select)({
  type: "string",
  options: values.map(option),
  validation: { isRequired: true },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});

// features/keystone/models/listAccess.ts
var rule = (permission) => permission === "signedIn" ? isSignedIn : Array.isArray(permission) ? anyOf(...permission) : permissions[permission];
var governed = (read) => ({
  operation: { query: rule(read), create: sys, update: sys, delete: sys }
});
var managed = (read, write) => ({
  operation: { query: rule(read), create: rule(write), update: rule(write), delete: sys }
});
var immutable = governed;
var serverOnly = {
  operation: { query: sys, create: sys, update: sys, delete: sys }
};

// features/keystone/models/platform.ts
var AgentIdentity = (0, import_core7.list)({
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManageAgents, update: () => false, delete: () => false } },
  ui: { labelField: "name" },
  fields: {
    name: (0, import_fields8.text)({ validation: { isRequired: true }, isIndexed: "unique" }),
    kind: choice(["voice_receptionist", "sms_receptionist", "scribe", "charge_capture", "insights", "external_mcp_client"], "voice_receptionist"),
    model: (0, import_fields8.text)(),
    provider: (0, import_fields8.text)(),
    owner: relationship({ ref: "User" }),
    status: lifecycle(["active", "paused", "revoked"]),
    killSwitch: (0, import_fields8.checkbox)({ ...readOnly, defaultValue: false, ui: { ...readOnly.ui, description: "On: every tool call is refused at once (setAgentKillSwitch)." } }),
    limits: (0, import_fields8.json)({ ...readOnly, defaultValue: { toolCallsPerRun: 40 } }),
    oauthApp: relationship({ ref: "OAuthApp" }),
    grants: relationship({ ref: "AgentToolGrant.agent", many: true, ...readOnly }),
    runs: relationship({ ref: "AgentRun.agent", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AuditEvent = (0, import_core7.list)({
  access: immutable("canReadAudit"),
  ui: { labelField: "eventType", listView: { initialColumns: ["seq", "at", "eventType", "entityType", "entityId", "actorUser"], initialSort: { field: "seq", direction: "DESC" } } },
  fields: {
    seq: (0, import_fields8.integer)({ isIndexed: "unique", validation: { isRequired: true }, ...readOnly }),
    eventKey: systemText({ indexed: "unique", required: true }),
    eventType: systemText({ indexed: true, required: true }),
    entityType: systemText({ indexed: true, required: true }),
    entityId: systemText({ indexed: true, required: true }),
    actorUser: relationship({ ref: "User", ...readOnly }),
    actorAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    approver: relationship({ ref: "User", ...readOnly }),
    reason: systemText(),
    before: (0, import_fields8.json)({ ...readOnly }),
    after: (0, import_fields8.json)({ ...readOnly }),
    metadata: (0, import_fields8.json)({ ...readOnly }),
    requestId: systemText(),
    prevHash: systemText({ required: true }),
    hash: systemText({ indexed: "unique", required: true }),
    at: (0, import_fields8.timestamp)({ validation: { isRequired: true }, defaultValue: { kind: "now" }, ...readOnly })
  }
});
var CommandReceipt = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    idempotencyKey: (0, import_fields8.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    command: (0, import_fields8.text)({ validation: { isRequired: true } }),
    principalKey: (0, import_fields8.text)({ validation: { isRequired: true } }),
    requestHash: (0, import_fields8.text)({ validation: { isRequired: true } }),
    requestParams: (0, import_fields8.json)(),
    responseCode: (0, import_fields8.text)(),
    responseBody: (0, import_fields8.json)(),
    recoveryPoint: (0, import_fields8.text)({ defaultValue: "completed" }),
    completedAt: (0, import_fields8.timestamp)({ defaultValue: { kind: "now" } }),
    ...trackingFields
  }
});
var Sequence = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    key: (0, import_fields8.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    nextValue: (0, import_fields8.integer)({ defaultValue: 1, validation: { isRequired: true } })
  }
});
var Notification = (0, import_core7.list)({
  access: {
    operation: { query: permissions.canAccessDashboard, create: () => false, update: permissions.canAccessDashboard, delete: () => false },
    filter: {
      query: ({ session }) => session ? { recipient: { id: { equals: session.itemId } } } : false,
      update: ({ session }) => session ? { recipient: { id: { equals: session.itemId } } } : false
    }
  },
  fields: {
    recipient: relationship({ ref: "User", ...readOnly }),
    channel: choice(["in_app", "email"], "in_app"),
    template: systemText({ required: true }),
    payload: (0, import_fields8.json)({ ...readOnly }),
    status: lifecycle(["pending", "sent", "failed"]),
    sentAt: (0, import_fields8.timestamp)({ ...readOnly }),
    readAt: (0, import_fields8.timestamp)(),
    ...trackingFields
  }
});
var BusinessCalendar = (0, import_core7.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "code" },
  fields: {
    code: (0, import_fields8.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    name: (0, import_fields8.text)(),
    timeZone: (0, import_fields8.text)({ validation: { isRequired: true }, defaultValue: "America/Los_Angeles" }),
    kind: choice(["federal", "state", "location"], "location"),
    weekendDays: (0, import_fields8.json)({ defaultValue: [0, 6] }),
    regularOpen: (0, import_fields8.text)({ defaultValue: "08:00", ui: { description: "HH:mm local" } }),
    regularClose: (0, import_fields8.text)({ defaultValue: "18:00", ui: { description: "HH:mm local" } }),
    composedOf: relationship({ ref: "BusinessCalendar", many: true, ui: { description: "Holidays of these calendars also apply (a location calendar composes the federal one)." } }),
    exceptions: relationship({ ref: "CalendarException.calendar", many: true }),
    coverageThrough: (0, import_fields8.calendarDay)({ ui: { description: "Scheduling past this date is blocked." } }),
    source: (0, import_fields8.text)({ ui: { description: "Where the holiday table came from and when it was checked." } }),
    ...trackingFields
  }
});
var CalendarException = (0, import_core7.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "date", listView: { initialColumns: ["calendar", "date", "kind", "closeAt", "note"] } },
  fields: {
    calendar: relationship({ ref: "BusinessCalendar.exceptions" }),
    date: (0, import_fields8.calendarDay)({ validation: { isRequired: true } }),
    kind: choice(["holiday", "early_close", "special_open", "closed"], "holiday"),
    openAt: (0, import_fields8.text)(),
    closeAt: (0, import_fields8.text)(),
    note: (0, import_fields8.text)(),
    ...trackingFields
  }
});
var ApprovalPolicy = (0, import_core7.list)({
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManagePractice, update: () => false, delete: () => false } },
  ui: { labelField: "action" },
  fields: {
    action: (0, import_fields8.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    description: (0, import_fields8.text)(),
    requiredPermission: (0, import_fields8.text)({ validation: { isRequired: true } }),
    minApprovals: (0, import_fields8.integer)({ defaultValue: 1, validation: { min: 1 } }),
    thresholdMinor: minor(),
    expiresAfterMinutes: (0, import_fields8.integer)({ defaultValue: 1440 }),
    ...trackingFields
  }
});
var canDecideSomething = (session) => approvalPermissions.some((name) => hasPermission(session, name));
var ApprovalRequest = (0, import_core7.list)({
  access: {
    ...governed("canAccessDashboard"),
    filter: { query: ({ session }) => canDecideSomething(session) ? true : session?.itemId ? { requestedBy: { id: { equals: session.itemId } } } : false }
  },
  ui: { labelField: "action", listView: { initialColumns: ["action", "status", "targetList", "requestedBy", "createdAt", "expiresAt"] } },
  fields: {
    action: systemText({ indexed: true, required: true }),
    summary: systemText(),
    targetList: systemText({ required: true }),
    targetId: systemText({ indexed: true, required: true }),
    payload: (0, import_fields8.json)({ ...readOnly }),
    payloadHash: hiddenHash({ required: true }),
    requiredPermission: systemText({ required: true }),
    requestedBy: relationship({ ref: "User", ...readOnly }),
    requestedByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    status: lifecycle(["pending", "approved", "rejected", "expired", "cancelled"]),
    expiresAt: (0, import_fields8.timestamp)({ ...readOnly }),
    consumedAt: (0, import_fields8.timestamp)({ ...readOnly, ui: { ...readOnly.ui, description: "When the approved action was carried out. An approval is used once." } }),
    decisions: relationship({ ref: "ApprovalDecision.request", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ApprovalDecision = (0, import_core7.list)({
  access: {
    ...immutable("canAccessDashboard"),
    filter: {
      query: ({ session }) => canDecideSomething(session) ? true : session?.itemId ? { OR: [{ decidedBy: { id: { equals: session.itemId } } }, { request: { requestedBy: { id: { equals: session.itemId } } } }] } : false
    }
  },
  fields: {
    request: relationship({ ref: "ApprovalRequest.decisions", ...readOnly }),
    decidedBy: relationship({ ref: "User", ...readOnly }),
    decision: (0, import_fields8.select)({ type: "string", options: ["approve", "reject"].map((value) => ({ label: value, value })), validation: { isRequired: true }, ...readOnly }),
    reason: systemText(),
    at: (0, import_fields8.timestamp)({ defaultValue: { kind: "now" }, ...readOnly })
  }
});
var Document = (0, import_core7.list)({
  access: governed("canAccessDashboard"),
  fields: {
    title: (0, import_fields8.text)({ validation: { isRequired: true } }),
    kind: choice(["dea_form", "licence", "policy", "consent", "certificate", "records_packet", "invoice", "statement", "report", "import", "other"], "other"),
    storageKey: systemText(),
    sha256: systemText(),
    mimeType: systemText(),
    sizeBytes: (0, import_fields8.integer)({ ...readOnly }),
    documentVersion: (0, import_fields8.integer)({ defaultValue: 1, ...readOnly }),
    supersedes: relationship({ ref: "Document", ...readOnly }),
    visibility: choice(["internal", "client", "public"], "internal"),
    retentionUntil: (0, import_fields8.calendarDay)(),
    signedAt: (0, import_fields8.timestamp)({ ...readOnly }),
    esignEnvelopeId: systemText(),
    ...trackingFields
  }
});
var SecretBox = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    purpose: (0, import_fields8.text)({ validation: { isRequired: true } }),
    ciphertext: (0, import_fields8.text)({ validation: { isRequired: true } }),
    iv: (0, import_fields8.text)({ validation: { isRequired: true } }),
    authTag: (0, import_fields8.text)({ validation: { isRequired: true } }),
    keyVersion: (0, import_fields8.integer)({ defaultValue: 1 }),
    ...trackingFields
  }
});
var ReadAudit = (0, import_core7.list)({
  access: immutable("canReadAudit"),
  ui: { listView: { initialColumns: ["at", "actorKind", "actorLabel", "resourceType", "resourceId", "purpose"], initialSort: { field: "at", direction: "DESC" } } },
  fields: {
    actorKind: fixedChoice(["user", "agent", "system", "portal"]),
    actorId: systemText({ indexed: true, required: true }),
    actorLabel: systemText(),
    patientId: systemText({ indexed: true }),
    clientId: systemText({ indexed: true }),
    resourceType: systemText({ indexed: true, required: true }),
    resourceId: systemText({ indexed: true }),
    purpose: fixedChoice(["treatment", "operations", "records_request", "agent_tool", "audit", "break_glass"]),
    fields: (0, import_fields8.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Field names returned (never values)." } }),
    requestId: systemText(),
    at: (0, import_fields8.timestamp)({ defaultValue: { kind: "now" }, ...readOnly })
  }
});
var BreakGlassEvent = (0, import_core7.list)({
  access: governed("canReadAudit"),
  fields: {
    user: relationship({ ref: "User", ...readOnly }),
    resourceType: systemText({ required: true }),
    resourceId: systemText({ required: true }),
    reason: systemText({ required: true }),
    status: lifecycle(["open", "reviewed", "escalated"]),
    reviewedBy: relationship({ ref: "User", ...readOnly }),
    reviewedAt: (0, import_fields8.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ProviderObservation = (0, import_core7.list)({
  access: governed("canManageIntegrations"),
  fields: {
    source: systemText({ indexed: true, required: true }),
    connectionId: systemText(),
    externalId: systemText({ indexed: true }),
    contentHash: systemText({ required: true, secret: true }),
    payload: (0, import_fields8.json)({ ...readOnly }),
    receivedAt: (0, import_fields8.timestamp)({ defaultValue: { kind: "now" }, ...readOnly }),
    processedAt: (0, import_fields8.timestamp)({ ...readOnly }),
    status: lifecycle(["received", "processed", "ignored", "failed"]),
    ...trackingFields
  }
});
var IntegrationConnection = (0, import_core7.list)({
  access: governed("canManageIntegrations"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "area", "providerKey", "mode", "status", "lastHealthAt"] } },
  fields: {
    name: systemText({ required: true }),
    area: fixedChoice(["payments", "telephony", "voice_agent", "lab", "imaging", "pharmacy", "pdmp", "csos", "cabinet", "insurance", "accounting", "payroll", "scribe", "crematory", "email"]),
    providerKey: systemText({ required: true }),
    mode: fixedChoice(["manual", "test", "live"]),
    location: relationship({ ref: "Location", ...readOnly }),
    /** Name of the SecretBox entry holding the credential; the secret itself never leaves the server. */
    secretRef: systemText({ secret: true }),
    capabilityProfile: (0, import_fields8.json)({ ...readOnly }),
    status: lifecycle(["active", "paused", "error", "retired"]),
    lastHealthAt: (0, import_fields8.timestamp)({ ...readOnly }),
    lastError: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var ExternalId = (0, import_core7.list)({
  access: governed("canAccessDashboard"),
  fields: {
    system: systemText({ indexed: true, required: true }),
    recordType: systemText({ required: true }),
    recordId: systemText({ indexed: true, required: true }),
    value: systemText({ required: true }),
    ...trackingFields
  }
});

// features/keystone/models/practice.ts
var practice_exports = {};
__export(practice_exports, {
  DeaPowerOfAttorney: () => DeaPowerOfAttorney,
  DeaRegistration: () => DeaRegistration,
  LicenseEvaluation: () => LicenseEvaluation,
  Location: () => Location,
  PracticeSettings: () => PracticeSettings,
  ProfessionalLicense: () => ProfessionalLicense,
  StaffMember: () => StaffMember
});
var import_core8 = require("@keystone-6/core");
var import_fields9 = require("@keystone-6/core/fields");
var PracticeSettings = (0, import_core8.list)({
  isSingleton: true,
  graphql: { plural: "PracticeSettingsItems" },
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManagePractice, update: permissions.canManagePractice, delete: () => false } },
  fields: {
    legalName: (0, import_fields9.text)({ validation: { isRequired: true }, defaultValue: "Openfront Vet Clinic" }),
    displayName: (0, import_fields9.text)({ validation: { isRequired: true }, defaultValue: "Openfront Vet Clinic" }),
    homeTimeZone: (0, import_fields9.text)({ defaultValue: "America/Los_Angeles", validation: { isRequired: true } }),
    currencyCode: (0, import_fields9.text)({ defaultValue: "USD", validation: { isRequired: true, match: { regex: /^[A-Z]{3}$/ } } }),
    medicalDirector: relationship({ ref: "StaffMember", ui: { description: "Registrant contact for controlled substances." } }),
    estimateValidityDays: (0, import_fields9.integer)({ defaultValue: 30, validation: { min: 1, max: 365 } }),
    estimateOverageToleranceBps: (0, import_fields9.integer)({ defaultValue: 0, validation: { min: 0, max: 1e4 } }),
    electiveDepositPct: rate({ description: "Fraction of the estimate low end taken as a deposit for elective work (0.5 = 50%)." }),
    depositBasis: choice(["low", "high"], "low"),
    noShowGraceMinutes: (0, import_fields9.integer)({ defaultValue: 15, validation: { min: 0, max: 240 } }),
    unsignedRecordTaskHours: (0, import_fields9.integer)({ defaultValue: 24 }),
    unsignedRecordEscalateHours: (0, import_fields9.integer)({ defaultValue: 72 }),
    refundApprovalThresholdMinor: minor({ defaultValue: 25000n }),
    discountApprovalThresholdBps: (0, import_fields9.integer)({ defaultValue: 1e3 }),
    writeOffRequiresApproval: (0, import_fields9.checkbox)({ defaultValue: true }),
    weightMaxAgeHours: (0, import_fields9.json)({ defaultValue: { anaesthesia: 24, inpatient: 72, outpatient: 720 } }),
    features: (0, import_fields9.json)({ defaultValue: { boarding: true, grooming: true, wellnessPlans: true, insurance: true, aiVoice: false, scribe: false, multiLocation: true, pdmp: true, csos: false, drugCabinet: false } }),
    // Agents' owner can never be the checker of what the agent proposed (separation of duties).
    strictAgentOwnerSoD: (0, import_fields9.checkbox)({ ...readOnly, defaultValue: true }),
    onboardingStatus: choice(["not_started", "in_progress", "completed", "dismissed"], "not_started"),
    version: versionField(),
    ...trackingFields
  }
});
var Location = (0, import_core8.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "code", "kind", "stateCode", "timeZone", "active"] } },
  fields: {
    name: (0, import_fields9.text)({ validation: { isRequired: true } }),
    code: (0, import_fields9.text)({ isIndexed: "unique", validation: { isRequired: true, match: { regex: /^[A-Z0-9-]{3,24}$/, explanation: "Capital letters, digits and dashes." } } }),
    kind: choice(["general_practice", "emergency", "specialty", "wellness", "mobile"], "general_practice"),
    addressLine1: (0, import_fields9.text)(),
    addressLine2: (0, import_fields9.text)(),
    city: (0, import_fields9.text)(),
    postalCode: (0, import_fields9.text)(),
    stateCode: (0, import_fields9.text)({ validation: { isRequired: true, match: { regex: /^US-[A-Z]{2}$/, explanation: "ISO 3166-2, e.g. US-CA." } } }),
    lat: geo(),
    lng: geo(),
    timeZone: (0, import_fields9.text)({ validation: { isRequired: true }, defaultValue: "America/Los_Angeles" }),
    phone: (0, import_fields9.text)(),
    email: (0, import_fields9.text)(),
    calendar: relationship({ ref: "BusinessCalendar" }),
    openHours: (0, import_fields9.json)({ ui: { description: 'Per weekday open/close "HH:mm" in the location time zone.' } }),
    emergencyCoverage: choice(["none", "in_house", "referral"], "referral"),
    deaRegistrations: relationship({ ref: "DeaRegistration.location", many: true, ...readOnly }),
    active: (0, import_fields9.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var DeaRegistration = (0, import_core8.list)({
  access: { operation: { query: permissions.canViewControlled, create: () => false, update: () => false, delete: () => false } },
  ui: { labelField: "registrationNumber", listView: { initialColumns: ["registrationNumber", "registrantName", "location", "status", "expiresOn"] } },
  fields: {
    registrationNumber: systemText({ indexed: "unique", required: true }),
    registrantName: systemText({ required: true }),
    registrantKind: fixedChoice(["practitioner_individual", "practitioner_institution"]),
    staffMember: relationship({ ref: "StaffMember", ...readOnly }),
    location: relationship({ ref: "Location.deaRegistrations", ...readOnly }),
    schedules: (0, import_fields9.json)({ ...readOnly, ui: { ...readOnly.ui, description: 'Schedules covered, e.g. ["2","2N","3","3N","4","5"].' } }),
    issuedOn: (0, import_fields9.calendarDay)({ ...readOnly }),
    expiresOn: (0, import_fields9.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    stateCsRegistration: systemText(),
    csosCertificateRef: systemText(),
    powersOfAttorney: relationship({ ref: "DeaPowerOfAttorney.registration", many: true, ...readOnly }),
    status: lifecycle(["active", "expired", "surrendered", "revoked"]),
    version: versionField(),
    ...trackingFields
  }
});
var DeaPowerOfAttorney = (0, import_core8.list)({
  access: governed("canViewControlled"),
  fields: {
    registration: relationship({ ref: "DeaRegistration.powersOfAttorney", ...readOnly }),
    grantee: relationship({ ref: "StaffMember", ...readOnly }),
    signedOn: (0, import_fields9.calendarDay)({ ...readOnly }),
    revokedOn: (0, import_fields9.calendarDay)({ ...readOnly }),
    document: relationship({ ref: "Document", ...readOnly }),
    ...trackingFields
  }
});
var StaffMember = (0, import_core8.list)({
  access: managed("canAccessDashboard", "canManagePeople"),
  ui: { labelField: "displayName", listView: { initialColumns: ["displayName", "kind", "credentials", "homeLocation", "employment", "active"] } },
  fields: {
    user: relationship({ ref: "User.staffMember" }),
    displayName: (0, import_fields9.text)({ validation: { isRequired: true } }),
    kind: choice(["dvm", "rvt", "assistant", "csr", "groomer", "manager", "inventory", "bookkeeper", "kennel"]),
    credentials: (0, import_fields9.text)({ ui: { description: 'e.g. "DVM, DACVS".' } }),
    employment: choice(["employee", "relief", "contractor"], "employee"),
    homeLocation: relationship({ ref: "Location" }),
    locations: relationship({ ref: "Location", many: true }),
    colour: (0, import_fields9.text)(),
    licenses: relationship({ ref: "ProfessionalLicense.staffMember", many: true, ...readOnly }),
    active: (0, import_fields9.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var ProfessionalLicense = (0, import_core8.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "licenseNumber", listView: { initialColumns: ["staffMember", "kind", "stateCode", "licenseNumber", "status", "expiresOn"] } },
  fields: {
    staffMember: relationship({ ref: "StaffMember.licenses", ...readOnly }),
    kind: fixedChoice(["veterinarian", "registered_veterinary_technician", "veterinary_assistant_cs_permit", "groomer_cert"]),
    stateCode: systemText({ required: true }),
    licenseNumber: systemText({ required: true }),
    issuedOn: (0, import_fields9.calendarDay)({ ...readOnly }),
    expiresOn: (0, import_fields9.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["active", "expired", "suspended", "revoked"]),
    verifiedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    verifiedBy: relationship({ ref: "User", ...readOnly }),
    verificationSource: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var LicenseEvaluation = (0, import_core8.list)({
  access: immutable("canAccessDashboard"),
  ui: { listView: { initialColumns: ["action", "result", "staffMember", "location", "at"] } },
  fields: {
    action: systemText({ indexed: true, required: true }),
    staffMember: relationship({ ref: "StaffMember", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    at: (0, import_fields9.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    onDate: (0, import_fields9.calendarDay)({ ...readOnly }),
    license: relationship({ ref: "ProfessionalLicense", ...readOnly }),
    deaRegistration: relationship({ ref: "DeaRegistration", ...readOnly }),
    policyVersions: (0, import_fields9.json)({ ...readOnly }),
    result: fixedChoice(["allowed", "blocked"]),
    findings: (0, import_fields9.json)({ ...readOnly })
  }
});

// features/keystone/models/compliance.ts
var compliance_exports = {};
__export(compliance_exports, {
  ComplianceTask: () => ComplianceTask,
  Incident: () => Incident,
  LegalHold: () => LegalHold,
  MachineCredential: () => MachineCredential,
  Note: () => Note,
  PolicyBinding: () => PolicyBinding,
  PolicyPack: () => PolicyPack,
  PolicyVersion: () => PolicyVersion,
  RetentionPolicy: () => RetentionPolicy,
  Tag: () => Tag,
  Task: () => Task
});
var import_core9 = require("@keystone-6/core");
var import_fields10 = require("@keystone-6/core/fields");
var POLICY_KINDS = [
  "medical_records",
  "vcpr",
  "confidentiality",
  "controlled_substances",
  "prescription",
  "rabies",
  "supervision",
  "telehealth",
  "contact",
  "auto_renewal",
  "sales_tax",
  "boarding",
  "licensure"
];
var PolicyPack = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "code", listView: { initialColumns: ["code", "kind", "jurisdiction", "name"] } },
  fields: {
    code: systemText({ indexed: "unique", required: true }),
    name: systemText({ required: true }),
    kind: fixedChoice(POLICY_KINDS),
    jurisdiction: systemText({ indexed: true, required: true }),
    versions: relationship({ ref: "PolicyVersion.pack", many: true, ...readOnly }),
    ...trackingFields
  }
});
var PolicyVersion = (0, import_core9.list)({
  access: immutable("canAccessDashboard"),
  ui: { labelField: "label", listView: { initialColumns: ["pack", "label", "status", "effectiveFrom", "effectiveTo", "verified"] } },
  fields: {
    pack: relationship({ ref: "PolicyPack.versions", ...readOnly }),
    label: systemText({ required: true }),
    versionNumber: (0, import_fields10.integer)({ ...readOnly, validation: { isRequired: true } }),
    rules: (0, import_fields10.json)({ ...readOnly }),
    rulesHash: systemText({ required: true }),
    sourceRefs: (0, import_fields10.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Citations: [{ ref, title, url, section }]." } }),
    verified: (0, import_fields10.checkbox)({ ...readOnly, defaultValue: false }),
    unverifiedRules: (0, import_fields10.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Rule paths still marked (verify)." } }),
    verifiedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    effectiveFrom: (0, import_fields10.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    effectiveTo: (0, import_fields10.calendarDay)({ ...readOnly }),
    status: lifecycle(["draft", "published", "superseded"]),
    approval: relationship({ ref: "ApprovalRequest", ...readOnly }),
    publishedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    publishedBy: relationship({ ref: "User", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var PolicyBinding = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  fields: {
    pack: relationship({ ref: "PolicyPack", ...readOnly }),
    scope: fixedChoice(["practice", "location"]),
    location: relationship({ ref: "Location", ...readOnly }),
    layer: fixedChoice(["federal", "state", "local"]),
    ...trackingFields
  }
});
var ComplianceTask = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "title", listView: { initialColumns: ["kind", "title", "location", "dueAt", "status"], initialSort: { field: "dueAt", direction: "ASC" } } },
  fields: {
    kind: fixedChoice([
      "dea_theft_loss_notice",
      "dea_form_106",
      "dea_biennial_inventory",
      "dea_222_validity",
      "pdmp_report",
      "dea_registration_expiry",
      "licence_expiry",
      "records_request_response",
      "rabies_bite_observation",
      "vcpr_expiry",
      "refill_request_sla",
      "lab_result_review",
      "estimate_expiry",
      "wellness_renewal_notice",
      "retention_disposition",
      "policy_review"
    ]),
    title: systemText({ required: true }),
    subjectType: systemText(),
    subjectId: systemText({ indexed: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    startedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    dueAt: (0, import_fields10.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    dedupeKey: systemText({ indexed: "unique", nullable: true }),
    escalations: (0, import_fields10.json)({ ...readOnly }),
    status: lifecycle(["open", "done", "overdue", "waived"]),
    evidence: (0, import_fields10.json)({ ...readOnly }),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    completedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    completedBy: relationship({ ref: "User", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Task = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "title", listView: { initialColumns: ["title", "kind", "priority", "assignee", "dueAt", "status"], initialSort: { field: "dueAt", direction: "ASC" } } },
  fields: {
    ref: systemText({ indexed: "unique", nullable: true }),
    kind: fixedChoice(["call_back", "refill_review", "result_review", "record_unsigned", "records_request", "registration_review", "follow_up", "agent_handoff", "general"]),
    title: systemText({ required: true }),
    detail: (0, import_fields10.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    subjectType: systemText(),
    subjectId: systemText({ indexed: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    assignee: relationship({ ref: "StaffMember", ...readOnly }),
    roleName: systemText(),
    priority: fixedChoice(["urgent", "high", "normal", "low"]),
    dueAt: (0, import_fields10.timestamp)({ ...readOnly }),
    status: lifecycle(["open", "in_progress", "done", "cancelled"]),
    createdByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    createdByUser: relationship({ ref: "User", ...readOnly }),
    completedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Note = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  fields: {
    subjectType: systemText({ required: true }),
    subjectId: systemText({ indexed: true, required: true }),
    body: (0, import_fields10.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    visibility: fixedChoice(["staff", "clinical"]),
    /**
     * When set, the body supersedes the stored text of this field on the subject (an append-only
     * correction of wording on a row that can never change, e.g. Administration.reason). Screens
     * show the latest superseding note in place of the field; the original stays in the row and the audit trail.
     */
    supersedesField: systemText(),
    author: relationship({ ref: "User", ...readOnly }),
    authorAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    ...trackingFields
  }
});
var Tag = (0, import_core9.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name" },
  fields: {
    name: (0, import_fields10.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    colour: (0, import_fields10.text)(),
    appliesTo: fixedChoice(["client", "patient", "appointment", "any"]),
    ...trackingFields
  }
});
var LegalHold = (0, import_core9.list)({
  access: governed("canReadAudit"),
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    reason: systemText({ required: true }),
    subjectType: systemText({ required: true }),
    subjectId: systemText({ indexed: true, required: true }),
    placedBy: relationship({ ref: "User", ...readOnly }),
    placedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    releasedBy: relationship({ ref: "User", ...readOnly }),
    releasedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    status: lifecycle(["active", "released"]),
    version: versionField(),
    ...trackingFields
  }
});
var RetentionPolicy = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  fields: {
    recordClass: systemText({ indexed: "unique", required: true }),
    retainYears: (0, import_fields10.integer)({ ...readOnly, validation: { isRequired: true, min: 1 } }),
    from: fixedChoice(["last_visit", "record_date", "death", "account_closed"]),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    ...trackingFields
  }
});
var Incident = (0, import_core9.list)({
  access: governed("canReadAudit"),
  ui: { labelField: "title" },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    kind: fixedChoice(["privacy", "security", "controlled_substance", "patient_safety", "other"]),
    title: systemText({ required: true }),
    detail: (0, import_fields10.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    location: relationship({ ref: "Location", ...readOnly }),
    discoveredAt: (0, import_fields10.timestamp)({ ...readOnly }),
    status: lifecycle(["open", "investigating", "reported", "closed"]),
    version: versionField(),
    ...trackingFields
  }
});
var MachineCredential = (0, import_core9.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    name: (0, import_fields10.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    purpose: (0, import_fields10.text)({ validation: { isRequired: true } }),
    secretHash: (0, import_fields10.text)({ validation: { isRequired: true } }),
    lastUsedAt: (0, import_fields10.timestamp)(),
    revokedAt: (0, import_fields10.timestamp)(),
    ...trackingFields
  }
});

// features/keystone/models/clients.ts
var clients_exports = {};
__export(clients_exports, {
  AlertAcknowledgement: () => AlertAcknowledgement,
  Breed: () => Breed,
  Client: () => Client,
  ClientPerson: () => ClientPerson,
  ColourMarking: () => ColourMarking,
  ConsentRecord: () => ConsentRecord,
  ContactPoint: () => ContactPoint,
  Microchip: () => Microchip,
  Patient: () => Patient,
  PatientAlert: () => PatientAlert,
  PatientOwnership: () => PatientOwnership,
  PetInsurancePolicy: () => PetInsurancePolicy,
  RecordsRelease: () => RecordsRelease,
  RecordsRequest: () => RecordsRequest,
  ReferralHospital: () => ReferralHospital,
  ReferringVet: () => ReferringVet,
  RefillRequest: () => RefillRequest,
  Species: () => Species,
  ThirdPartyPayer: () => ThirdPartyPayer,
  VcprRecord: () => VcprRecord,
  WeightMeasurement: () => WeightMeasurement
});
var import_core10 = require("@keystone-6/core");
var import_fields11 = require("@keystone-6/core/fields");
var CLIENT_READ = ["canManageClients", "canBook", "canReadClientPII", "canReadClinical"];
var PATIENT_READ = ["canReadClinical", "canBook", "canManagePatients", "canCheckIn"];
var Client = (0, import_core10.list)({
  access: governed([...CLIENT_READ]),
  ui: { labelField: "displayName", listView: { initialColumns: ["ref", "displayName", "kind", "status", "primaryLocation"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    publicCode: systemText({ indexed: "unique", nullable: true }),
    displayName: systemText({ required: true }),
    kind: fixedChoice(["individual", "household", "rescue", "shelter", "business", "government"]),
    status: lifecycle(["prospect", "active", "inactive", "merged", "closed"]),
    primaryLocation: relationship({ ref: "Location", ...readOnly }),
    addressLine1: systemText(),
    addressLine2: systemText(),
    city: systemText(),
    stateCode: systemText(),
    postalCode: systemText(),
    creditLimitMinor: minor({ defaultValue: 0n }),
    accountFlags: (0, import_fields11.json)({ ...readOnly, defaultValue: {}, ui: { ...readOnly.ui, description: "collections, cashOnly, noOnlineBooking, cautionClient (staff safety)." } }),
    taxExempt: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    mergedInto: relationship({ ref: "Client", ...readOnly }),
    people: relationship({ ref: "ClientPerson.client", many: true, ...readOnly }),
    ownerships: relationship({ ref: "PatientOwnership.client", many: true, ...readOnly }),
    source: fixedChoice(["csr", "portal", "ai_voice", "ai_sms", "import", "walk_in"]),
    version: versionField(),
    ...trackingFields
  }
});
var ClientPerson = (0, import_core10.list)({
  access: governed([...CLIENT_READ]),
  ui: { labelField: "lastName", listView: { initialColumns: ["firstName", "lastName", "client", "relationship", "isPrimary"] } },
  fields: {
    client: relationship({ ref: "Client.people", ...readOnly }),
    firstName: systemText({ required: true }),
    lastName: systemText({ required: true }),
    relationship: fixedChoice(["owner", "co_owner", "family", "agent", "foster", "shelter_staff", "other"]),
    isPrimary: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    canBook: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: true }),
    canApproveTreatment: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    canReceiveRecords: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    canPay: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: true }),
    canAuthoriseEuthanasia: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    dateOfBirth: (0, import_fields11.calendarDay)({ ...readOnly }),
    preferredLanguage: systemText(),
    user: relationship({ ref: "User", ...readOnly }),
    identityVerifiedAt: (0, import_fields11.timestamp)({ ...readOnly }),
    contactPoints: relationship({ ref: "ContactPoint.person", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ContactPoint = (0, import_core10.list)({
  access: governed([...CLIENT_READ]),
  ui: { labelField: "value", listView: { initialColumns: ["person", "kind", "value", "status", "canText"] } },
  fields: {
    person: relationship({ ref: "ClientPerson.contactPoints", ...readOnly }),
    kind: fixedChoice(["mobile", "landline", "email"]),
    value: systemText({ required: true }),
    /** Hash of the normalised value: duplicate detection and caller lookup. Server-only (a phone number is guessable). */
    valueHash: hiddenHash({ indexed: true, required: true }),
    isPrimary: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    verifiedAt: (0, import_fields11.timestamp)({ ...readOnly }),
    canText: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    status: lifecycle(["active", "invalid", "ported"]),
    consents: relationship({ ref: "ConsentRecord.contactPoint", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ConsentRecord = (0, import_core10.list)({
  access: immutable([...CLIENT_READ]),
  ui: { listView: { initialColumns: ["contactPoint", "purpose", "action", "method", "at"] } },
  fields: {
    contactPoint: relationship({ ref: "ContactPoint.consents", ...readOnly }),
    purpose: fixedChoice(["care", "transactional", "marketing", "ai_voice", "recording"]),
    action: fixedChoice(["grant", "revoke"]),
    method: fixedChoice(["web_form", "sms_keyword", "verbal_recorded", "paper", "portal", "import", "staff_entry"]),
    evidence: relationship({ ref: "Document", ...readOnly }),
    callRecord: relationship({ ref: "CallRecord", ...readOnly }),
    keyword: systemText(),
    capturedByUser: relationship({ ref: "User", ...readOnly }),
    capturedByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    at: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});
var Species = (0, import_core10.list)({
  access: managed("signedIn", "canManagePractice"),
  graphql: { plural: "SpeciesList" },
  ui: { labelField: "name" },
  fields: {
    code: (0, import_fields11.text)({ isIndexed: "unique", validation: { isRequired: true, match: { regex: /^[a-z_]{2,40}$/ } } }),
    name: (0, import_fields11.text)({ validation: { isRequired: true } }),
    module: choice(["companion", "equine", "food_animal"], "companion"),
    defaultWeightUnit: choice(WEIGHT_UNITS, "kg"),
    vitalsReference: (0, import_fields11.json)({ ui: { description: 'Reference ranges: {"hr":[60,140],"rr":[10,30],"tempC":["37.5","39.2"]}' } }),
    breeds: relationship({ ref: "Breed.species", many: true }),
    active: (0, import_fields11.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var Breed = (0, import_core10.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "species", "sizeClass"] } },
  fields: {
    species: relationship({ ref: "Species.breeds" }),
    name: (0, import_fields11.text)({ validation: { isRequired: true } }),
    registryCode: (0, import_fields11.text)(),
    sizeClass: choice(["toy", "small", "medium", "large", "giant"], null),
    geneticFlags: (0, import_fields11.json)({ ui: { description: 'e.g. {"MDR1_risk": true} for herding breeds.' } }),
    ...trackingFields
  }
});
var ColourMarking = (0, import_core10.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name" },
  fields: { species: relationship({ ref: "Species" }), name: (0, import_fields11.text)({ validation: { isRequired: true } }), ...trackingFields }
});
var Patient = (0, import_core10.list)({
  access: governed([...PATIENT_READ]),
  ui: { labelField: "name", listView: { initialColumns: ["ref", "name", "species", "breed", "status"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    name: systemText({ required: true }),
    kind: fixedChoice(["individual", "group"]),
    species: relationship({ ref: "Species", ...readOnly }),
    breed: relationship({ ref: "Breed", ...readOnly }),
    secondaryBreed: relationship({ ref: "Breed", ...readOnly }),
    sex: fixedChoice(["male", "female", "unknown"]),
    reproductiveStatus: fixedChoice(["intact", "neutered", "spayed", "unknown"]),
    dateOfBirth: (0, import_fields11.calendarDay)({ ...readOnly }),
    dobEstimated: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    colourMarkings: systemText(),
    status: lifecycle(["pending", "active", "inactive", "deceased", "merged"]),
    deceasedAt: (0, import_fields11.timestamp)({ ...readOnly }),
    codeStatus: fixedChoice(["unspecified", "full", "closed_chest_only", "dnr"]),
    preferredDvm: relationship({ ref: "StaffMember", ...readOnly }),
    groupSize: (0, import_fields11.integer)({ ...readOnly }),
    mergedInto: relationship({ ref: "Patient", ...readOnly }),
    photo: relationship({ ref: "Document", ...readOnly }),
    ownerships: relationship({ ref: "PatientOwnership.patient", many: true, ...readOnly }),
    alerts: relationship({ ref: "PatientAlert.patient", many: true, ...readOnly }),
    weights: relationship({ ref: "WeightMeasurement.patient", many: true, ...readOnly }),
    microchips: relationship({ ref: "Microchip.patient", many: true, ...readOnly }),
    vcprs: relationship({ ref: "VcprRecord.patient", many: true, ...readOnly }),
    insurancePolicies: relationship({ ref: "PetInsurancePolicy.patient", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var PatientOwnership = (0, import_core10.list)({
  access: governed([...PATIENT_READ]),
  ui: { listView: { initialColumns: ["patient", "client", "role", "effectiveFrom", "effectiveTo"] } },
  fields: {
    patient: relationship({ ref: "Patient.ownerships", ...readOnly }),
    client: relationship({ ref: "Client.ownerships", ...readOnly }),
    role: fixedChoice(["primary", "co_owner", "foster", "boarding_custodian"]),
    effectiveFrom: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    effectiveTo: (0, import_fields11.timestamp)({ ...readOnly }),
    basis: fixedChoice(["registration", "transfer_signed", "adoption", "shelter_transfer", "court", "import"]),
    evidence: relationship({ ref: "Document", ...readOnly }),
    recordedBy: relationship({ ref: "User", ...readOnly }),
    ...trackingFields
  }
});
var WeightMeasurement = (0, import_core10.list)({
  access: immutable([...PATIENT_READ]),
  ui: { listView: { initialColumns: ["patient", "value", "unit", "valueKg", "method", "measuredAt"] } },
  fields: {
    patient: relationship({ ref: "Patient.weights", ...readOnly }),
    value: wt({ required: true }),
    unit: fixedChoice(WEIGHT_UNITS),
    valueKg: wt({ required: true }),
    method: fixedChoice(["scale", "owner_reported", "estimate", "carried_over"]),
    bodyConditionScore: (0, import_fields11.integer)({ ...readOnly, validation: { min: 1, max: 9 } }),
    measuredAt: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    measuredBy: relationship({ ref: "StaffMember", ...readOnly }),
    appointment: relationship({ ref: "Appointment", ...readOnly }),
    ...trackingFields
  }
});
var PatientAlert = (0, import_core10.list)({
  access: governed([...PATIENT_READ]),
  ui: { labelField: "text", listView: { initialColumns: ["patient", "kind", "severity", "text", "active"] } },
  fields: {
    patient: relationship({ ref: "Patient.alerts", ...readOnly }),
    kind: fixedChoice(["behaviour_caution", "allergy", "drug_sensitivity", "medical", "genetic", "handling", "financial", "deceased_sibling_note"]),
    severity: fixedChoice(["info", "warn", "block"]),
    text: systemText({ required: true }),
    active: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: true }),
    createdBy: relationship({ ref: "User", ...readOnly }),
    acknowledgements: relationship({ ref: "AlertAcknowledgement.alert", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AlertAcknowledgement = (0, import_core10.list)({
  access: immutable([...PATIENT_READ]),
  fields: {
    alert: relationship({ ref: "PatientAlert.acknowledgements", ...readOnly }),
    user: relationship({ ref: "User", ...readOnly }),
    appointment: relationship({ ref: "Appointment", ...readOnly }),
    at: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});
var Microchip = (0, import_core10.list)({
  access: governed([...PATIENT_READ]),
  ui: { labelField: "number", listView: { initialColumns: ["number", "patient", "standard", "registry", "active"] } },
  fields: {
    patient: relationship({ ref: "Patient.microchips", ...readOnly }),
    number: systemText({ indexed: true, required: true }),
    standard: fixedChoice(["iso_11784", "avid_9", "avid_10", "other"]),
    implantedOn: (0, import_fields11.calendarDay)({ ...readOnly }),
    registry: systemText(),
    registeredToClient: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    active: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: true }),
    ...trackingFields
  }
});
var VcprRecord = (0, import_core10.list)({
  access: governed(["canReadClinical", "canBook", "canCheckIn"]),
  ui: { listView: { initialColumns: ["patient", "dvm", "scope", "status", "establishedAt", "expiresAt"] } },
  fields: {
    patient: relationship({ ref: "Patient.vcprs", ...readOnly }),
    scope: fixedChoice(["dvm", "practice"]),
    dvm: relationship({ ref: "StaffMember", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    establishedByRef: systemText(),
    establishedVia: fixedChoice(["encounter", "import"]),
    establishedAt: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    expiresAt: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["active", "expired", "terminated"]),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    terminatedReason: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var ThirdPartyPayer = (0, import_core10.list)({
  access: managed("canAccessDashboard", "canManagePractice"),
  ui: { labelField: "name" },
  fields: {
    name: (0, import_fields11.text)({ validation: { isRequired: true }, isIndexed: "unique" }),
    kind: choice(["insurer", "financing", "shelter_program", "employer"], "insurer"),
    directPay: (0, import_fields11.checkbox)({ defaultValue: false }),
    phone: (0, import_fields11.text)(),
    claimsEmail: (0, import_fields11.text)(),
    portalUrl: (0, import_fields11.text)(),
    adapterKey: (0, import_fields11.text)({ defaultValue: "manual" }),
    active: (0, import_fields11.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var PetInsurancePolicy = (0, import_core10.list)({
  access: governed([...PATIENT_READ]),
  fields: {
    patient: relationship({ ref: "Patient.insurancePolicies", ...readOnly }),
    insurer: relationship({ ref: "ThirdPartyPayer", ...readOnly }),
    policyNumber: systemText({ required: true }),
    plan: systemText(),
    deductibleMinor: minor(),
    reimbursementRate: rate(),
    effectiveFrom: (0, import_fields11.calendarDay)({ ...readOnly }),
    effectiveTo: (0, import_fields11.calendarDay)({ ...readOnly }),
    directPayEligible: (0, import_fields11.checkbox)({ ...readOnly, defaultValue: false }),
    clientAuthorisation: relationship({ ref: "Document", ...readOnly }),
    ...trackingFields
  }
});
var ReferralHospital = (0, import_core10.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "kind", "phone", "open24h", "active"] } },
  fields: {
    name: (0, import_fields11.text)({ validation: { isRequired: true } }),
    kind: choice(["emergency", "specialty", "general"], "emergency"),
    phone: (0, import_fields11.text)({ validation: { isRequired: true } }),
    fax: (0, import_fields11.text)(),
    email: (0, import_fields11.text)(),
    addressLine1: (0, import_fields11.text)(),
    city: (0, import_fields11.text)(),
    stateCode: (0, import_fields11.text)(),
    lat: geo(),
    lng: geo(),
    open24h: (0, import_fields11.checkbox)({ defaultValue: false }),
    hours: (0, import_fields11.json)({ ui: { description: 'Per weekday open/close "HH:mm" when not 24h.' } }),
    verifiedChannel: (0, import_fields11.checkbox)({ defaultValue: false }),
    active: (0, import_fields11.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var ReferringVet = (0, import_core10.list)({
  access: managed("signedIn", "canManageClients"),
  ui: { labelField: "name" },
  fields: {
    name: (0, import_fields11.text)({ validation: { isRequired: true } }),
    clinicName: (0, import_fields11.text)(),
    phone: (0, import_fields11.text)(),
    fax: (0, import_fields11.text)(),
    email: (0, import_fields11.text)(),
    verifiedChannel: (0, import_fields11.checkbox)({ defaultValue: false }),
    ...trackingFields
  }
});
var RefillRequest = (0, import_core10.list)({
  access: governed(["canReadClinical", "canManageRefills", "canFulfilRefill", "canBook"]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "productText", "channel", "status", "slaDueAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    requestedBy: relationship({ ref: "ClientPerson", ...readOnly }),
    channel: fixedChoice(["portal", "csr", "ai_voice", "ai_sms", "online_pharmacy", "retail_pharmacy", "email"]),
    productText: systemText({ required: true }),
    pharmacyNote: systemText(),
    status: lifecycle(["received", "in_review", "fulfilled_under_existing_rx", "approved_new_rx", "denied", "needs_exam", "merged"]),
    slaDueAt: (0, import_fields11.timestamp)({ ...readOnly }),
    decidedBy: relationship({ ref: "StaffMember", ...readOnly }),
    decidedAt: (0, import_fields11.timestamp)({ ...readOnly }),
    denialReason: systemText(),
    callRecord: relationship({ ref: "CallRecord", ...readOnly }),
    createdByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var RecordsRequest = (0, import_core10.list)({
  access: governed(["canProcessRecordsRequests", "canReadClinical"]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "requesterKind", "basis", "status", "responseDueAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    requesterKind: fixedChoice(["client_person", "clinic", "insurer", "court", "public_health", "other"]),
    requesterName: systemText({ required: true }),
    requesterContact: systemText(),
    requestedBy: relationship({ ref: "ClientPerson", ...readOnly }),
    channel: fixedChoice(["portal", "csr", "ai_voice", "email", "fax", "mail"]),
    basis: fixedChoice(["client_of_record", "authorised_person", "referral_with_authorisation", "insurer_with_authorisation", "court_order", "subpoena", "public_health"]),
    scope: systemText(),
    authorisationDocument: relationship({ ref: "Document", ...readOnly }),
    status: lifecycle(["received", "verifying_authority", "approved", "released", "denied", "withdrawn"]),
    responseDueAt: (0, import_fields11.timestamp)({ ...readOnly }),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    callRecord: relationship({ ref: "CallRecord", ...readOnly }),
    createdByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    releases: relationship({ ref: "RecordsRelease.request", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var RecordsRelease = (0, import_core10.list)({
  access: immutable(["canProcessRecordsRequests", "canReadAudit"]),
  fields: {
    request: relationship({ ref: "RecordsRequest.releases", ...readOnly }),
    recipient: systemText({ required: true }),
    channel: fixedChoice(["email", "portal", "fax", "mail", "in_person"]),
    documents: (0, import_fields11.json)({ ...readOnly, ui: { ...readOnly.ui, description: "[{documentId, sha256, title}]" } }),
    releasedByUser: relationship({ ref: "User", ...readOnly }),
    releasedByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    at: (0, import_fields11.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});

// features/keystone/models/schedule.ts
var schedule_exports = {};
__export(schedule_exports, {
  Appointment: () => Appointment,
  AppointmentPatient: () => AppointmentPatient,
  AppointmentSegment: () => AppointmentSegment,
  AppointmentType: () => AppointmentType,
  ProviderReservation: () => ProviderReservation,
  Resource: () => Resource,
  ResourceReservation: () => ResourceReservation,
  SegmentTransition: () => SegmentTransition,
  StaffSchedule: () => StaffSchedule,
  TriageAssessment: () => TriageAssessment,
  TriageProtocol: () => TriageProtocol,
  TriageProtocolVersion: () => TriageProtocolVersion,
  WaitlistEntry: () => WaitlistEntry,
  WhiteboardEntry: () => WhiteboardEntry
});
var import_core11 = require("@keystone-6/core");
var import_fields12 = require("@keystone-6/core/fields");
var BOOK_READ = ["canBook", "canCheckIn", "canReadClinical", "canManageSchedules"];
var StaffSchedule = (0, import_core11.list)({
  access: managed("canAccessDashboard", "canManageSchedules"),
  ui: { listView: { initialColumns: ["staffMember", "location", "kind", "weekday", "localDate", "startTime", "endTime"] } },
  fields: {
    staffMember: relationship({ ref: "StaffMember" }),
    location: relationship({ ref: "Location" }),
    kind: choice(["recurring", "one_time", "time_off"], "recurring"),
    weekday: (0, import_fields12.integer)({ validation: { min: 0, max: 6 }, ui: { description: "0 = Sunday (recurring blocks)." } }),
    localDate: (0, import_fields12.calendarDay)({ ui: { description: "One-time blocks and time off." } }),
    startTime: (0, import_fields12.text)({ validation: { isRequired: true, match: { regex: /^([01]\d|2[0-3]):[0-5]\d$/ } } }),
    endTime: (0, import_fields12.text)({ validation: { isRequired: true, match: { regex: /^([01]\d|2[0-3]):[0-5]\d$/ } } }),
    appointmentCategories: (0, import_fields12.json)({ ui: { description: 'Allowed categories in this block, e.g. ["surgery","dental"] for the AM surgical block; empty = any.' } }),
    effectiveFrom: (0, import_fields12.calendarDay)(),
    effectiveTo: (0, import_fields12.calendarDay)(),
    ...trackingFields
  }
});
var AppointmentType = (0, import_core11.list)({
  access: managed("signedIn", "canManageSchedules"),
  ui: { labelField: "name", listView: { initialColumns: ["code", "name", "category", "durationMinutes", "aiBookable", "requestOnly"] } },
  fields: {
    code: (0, import_fields12.text)({ isIndexed: "unique", validation: { isRequired: true, match: { regex: /^[a-z0-9_]{2,40}$/ } } }),
    name: (0, import_fields12.text)({ validation: { isRequired: true } }),
    category: choice(["wellness", "sick", "recheck", "surgery", "dental", "euthanasia", "tech", "vaccine_only", "grooming", "boarding_checkin", "telehealth", "drop_off"]),
    durationMinutes: (0, import_fields12.integer)({ validation: { isRequired: true, min: 5, max: 720 } }),
    segments: (0, import_fields12.json)({ ui: { description: 'Segment template, e.g. [{"kind":"drop_off","offset":0,"minutes":30},{"kind":"procedure","offset":60,"minutes":120}].' } }),
    species: relationship({ ref: "Species", many: true, ui: { description: "Empty = every species." } }),
    requiredResourceKinds: (0, import_fields12.json)({ defaultValue: ["exam_room"] }),
    providerKinds: (0, import_fields12.json)({ defaultValue: ["dvm"], ui: { description: "Staff kinds that can take it: dvm, rvt, groomer." } }),
    aiBookable: (0, import_fields12.checkbox)({ defaultValue: false }),
    portalBookable: (0, import_fields12.checkbox)({ defaultValue: false }),
    requestOnly: (0, import_fields12.checkbox)({ defaultValue: false }),
    newClientAllowed: (0, import_fields12.checkbox)({ defaultValue: true }),
    depositRequired: choice(["none", "fixed", "estimate"], "none"),
    depositMinor: minor(),
    vcprQualifying: (0, import_fields12.checkbox)({ defaultValue: false }),
    colour: (0, import_fields12.text)(),
    active: (0, import_fields12.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var Resource = (0, import_core11.list)({
  access: managed("signedIn", "canManageSchedules"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "kind", "location", "active"] } },
  fields: {
    location: relationship({ ref: "Location" }),
    kind: choice(["exam_room", "surgery_suite", "dental_table", "anaesthesia_machine", "ultrasound", "radiography", "treatment_table", "grooming_table", "isolation"]),
    name: (0, import_fields12.text)({ validation: { isRequired: true } }),
    sortOrder: (0, import_fields12.integer)({ defaultValue: 0 }),
    active: (0, import_fields12.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var ResourceReservation = (0, import_core11.list)({
  access: governed([...BOOK_READ]),
  fields: {
    resource: relationship({ ref: "Resource", ...readOnly }),
    appointment: relationship({ ref: "Appointment.reservations", ...readOnly }),
    startsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    endsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["held", "confirmed", "released"]),
    ...trackingFields
  }
});
var ProviderReservation = (0, import_core11.list)({
  access: governed([...BOOK_READ]),
  fields: {
    staffMember: relationship({ ref: "StaffMember", ...readOnly }),
    appointment: relationship({ ref: "Appointment.providerReservations", ...readOnly }),
    startsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    endsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["held", "confirmed", "released"]),
    ...trackingFields
  }
});
var Appointment = (0, import_core11.list)({
  access: governed([...BOOK_READ]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "startsAt", "client", "appointmentType", "provider", "status", "channel"], initialSort: { field: "startsAt", direction: "ASC" } } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    appointmentType: relationship({ ref: "AppointmentType", ...readOnly }),
    provider: relationship({ ref: "StaffMember", ...readOnly }),
    startsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    endsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["requested", "booked", "confirmed", "checked_in", "in_progress", "ready_for_checkout", "completed", "cancelled", "no_show", "declined"]),
    channel: fixedChoice(["csr", "portal", "ai_voice", "ai_sms", "walk_in", "referral", "import"]),
    bookedByUser: relationship({ ref: "User", ...readOnly }),
    bookedByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    slotToken: systemText(),
    reason: systemText(),
    triage: relationship({ ref: "TriageAssessment", ...readOnly }),
    callRecord: relationship({ ref: "CallRecord", ...readOnly }),
    cancelReason: systemText(),
    cancelledAt: (0, import_fields12.timestamp)({ ...readOnly }),
    confirmedAt: (0, import_fields12.timestamp)({ ...readOnly }),
    checkedInAt: (0, import_fields12.timestamp)({ ...readOnly }),
    completedAt: (0, import_fields12.timestamp)({ ...readOnly }),
    patients: relationship({ ref: "AppointmentPatient.appointment", many: true, ...readOnly }),
    segments: relationship({ ref: "AppointmentSegment.appointment", many: true, ...readOnly }),
    reservations: relationship({ ref: "ResourceReservation.appointment", many: true, ...readOnly }),
    providerReservations: relationship({ ref: "ProviderReservation.appointment", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AppointmentPatient = (0, import_core11.list)({
  access: governed([...BOOK_READ]),
  fields: {
    appointment: relationship({ ref: "Appointment.patients", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    reason: systemText(),
    status: lifecycle(["scheduled", "checked_in", "in_progress", "done", "cancelled", "no_show"]),
    weightSkippedReason: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var AppointmentSegment = (0, import_core11.list)({
  access: governed([...BOOK_READ]),
  fields: {
    appointment: relationship({ ref: "Appointment.segments", ...readOnly }),
    kind: fixedChoice(["drop_off", "exam", "procedure", "anaesthesia", "recovery", "pickup", "groom", "bath"]),
    startsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    endsAt: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    resource: relationship({ ref: "Resource", ...readOnly }),
    staff: relationship({ ref: "StaffMember", ...readOnly }),
    status: lifecycle(["planned", "active", "done", "skipped"]),
    transitions: relationship({ ref: "SegmentTransition.segment", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var SegmentTransition = (0, import_core11.list)({
  access: immutable([...BOOK_READ]),
  fields: {
    segment: relationship({ ref: "AppointmentSegment.transitions", ...readOnly }),
    fromStatus: systemText({ required: true }),
    toStatus: systemText({ required: true }),
    by: relationship({ ref: "User", ...readOnly }),
    at: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});
var WaitlistEntry = (0, import_core11.list)({
  access: governed([...BOOK_READ]),
  ui: { listView: { initialColumns: ["client", "appointmentType", "urgency", "status", "createdAt"] } },
  fields: {
    client: relationship({ ref: "Client", ...readOnly }),
    patients: relationship({ ref: "Patient", many: true, ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    appointmentType: relationship({ ref: "AppointmentType", ...readOnly }),
    preferredWindows: (0, import_fields12.json)({ ...readOnly }),
    urgency: fixedChoice(["routine", "soon", "urgent"]),
    status: lifecycle(["waiting", "offered", "accepted", "expired", "declined", "cancelled"]),
    offeredSlotToken: systemText({ secret: true }),
    offerExpiresAt: (0, import_fields12.timestamp)({ ...readOnly }),
    bookedAppointment: relationship({ ref: "Appointment", ...readOnly }),
    note: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var TriageProtocol = (0, import_core11.list)({
  access: governed("signedIn"),
  ui: { labelField: "name" },
  fields: {
    code: systemText({ indexed: "unique", required: true }),
    name: systemText({ required: true }),
    versions: relationship({ ref: "TriageProtocolVersion.protocol", many: true, ...readOnly }),
    ...trackingFields
  }
});
var TriageProtocolVersion = (0, import_core11.list)({
  access: governed("signedIn"),
  ui: { labelField: "label", listView: { initialColumns: ["protocol", "versionNumber", "status", "publishedAt"] } },
  fields: {
    protocol: relationship({ ref: "TriageProtocol.versions", ...readOnly }),
    versionNumber: (0, import_fields12.integer)({ ...readOnly, validation: { isRequired: true } }),
    label: systemText(),
    questions: (0, import_fields12.json)({ ...readOnly }),
    redFlags: (0, import_fields12.json)({ ...readOnly }),
    levelRules: (0, import_fields12.json)({ ...readOnly }),
    scripts: (0, import_fields12.json)({ ...readOnly }),
    contentHash: systemText({ required: true }),
    status: lifecycle(["draft", "published", "superseded"]),
    publishedAt: (0, import_fields12.timestamp)({ ...readOnly }),
    approval: relationship({ ref: "ApprovalRequest", ...readOnly }),
    ...trackingFields
  }
});
var TriageAssessment = (0, import_core11.list)({
  access: immutable(["canReadClinical", "canBook", "canCheckIn"]),
  ui: { listView: { initialColumns: ["at", "patient", "level", "outcome", "actorKind"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    callRecord: relationship({ ref: "CallRecord", ...readOnly }),
    protocolVersion: relationship({ ref: "TriageProtocolVersion", ...readOnly }),
    complaint: systemText(),
    answers: (0, import_fields12.json)({ ...readOnly }),
    redFlagsHit: (0, import_fields12.json)({ ...readOnly }),
    level: fixedChoice(["emergency_now", "urgent_today", "soon", "routine"]),
    outcome: fixedChoice(["transferred", "er_referred", "booked", "advised_home_monitor", "callback_task"]),
    referredTo: relationship({ ref: "ReferralHospital", ...readOnly }),
    actorKind: fixedChoice(["user", "agent"]),
    actorUser: relationship({ ref: "User", ...readOnly }),
    actorAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    at: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});
var WhiteboardEntry = (0, import_core11.list)({
  access: governed(["canReadClinical", "canCheckIn", "canBook"]),
  ui: { listView: { initialColumns: ["location", "patient", "status", "room", "assignedDvm", "since"] } },
  fields: {
    location: relationship({ ref: "Location", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    appointment: relationship({ ref: "Appointment", ...readOnly }),
    status: lifecycle(["waiting", "in_exam", "treatment", "diagnostics", "hospitalised", "surgery", "recovery", "boarding", "ready_for_discharge", "discharged"]),
    room: relationship({ ref: "Resource", ...readOnly }),
    assignedDvm: relationship({ ref: "StaffMember", ...readOnly }),
    assignedTech: relationship({ ref: "StaffMember", ...readOnly }),
    flags: (0, import_fields12.json)({ ...readOnly, defaultValue: [] }),
    since: (0, import_fields12.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    version: versionField(),
    ...trackingFields
  }
});

// features/keystone/models/comms.ts
var comms_exports = {};
__export(comms_exports, {
  CallRecord: () => CallRecord,
  CommsMessage: () => CommsMessage,
  CommsThread: () => CommsThread,
  KnowledgeBaseEntry: () => KnowledgeBaseEntry,
  MessageTemplate: () => MessageTemplate,
  PortalSession: () => PortalSession,
  PublicAppointmentType: () => PublicAppointmentType,
  PublicSiteProfile: () => PublicSiteProfile,
  RateLimitBucket: () => RateLimitBucket,
  Suppression: () => Suppression
});
var import_core12 = require("@keystone-6/core");
var import_fields13 = require("@keystone-6/core/fields");
var COMMS_READ = ["canMessageClients", "canManageClients", "canBook"];
var CommsThread = (0, import_core12.list)({
  access: governed([...COMMS_READ]),
  ui: { labelField: "subject", listView: { initialColumns: ["client", "channel", "status", "lastMessageAt"] } },
  fields: {
    client: relationship({ ref: "Client", ...readOnly }),
    contactPoint: relationship({ ref: "ContactPoint", ...readOnly }),
    channel: fixedChoice(["sms", "email", "voice", "portal"]),
    subject: systemText(),
    status: lifecycle(["open", "waiting_client", "waiting_staff", "closed"]),
    assignedTo: relationship({ ref: "StaffMember", ...readOnly }),
    lastMessageAt: (0, import_fields13.timestamp)({ ...readOnly }),
    messages: relationship({ ref: "CommsMessage.thread", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var CommsMessage = (0, import_core12.list)({
  access: governed([...COMMS_READ]),
  ui: { listView: { initialColumns: ["thread", "direction", "purpose", "status", "createdAt"] } },
  fields: {
    thread: relationship({ ref: "CommsThread.messages", ...readOnly }),
    direction: fixedChoice(["inbound", "outbound"]),
    purpose: fixedChoice(["care", "transactional", "marketing"]),
    templateCode: systemText(),
    to: systemText(),
    from: systemText(),
    body: (0, import_fields13.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    status: lifecycle(["queued", "sending", "sent", "delivered", "failed", "blocked", "received"]),
    blockedReason: systemText(),
    providerId: systemText({ indexed: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    appointment: relationship({ ref: "Appointment", ...readOnly }),
    sentAt: (0, import_fields13.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var MessageTemplate = (0, import_core12.list)({
  access: managed("canAccessDashboard", "canManageTemplates"),
  ui: { labelField: "code", listView: { initialColumns: ["code", "purpose", "channel", "locale", "templateVersion"] } },
  fields: {
    code: (0, import_fields13.text)({ validation: { isRequired: true } }),
    purpose: choice(["care", "transactional", "marketing"]),
    channel: choice(["sms", "email", "voice"]),
    locale: (0, import_fields13.text)({ defaultValue: "en-US" }),
    body: (0, import_fields13.text)({ validation: { isRequired: true }, ui: { displayMode: "textarea", description: "Placeholders: {{practice}}, {{pet}}, {{when}}, {{location}}, {{ref}}." } }),
    templateVersion: (0, import_fields13.integer)({ defaultValue: 1 }),
    active: (0, import_fields13.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var CallRecord = (0, import_core12.list)({
  access: governed([...COMMS_READ]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "startedAt", "from", "answeredBy", "disposition", "status"], initialSort: { field: "startedAt", direction: "DESC" } } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    direction: fixedChoice(["inbound", "outbound"]),
    from: systemText({ required: true }),
    to: systemText({ required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    person: relationship({ ref: "ClientPerson", ...readOnly }),
    answeredBy: fixedChoice(["ai", "staff", "voicemail", "missed"]),
    agent: relationship({ ref: "AgentIdentity", ...readOnly }),
    agentRun: relationship({ ref: "AgentRun", ...readOnly }),
    providerCallId: systemText({ indexed: true }),
    adapterKey: systemText(),
    disclosurePlayedAt: (0, import_fields13.timestamp)({ ...readOnly }),
    recordingConsent: fixedChoice(["not_asked", "accepted", "declined"]),
    callerVerifiedAt: (0, import_fields13.timestamp)({ ...readOnly }),
    verificationMethod: fixedChoice(["none", "pet_name_dob", "otp"]),
    transcript: (0, import_fields13.json)({ ...readOnly, defaultValue: [], ui: { ...readOnly.ui, description: "[{speaker, text, at}] as received; untrusted." } }),
    summary: systemText(),
    disposition: fixedChoice(["open", "booked", "rescheduled", "cancelled", "refill_request", "records_request", "info", "transferred", "urgent_transfer", "er_referred", "voicemail", "abandoned", "callback_task"]),
    transferTo: systemText(),
    startedAt: (0, import_fields13.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    endedAt: (0, import_fields13.timestamp)({ ...readOnly }),
    durationSeconds: (0, import_fields13.integer)({ ...readOnly }),
    recordingRef: systemText(),
    status: lifecycle(["ringing", "in_progress", "completed", "failed"]),
    version: versionField(),
    ...trackingFields
  }
});
var Suppression = (0, import_core12.list)({
  access: governed([...COMMS_READ]),
  fields: {
    contactPoint: relationship({ ref: "ContactPoint", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    reason: fixedChoice(["stop_keyword", "deceased", "client_request", "legal", "invalid_number", "bounce"]),
    until: (0, import_fields13.timestamp)({ ...readOnly }),
    active: (0, import_fields13.checkbox)({ ...readOnly, defaultValue: true }),
    ...trackingFields
  }
});
var KnowledgeBaseEntry = (0, import_core12.list)({
  access: managed("signedIn", "canManageTemplates"),
  ui: { labelField: "topic", listView: { initialColumns: ["topic", "visibility", "entryVersion", "active"] } },
  fields: {
    topic: (0, import_fields13.text)({ validation: { isRequired: true }, isIndexed: true }),
    keywords: (0, import_fields13.json)({ defaultValue: [], ui: { description: "Lower-case words that match a question to this entry." } }),
    content: (0, import_fields13.text)({ validation: { isRequired: true }, ui: { displayMode: "textarea" } }),
    visibility: choice(["public", "verified_client", "staff"], "public"),
    location: relationship({ ref: "Location" }),
    entryVersion: (0, import_fields13.integer)({ defaultValue: 1 }),
    active: (0, import_fields13.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var PublicSiteProfile = (0, import_core12.list)({
  access: managed("signedIn", "canManagePractice"),
  isSingleton: true,
  fields: {
    headline: (0, import_fields13.text)({ defaultValue: "Cedar Creek Animal Hospital" }),
    onlineBookingEnabled: (0, import_fields13.checkbox)({ defaultValue: true }),
    newClientBookingMode: choice(["book", "request", "off"], "request"),
    bookingWindowDays: (0, import_fields13.integer)({ defaultValue: 60, validation: { min: 1, max: 365 } }),
    minimumNoticeMinutes: (0, import_fields13.integer)({ defaultValue: 120 }),
    ...trackingFields
  }
});
var PublicAppointmentType = (0, import_core12.list)({
  access: managed("signedIn", "canManageSchedules"),
  ui: { labelField: "publicName" },
  fields: {
    appointmentType: relationship({ ref: "AppointmentType" }),
    publicName: (0, import_fields13.text)({ validation: { isRequired: true } }),
    description: (0, import_fields13.text)({ ui: { displayMode: "textarea" } }),
    mode: choice(["book", "request"], "book"),
    newClients: (0, import_fields13.checkbox)({ defaultValue: false }),
    sortOrder: (0, import_fields13.integer)({ defaultValue: 0 }),
    active: (0, import_fields13.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var PortalSession = (0, import_core12.list)({
  access: serverOnly,
  graphql: { omit: true },
  fields: {
    person: relationship({ ref: "ClientPerson" }),
    contactPoint: relationship({ ref: "ContactPoint" }),
    tokenHash: (0, import_fields13.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    otpHash: (0, import_fields13.text)(),
    otpAttempts: (0, import_fields13.integer)({ defaultValue: 0 }),
    status: choice(["pending", "verified", "expired", "revoked"], "pending"),
    expiresAt: (0, import_fields13.timestamp)({ validation: { isRequired: true } }),
    verifiedAt: (0, import_fields13.timestamp)(),
    ipHash: (0, import_fields13.text)(),
    ...trackingFields
  }
});
var RateLimitBucket = (0, import_core12.list)({
  access: serverOnly,
  graphql: { omit: true },
  fields: {
    key: (0, import_fields13.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    // Indexed for the sign-in limiter's sweep of expired rows (review r8 #3).
    windowStart: (0, import_fields13.timestamp)({ validation: { isRequired: true }, isIndexed: true }),
    count: (0, import_fields13.integer)({ defaultValue: 0 })
  }
});

// features/keystone/models/pharmacy.ts
var import_core13 = require("@keystone-6/core");
var import_fields14 = require("@keystone-6/core/fields");

// features/keystone/lib/canonical.ts
var import_node_crypto2 = require("node:crypto");

// features/keystone/lib/decimal.ts
var import_decimal = __toESM(require("decimal.js"));
var Decimal = import_decimal.default.clone({
  precision: 60,
  rounding: import_decimal.default.ROUND_HALF_EVEN,
  toExpNeg: -40,
  toExpPos: 60
});
var Scale = { qty: 6, rate: 6, wt: 4, geo: 6 };
var DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
function dec(value) {
  if (value instanceof Decimal) return value;
  if (typeof value === "bigint") return new Decimal(value.toString());
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`Refusing float ${value}: pass the exact decimal as a string`);
    return new Decimal(value);
  }
  const text17 = String(value).trim();
  if (!DECIMAL_TEXT.test(text17)) throw new Error(`Not a decimal number: ${JSON.stringify(text17).slice(0, 40)}`);
  return new Decimal(text17);
}
function toScale(value, scale, rounding = Decimal.ROUND_HALF_EVEN) {
  const places = typeof scale === "number" ? scale : Scale[scale];
  return dec(value).toDecimalPlaces(places, rounding).toFixed(places);
}
var plain = (value) => dec(value).toFixed();
var ZERO = new Decimal(0);
var ONE = new Decimal(1);
var BPS = new Decimal(1e4);
function toBpsInt(fraction) {
  const text17 = dec(fraction).times(BPS).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).toFixed(0);
  const n = Number.parseInt(text17, 10);
  if (!Number.isSafeInteger(n)) throw new RangeError(`Basis points out of range: ${text17}`);
  return n;
}
var KG_PER_LB = new Decimal("0.45359237");
function toKg(value, unit2) {
  const v = dec(value);
  if (v.isNegative()) throw new RangeError("A weight cannot be negative");
  const kg = unit2 === "kg" ? v : unit2 === "lb" ? v.times(KG_PER_LB) : v.div(1e3);
  return kg.toDecimalPlaces(Scale.wt, Decimal.ROUND_HALF_EVEN);
}

// features/keystone/lib/canonical.ts
function canonicalize(value) {
  if (value === null || value === void 0) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Canonical JSON cannot hold a non-finite number");
    return value;
  }
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const decimalLike = value;
    if (typeof decimalLike.isFinite === "function" && typeof decimalLike.isNaN === "function") return plain(decimalLike.toString());
    return Object.fromEntries(
      Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key2, entry]) => [key2, canonicalize(entry)])
    );
  }
  throw new Error(`Canonical JSON cannot hold a ${typeof value}`);
}
var canonicalJson = (value) => JSON.stringify(canonicalize(value));
var sha256 = (text17) => (0, import_node_crypto2.createHash)("sha256").update(text17).digest("hex");
var payloadHash = (value) => sha256(canonicalJson(value));
var toJsonValue = (value) => canonicalize(value);
var DEVELOPMENT_SECRET2 = "this secret should only be used in testing";
function keyedPayloadHash(value, purpose) {
  const secret2 = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : DEVELOPMENT_SECRET2);
  if (secret2.length < 16) throw new Error("SESSION_SECRET must be set to hash protected content");
  const key2 = (0, import_node_crypto2.createHmac)("sha256", secret2).update(`vc-keyed-hash\0${purpose}`, "utf8").digest();
  return (0, import_node_crypto2.createHmac)("sha256", key2).update(canonicalJson(value), "utf8").digest("hex");
}

// features/keystone/lib/db.ts
async function advisoryLock(tx, key2) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key2}, 0))`;
}
var MODEL_NAME = /^[A-Z][A-Za-z0-9]*$/;
function tableName(model) {
  if (!MODEL_NAME.test(model)) throw new Error(`Invalid model name: ${model.slice(0, 40)}`);
  return `"${model}"`;
}
function delegateOf(tx, model) {
  tableName(model);
  const delegate = tx[model[0].toLowerCase() + model.slice(1)];
  if (!delegate) throw new Error(`Unknown model: ${model}`);
  return delegate;
}
var TRANSACTION_OPTIONS = { maxWait: 15e3, timeout: 18e5 };

// features/keystone/lib/sequence.ts
var import_node_crypto3 = require("node:crypto");
async function nextReference(tx, prefix, now = /* @__PURE__ */ new Date(), width = 6) {
  if (!/^[A-Z]{2,5}$/.test(prefix)) throw new Error("Reference prefix must be 2-5 capital letters");
  const key2 = `${prefix}-${now.getUTCFullYear()}`;
  await advisoryLock(tx, `sequence:${key2}`);
  const row = await tx.sequence.upsert({ where: { key: key2 }, create: { key: key2, nextValue: 2 }, update: { nextValue: { increment: 1 } } });
  const value = row.nextValue - 1;
  return `${key2}-${String(value).padStart(width, "0")}`;
}
var CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
function publicCode(prefix, groups = 2) {
  const bytes = (0, import_node_crypto3.randomBytes)(groups * 4);
  const chars = Array.from(bytes, (byte) => CROCKFORD[byte % 32]);
  const parts = Array.from({ length: groups }, (_, i) => chars.slice(i * 4, i * 4 + 4).join(""));
  return `${prefix}-${parts.join("-")}`;
}
async function nextSerial(tx, prefix, width = 6) {
  if (!/^[A-Z]{1,5}$/.test(prefix)) throw new Error("Serial prefix must be 1-5 capital letters");
  const key2 = `${prefix}-serial`;
  await advisoryLock(tx, `sequence:${key2}`);
  const row = await tx.sequence.upsert({ where: { key: key2 }, create: { key: key2, nextValue: 2 }, update: { nextValue: { increment: 1 } } });
  return `${prefix}-${String(row.nextValue - 1).padStart(width, "0")}`;
}
async function reserveReferences(tx, prefix, n, now = /* @__PURE__ */ new Date(), width = 6) {
  if (!/^[A-Z]{2,5}$/.test(prefix)) throw new Error("Reference prefix must be 2-5 capital letters");
  if (n <= 0) return [];
  const key2 = `${prefix}-${now.getUTCFullYear()}`;
  await advisoryLock(tx, `sequence:${key2}`);
  const row = await tx.sequence.upsert({ where: { key: key2 }, create: { key: key2, nextValue: n + 1 }, update: { nextValue: { increment: n } } });
  const first = row.nextValue - n;
  return Array.from({ length: n }, (_, i) => `${key2}-${String(first + i).padStart(width, "0")}`);
}
async function reserveSerials(tx, prefix, n, width = 6) {
  if (!/^[A-Z]{1,5}$/.test(prefix)) throw new Error("Serial prefix must be 1-5 capital letters");
  if (n <= 0) return [];
  const key2 = `${prefix}-serial`;
  await advisoryLock(tx, `sequence:${key2}`);
  const row = await tx.sequence.upsert({ where: { key: key2 }, create: { key: key2, nextValue: n + 1 }, update: { nextValue: { increment: n } } });
  const first = row.nextValue - n;
  return Array.from({ length: n }, (_, i) => `${prefix}-${String(first + i).padStart(width, "0")}`);
}

// features/keystone/lib/csRegister.ts
async function appendCsEntry(tx, input, now) {
  const container = await tx.csContainer.findUnique({ where: { id: input.containerId }, select: { id: true, deaRegistrationId: true, product: { select: { csSchedule: true } } } });
  if (!container?.product) throw new Error("Unknown controlled-substance container");
  const schedule = container.product.csSchedule;
  await advisoryLock(tx, `cs-chain:${container.id}`);
  const last = await tx.csLogEntry.findFirst({ where: { containerId: container.id }, orderBy: { recordedAt: "desc" }, select: { hash: true } });
  const prevHash = last?.hash || "0".repeat(64);
  const ref = await nextReference(tx, "CS", now);
  const ciiRef = schedule === "CII" || schedule === "CIIN" ? await nextReference(tx, "CII", now) : null;
  const qty2 = toScale(dec(input.qtySigned), "qty");
  const witnessId = input.witnessId ?? null;
  if ((input.type === "waste" || input.type === "administer" && ciiRef) && !witnessId) throw new Error(`A ${input.type === "waste" ? "waste" : "Schedule II"} register entry needs a witness`);
  if (witnessId && witnessId === input.actorId) throw new Error("The witness must be someone other than the person recording the entry");
  const body = { ref, ciiRef, containerId: container.id, schedule, type: input.type, qtySigned: qty2, unit: input.unit, occurredAt: input.occurredAt.toISOString(), actorId: input.actorId, patientId: input.patientId ?? null, ...witnessId ? { witnessId } : {}, ...input.reversesId ? { reversesId: input.reversesId } : {} };
  const hash2 = sha256(`${prevHash}
${canonicalJson(body)}`);
  return tx.csLogEntry.create({
    data: {
      ...input.id ? { id: input.id } : {},
      ref,
      ciiRef,
      containerId: container.id,
      deaRegistrationId: container.deaRegistrationId,
      schedule,
      type: input.type,
      qtySigned: qty2,
      unit: input.unit,
      occurredAt: input.occurredAt,
      recordedAt: now,
      actorId: input.actorId,
      witnessId,
      reversesId: input.reversesId ?? null,
      patientId: input.patientId ?? null,
      clientId: input.clientId ?? null,
      reason: input.reason ?? "",
      prevHash,
      hash: hash2
    }
  });
}
async function containerBalance(tx, containerId) {
  const sum = await tx.csLogEntry.aggregate({ where: { containerId }, _sum: { qtySigned: true } });
  return dec(sum._sum.qtySigned ?? 0);
}

// features/keystone/models/pharmacy.ts
var CS_SCHEDULES = ["none", "CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"];
var DrugProduct = (0, import_core13.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "displayName", listView: { initialColumns: ["displayName", "form", "strength", "strengthUnit", "csSchedule", "active"] } },
  fields: {
    displayName: systemText({ required: true }),
    genericName: systemText({ required: true }),
    brandName: systemText(),
    form: fixedChoice(["tablet", "capsule", "chewable", "liquid_oral", "injectable", "topical", "otic", "ophthalmic", "transdermal", "powder", "implant", "other"]),
    strength: qty(),
    strengthUnit: unit(),
    per: choice(["tablet", "capsule", "mL", "g", "dose", "application"], null),
    concentration: qty(),
    concentrationUnit: systemText(),
    packageQty: qty(),
    packageUnit: unit(),
    csSchedule: fixedChoice(CS_SCHEDULES),
    stateCsSchedule: (0, import_fields14.json)({ ...readOnly, ui: { ...readOnly.ui, description: 'Per-state scheduling from the policy packs, e.g. {"US-CA":"CV"}.' } }),
    isHumanLabel: (0, import_fields14.checkbox)({ ...readOnly, defaultValue: false }),
    approvalStatus: fixedChoice(["fda_approved", "conditional", "indexed", "compounded", "human_label"]),
    multiDoseBudDays: (0, import_fields14.integer)({ ...readOnly }),
    ndc: systemText({ indexed: true }),
    requiresWitnessOnAdminister: (0, import_fields14.checkbox)({ ...readOnly, defaultValue: false }),
    doseRanges: (0, import_fields14.json)({ ...readOnly, ui: { ...readOnly.ui, description: 'Per species: {"canine":{"min":"0.2","max":"0.4","unit":"mg","per":"kg"}} from the practice formulary (I-O2 dose check).' } }),
    cautionFlags: (0, import_fields14.json)({ ...readOnly, defaultValue: [], ui: { ...readOnly.ui, description: 'Breed genetic flags that make this drug a caution, e.g. ["MDR1_risk"].' } }),
    measurableIncrement: qty(),
    active: (0, import_fields14.checkbox)({ ...readOnly, defaultValue: true }),
    ...trackingFields
  }
});
var Prescription = (0, import_core13.list)({
  access: governed(["canReadClinical", "canPrescribe", "canManageRefills"]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "prescriber", "status", "issuedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    prescriber: relationship({ ref: "StaffMember", ...readOnly }),
    deaRegistration: relationship({ ref: "DeaRegistration", ...readOnly }),
    vcpr: relationship({ ref: "VcprRecord", ...readOnly }),
    issuedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["draft", "active", "exhausted", "expired", "cancelled"]),
    signedAt: (0, import_fields14.timestamp)({ ...readOnly }),
    licenseEvaluation: relationship({ ref: "LicenseEvaluation", ...readOnly }),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    lines: relationship({ ref: "PrescriptionLine.prescription", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var PrescriptionLine = (0, import_core13.list)({
  access: governed(["canReadClinical", "canPrescribe", "canManageRefills"]),
  fields: {
    prescription: relationship({ ref: "Prescription.lines", ...readOnly }),
    product: relationship({ ref: "DrugProduct", ...readOnly }),
    /** The product's federal schedule when the line was written (checked against the product by the DB). */
    csSchedule: fixedChoice(CS_SCHEDULES),
    directions: systemText({ required: true }),
    route: systemText(),
    frequency: systemText(),
    quantity: qty({ required: true }),
    quantityUnit: unit(),
    refillsAuthorised: (0, import_fields14.integer)({ ...readOnly, defaultValue: 0, validation: { isRequired: true, min: 0 } }),
    expiresAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    extralabel: (0, import_fields14.checkbox)({ ...readOnly, defaultValue: false }),
    substitutionAllowed: (0, import_fields14.checkbox)({ ...readOnly, defaultValue: true }),
    ...trackingFields
  }
});
var CsContainer = (0, import_core13.list)({
  access: { operation: { query: permissions.canViewControlled, create: () => false, update: () => false, delete: () => false } },
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "product", "location", "status", "labelQty", "labelUnit"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    product: relationship({ ref: "DrugProduct", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    deaRegistration: relationship({ ref: "DeaRegistration", ...readOnly }),
    lotNumber: systemText({ required: true }),
    lotExpiresOn: (0, import_fields14.calendarDay)({ ...readOnly }),
    status: lifecycle(["sealed", "open", "emptied", "quarantined", "disposed", "retired"]),
    labelQty: qty({ required: true }),
    labelUnit: unit(),
    openedAt: (0, import_fields14.timestamp)({ ...readOnly }),
    openedBy: relationship({ ref: "StaffMember", ...readOnly }),
    budAt: (0, import_fields14.timestamp)({ ...readOnly }),
    /** Derived on read: Σ register entries (never stored, so it cannot drift). */
    balance: (0, import_fields14.virtual)({ field: import_core13.graphql.field({ type: import_core13.graphql.String, async resolve(item, _args, context) {
      return (await containerBalance(context.prisma, item.id)).toFixed();
    } }) }),
    entries: relationship({ ref: "CsLogEntry.container", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var CsLogEntry = (0, import_core13.list)({
  access: { operation: { query: permissions.canViewControlled, create: () => false, update: () => false, delete: () => false } },
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "container", "type", "qtySigned", "unit", "occurredAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    ciiRef: systemText({ indexed: "unique", nullable: true }),
    container: relationship({ ref: "CsContainer.entries", ...readOnly }),
    deaRegistration: relationship({ ref: "DeaRegistration", ...readOnly }),
    schedule: fixedChoice(CS_SCHEDULES),
    type: fixedChoice(["receive", "open_transfer", "administer", "dispense", "waste", "transfer_out", "transfer_in", "return", "destroy", "adjust", "count_variance", "theft_loss"]),
    qtySigned: qty({ required: true }),
    unit: unit(),
    occurredAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    recordedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    actor: relationship({ ref: "StaffMember", ...readOnly }),
    witness: relationship({ ref: "StaffMember", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    clientSnapshot: (0, import_fields14.json)({ ...readOnly }),
    reverses: relationship({ ref: "CsLogEntry", ...readOnly }),
    reason: systemText(),
    prevHash: systemText(),
    hash: systemText()
  }
});
var Dispense = (0, import_core13.list)({
  access: governed(["canReadClinical", "canDispense", "canFulfilRefill"]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "product", "quantity", "quantityUnit", "refillNumber", "dispensedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    prescription: relationship({ ref: "Prescription", ...readOnly }),
    line: relationship({ ref: "PrescriptionLine", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    product: relationship({ ref: "DrugProduct", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    container: relationship({ ref: "CsContainer", ...readOnly }),
    csLogEntry: relationship({ ref: "CsLogEntry", ...readOnly }),
    refillRequest: relationship({ ref: "RefillRequest", ...readOnly }),
    quantity: qty({ required: true }),
    quantityUnit: unit(),
    /** 0 for the original fill, then 1, 2, … for each refill. */
    refillNumber: (0, import_fields14.integer)({ ...readOnly, defaultValue: 0, validation: { isRequired: true, min: 0 } }),
    dispensedBy: relationship({ ref: "StaffMember", ...readOnly }),
    dispensedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    label: (0, import_fields14.json)({ ...readOnly, ui: { ...readOnly.ui, description: "The label as printed: every field the practice must show (policy pack)." } }),
    ...trackingFields
  }
});
var CsCount = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "location", "kind", "countedBy", "countedAt", "status"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    kind: fixedChoice(["initial", "biennial", "periodic", "spot"]),
    countedBy: relationship({ ref: "StaffMember", ...readOnly }),
    witness: relationship({ ref: "StaffMember", ...readOnly }),
    countedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["closed"]),
    lines: relationship({ ref: "CsCountLine.count", many: true, ...readOnly }),
    ...trackingFields
  }
});
var CsCountLine = (0, import_core13.list)({
  access: governed("canViewControlled"),
  fields: {
    count: relationship({ ref: "CsCount.lines", ...readOnly }),
    container: relationship({ ref: "CsContainer", ...readOnly }),
    expectedQty: qty({ required: true }),
    countedQty: qty({ required: true }),
    variance: qty({ required: true }),
    unit: unit(),
    discrepancyCase: relationship({ ref: "CsDiscrepancyCase", ...readOnly })
  }
});
var CsDiscrepancyCase = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "location", "kind", "status", "noticeDueOn", "form106DueOn"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    container: relationship({ ref: "CsContainer", ...readOnly }),
    kind: fixedChoice(["count_variance", "theft", "loss"]),
    qty: qty({ required: true }),
    unit: unit(),
    discoveredAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    discoveredBy: relationship({ ref: "StaffMember", ...readOnly }),
    description: systemText(),
    status: lifecycle(["open", "notified", "form_filed", "closed"]),
    noticeDueOn: (0, import_fields14.calendarDay)({ ...readOnly }),
    noticeGivenAt: (0, import_fields14.timestamp)({ ...readOnly }),
    noticeReference: systemText(),
    form106DueOn: (0, import_fields14.calendarDay)({ ...readOnly }),
    form106FiledAt: (0, import_fields14.timestamp)({ ...readOnly }),
    form106Reference: systemText(),
    resolution: systemText(),
    closedAt: (0, import_fields14.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var CsDestructionRecord = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "container", "qty", "unit", "destroyedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    container: relationship({ ref: "CsContainer", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    csLogEntry: relationship({ ref: "CsLogEntry", ...readOnly }),
    qty: qty({ required: true }),
    unit: unit(),
    method: systemText({ required: true }),
    form41Reference: systemText(),
    recordedBy: relationship({ ref: "StaffMember", ...readOnly }),
    witnessA: relationship({ ref: "StaffMember", ...readOnly }),
    witnessB: relationship({ ref: "StaffMember", ...readOnly }),
    destroyedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var PdmpReport = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "location", "program", "status", "dueOn", "submittedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    dispense: relationship({ ref: "Dispense", ...readOnly }),
    program: systemText({ required: true }),
    format: systemText(),
    dueOn: (0, import_fields14.calendarDay)({ ...readOnly }),
    status: lifecycle(["pending", "submitted"]),
    submittedAt: (0, import_fields14.timestamp)({ ...readOnly }),
    submittedBy: relationship({ ref: "StaffMember", ...readOnly }),
    confirmation: systemText(),
    submission: relationship({ ref: "PdmpSubmission.reports", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var CsWitness = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { listView: { initialColumns: ["entry", "witness", "attestedAt"] } },
  fields: {
    entry: relationship({ ref: "CsLogEntry", ...readOnly }),
    witness: relationship({ ref: "StaffMember", ...readOnly }),
    attestedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var CsOrderForm = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "formNumber", "supplier", "status", "issuedOn", "expiresOn"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    formNumber: systemText({ required: true }),
    kind: fixedChoice(["form_222", "csos"]),
    location: relationship({ ref: "Location", ...readOnly }),
    supplier: relationship({ ref: "Supplier", ...readOnly }),
    issuedOn: (0, import_fields14.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    expiresOn: (0, import_fields14.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["open", "partially_filled", "filled", "expired", "cancelled"]),
    signedBy: relationship({ ref: "StaffMember", ...readOnly }),
    lines: relationship({ ref: "CsOrderFormLine.orderForm", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var CsOrderFormLine = (0, import_core13.list)({
  access: governed("canViewControlled"),
  fields: {
    orderForm: relationship({ ref: "CsOrderForm.lines", ...readOnly }),
    product: relationship({ ref: "DrugProduct", ...readOnly }),
    packages: (0, import_fields14.integer)({ ...readOnly, validation: { isRequired: true, min: 1 } }),
    packagesReceived: (0, import_fields14.integer)({ ...readOnly, defaultValue: 0, validation: { isRequired: true, min: 0 } }),
    ...trackingFields
  }
});
var CsTransfer = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "fromContainer", "toRegistration", "qty", "status"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    fromContainer: relationship({ ref: "CsContainer", ...readOnly }),
    toContainer: relationship({ ref: "CsContainer", ...readOnly }),
    toRegistration: relationship({ ref: "DeaRegistration", ...readOnly }),
    qty: qty({ required: true }),
    unit: unit(),
    status: lifecycle(["sent", "received"]),
    outEntry: relationship({ ref: "CsLogEntry", ...readOnly }),
    inEntry: relationship({ ref: "CsLogEntry", ...readOnly }),
    sentBy: relationship({ ref: "StaffMember", ...readOnly }),
    witness: relationship({ ref: "StaffMember", ...readOnly }),
    sentAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    receivedAt: (0, import_fields14.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var PdmpSubmission = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { labelField: "ref" },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    format: systemText(),
    reportCount: (0, import_fields14.integer)({ ...readOnly, defaultValue: 0 }),
    fileSha256: systemText(),
    fileBody: (0, import_fields14.json)({ ...readOnly }),
    reports: relationship({ ref: "PdmpReport.submission", many: true, ...readOnly }),
    generatedBy: relationship({ ref: "StaffMember", ...readOnly }),
    generatedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var CabinetAccessEvent = (0, import_core13.list)({
  access: governed("canViewControlled"),
  ui: { listView: { initialColumns: ["occurredAt", "location", "staff", "kind"] } },
  fields: {
    location: relationship({ ref: "Location", ...readOnly }),
    staff: relationship({ ref: "StaffMember", ...readOnly }),
    kind: fixedChoice(["opened", "closed", "failed_attempt"]),
    note: systemText(),
    occurredAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var DispenseLabel = (0, import_core13.list)({
  access: governed(["canReadClinical", "canDispense", "canFulfilRefill"]),
  fields: {
    dispense: relationship({ ref: "Dispense", ...readOnly }),
    fields: (0, import_fields14.json)({ ...readOnly }),
    printedBy: relationship({ ref: "StaffMember", ...readOnly }),
    printedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var ExternalDispense = (0, import_core13.list)({
  access: governed(["canReadClinical", "canDispense", "canFulfilRefill"]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "prescription", "pharmacyName", "status", "decidedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    prescription: relationship({ ref: "Prescription", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    pharmacyName: systemText({ required: true }),
    orderReference: systemText(),
    status: lifecycle(["requested", "approved", "declined", "filled"]),
    decidedBy: relationship({ ref: "StaffMember", ...readOnly }),
    decidedAt: (0, import_fields14.timestamp)({ ...readOnly }),
    note: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var WrittenRxExport = (0, import_core13.list)({
  access: governed(["canReadClinical", "canDispense", "canPrescribe"]),
  ui: { labelField: "ref" },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    prescription: relationship({ ref: "Prescription", ...readOnly }),
    exportedBy: relationship({ ref: "StaffMember", ...readOnly }),
    exportedAt: (0, import_fields14.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    contentSha256: systemText(),
    ...trackingFields
  }
});

// features/keystone/models/inventory.ts
var import_core14 = require("@keystone-6/core");
var import_fields15 = require("@keystone-6/core/fields");
var STOCK_READ = ["canAccessDashboard"];
var PURCHASING = ["canOrderStock", "canManageInventory", "canApprovePurchase", "canViewFinance"];
var UnitOfMeasure = (0, import_core14.list)({
  access: managed("signedIn", "canManageInventory"),
  ui: { labelField: "name" },
  fields: {
    code: (0, import_fields15.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    name: (0, import_fields15.text)({ validation: { isRequired: true } }),
    ...trackingFields
  }
});
var Item = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { labelField: "name", listView: { initialColumns: ["ref", "name", "kind", "baseUnit", "active"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    name: systemText({ required: true }),
    kind: fixedChoice(["drug", "vaccine", "supply", "retail_food", "retail_other"]),
    drug: relationship({ ref: "DrugProduct", ...readOnly }),
    vaccine: relationship({ ref: "VaccineProduct", ...readOnly }),
    baseUnit: unit(),
    sku: systemText(),
    /** Held in a fridge: a lot of it is quarantined when its fridge goes out of range. */
    coldChain: (0, import_fields15.checkbox)({ defaultValue: false, ...readOnly }),
    active: (0, import_fields15.checkbox)({ defaultValue: true, ...readOnly }),
    ...trackingFields
  }
});
var ItemUomConversion = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  fields: {
    item: relationship({ ref: "Item", ...readOnly }),
    fromUnit: systemText({ required: true }),
    toUnit: systemText({ required: true }),
    factor: qty({ required: true }),
    ...trackingFields
  }
});
var StockLocation = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { labelField: "name", listView: { initialColumns: ["name", "location", "kind", "active"] } },
  fields: {
    name: systemText({ required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    kind: fixedChoice(["shelf", "fridge", "freezer", "cabinet", "controlled_cabinet", "vehicle"]),
    minTempC: qty(),
    maxTempC: qty(),
    active: (0, import_fields15.checkbox)({ defaultValue: true, ...readOnly }),
    ...trackingFields
  }
});
var StockMovement = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { listView: { initialColumns: ["occurredAt", "item", "kind", "qtySigned", "unit", "stockLocation"] } },
  fields: {
    item: relationship({ ref: "Item", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    stockLocation: relationship({ ref: "StockLocation", ...readOnly }),
    kind: fixedChoice(["receive", "use", "dispense", "adjust", "count", "transfer_out", "transfer_in", "dispose", "return"]),
    qtySigned: qty({ required: true }),
    unit: unit(),
    sourceType: systemText(),
    sourceId: systemText(),
    reason: systemText(),
    actor: relationship({ ref: "StaffMember", ...readOnly }),
    occurredAt: (0, import_fields15.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var StockLevel = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { listView: { initialColumns: ["item", "lot", "stockLocation", "onHand", "unit"] } },
  fields: {
    item: relationship({ ref: "Item", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    stockLocation: relationship({ ref: "StockLocation", ...readOnly }),
    onHand: qty({ required: true }),
    unit: unit(),
    ...trackingFields
  }
});
var Supplier = (0, import_core14.list)({
  access: governed([...PURCHASING]),
  ui: { labelField: "name" },
  fields: {
    name: systemText({ required: true }),
    accountNumber: systemText(),
    phone: systemText(),
    email: systemText(),
    /** Hold DEA registration for suppliers of controlled drugs. */
    deaNumber: systemText(),
    active: (0, import_fields15.checkbox)({ defaultValue: true, ...readOnly }),
    ...trackingFields
  }
});
var SupplierItem = (0, import_core14.list)({
  access: governed([...PURCHASING]),
  fields: {
    supplier: relationship({ ref: "Supplier", ...readOnly }),
    item: relationship({ ref: "Item", ...readOnly }),
    sku: systemText(),
    packSize: qty(),
    packUnit: unit(),
    lastCostMinor: minor(),
    ...trackingFields
  }
});
var PurchaseOrder = (0, import_core14.list)({
  access: governed([...PURCHASING]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "supplier", "location", "status", "orderedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    supplier: relationship({ ref: "Supplier", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    status: lifecycle(["draft", "submitted", "partially_received", "received", "cancelled"]),
    orderedBy: relationship({ ref: "StaffMember", ...readOnly }),
    orderedAt: (0, import_fields15.timestamp)({ ...readOnly }),
    approvedBy: relationship({ ref: "StaffMember", ...readOnly }),
    note: systemText(),
    lines: relationship({ ref: "PurchaseOrderLine.purchaseOrder", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var PurchaseOrderLine = (0, import_core14.list)({
  access: governed([...PURCHASING]),
  fields: {
    purchaseOrder: relationship({ ref: "PurchaseOrder.lines", ...readOnly }),
    item: relationship({ ref: "Item", ...readOnly }),
    qtyOrdered: qty({ required: true }),
    qtyReceived: qty({ required: true }),
    unit: unit(),
    unitCostMinor: minor({ required: true }),
    ...trackingFields
  }
});
var GoodsReceipt = (0, import_core14.list)({
  access: governed([...PURCHASING, "canReceiveStock"]),
  ui: { labelField: "ref" },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    purchaseOrder: relationship({ ref: "PurchaseOrder", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    receivedBy: relationship({ ref: "StaffMember", ...readOnly }),
    receivedAt: (0, import_fields15.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    packingSlip: systemText(),
    lines: relationship({ ref: "GoodsReceiptLine.receipt", many: true, ...readOnly }),
    ...trackingFields
  }
});
var GoodsReceiptLine = (0, import_core14.list)({
  access: governed([...PURCHASING, "canReceiveStock"]),
  fields: {
    receipt: relationship({ ref: "GoodsReceipt.lines", ...readOnly }),
    purchaseOrderLine: relationship({ ref: "PurchaseOrderLine", ...readOnly }),
    item: relationship({ ref: "Item", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    qty: qty({ required: true }),
    unit: unit(),
    ...trackingFields
  }
});
var ReorderRule = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  fields: {
    item: relationship({ ref: "Item", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    minQty: qty({ required: true }),
    targetQty: qty({ required: true }),
    ...trackingFields
  }
});
var StockCount = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { labelField: "ref" },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    location: relationship({ ref: "Location", ...readOnly }),
    stockLocation: relationship({ ref: "StockLocation", ...readOnly }),
    status: lifecycle(["closed"]),
    countedBy: relationship({ ref: "StaffMember", ...readOnly }),
    countedAt: (0, import_fields15.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    lines: relationship({ ref: "StockCountLine.count", many: true, ...readOnly }),
    ...trackingFields
  }
});
var StockCountLine = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  fields: {
    count: relationship({ ref: "StockCount.lines", ...readOnly }),
    item: relationship({ ref: "Item", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    expectedQty: qty({ required: true }),
    countedQty: qty({ required: true }),
    variance: qty({ required: true }),
    ...trackingFields
  }
});
var RecallCase = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "title", "lotNumber", "status", "openedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    title: systemText({ required: true }),
    source: systemText(),
    item: relationship({ ref: "Item", ...readOnly }),
    lotNumber: systemText({ required: true }),
    status: lifecycle(["open", "closed"]),
    openedAt: (0, import_fields15.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    closedAt: (0, import_fields15.timestamp)({ ...readOnly }),
    resolution: systemText(),
    exposures: relationship({ ref: "RecallExposure.recall", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var RecallExposure = (0, import_core14.list)({
  access: governed(["canReadClinical", "canManageInventory"]),
  ui: { listView: { initialColumns: ["recall", "patient", "sourceType", "status"] } },
  fields: {
    recall: relationship({ ref: "RecallCase.exposures", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    client: relationship({ ref: "Client", ...readOnly }),
    sourceType: fixedChoice(["dispense", "administration", "vaccine"]),
    sourceId: systemText({ required: true }),
    givenOn: (0, import_fields15.calendarDay)({ ...readOnly }),
    status: lifecycle(["to_contact", "contacted", "resolved"]),
    note: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var TemperatureLog = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { listView: { initialColumns: ["recordedAt", "stockLocation", "readingC", "inRange"] } },
  fields: {
    stockLocation: relationship({ ref: "StockLocation", ...readOnly }),
    readingC: qty({ required: true }),
    inRange: (0, import_fields15.checkbox)({ defaultValue: true, ...readOnly }),
    recordedBy: relationship({ ref: "StaffMember", ...readOnly }),
    recordedAt: (0, import_fields15.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    ...trackingFields
  }
});
var TemperatureExcursion = (0, import_core14.list)({
  access: governed([...STOCK_READ]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "stockLocation", "status", "openedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    stockLocation: relationship({ ref: "StockLocation", ...readOnly }),
    log: relationship({ ref: "TemperatureLog", ...readOnly }),
    status: lifecycle(["open", "resolved"]),
    openedAt: (0, import_fields15.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    quarantinedLots: (0, import_fields15.integer)({ ...readOnly, defaultValue: 0 }),
    resolvedAt: (0, import_fields15.timestamp)({ ...readOnly }),
    resolution: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var INVENTORY_LISTS = {
  UnitOfMeasure,
  Item,
  ItemUomConversion,
  StockLocation,
  StockMovement,
  StockLevel,
  Supplier,
  SupplierItem,
  PurchaseOrder,
  PurchaseOrderLine,
  GoodsReceipt,
  GoodsReceiptLine,
  ReorderRule,
  StockCount,
  StockCountLine,
  RecallCase,
  RecallExposure,
  TemperatureLog,
  TemperatureExcursion
};

// features/keystone/models/record.ts
var import_core15 = require("@keystone-6/core");
var import_fields16 = require("@keystone-6/core/fields");
var CLINICAL_READ = ["canReadClinical"];
var ENCOUNTER_KINDS = ["outpatient", "inpatient_day", "surgery", "dental", "emergency", "telehealth", "phone_consult", "records_import", "euthanasia", "tech_visit"];
var SECTION_KINDS = ["history", "subjective", "objective", "assessment", "plan", "discharge", "surgery_report", "dental_chart", "anaesthesia_summary", "communication"];
var REPEATABLE_SECTIONS = ["communication"];
var Encounter = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "kind", "status", "attendingDvm", "startedAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    appointment: relationship({ ref: "Appointment", ...readOnly }),
    stay: relationship({ ref: "HospitalStay", ...readOnly }),
    kind: fixedChoice(ENCOUNTER_KINDS),
    vcprQualifying: (0, import_fields16.checkbox)({ ...readOnly, defaultValue: false }),
    status: lifecycle(["open", "in_progress", "pending_signature", "signed", "voided"]),
    reason: systemText(),
    attendingDvm: relationship({ ref: "StaffMember", ...readOnly }),
    participants: relationship({ ref: "StaffMember", many: true, ...readOnly }),
    weightUsed: relationship({ ref: "WeightMeasurement", ...readOnly }),
    startedAt: (0, import_fields16.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    submittedAt: (0, import_fields16.timestamp)({ ...readOnly }),
    signedBy: relationship({ ref: "StaffMember", ...readOnly }),
    signedAt: (0, import_fields16.timestamp)({ ...readOnly }),
    contentHash: systemText(),
    signedContent: (0, import_fields16.json)({ ...readOnly, ui: { ...readOnly.ui, description: "The canonical content that was hashed at signing (sections, vitals, findings, diagnoses, orders, administrations)." } }),
    licenseEvaluation: relationship({ ref: "LicenseEvaluation", ...readOnly }),
    vcpr: relationship({ ref: "VcprRecord", ...readOnly }),
    document: relationship({ ref: "ClinicalDocument", ...readOnly }),
    policyVersion: relationship({ ref: "PolicyVersion", ...readOnly }),
    completeness: (0, import_fields16.json)({ ...readOnly, ui: { ...readOnly.ui, description: "The last required-fields check against the medical_records policy (I-R4)." } }),
    voidReason: systemText(),
    voidApproval: relationship({ ref: "ApprovalRequest", ...readOnly }),
    importedFrom: systemText(),
    sections: relationship({ ref: "SoapSection.encounter", many: true, ...readOnly }),
    addenda: relationship({ ref: "Addendum.encounter", many: true, ...readOnly }),
    vitals: relationship({ ref: "VitalsObservation.encounter", many: true, ...readOnly }),
    findings: relationship({ ref: "PhysicalExamFinding.encounter", many: true, ...readOnly }),
    diagnoses: relationship({ ref: "Diagnosis.encounter", many: true, ...readOnly }),
    orders: relationship({ ref: "ClinicalOrder.encounter", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var SoapSection = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["encounter", "kind", "ordinal", "version", "lockedAt"] } },
  fields: {
    encounter: relationship({ ref: "Encounter.sections", ...readOnly }),
    kind: fixedChoice(SECTION_KINDS),
    ordinal: (0, import_fields16.integer)({ ...readOnly, defaultValue: 1, validation: { isRequired: true } }),
    body: systemText(),
    structured: (0, import_fields16.json)({ ...readOnly }),
    source: fixedChoice(["typed", "template", "scribe", "import"]),
    lastAuthor: relationship({ ref: "StaffMember", ...readOnly }),
    revisions: relationship({ ref: "SoapSectionRevision.section", many: true, ...readOnly }),
    lockedAt: (0, import_fields16.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var SoapSectionRevision = (0, import_core15.list)({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["section", "source", "author", "at"] } },
  fields: {
    section: relationship({ ref: "SoapSection.revisions", ...readOnly }),
    revisionNumber: (0, import_fields16.integer)({ ...readOnly, validation: { isRequired: true } }),
    body: systemText(),
    structured: (0, import_fields16.json)({ ...readOnly }),
    source: fixedChoice(["typed", "template", "scribe", "import"]),
    template: relationship({ ref: "RecordTemplate", ...readOnly }),
    scribeDraft: relationship({ ref: "ScribeDraft", ...readOnly }),
    author: relationship({ ref: "StaffMember", ...readOnly }),
    authorUser: relationship({ ref: "User", ...readOnly }),
    at: (0, import_fields16.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    contentHash: systemText({ required: true })
  }
});
var Addendum = (0, import_core15.list)({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["encounter", "sectionKind", "author", "signedAt"] } },
  fields: {
    encounter: relationship({ ref: "Encounter.addenda", ...readOnly }),
    sectionKind: fixedChoice([...SECTION_KINDS, "general"]),
    author: relationship({ ref: "StaffMember", ...readOnly }),
    authorIsDvm: (0, import_fields16.checkbox)({ ...readOnly, defaultValue: false }),
    reason: systemText({ required: true }),
    body: systemText({ required: true }),
    signedAt: (0, import_fields16.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    hash: systemText({ required: true })
  }
});
var VitalsObservation = (0, import_core15.list)({
  access: immutable([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["encounter", "temperature", "heartRate", "respRate", "painScore", "at"] } },
  fields: {
    encounter: relationship({ ref: "Encounter.vitals", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    temperature: qty(),
    temperatureUnit: choice(["F", "C"], "F"),
    heartRate: (0, import_fields16.integer)({ ...readOnly }),
    respRate: (0, import_fields16.integer)({ ...readOnly }),
    mucousMembranes: choice(["pink", "pale", "white", "cyanotic", "icteric", "injected", "brick_red", "not_assessed"], null),
    crtSeconds: qty(),
    painScore: (0, import_fields16.integer)({ ...readOnly }),
    bodyConditionScore: (0, import_fields16.integer)({ ...readOnly }),
    mentation: choice(["bar", "qar", "dull", "obtunded", "stuporous", "comatose"], null),
    hydrationPct: qty(),
    at: (0, import_fields16.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    by: relationship({ ref: "StaffMember", ...readOnly })
  }
});
var EXAM_SYSTEMS = ["general", "integument", "eyes", "ears", "oral", "cardiovascular", "respiratory", "gi", "urogenital", "musculoskeletal", "neurologic", "lymphatic"];
var PhysicalExamFinding = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["encounter", "system", "status", "text"] } },
  fields: {
    encounter: relationship({ ref: "Encounter.findings", ...readOnly }),
    system: fixedChoice(EXAM_SYSTEMS),
    status: fixedChoice(["normal", "abnormal", "not_examined"]),
    text: systemText(),
    by: relationship({ ref: "StaffMember", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var DiagnosisCode = (0, import_core15.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "term", listView: { initialColumns: ["codeSystem", "code", "term", "active"] } },
  fields: {
    codeSystem: choice(["practice", "venomcode", "snomed_vet"], "practice"),
    code: (0, import_fields16.text)({ validation: { isRequired: true } }),
    term: (0, import_fields16.text)({ validation: { isRequired: true } }),
    species: relationship({ ref: "Species", many: true }),
    active: (0, import_fields16.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var Problem = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: "term", listView: { initialColumns: ["patient", "term", "status", "chronic", "onset"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    code: relationship({ ref: "DiagnosisCode", ...readOnly }),
    term: systemText({ required: true }),
    status: lifecycle(["active", "resolved", "inactive"]),
    chronic: (0, import_fields16.checkbox)({ ...readOnly, defaultValue: false }),
    onset: (0, import_fields16.calendarDay)({ ...readOnly }),
    resolvedAt: (0, import_fields16.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Diagnosis = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: "term", listView: { initialColumns: ["encounter", "term", "certainty"] } },
  fields: {
    encounter: relationship({ ref: "Encounter.diagnoses", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    code: relationship({ ref: "DiagnosisCode", ...readOnly }),
    term: systemText({ required: true }),
    certainty: fixedChoice(["presumptive", "differential", "confirmed", "ruled_out"]),
    problem: relationship({ ref: "Problem", ...readOnly }),
    by: relationship({ ref: "StaffMember", ...readOnly }),
    ...trackingFields
  }
});
var ClinicalAttachment = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: "caption" },
  fields: {
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    kind: fixedChoice(["photo", "radiograph", "ultrasound", "lab_pdf", "external_record", "audio", "other"]),
    caption: systemText(),
    document: relationship({ ref: "Document", ...readOnly }),
    addedBy: relationship({ ref: "StaffMember", ...readOnly }),
    ...trackingFields
  }
});
var ClinicalDocument = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { labelField: "title", listView: { initialColumns: ["patient", "kind", "title", "status", "createdAt"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    kind: fixedChoice(["encounter_record", "discharge", "rabies_certificate", "health_certificate", "estimate", "consent", "lab_report", "imaging_report", "referral_letter", "records_bundle", "cs_count", "form41_packet", "form106_packet", "claim_packet", "imported_record"]),
    title: systemText({ required: true }),
    status: lifecycle(["pending_render", "rendered", "failed"]),
    sourceType: systemText(),
    sourceId: systemText({ indexed: true }),
    sourceHash: systemText(),
    document: relationship({ ref: "Document", ...readOnly }),
    signedBy: relationship({ ref: "StaffMember", ...readOnly }),
    renderedAt: (0, import_fields16.timestamp)({ ...readOnly }),
    // The rendered document (database store, the default; an object-store adapter keeps only the
    // key). Deterministic from the frozen source, so sha256 proves it was not altered.
    mimeType: systemText(),
    body: (0, import_fields16.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    sha256: systemText(),
    renderError: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var RecordTemplate = (0, import_core15.list)({
  access: managed("canReadClinical", "canManagePractice"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "kind", "sectionKind", "active"] } },
  fields: {
    name: (0, import_fields16.text)({ validation: { isRequired: true } }),
    kind: choice(["wellness", "sick", "recheck", "surgery", "dental", "euthanasia", "discharge", "phone"], "wellness"),
    sectionKind: choice([...SECTION_KINDS], "objective"),
    species: relationship({ ref: "Species" }),
    body: (0, import_fields16.text)({ ui: { displayMode: "textarea" } }),
    templateVersion: (0, import_fields16.integer)({ defaultValue: 1 }),
    active: (0, import_fields16.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var Glossary = (0, import_core15.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "term" },
  fields: {
    term: (0, import_fields16.text)({ validation: { isRequired: true }, isIndexed: "unique" }),
    expansion: (0, import_fields16.text)({ validation: { isRequired: true } }),
    ...trackingFields
  }
});
var ScribeSession = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["encounter", "status", "transcriptionProvider", "modelProvider", "createdAt"] } },
  fields: {
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    startedBy: relationship({ ref: "StaffMember", ...readOnly }),
    startedByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    clientConsent: relationship({ ref: "ConsentRecord", ...readOnly }),
    staffAcknowledged: (0, import_fields16.checkbox)({ ...readOnly, defaultValue: false }),
    audioDocument: relationship({ ref: "Document", ...readOnly }),
    audioDeleteAfter: (0, import_fields16.timestamp)({ ...readOnly }),
    transcriptRef: systemText(),
    transcript: systemText(),
    transcriptionProvider: systemText(),
    modelProvider: systemText(),
    modelRef: systemText(),
    status: lifecycle(["recording", "transcribing", "drafted", "accepted", "discarded"]),
    drafts: relationship({ ref: "ScribeDraft.session", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ScribeDraft = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  fields: {
    session: relationship({ ref: "ScribeSession.drafts", ...readOnly }),
    sections: (0, import_fields16.json)({ ...readOnly, ui: { ...readOnly.ui, description: "[{ kind, body, evidence: [transcript spans] }]" } }),
    suggestedCharges: (0, import_fields16.json)({ ...readOnly }),
    confidence: rate(),
    modelRef: systemText(),
    acceptedBlocks: (0, import_fields16.json)({ ...readOnly }),
    status: lifecycle(["proposed", "partly_accepted", "accepted", "rejected"]),
    decidedBy: relationship({ ref: "StaffMember", ...readOnly }),
    decidedAt: (0, import_fields16.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Referral = (0, import_core15.list)({
  access: governed([...CLINICAL_READ]),
  ui: { listView: { initialColumns: ["patient", "direction", "hospital", "urgency", "status"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    direction: fixedChoice(["outbound", "inbound"]),
    hospital: relationship({ ref: "ReferralHospital", ...readOnly }),
    referringVet: relationship({ ref: "ReferringVet", ...readOnly }),
    reason: systemText({ required: true }),
    urgency: fixedChoice(["emergency", "urgent", "routine"]),
    recordsRelease: relationship({ ref: "RecordsRelease", ...readOnly }),
    status: lifecycle(["draft", "sent", "accepted", "seen", "report_received", "closed"]),
    createdBy: relationship({ ref: "StaffMember", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});

// features/keystone/models/treatment.ts
var import_core16 = require("@keystone-6/core");
var import_fields17 = require("@keystone-6/core/fields");
var CLINICAL_READ2 = ["canReadClinical"];
var ROUTES = ["po", "iv", "im", "sc", "topical", "otic", "ophthalmic", "inhaled", "intranasal", "io", "rectal", "transdermal", "other"];
var ClinicalOrder = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "kind", "description", "status", "orderedBy"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    encounter: relationship({ ref: "Encounter.orders", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    kind: fixedChoice(["medication", "procedure", "treatment", "lab", "imaging", "vaccine", "fluid", "diet", "nursing", "euthanasia"]),
    description: systemText({ required: true }),
    drug: relationship({ ref: "DrugProduct", ...readOnly }),
    vaccine: relationship({ ref: "VaccineProduct", ...readOnly }),
    status: lifecycle(["ordered", "in_progress", "completed", "cancelled", "reversed"]),
    orderedBy: relationship({ ref: "StaffMember", ...readOnly }),
    licenseEvaluation: relationship({ ref: "LicenseEvaluation", ...readOnly }),
    dose: relationship({ ref: "DoseCalculation", ...readOnly }),
    frequency: systemText(),
    schedule: (0, import_fields17.json)({ ...readOnly, ui: { ...readOnly.ui, description: '{ frequency: "q8h" | "SID" | "BID" | "TID" | "PRN" | "once", startAt, durationHours }' } }),
    route: fixedChoice(ROUTES),
    quantity: qty(),
    quantityUnit: unit(),
    extralabel: (0, import_fields17.checkbox)({ ...readOnly, defaultValue: false }),
    emergencyStabilisation: (0, import_fields17.checkbox)({ ...readOnly, defaultValue: false }),
    overrideReason: systemText(),
    warnings: (0, import_fields17.json)({ ...readOnly, defaultValue: [], ui: { ...readOnly.ui, description: "Contraindication and safety warnings shown when ordering, acknowledged by the orderer." } }),
    cancelReason: systemText(),
    administrations: relationship({ ref: "Administration.order", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var DoseCalculation = (0, import_core16.list)({
  access: immutable([...CLINICAL_READ2]),
  ui: { listView: { initialColumns: ["product", "weightKg", "doseAmount", "doseUnit", "totalAmount", "roundedQty", "computedUnit"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    weight: relationship({ ref: "WeightMeasurement", ...readOnly }),
    weightKg: wt({ required: true }),
    weightAgeHours: (0, import_fields17.integer)({ ...readOnly }),
    doseAmount: qty({ required: true }),
    doseUnit: fixedChoice(["mg", "mcg", "g", "mL", "IU", "unit", "tablet", "capsule", "dose"]),
    dosePer: fixedChoice(["kg", "m2", "animal"]),
    bsaM2: qty(),
    bsaConstant: qty(),
    totalAmount: qty({ required: true }),
    totalUnit: systemText({ required: true }),
    product: relationship({ ref: "DrugProduct", ...readOnly }),
    concentration: qty(),
    concentrationUnit: systemText(),
    computedQty: qty(),
    computedUnit: systemText(),
    roundingRule: (0, import_fields17.json)({ ...readOnly }),
    roundedQty: qty(),
    deliveredAmount: qty(),
    deviationBps: (0, import_fields17.integer)({ ...readOnly }),
    manualOverrideQty: qty(),
    overrideReason: systemText(),
    warnings: (0, import_fields17.json)({ ...readOnly, defaultValue: [] }),
    calcVersion: systemText({ required: true }),
    hash: systemText({ required: true }),
    by: relationship({ ref: "StaffMember", ...readOnly }),
    at: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});
var InventoryLot = (0, import_core16.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "lotNumber", listView: { initialColumns: ["lotNumber", "drug", "vaccine", "expiresOn", "status", "location"] } },
  fields: {
    drug: relationship({ ref: "DrugProduct", ...readOnly }),
    vaccine: relationship({ ref: "VaccineProduct", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    lotNumber: systemText({ required: true }),
    expiresOn: (0, import_fields17.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["available", "quarantined", "disposed"]),
    quarantineReason: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var Administration = (0, import_core16.list)({
  access: immutable([...CLINICAL_READ2]),
  ui: { listView: { initialColumns: ["order", "patient", "qty", "unit", "route", "givenBy", "givenAt"] } },
  fields: {
    order: relationship({ ref: "ClinicalOrder.administrations", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    treatmentTask: relationship({ ref: "TreatmentTask", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    lotNumber: systemText(),
    lotExpiresOn: (0, import_fields17.calendarDay)({ ...readOnly }),
    csContainer: relationship({ ref: "CsContainer", ...readOnly }),
    csLogEntry: relationship({ ref: "CsLogEntry", ...readOnly }),
    qty: qty({ required: true }),
    unit: systemText({ required: true }),
    route: fixedChoice(ROUTES),
    site: systemText(),
    givenBy: relationship({ ref: "StaffMember", ...readOnly }),
    supervisingDvm: relationship({ ref: "StaffMember", ...readOnly }),
    witness: relationship({ ref: "StaffMember", ...readOnly }),
    licenseEvaluation: relationship({ ref: "LicenseEvaluation", ...readOnly }),
    wasteLogEntry: relationship({ ref: "CsLogEntry", ...readOnly }),
    givenAt: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    wasteQty: qty(),
    reverses: relationship({ ref: "Administration", ...readOnly }),
    reason: systemText(),
    /** N1: why a veterinarian recorded an amount outside the ordered quantity (trigger Administration_qty_guard). */
    qtyOverrideReason: systemText()
  }
});
var Ward = (0, import_core16.list)({
  access: managed("canReadClinical", "canManagePractice"),
  ui: { labelField: "name" },
  fields: {
    location: relationship({ ref: "Location" }),
    name: systemText({ required: true }),
    kind: choice(["general", "icu", "isolation", "surgery_recovery", "exotics"], "general"),
    cages: relationship({ ref: "Cage.ward", many: true }),
    ...trackingFields
  }
});
var Cage = (0, import_core16.list)({
  access: managed("canReadClinical", "canManagePractice"),
  ui: { labelField: "code", listView: { initialColumns: ["code", "ward", "size", "active"] } },
  fields: {
    ward: relationship({ ref: "Ward.cages" }),
    code: systemText({ required: true, indexed: "unique" }),
    size: choice(["small", "medium", "large", "run"], "medium"),
    features: (0, import_fields17.json)({ defaultValue: {} }),
    active: (0, import_fields17.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var HospitalStay = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "status", "cage", "admittedAt", "attendingDvm"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    cage: relationship({ ref: "Cage", ...readOnly }),
    admittedAt: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    dischargedAt: (0, import_fields17.timestamp)({ ...readOnly }),
    status: lifecycle(["admitted", "in_care", "ready_for_discharge", "discharged", "transferred", "deceased"]),
    codeStatus: fixedChoice(["full", "closed_chest_only", "dnr"]),
    attendingDvm: relationship({ ref: "StaffMember", ...readOnly }),
    reason: systemText(),
    assignments: relationship({ ref: "CageAssignment.stay", many: true, ...readOnly }),
    sheetOrders: relationship({ ref: "TreatmentSheetOrder.stay", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var CageAssignment = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  fields: {
    stay: relationship({ ref: "HospitalStay.assignments", ...readOnly }),
    cage: relationship({ ref: "Cage", ...readOnly }),
    fromAt: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    toAt: (0, import_fields17.timestamp)({ ...readOnly }),
    ...trackingFields
  }
});
var TreatmentSheetOrder = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  ui: { listView: { initialColumns: ["stay", "order", "frequency", "active", "materialisedThrough"] } },
  fields: {
    stay: relationship({ ref: "HospitalStay.sheetOrders", ...readOnly }),
    order: relationship({ ref: "ClinicalOrder", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    frequency: fixedChoice(["q1h", "q2h", "q4h", "q6h", "q8h", "q12h", "sid", "bid", "tid", "qid", "prn", "cri", "once"]),
    startAt: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    endAt: (0, import_fields17.timestamp)({ ...readOnly }),
    instructions: systemText(),
    materialisedThrough: (0, import_fields17.timestamp)({ ...readOnly }),
    graceMinutes: (0, import_fields17.integer)({ ...readOnly, defaultValue: 30 }),
    active: (0, import_fields17.checkbox)({ ...readOnly, defaultValue: true }),
    tasks: relationship({ ref: "TreatmentTask.sheetOrder", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var TreatmentTask = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  ui: { listView: { initialColumns: ["patient", "sheetOrder", "dueAt", "status", "doneBy"] } },
  fields: {
    sheetOrder: relationship({ ref: "TreatmentSheetOrder.tasks", ...readOnly }),
    stay: relationship({ ref: "HospitalStay", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    dueAt: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["scheduled", "due", "overdue", "missed", "done", "skipped", "rescheduled"]),
    doneBy: relationship({ ref: "StaffMember", ...readOnly }),
    doneAt: (0, import_fields17.timestamp)({ ...readOnly }),
    skipReason: systemText(),
    rescheduledTo: relationship({ ref: "TreatmentTask", ...readOnly }),
    administration: relationship({ ref: "Administration", ...readOnly }),
    observation: (0, import_fields17.json)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AnaesthesiaRecord = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "asaStatus", "status", "anaesthetist", "inductionAt"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    procedure: systemText({ required: true }),
    asaStatus: fixedChoice(["I", "II", "III", "IV", "V", "IE", "IIE", "IIIE", "IVE", "VE"]),
    fastingConfirmed: (0, import_fields17.checkbox)({ ...readOnly, defaultValue: false }),
    consentConfirmed: (0, import_fields17.checkbox)({ ...readOnly, defaultValue: false }),
    preWeight: relationship({ ref: "WeightMeasurement", ...readOnly }),
    ivCatheter: (0, import_fields17.json)({ ...readOnly }),
    protocol: (0, import_fields17.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Premedication, induction and maintenance plan." } }),
    checklist: (0, import_fields17.json)({ ...readOnly }),
    inductionAt: (0, import_fields17.timestamp)({ ...readOnly }),
    intubatedAt: (0, import_fields17.timestamp)({ ...readOnly }),
    extubatedAt: (0, import_fields17.timestamp)({ ...readOnly }),
    recoveryEndAt: (0, import_fields17.timestamp)({ ...readOnly }),
    anaesthetist: relationship({ ref: "StaffMember", ...readOnly }),
    dvm: relationship({ ref: "StaffMember", ...readOnly }),
    licenseEvaluation: relationship({ ref: "LicenseEvaluation", ...readOnly }),
    status: lifecycle(["open", "monitoring", "recovery", "closed"]),
    complications: systemText(),
    closedBy: relationship({ ref: "StaffMember", ...readOnly }),
    readings: relationship({ ref: "MonitoringReading.record", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var MonitoringReading = (0, import_core16.list)({
  access: immutable([...CLINICAL_READ2]),
  ui: { listView: { initialColumns: ["record", "at", "hr", "rr", "spo2", "etco2", "map", "tempC"] } },
  fields: {
    record: relationship({ ref: "AnaesthesiaRecord.readings", ...readOnly }),
    at: (0, import_fields17.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    hr: (0, import_fields17.integer)({ ...readOnly }),
    rr: (0, import_fields17.integer)({ ...readOnly }),
    spo2: (0, import_fields17.integer)({ ...readOnly }),
    etco2: (0, import_fields17.integer)({ ...readOnly }),
    sbp: (0, import_fields17.integer)({ ...readOnly }),
    dbp: (0, import_fields17.integer)({ ...readOnly }),
    map: (0, import_fields17.integer)({ ...readOnly }),
    tempC: qty(),
    agentPct: qty(),
    o2FlowLpm: qty(),
    fluidsRateMlHr: qty(),
    notes: systemText(),
    by: relationship({ ref: "StaffMember", ...readOnly })
  }
});
var SurgeryReport = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  fields: {
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    procedure: systemText({ required: true }),
    surgeon: relationship({ ref: "StaffMember", ...readOnly }),
    assistant: relationship({ ref: "StaffMember", ...readOnly }),
    technique: systemText(),
    findings: systemText(),
    closure: systemText(),
    sutures: systemText(),
    specimens: systemText(),
    status: lifecycle(["draft", "signed"]),
    version: versionField(),
    ...trackingFields
  }
});
var DentalChart = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  fields: {
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    teeth: (0, import_fields17.json)({ ...readOnly, defaultValue: {} }),
    version: versionField(),
    ...trackingFields
  }
});
var DischargeInstruction = (0, import_core16.list)({
  access: governed([...CLINICAL_READ2]),
  fields: {
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    stay: relationship({ ref: "HospitalStay", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    body: systemText({ required: true }),
    medsSummary: systemText(),
    recheckOn: (0, import_fields17.calendarDay)({ ...readOnly }),
    sentAt: (0, import_fields17.timestamp)({ ...readOnly }),
    author: relationship({ ref: "StaffMember", ...readOnly }),
    ...trackingFields
  }
});

// features/keystone/models/preventive.ts
var import_core17 = require("@keystone-6/core");
var import_fields18 = require("@keystone-6/core/fields");
var CLINICAL_READ3 = ["canReadClinical"];
var REMINDER_READ = ["canReadClinical", "canBook", "canMessageClients"];
var VaccineProduct = (0, import_core17.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "manufacturer", "isRabies", "licensedDoiMonths", "minAgeWeeks", "active"] } },
  fields: {
    name: (0, import_fields18.text)({ validation: { isRequired: true } }),
    manufacturer: (0, import_fields18.text)({ validation: { isRequired: true } }),
    antigens: (0, import_fields18.json)({ defaultValue: [], ui: { description: 'e.g. ["rabies"] or ["CDV","CAV2","CPV","CPiV"].' } }),
    species: relationship({ ref: "Species", many: true }),
    licensedDoiMonths: (0, import_fields18.integer)({ validation: { isRequired: true, min: 1, max: 48 }, defaultValue: 12 }),
    minAgeWeeks: (0, import_fields18.integer)({ validation: { isRequired: true, min: 4, max: 52 }, defaultValue: 8 }),
    isRabies: (0, import_fields18.checkbox)({ defaultValue: false }),
    usdaProductCode: (0, import_fields18.text)(),
    defaultRoute: choice(["sc", "im", "intranasal", "po", "transdermal"], "sc"),
    reminderType: relationship({ ref: "ReminderType" }),
    active: (0, import_fields18.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var VaccineAdministration = (0, import_core17.list)({
  access: immutable([...CLINICAL_READ3]),
  ui: { listView: { initialColumns: ["patient", "product", "lotNumber", "administeredOn", "dueNextOn", "vaccinatedBy"] } },
  fields: {
    administration: relationship({ ref: "Administration", ...readOnly }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    encounter: relationship({ ref: "Encounter", ...readOnly }),
    product: relationship({ ref: "VaccineProduct", ...readOnly }),
    lot: relationship({ ref: "InventoryLot", ...readOnly }),
    lotNumber: systemText({ required: true }),
    lotExpiresOn: (0, import_fields18.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    doseSeries: (0, import_fields18.integer)({ ...readOnly, validation: { isRequired: true } }),
    isInitialSeries: (0, import_fields18.checkbox)({ ...readOnly, defaultValue: false }),
    route: fixedChoice(["sc", "im", "intranasal", "po", "transdermal"]),
    site: systemText({ required: true }),
    administeredOn: (0, import_fields18.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    durationMonths: (0, import_fields18.integer)({ ...readOnly, validation: { isRequired: true } }),
    dueNextOn: (0, import_fields18.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    vaccinatedBy: relationship({ ref: "StaffMember", ...readOnly }),
    supervisingDvm: relationship({ ref: "StaffMember", ...readOnly }),
    policyVersions: (0, import_fields18.json)({ ...readOnly }),
    certificate: relationship({ ref: "RabiesCertificate", ...readOnly }),
    source: fixedChoice(["administered", "import", "external_evidence", "reversal"]),
    /** M5: a reversal is a new row pointing at the dose it cancels (append-only, DVM, with a reason). */
    reverses: relationship({ ref: "VaccineAdministration", ...readOnly }),
    reason: systemText()
  }
});
var RabiesCertificate = (0, import_core17.list)({
  access: governed([...CLINICAL_READ3]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "patient", "vaccinatedOn", "nextDueOn", "tagNumber"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    patient: relationship({ ref: "Patient", ...readOnly }),
    ownerSnapshot: (0, import_fields18.json)({ ...readOnly }),
    patientSnapshot: (0, import_fields18.json)({ ...readOnly }),
    vaccineSnapshot: (0, import_fields18.json)({ ...readOnly }),
    vetSnapshot: (0, import_fields18.json)({ ...readOnly }),
    vaccinatedOn: (0, import_fields18.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    durationMonths: (0, import_fields18.integer)({ ...readOnly, validation: { isRequired: true } }),
    nextDueOn: (0, import_fields18.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    tagNumber: systemText(),
    tagJurisdiction: systemText(),
    fields: (0, import_fields18.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Every certificate field the rabies policy requires, by name." } }),
    missingFields: (0, import_fields18.json)({ ...readOnly, defaultValue: [] }),
    document: relationship({ ref: "ClinicalDocument", ...readOnly }),
    reportedTo: fixedChoice(["none", "county", "city"]),
    reportedAt: (0, import_fields18.timestamp)({ ...readOnly }),
    policyVersions: (0, import_fields18.json)({ ...readOnly }),
    /** Set when the vaccine it certifies is reversed; a void certificate is kept, never deleted. */
    voidedAt: (0, import_fields18.timestamp)({ ...readOnly }),
    voidReason: systemText(),
    ...trackingFields
  }
});
var ReminderType = (0, import_core17.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name" },
  fields: {
    code: (0, import_fields18.text)({ isIndexed: "unique", validation: { isRequired: true, match: { regex: /^[A-Z0-9_]{2,32}$/, explanation: "Capital letters, digits and underscores." } } }),
    name: (0, import_fields18.text)({ validation: { isRequired: true } }),
    kind: choice(["vaccine", "test", "procedure", "recheck", "preventive_med"], "vaccine"),
    active: (0, import_fields18.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var ReminderProtocol = (0, import_core17.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "name" },
  fields: {
    code: systemText({ indexed: "unique", required: true }),
    name: systemText({ required: true }),
    species: relationship({ ref: "Species", ...readOnly }),
    versions: relationship({ ref: "ReminderProtocolVersion.protocol", many: true, ...readOnly }),
    ...trackingFields
  }
});
var ReminderProtocolVersion = (0, import_core17.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "label" },
  fields: {
    protocol: relationship({ ref: "ReminderProtocol.versions", ...readOnly }),
    label: systemText({ required: true }),
    versionNumber: (0, import_fields18.integer)({ ...readOnly, validation: { isRequired: true } }),
    rules: relationship({ ref: "ReminderRule.protocolVersion", many: true, ...readOnly }),
    sourceRefs: (0, import_fields18.json)({ ...readOnly }),
    verified: (0, import_fields18.checkbox)({ ...readOnly, defaultValue: false }),
    unverifiedRules: (0, import_fields18.json)({ ...readOnly, defaultValue: [] }),
    status: lifecycle(["draft", "published", "superseded"]),
    publishedAt: (0, import_fields18.timestamp)({ ...readOnly }),
    contentHash: systemText(),
    version: versionField(),
    ...trackingFields
  }
});
var ReminderRule = (0, import_core17.list)({
  access: governed("canAccessDashboard"),
  fields: {
    protocolVersion: relationship({ ref: "ReminderProtocolVersion.rules", ...readOnly }),
    code: systemText({ required: true }),
    triggerVaccines: relationship({ ref: "VaccineProduct", many: true, ...readOnly }),
    triggerServiceCode: systemText(),
    satisfies: relationship({ ref: "ReminderType", ...readOnly }),
    schedule: (0, import_fields18.json)({ ...readOnly }),
    leadDays: (0, import_fields18.integer)({ ...readOnly, defaultValue: 30 }),
    graceDays: (0, import_fields18.integer)({ ...readOnly, defaultValue: 30 }),
    lapseDays: (0, import_fields18.integer)({ ...readOnly, defaultValue: 180 }),
    ...trackingFields
  }
});
var PatientReminder = (0, import_core17.list)({
  access: governed([...REMINDER_READ]),
  ui: { listView: { initialColumns: ["patient", "type", "dueOn", "status", "source"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    location: relationship({ ref: "Location", ...readOnly }),
    type: relationship({ ref: "ReminderType", ...readOnly }),
    rule: relationship({ ref: "ReminderRule", ...readOnly }),
    dueOn: (0, import_fields18.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["scheduled", "due", "overdue", "satisfied", "suppressed", "lapsed"]),
    suppressedReason: systemText(),
    protocolVersion: relationship({ ref: "ReminderProtocolVersion", ...readOnly }),
    source: fixedChoice(["protocol", "vaccine", "manual", "import"]),
    sourceKey: systemText({ required: true }),
    lastNotifiedAt: (0, import_fields18.timestamp)({ ...readOnly }),
    satisfactions: relationship({ ref: "ReminderSatisfaction.reminder", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ReminderSatisfaction = (0, import_core17.list)({
  access: immutable([...CLINICAL_READ3]),
  fields: {
    reminder: relationship({ ref: "PatientReminder.satisfactions", ...readOnly }),
    sourceKey: systemText({ required: true }),
    vaccineAdministration: relationship({ ref: "VaccineAdministration", ...readOnly }),
    administration: relationship({ ref: "Administration", ...readOnly }),
    externalEvidence: relationship({ ref: "Document", ...readOnly }),
    note: systemText(),
    recordedBy: relationship({ ref: "StaffMember", ...readOnly }),
    at: (0, import_fields18.timestamp)({ ...readOnly, validation: { isRequired: true } })
  }
});
var AdverseEventReport = (0, import_core17.list)({
  access: governed([...CLINICAL_READ3]),
  ui: { listView: { initialColumns: ["patient", "product", "severity", "reportedTo", "status"] } },
  fields: {
    patient: relationship({ ref: "Patient", ...readOnly }),
    vaccineAdministration: relationship({ ref: "VaccineAdministration", ...readOnly }),
    administration: relationship({ ref: "Administration", ...readOnly }),
    product: relationship({ ref: "VaccineProduct", ...readOnly }),
    drug: relationship({ ref: "DrugProduct", ...readOnly }),
    lotNumber: systemText(),
    description: systemText({ required: true }),
    severity: fixedChoice(["mild", "moderate", "severe", "fatal"]),
    reportedTo: fixedChoice(["manufacturer", "fda_cvm", "usda_cvb"]),
    status: lifecycle(["draft", "submitted", "acknowledged"]),
    reference: systemText(),
    submittedAt: (0, import_fields18.timestamp)({ ...readOnly }),
    createdBy: relationship({ ref: "StaffMember", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});

// features/keystone/models/imports.ts
var import_core18 = require("@keystone-6/core");
var import_fields19 = require("@keystone-6/core/fields");
var ImportBatch = (0, import_core18.list)({
  access: governed(["canManageOnboarding", "canManageIntegrations"]),
  ui: { labelField: "ref", listView: { initialColumns: ["ref", "system", "entity", "status", "rowsTotal", "rowsCreated", "rowsFailed"] } },
  fields: {
    ref: systemText({ indexed: "unique", required: true }),
    system: fixedChoice(["ezyvet", "avimark", "csv"]),
    channel: fixedChoice(["csv", "api", "dbf"]),
    entity: fixedChoice(["clients", "patients", "weights", "vaccinations", "reminders", "consults"]),
    location: relationship({ ref: "Location", ...readOnly }),
    fileName: systemText(),
    fileHash: hiddenHash({ indexed: true }),
    status: lifecycle(["received", "validated", "applying", "applied", "failed"]),
    rowsTotal: (0, import_fields19.integer)({ ...readOnly, defaultValue: 0 }),
    rowsCreated: (0, import_fields19.integer)({ ...readOnly, defaultValue: 0 }),
    rowsSkipped: (0, import_fields19.integer)({ ...readOnly, defaultValue: 0 }),
    rowsFailed: (0, import_fields19.integer)({ ...readOnly, defaultValue: 0 }),
    mapping: (0, import_fields19.json)({ ...readOnly }),
    startedBy: relationship({ ref: "User", ...readOnly }),
    finishedAt: (0, import_fields19.timestamp)({ ...readOnly }),
    rows: relationship({ ref: "ImportRow.batch", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ImportRow = (0, import_core18.list)({
  access: governed(["canManageOnboarding", "canManageIntegrations"]),
  ui: { listView: { initialColumns: ["batch", "rowNumber", "externalId", "result", "recordType"] } },
  fields: {
    batch: relationship({ ref: "ImportBatch.rows", ...readOnly }),
    rowNumber: (0, import_fields19.integer)({ ...readOnly, validation: { isRequired: true } }),
    externalId: systemText({ required: true }),
    result: fixedChoice(["created", "skipped_existing", "failed"]),
    recordType: systemText(),
    recordId: systemText(),
    errors: (0, import_fields19.json)({ ...readOnly, defaultValue: [] }),
    ...trackingFields
  }
});

// features/keystone/models/agents.ts
var import_core19 = require("@keystone-6/core");
var import_fields20 = require("@keystone-6/core/fields");
var AGENT_SCOPES = [
  "reception.read",
  "reception.book",
  "reception.register",
  "triage.run",
  "pharmacy.intake",
  "records.request",
  "records.send",
  "results.notify",
  "boarding.reserve",
  "plan.enroll",
  "payment.link",
  "scribe.draft",
  "charges.suggest",
  "insights.read",
  "tasks.create"
];
var PROPOSAL_KINDS = [
  "client.register",
  "patient.register",
  "appointment.request",
  "refill.request",
  "records.release",
  "charge.add",
  "note.draft",
  "plan.enroll",
  "boarding.reserve",
  "reminder.send"
];
var AgentToolGrant = (0, import_core19.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "scope", listView: { initialColumns: ["agent", "scope", "status", "createdAt"] } },
  fields: {
    agent: relationship({ ref: "AgentIdentity.grants", ...readOnly }),
    scope: fixedChoice(AGENT_SCOPES),
    constraints: (0, import_fields20.json)({ ...readOnly, ui: { ...readOnly.ui, description: 'Limits, e.g. {"locations":["\u2026"],"maxBookingsPerCall":3}.' } }),
    status: lifecycle(["requested", "active", "revoked"]),
    approval: relationship({ ref: "ApprovalRequest", ...readOnly }),
    revokedAt: (0, import_fields20.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AgentRun = (0, import_core19.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "callRecordId", listView: { initialColumns: ["agent", "status", "startedAt", "endedAt"] } },
  fields: {
    agent: relationship({ ref: "AgentIdentity.runs", ...readOnly }),
    startedAt: (0, import_fields20.timestamp)({ defaultValue: { kind: "now" }, ...readOnly }),
    endedAt: (0, import_fields20.timestamp)({ ...readOnly }),
    status: lifecycle(["started", "completed", "failed", "aborted"]),
    promptHash: hiddenHash(),
    toolCalls: (0, import_fields20.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Tool names and argument hashes, never raw arguments." } }),
    costMeta: (0, import_fields20.json)({ ...readOnly }),
    callRecordId: systemText({ indexed: true }),
    proposals: relationship({ ref: "Proposal.agentRun", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Proposal = (0, import_core19.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "kind", listView: { initialColumns: ["kind", "status", "proposedByAgent", "proposedByUser", "createdAt"] } },
  fields: {
    kind: fixedChoice(PROPOSAL_KINDS),
    payload: (0, import_fields20.json)({ ...readOnly }),
    payloadHash: systemText({ required: true, secret: true }),
    status: lifecycle(["proposed", "validated", "approved", "rejected", "expired", "applied"]),
    agentRun: relationship({ ref: "AgentRun.proposals", ...readOnly }),
    proposedByAgent: relationship({ ref: "AgentIdentity", ...readOnly }),
    proposedByUser: relationship({ ref: "User", ...readOnly }),
    targetList: systemText(),
    targetId: systemText({ indexed: true }),
    approval: relationship({ ref: "ApprovalRequest", ...readOnly }),
    validation: (0, import_fields20.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Check results recorded when the proposal was validated." } }),
    version: versionField(),
    ...trackingFields
  }
});
var AgentAction = (0, import_core19.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "tool", listView: { initialColumns: ["tool", "outcome", "agent", "at"] } },
  fields: {
    agent: relationship({ ref: "AgentIdentity", ...readOnly }),
    run: relationship({ ref: "AgentRun", ...readOnly }),
    tool: systemText({ indexed: true, required: true }),
    argsHash: hiddenHash(),
    outcome: fixedChoice(["ok", "scope_denied", "never_allowed", "guard_failed", "error", "killed"]),
    errorCode: systemText(),
    auditEventId: systemText(),
    at: (0, import_fields20.timestamp)({ defaultValue: { kind: "now" }, ...readOnly })
  }
});

// features/keystone/models/index.ts
var models = {
  User,
  Role,
  OAuthApp,
  OAuthToken,
  ...platform_exports,
  ...practice_exports,
  ...compliance_exports,
  ...clients_exports,
  ...schedule_exports,
  ...comms_exports,
  DrugProduct,
  Prescription,
  PrescriptionLine,
  CsContainer,
  CsLogEntry,
  Dispense,
  CsCount,
  CsCountLine,
  CsDiscrepancyCase,
  CsDestructionRecord,
  PdmpReport,
  CsWitness,
  CsOrderForm,
  CsOrderFormLine,
  CsTransfer,
  PdmpSubmission,
  CabinetAccessEvent,
  DispenseLabel,
  ExternalDispense,
  WrittenRxExport,
  ...INVENTORY_LISTS,
  // Phase 2: the medical record, orders and treatment, preventive care, incumbent import
  Encounter,
  SoapSection,
  SoapSectionRevision,
  Addendum,
  VitalsObservation,
  PhysicalExamFinding,
  DiagnosisCode,
  Problem,
  Diagnosis,
  ClinicalAttachment,
  ClinicalDocument,
  RecordTemplate,
  Glossary,
  ScribeSession,
  ScribeDraft,
  Referral,
  ClinicalOrder,
  DoseCalculation,
  InventoryLot,
  Administration,
  Ward,
  Cage,
  HospitalStay,
  CageAssignment,
  TreatmentSheetOrder,
  TreatmentTask,
  AnaesthesiaRecord,
  MonitoringReading,
  SurgeryReport,
  DentalChart,
  DischargeInstruction,
  VaccineProduct,
  VaccineAdministration,
  RabiesCertificate,
  ReminderType,
  ReminderProtocol,
  ReminderProtocolVersion,
  ReminderRule,
  PatientReminder,
  ReminderSatisfaction,
  AdverseEventReport,
  ImportBatch,
  ImportRow,
  AgentToolGrant,
  AgentRun,
  AgentAction,
  Proposal
};
var API_MAX_TAKE = 500;
for (const list19 of Object.values(models)) {
  list19.graphql = { ...list19.graphql ?? {}, maxTake: API_MAX_TAKE };
}
registerListAccess(models);

// features/keystone/index.ts
var import_session2 = require("@keystone-6/core/session");

// features/keystone/mutations/index.ts
var import_schema = require("@graphql-tools/schema");

// features/keystone/mutations/redirectToInit.ts
async function redirectToInit(root, args, context) {
  const userCount = await context.sudo().query.User.count({});
  if (userCount === 0) {
    return true;
  }
  return false;
}
var redirectToInit_default = redirectToInit;

// features/keystone/mutations/updateActiveUser.ts
async function updateActiveUser(_root, { data }, context) {
  const session = context.session;
  if (!isSignedIn({ session })) throw new Error("Not authenticated");
  const allowed = /* @__PURE__ */ new Set(["email", "name", "password", "onboardingStatus"]);
  if (Object.keys(data || {}).some((key2) => !allowed.has(key2))) throw new Error("Unsupported profile field");
  return context.db.User.updateOne({ where: { id: session.itemId }, data });
}
var updateActiveUser_default = updateActiveUser;

// features/keystone/mutations/op.ts
var import_graphql = require("graphql");

// features/keystone/lib/errors.ts
var DomainError = class extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DomainError";
    this.code = code;
    this.details = details;
  }
};
var isDomainError = (error) => error instanceof DomainError;
var Codes = {
  NOT_AUTHORIZED: "NOT_AUTHORIZED",
  NOT_FOUND: "NOT_FOUND",
  INVALID_INPUT: "INVALID_INPUT",
  INVALID_TRANSITION: "INVALID_TRANSITION",
  STALE_STATE: "STALE_STATE",
  GUARD_FAILED: "GUARD_FAILED",
  IDEMPOTENCY_KEY_REQUIRED: "IDEMPOTENCY_KEY_REQUIRED",
  IDEMPOTENCY_KEY_REUSED: "IDEMPOTENCY_KEY_REUSED",
  IN_PROGRESS: "IN_PROGRESS",
  APPROVAL_REQUIRED: "APPROVAL_REQUIRED",
  SELF_APPROVAL: "SELF_APPROVAL",
  AGENT_CANNOT_APPROVE: "AGENT_CANNOT_APPROVE",
  APPROVAL_MISMATCH: "APPROVAL_MISMATCH",
  LEASE_LOST: "LEASE_LOST",
  STALE_FENCING_TOKEN: "STALE_FENCING_TOKEN",
  AUDIT_CHAIN_BROKEN: "AUDIT_CHAIN_BROKEN",
  // Vet clinic (STATE-MACHINES §0 error codes)
  POLICY_UNRESOLVED: "POLICY_UNRESOLVED",
  POLICY_AMBIGUOUS: "POLICY_AMBIGUOUS",
  LICENSE_INACTIVE: "LICENSE_INACTIVE",
  DEA_REGISTRATION_INVALID: "DEA_REGISTRATION_INVALID",
  VCPR_REQUIRED: "VCPR_REQUIRED",
  SLOT_TAKEN: "SLOT_TAKEN",
  SLOT_TOKEN_INVALID: "SLOT_TOKEN_INVALID",
  CONSENT_REQUIRED: "CONSENT_REQUIRED",
  PATIENT_DECEASED: "PATIENT_DECEASED",
  SCOPE_DENIED: "SCOPE_DENIED",
  NEVER_ALLOWED_FOR_AGENTS: "NEVER_ALLOWED_FOR_AGENTS",
  CALLER_NOT_VERIFIED: "CALLER_NOT_VERIFIED",
  FEATURE_DISABLED: "FEATURE_DISABLED",
  DUPLICATE_SUSPECTED: "DUPLICATE_SUSPECTED"
};

// features/keystone/lib/actor.ts
function actorFromSession(session) {
  if (!session || !isSignedIn({ session })) throw new DomainError(Codes.NOT_AUTHORIZED, "Sign in to continue.");
  const role = session.data.role;
  const granted = new Set(role ? permissionNames.filter((name) => role[name] === true) : []);
  return { kind: "user", userId: session.itemId, name: session.data.name, permissions: granted };
}
function can(actor, permission) {
  return actor.kind === "user" && actor.permissions.has(permission);
}
function requirePermission(actor, ...anyOf2) {
  if (actor.kind === "system") return;
  if (actor.kind === "agent") throw new DomainError(Codes.NOT_AUTHORIZED, "Agents act only through their tool grants.");
  if (!anyOf2.some((permission) => actor.permissions.has(permission))) {
    throw new DomainError(Codes.NOT_AUTHORIZED, `This needs the ${anyOf2.join(" or ")} permission.`);
  }
}
var principalKey = (actor) => actor.kind === "user" ? `user:${actor.userId}` : actor.kind === "agent" ? `agent:${actor.agentId}` : `system:${actor.name}`;
var actorUserId = (actor) => actor.kind === "user" ? actor.userId : null;
var actorAgentId = (actor) => actor.kind === "agent" ? actor.agentId : null;

// features/keystone/lib/idempotency.ts
var IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;
function assertIdempotencyKey(key2) {
  if (typeof key2 !== "string" || !key2.trim()) throw new DomainError(Codes.IDEMPOTENCY_KEY_REQUIRED, "An idempotency key is required.");
  if (!IDEMPOTENCY_KEY.test(key2)) throw new DomainError(Codes.INVALID_INPUT, "The idempotency key must be 8 to 200 letters, digits or . _ : -");
}
async function claimReceipt(tx, input) {
  assertIdempotencyKey(input.key);
  await advisoryLock(tx, `command:${input.key}`);
  const existing = await tx.commandReceipt.findUnique({ where: { idempotencyKey: input.key } });
  if (!existing) return { replay: false };
  const requestHash = payloadHash(input.params);
  if (existing.command !== input.command || existing.principalKey !== input.principalKey || existing.requestHash !== requestHash) {
    throw new DomainError(Codes.IDEMPOTENCY_KEY_REUSED, "This idempotency key was already used for a different request.");
  }
  return { replay: true, responseBody: existing.responseBody };
}
async function writeReceipt(tx, input) {
  await tx.commandReceipt.create({
    data: {
      idempotencyKey: input.key,
      command: input.command,
      principalKey: input.principalKey,
      requestHash: payloadHash(input.params),
      requestParams: toJsonValue(canonicalize(input.params)),
      responseCode: "ok",
      responseBody: toJsonValue(input.response),
      recoveryPoint: "completed",
      completedAt: input.now
    }
  });
}

// features/keystone/lib/audit.ts
var import_node_crypto4 = require("node:crypto");
var GENESIS_HASH = "0".repeat(64);
function auditHashBody(row) {
  return {
    seq: row.seq,
    eventKey: row.eventKey,
    eventType: row.eventType,
    entityType: row.entityType,
    entityId: row.entityId,
    actorUserId: row.actorUserId ?? null,
    actorAgentId: row.actorAgentId ?? null,
    approverId: row.approverId ?? null,
    reason: row.reason || null,
    before: row.before ?? null,
    after: row.after ?? null,
    metadata: row.metadata ?? null,
    requestId: row.requestId || null,
    at: row.at.toISOString()
  };
}
var auditHash = (prevHash, row) => sha256(`${prevHash}
${canonicalJson(auditHashBody(row))}`);
async function appendAuditEvents(tx, events, now = /* @__PURE__ */ new Date()) {
  if (!events.length) return [];
  await advisoryLock(tx, "audit:chain");
  const last = await tx.auditEvent.findFirst({ orderBy: { seq: "desc" }, select: { seq: true, hash: true } });
  let seq = last?.seq ?? 0;
  let prevHash = last?.hash ?? GENESIS_HASH;
  const written = [];
  const rows = [];
  for (const event of events) {
    seq += 1;
    const row = {
      seq,
      eventKey: event.eventKey ?? (0, import_node_crypto4.randomUUID)(),
      eventType: event.eventType,
      entityType: event.entityType,
      entityId: event.entityId,
      actorUserId: event.actorUserId ?? null,
      actorAgentId: event.actorAgentId ?? null,
      approverId: event.approverId ?? null,
      reason: event.reason ? event.reason.slice(0, 2e3) : null,
      before: event.before === void 0 ? null : toJsonValue(event.before),
      after: event.after === void 0 ? null : toJsonValue(event.after),
      metadata: event.metadata === void 0 ? null : toJsonValue(event.metadata),
      requestId: event.requestId ?? null,
      prevHash,
      at: now
    };
    const hash2 = auditHash(prevHash, row);
    rows.push({
      seq: row.seq,
      eventKey: row.eventKey,
      eventType: row.eventType,
      entityType: row.entityType,
      entityId: row.entityId,
      actorUserId: row.actorUserId,
      actorAgentId: row.actorAgentId,
      approverId: row.approverId,
      reason: row.reason ?? "",
      // Nullable json columns: omit null (stored as SQL NULL, read back as null).
      ...row.before === null ? {} : { before: row.before },
      ...row.after === null ? {} : { after: row.after },
      ...row.metadata === null ? {} : { metadata: row.metadata },
      requestId: row.requestId ?? "",
      prevHash,
      hash: hash2,
      at: row.at
    });
    written.push({ seq, hash: hash2 });
    prevHash = hash2;
  }
  await tx.auditEvent.createMany({ data: rows });
  return written;
}
async function verifyAuditChain(db, batchSize = 1e3) {
  let prevHash = GENESIS_HASH;
  let expectedSeq = 1;
  let count = 0;
  for (; ; ) {
    const rows = await db.auditEvent.findMany({ where: { seq: { gte: expectedSeq } }, orderBy: { seq: "asc" }, take: batchSize });
    if (!rows.length) break;
    for (const row of rows) {
      if (row.seq !== expectedSeq) return { ok: false, count, lastSeq: expectedSeq - 1, lastHash: prevHash, brokenAtSeq: expectedSeq, problem: "missing event" };
      if (row.prevHash !== prevHash) return { ok: false, count, lastSeq: row.seq - 1, lastHash: prevHash, brokenAtSeq: row.seq, problem: "previous hash does not match" };
      const hash2 = auditHash(prevHash, {
        ...row,
        reason: row.reason || null,
        requestId: row.requestId || null,
        actorUserId: row.actorUserId ?? null,
        actorAgentId: row.actorAgentId ?? null,
        approverId: row.approverId ?? null
      });
      if (hash2 !== row.hash) return { ok: false, count, lastSeq: row.seq - 1, lastHash: prevHash, brokenAtSeq: row.seq, problem: "content does not match its hash" };
      prevHash = row.hash;
      expectedSeq += 1;
      count += 1;
    }
  }
  return { ok: true, count, lastSeq: expectedSeq - 1, lastHash: prevHash };
}

// features/keystone/lib/unitOfWork.ts
var UnitOfWork = class {
  constructor(tx, now, requestId) {
    this.tx = tx;
    this.now = now;
    this.requestId = requestId;
    this.audits = [];
  }
  audit(event) {
    this.audits.push({ requestId: this.requestId, ...event });
  }
};
async function runInTransaction(db, work, options = {}) {
  return db.$transaction(async (tx) => {
    const uow = new UnitOfWork(tx, options.now ?? /* @__PURE__ */ new Date(), options.requestId ?? null);
    const result = await work(uow);
    await appendAuditEvents(tx, uow.audits, uow.now);
    return result;
  }, TRANSACTION_OPTIONS);
}

// features/keystone/lib/command.ts
function invariantError(error) {
  if (isDomainError(error)) return null;
  const message = error instanceof Error ? error.message : String(error);
  const constraint = /constraint "([A-Za-z0-9_]+)"/.exec(message)?.[1] ?? "";
  if (/23P01|exclusion constraint|_no_overlap/.test(message)) return new DomainError(Codes.SLOT_TAKEN, "That time was just taken. Pick another slot.", { reason: constraint || "overlap" });
  const raised = /(?:ERROR|Message): ?`?([^`\n]*(?:cannot|can't|never|must|needs|frozen|append-only)[^`\n]*)/i.exec(message)?.[1];
  if (raised) return new DomainError(Codes.GUARD_FAILED, raised.trim().slice(0, 240), { reason: "database_guard" });
  if (/23514|check constraint/.test(message)) return new DomainError(Codes.GUARD_FAILED, `A database rule refused this change (${constraint || "check"}).`, { reason: constraint || "check" });
  return null;
}
var RETRYABLE = /deadlock detected|could not serialize|P2034|P2028|40P01|40001/i;
async function command(db, spec, work) {
  const principal = principalKey(spec.actor);
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await runInTransaction(db, async (uow) => {
        const receipt = await claimReceipt(uow.tx, { key: spec.idempotencyKey, command: spec.name, principalKey: principal, params: spec.params });
        if (receipt.replay) return { replay: true, value: receipt.responseBody };
        const value = toJsonValue(await work(uow));
        await writeReceipt(uow.tx, { key: spec.idempotencyKey, command: spec.name, principalKey: principal, params: spec.params, response: value, now: uow.now });
        return { replay: false, value };
      }, { requestId: spec.requestId ?? null, now: spec.now });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const code = error?.code ?? "";
      if (attempt < 4 && (RETRYABLE.test(message) || RETRYABLE.test(code))) continue;
      throw invariantError(error) ?? error;
    }
  }
}

// features/keystone/mutations/op.ts
var UNSAFE = /prisma|invocation|\bat\s+\S+\s*\(|node_modules|postgres(ql)?:\/\/|\bSQL\b|ECONN|query engine|\.ts:\d+|\.js:\d+/i;
var SAFE_DETAIL_KEYS = /* @__PURE__ */ new Set(["currentStatus", "currentVersion", "to", "reason", "field", "problems", "replay"]);
function prismaToDomain(error) {
  if (isDomainError(error)) return error;
  const guarded = invariantError(error);
  if (guarded) return guarded;
  const code = String(error?.code ?? error?.extensions?.prisma?.code ?? "");
  const meta4 = error?.meta ?? error?.extensions?.prisma?.meta ?? {};
  const target = Array.isArray(meta4?.target) ? meta4.target.join(", ") : String(meta4?.target ?? "");
  switch (code) {
    case "P2002":
      return new DomainError(Codes.GUARD_FAILED, `That ${target && !/[_"]/.test(target) ? target : "value"} is already in use.`, { reason: "unique" });
    case "P2003":
      return new DomainError(Codes.NOT_FOUND, "A linked record does not exist.", { reason: "foreign_key" });
    case "P2025":
      return new DomainError(Codes.NOT_FOUND, "The record was not found or changed meanwhile. Reload and try again.", { reason: "not_found" });
    case "P2000":
      return new DomainError(Codes.INVALID_INPUT, "A value is too long.", { reason: "too_long" });
    case "P2006":
    case "P2007":
    case "P2009":
    case "P2012":
    case "P2019":
      return new DomainError(Codes.INVALID_INPUT, "A value has the wrong form.", { reason: "invalid" });
    case "P2034":
      return new DomainError(Codes.STALE_STATE, "Someone else changed this at the same moment. Try again.", { reason: "conflict" });
  }
  const message = String(error?.message ?? "");
  if (/23505|unique constraint/i.test(message)) return new DomainError(Codes.GUARD_FAILED, "That value is already in use.", { reason: /constraint "([A-Za-z0-9_]+)"/.exec(message)?.[1] ?? "unique" });
  if (/23503|foreign key/i.test(message)) return new DomainError(Codes.NOT_FOUND, "A linked record does not exist.", { reason: "foreign_key" });
  return null;
}
var op = (fn) => async (root, args, context) => {
  try {
    return await fn(root, args, context);
  } catch (raw) {
    if (raw instanceof import_graphql.GraphQLError && raw.extensions?.code !== "KS_PRISMA_ERROR") throw raw;
    const error = prismaToDomain(raw) ?? raw;
    if (isDomainError(error)) {
      const details = Object.fromEntries(Object.entries(error.details).filter(([key2]) => SAFE_DETAIL_KEYS.has(key2)));
      throw new import_graphql.GraphQLError(error.message, { extensions: { code: error.code, ...details } });
    }
    const message = typeof error?.message === "string" ? error.message : "";
    console.error("Operation failed:", message.slice(0, 300).replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
    const safe = message && message.length <= 300 && !UNSAFE.test(message) && !error?.code;
    throw new import_graphql.GraphQLError(safe ? message : "Unable to complete the request. Please try again.", { extensions: { code: "KS_USER_INPUT_ERROR" } });
  }
};

// features/keystone/lib/calendar.ts
var FEDERAL_HOLIDAYS = [
  "2026-01-01",
  "2026-01-19",
  "2026-02-16",
  "2026-05-25",
  "2026-06-19",
  "2026-07-03",
  "2026-09-07",
  "2026-10-12",
  "2026-11-11",
  "2026-11-26",
  "2026-12-25",
  "2027-01-01",
  "2027-01-18",
  "2027-02-15",
  "2027-05-31",
  "2027-06-18",
  "2027-07-05",
  "2027-09-06",
  "2027-10-11",
  "2027-11-11",
  "2027-11-25",
  "2027-12-24",
  "2027-12-31",
  "2028-01-17",
  "2028-02-21",
  "2028-05-29",
  "2028-06-19",
  "2028-07-04",
  "2028-09-04",
  "2028-10-09",
  "2028-11-10",
  "2028-11-23",
  "2028-12-25"
];
var US_FED = {
  code: "US-FED",
  timeZone: "America/New_York",
  weekendDays: [0, 6],
  regularOpen: "09:00",
  regularClose: "17:00",
  holidays: new Set(FEDERAL_HOLIDAYS),
  earlyCloses: /* @__PURE__ */ new Map(),
  coverageThrough: "2028-12-31"
};
var US_FED_SOURCE = "5 U.S.C. 6103 federal holidays with OPM observance rules, 2026-2028";
var US_FED_HOLIDAYS = FEDERAL_HOLIDAYS;
function locationCalendar(input) {
  return {
    code: input.code,
    timeZone: input.timeZone,
    weekendDays: input.weekendDays ?? [0, 6],
    regularOpen: input.regularOpen ?? "08:00",
    regularClose: input.regularClose ?? "18:00",
    holidays: /* @__PURE__ */ new Set([...FEDERAL_HOLIDAYS, ...input.closures ?? []]),
    earlyCloses: /* @__PURE__ */ new Map(),
    coverageThrough: US_FED.coverageThrough
  };
}
var DATE = /^\d{4}-\d{2}-\d{2}$/;
function assertDate(date) {
  if (!DATE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) throw new Error(`Invalid date ${date}`);
}
function addDays(date, days2) {
  assertDate(date);
  const t = Date.parse(`${date}T12:00:00Z`) + days2 * 864e5;
  return new Date(t).toISOString().slice(0, 10);
}
var weekday = (date) => (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
function covered(calendar, date) {
  if (date > calendar.coverageThrough) throw new Error(`${calendar.code} has no verified schedule for ${date}`);
}
function isBusinessDay(calendar, date) {
  assertDate(date);
  covered(calendar, date);
  return !calendar.weekendDays.includes(weekday(date)) && !calendar.holidays.has(date);
}
function nextBusinessDay(calendar, date) {
  let d = addDays(date, 1);
  while (!isBusinessDay(calendar, d)) d = addDays(d, 1);
  return d;
}
function previousBusinessDay(calendar, date) {
  let d = addDays(date, -1);
  while (!isBusinessDay(calendar, d)) d = addDays(d, -1);
  return d;
}
function addBusinessDays(calendar, date, n) {
  let d = date;
  for (let i = 0; i < Math.abs(n); i += 1) d = n > 0 ? nextBusinessDay(calendar, d) : previousBusinessDay(calendar, d);
  return d;
}
var zoneParts = (timeZone, at) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
function localDate(calendar, at) {
  const p = zoneParts(calendar.timeZone, typeof at === "number" ? at : at.getTime());
  return `${p.year}-${p.month}-${p.day}`;
}
function zonedInstant(timeZone, date, hhmm2) {
  assertDate(date);
  const [h, m] = hhmm2.split(":").map((x) => Number.parseInt(x, 10));
  let guess = Date.parse(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`);
  for (let i = 0; i < 3; i += 1) {
    const p = zoneParts(timeZone, guess);
    const local = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute), Number(p.second));
    const target = Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h, m);
    const diff = target - local;
    if (diff === 0) break;
    guess += diff;
  }
  return new Date(guess);
}

// features/keystone/lib/cas.ts
var COLUMN = /^[a-z][A-Za-z0-9]*$/;
async function lockRow(tx, model, id2) {
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM ${tableName(model)} WHERE id = $1 FOR UPDATE`, id2);
  if (!rows.length) throw new DomainError(Codes.NOT_FOUND, `${model} not found.`, { model, id: id2 });
  const row = await delegateOf(tx, model).findUnique({ where: { id: id2 } });
  return row;
}
async function transition(uow, spec) {
  const statusField = spec.statusField ?? "status";
  if (!COLUMN.test(statusField)) throw new Error("Invalid status field");
  const row = await lockRow(uow.tx, spec.model, spec.id);
  const currentStatus = String(row[statusField]);
  const currentVersion = Number(row.version);
  if (spec.expectedVersion !== void 0 && spec.expectedVersion !== null && spec.expectedVersion !== currentVersion) {
    throw new DomainError(Codes.STALE_STATE, `${spec.model} changed since you loaded it. Reload and try again.`, { currentStatus, currentVersion });
  }
  if (!spec.from.includes(currentStatus)) {
    throw new DomainError(Codes.INVALID_TRANSITION, `${spec.model} can't move from ${currentStatus} to ${spec.to}.`, { currentStatus, currentVersion, to: spec.to });
  }
  if (spec.guard) await spec.guard(row);
  const extra = typeof spec.data === "function" ? await spec.data(row) : spec.data ?? {};
  const result = await delegateOf(uow.tx, spec.model).updateMany({
    where: { id: spec.id, version: currentVersion, [statusField]: { in: [...spec.from] } },
    data: { ...extra, [statusField]: spec.to, version: { increment: 1 } }
  });
  if (result.count !== 1) {
    throw new DomainError(Codes.STALE_STATE, `${spec.model} changed since you loaded it. Reload and try again.`, { currentStatus, currentVersion });
  }
  uow.audit({
    eventType: spec.eventType,
    entityType: spec.model,
    entityId: spec.id,
    actorUserId: actorUserId(spec.actor),
    actorAgentId: actorAgentId(spec.actor),
    approverId: spec.approverId ?? null,
    reason: spec.reason ?? null,
    before: { [statusField]: currentStatus, version: currentVersion },
    after: { [statusField]: spec.to, version: currentVersion + 1, ...extra },
    metadata: { ...spec.metadata ?? {}, ...spec.actor.kind === "system" ? { system: spec.actor.name } : {} }
  });
  return await delegateOf(uow.tx, spec.model).findUnique({ where: { id: spec.id } });
}
function auditCreate(uow, actor, model, id2, eventType, after, extra = {}) {
  uow.audit({
    eventType,
    entityType: model,
    entityId: id2,
    actorUserId: actorUserId(actor),
    actorAgentId: actorAgentId(actor),
    reason: extra.reason ?? null,
    after,
    metadata: { ...extra.metadata ?? {}, ...actor.kind === "system" ? { system: actor.name } : {} }
  });
}

// features/keystone/domain/policy.ts
var import_zod = require("zod");
var hhmm = import_zod.z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
var days = import_zod.z.number().int().min(0).max(36500);
var CS_SCHEDULE = import_zod.z.enum(["CI", "CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"]);
var CS_ENTRY = import_zod.z.enum(["receive", "administer", "dispense", "waste", "destroy", "transfer_out", "transfer_in", "adjust", "return_to_supplier", "loss"]);
var POLICY_SCHEMAS = {
  controlled_substances: import_zod.z.object({
    recordRetentionYears: import_zod.z.number().int().min(1),
    biennialInventoryMaxDays: days,
    theftLossNoticeBusinessDays: import_zod.z.number().int().min(0),
    form106Days: days,
    orderFormValidityDays: days,
    destructionWitnesses: import_zod.z.number().int().min(1),
    separateRegistrationPerLocation: import_zod.z.boolean(),
    ciiSeparateRecords: import_zod.z.boolean(),
    witnessRequired: import_zod.z.record(CS_ENTRY, import_zod.z.boolean()),
    countFrequencyDays: import_zod.z.record(CS_SCHEDULE, days),
    stateScheduled: import_zod.z.array(import_zod.z.object({ genericName: import_zod.z.string(), schedule: CS_SCHEDULE, note: import_zod.z.string().optional() })),
    pdmp: import_zod.z.object({ required: import_zod.z.boolean(), maxDays: days, format: import_zod.z.string(), schedules: import_zod.z.array(CS_SCHEDULE), program: import_zod.z.string() })
  }),
  vcpr: import_zod.z.object({
    establishment: import_zod.z.enum(["in_person_only", "in_person_or_telehealth"]),
    durationMonths: import_zod.z.number().int().min(1).max(36),
    level: import_zod.z.enum(["dvm", "practice"]),
    requiredFor: import_zod.z.array(import_zod.z.enum(["prescription", "refill", "extralabel", "vfd", "telehealth_treatment"]))
  }),
  prescription: import_zod.z.object({
    refillLimits: import_zod.z.record(CS_SCHEDULE, import_zod.z.object({ maxRefills: import_zod.z.number().int().min(0), maxMonths: import_zod.z.number().int().min(0) })),
    defaultExpiryMonths: import_zod.z.number().int().min(1).max(24),
    writtenRxOnRequest: import_zod.z.boolean(),
    labelFields: import_zod.z.array(import_zod.z.string()),
    vfdDefaultExpiryMonths: import_zod.z.number().int().min(1)
  }),
  medical_records: import_zod.z.object({
    retentionYearsAfterLastVisit: import_zod.z.number().int().min(1),
    requiredFields: import_zod.z.array(import_zod.z.string()),
    clientCopyDays: days,
    summaryInsteadOfCopyAllowed: import_zod.z.boolean()
  }),
  confidentiality: import_zod.z.object({
    releaseBases: import_zod.z.array(import_zod.z.enum(["client_of_record", "authorised_person", "referral_with_authorisation", "insurer_with_authorisation", "court_order", "subpoena", "public_health"])),
    agentMayRelease: import_zod.z.array(import_zod.z.enum(["client_of_record"]))
  }),
  contact: import_zod.z.object({
    quietHours: import_zod.z.object({ start: hhmm, end: hhmm }),
    aiVoiceDisclosure: import_zod.z.boolean(),
    recordingConsent: import_zod.z.enum(["one_party", "all_party"]),
    consentPurposes: import_zod.z.record(import_zod.z.enum(["care", "transactional", "marketing", "ai_voice", "recording"]), import_zod.z.enum(["implied", "express", "express_written"])),
    outboundAiVoiceAllowed: import_zod.z.boolean()
  }),
  rabies: import_zod.z.object({
    certificateFormat: import_zod.z.string(),
    maxDurationMonths: import_zod.z.number().int().min(12).max(48),
    firstDoseMinAgeWeeks: import_zod.z.number().int().min(8).max(26),
    boosterAfterFirstMonths: import_zod.z.number().int().min(6).max(24),
    reportBitesTo: import_zod.z.string(),
    biteObservationDays: import_zod.z.number().int().min(1),
    certificateFields: import_zod.z.array(import_zod.z.string())
  }),
  supervision: import_zod.z.object({
    tasks: import_zod.z.record(import_zod.z.string(), import_zod.z.object({ allowedKinds: import_zod.z.array(import_zod.z.enum(["dvm", "rvt", "assistant"])), supervision: import_zod.z.enum(["none", "indirect", "direct", "immediate"]) }))
  }),
  telehealth: import_zod.z.object({ allowed: import_zod.z.boolean(), mayEstablishVcpr: import_zod.z.boolean(), prescribingLimits: import_zod.z.string() }),
  auto_renewal: import_zod.z.object({ disclosureRequired: import_zod.z.boolean(), affirmativeConsent: import_zod.z.boolean(), onlineCancellation: import_zod.z.boolean(), renewalNoticeDays: days }),
  sales_tax: import_zod.z.object({
    taxableCategories: import_zod.z.array(import_zod.z.string()),
    exemptCategories: import_zod.z.array(import_zod.z.string()),
    baseRate: import_zod.z.string().regex(/^0\.\d{1,6}$/)
  }),
  boarding: import_zod.z.object({
    requiredVaccines: import_zod.z.record(import_zod.z.string(), import_zod.z.array(import_zod.z.string())),
    gracePeriodDays: days
  }),
  licensure: import_zod.z.object({
    licenceKindsByAction: import_zod.z.record(import_zod.z.string(), import_zod.z.array(import_zod.z.enum(["veterinarian", "registered_veterinary_technician", "veterinary_assistant_cs_permit"]))),
    licenceMustMatchLocationState: import_zod.z.boolean(),
    expiryWarningDays: days
  })
};
var POLICY_KIND_NAMES = Object.keys(POLICY_SCHEMAS);
var LAYER_ORDER = { federal: 0, state: 1, local: 2 };
var rulesHash = (rules2) => payloadHash(rules2);
var isPlainObject = (v) => !!v && typeof v === "object" && !Array.isArray(v);
function mergeLayers(layers) {
  return layers.reduce((acc, layer) => {
    if (!isPlainObject(acc) || !isPlainObject(layer)) return layer;
    const out = { ...acc };
    for (const [k, v] of Object.entries(layer)) out[k] = isPlainObject(v) && isPlainObject(out[k]) ? mergeLayers([out[k], v]) : v;
    return out;
  }, {});
}
function validateLayer(kind, rules2) {
  const schema = POLICY_SCHEMAS[kind];
  if (!schema) throw new DomainError(Codes.INVALID_INPUT, `Unknown policy kind ${kind}.`);
  const parsed = schema.partial().strict().safeParse(rules2);
  if (!parsed.success) throw new DomainError(Codes.INVALID_INPUT, `The ${kind} rules are not valid: ${parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  return parsed.data;
}
function selectAndMerge(kind, on, boundPacks, candidates) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(on)) throw new DomainError(Codes.INVALID_INPUT, `Invalid policy date ${on}.`);
  if (!boundPacks.length) throw new DomainError(Codes.POLICY_UNRESOLVED, `No ${kind} policy applies here. Bind a policy pack before this action can run.`, { kind, on });
  const chosen = [];
  for (const pack of boundPacks) {
    const inForce = candidates.filter((c) => c.packCode === pack && c.status === "published" && c.effectiveFrom <= on && (!c.effectiveTo || c.effectiveTo > on));
    if (!inForce.length) throw new DomainError(Codes.POLICY_UNRESOLVED, `The ${pack} policy has no version in force on ${on}.`, { kind, pack, on });
    if (inForce.length > 1) throw new DomainError(Codes.POLICY_AMBIGUOUS, `The ${pack} policy has ${inForce.length} versions in force on ${on}.`, { kind, pack, on, versions: inForce.map((v) => v.id) });
    chosen.push(inForce[0]);
  }
  chosen.sort((a, b) => LAYER_ORDER[a.layer] - LAYER_ORDER[b.layer]);
  const layers = new Set(chosen.map((c) => c.layer));
  if (layers.size !== chosen.length) throw new DomainError(Codes.POLICY_AMBIGUOUS, `Two ${kind} packs are bound at the same layer.`, { kind, packs: chosen.map((c) => c.packCode) });
  const merged = mergeLayers(chosen.map((c) => c.rules));
  const parsed = POLICY_SCHEMAS[kind].safeParse(merged);
  if (!parsed.success) {
    throw new DomainError(Codes.POLICY_UNRESOLVED, `The ${kind} policy in force is incomplete: ${parsed.error.issues.slice(0, 5).map((i) => i.path.join(".") || "(root)").join(", ")}.`, { kind, on });
  }
  const unverifiedRules = chosen.flatMap((c) => c.unverifiedRules.map((r) => `${c.packCode}:${r}`));
  return {
    kind,
    on,
    rules: parsed.data,
    versions: chosen.map((c) => ({ id: c.id, packCode: c.packCode, layer: c.layer, verified: c.verified })),
    verified: chosen.every((c) => c.verified),
    unverifiedRules
  };
}
var isoDay = (d) => d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
async function loadPolicySnapshot(tx, kinds) {
  const rows = await tx.policyBinding.findMany({
    where: { pack: { kind: { in: [...kinds] } } },
    select: { scope: true, locationId: true, layer: true, pack: { select: { id: true, code: true, kind: true } } }
  });
  const bindings = rows.filter((b) => b.pack).map((b) => ({ scope: b.scope, locationId: b.locationId, layer: b.layer, packId: b.pack.id, packCode: b.pack.code, kind: String(b.pack.kind) }));
  const packIds = [...new Set(bindings.map((b) => b.packId))];
  const versions = packIds.length ? await tx.policyVersion.findMany({ where: { packId: { in: packIds } }, select: { id: true, packId: true, status: true, effectiveFrom: true, effectiveTo: true, rules: true, verified: true, unverifiedRules: true } }) : [];
  return {
    bindings,
    versions: versions.map((v) => ({
      id: v.id,
      packId: v.packId,
      status: String(v.status),
      effectiveFrom: isoDay(v.effectiveFrom),
      effectiveTo: isoDay(v.effectiveTo),
      rules: v.rules,
      verified: v.verified === true,
      unverifiedRules: Array.isArray(v.unverifiedRules) ? v.unverifiedRules : []
    }))
  };
}
function resolveFromSnapshot(snapshot, kind, input) {
  const bound = snapshot.bindings.filter((b) => b.kind === kind && (b.scope === "practice" || b.scope === "location" && b.locationId === input.locationId));
  const unique = [...new Map(bound.map((b) => [b.packCode, b])).values()];
  const candidates = snapshot.versions.flatMap((v) => {
    const pack = unique.find((p) => p.packId === v.packId);
    if (!pack) return [];
    const { packId: _packId, ...rest } = v;
    return [{ ...rest, packCode: pack.packCode, layer: pack.layer }];
  });
  return selectAndMerge(kind, input.on, unique.map((p) => p.packCode), candidates);
}
async function resolvePolicy(tx, kind, input) {
  return resolveFromSnapshot(await loadPolicySnapshot(tx, [kind]), kind, input);
}

// features/keystone/seed/practice.ts
var PRACTICE = {
  legalName: "Cedar Creek Animal Hospital, Inc.",
  displayName: "Cedar Creek Animal Hospital",
  homeTimeZone: "America/Los_Angeles",
  currencyCode: "USD",
  electiveDepositPct: "0.5",
  estimateValidityDays: 30,
  noShowGraceMinutes: 15
};
var WEEKDAYS = (open, close, sat) => ({ mon: [open, close], tue: [open, close], wed: [open, close], thu: [open, close], fri: [open, close], sat, sun: null });
var LOCATIONS = [
  {
    id: "seed_loc_main",
    code: "CCAH-MAIN",
    name: "Cedar Creek Animal Hospital",
    kind: "general_practice",
    addressLine1: "4120 Cedar Creek Road",
    city: "Sacramento",
    postalCode: "95823",
    stateCode: "US-CA",
    lat: "38.481200",
    lng: "-121.441500",
    timeZone: "America/Los_Angeles",
    phone: "+19165550100",
    email: "frontdesk@cedarcreekvet.com",
    regularOpen: "07:30",
    regularClose: "18:00",
    closures: ["2026-12-24", "2027-12-24"],
    openHours: WEEKDAYS("07:30", "18:00", ["08:00", "14:00"]),
    emergencyCoverage: "referral"
  },
  {
    id: "seed_loc_elkgrove",
    code: "CCAH-EG",
    name: "Elk Grove Wellness Clinic",
    kind: "wellness",
    addressLine1: "9175 Laguna Springs Way",
    city: "Elk Grove",
    postalCode: "95758",
    stateCode: "US-CA",
    lat: "38.423900",
    lng: "-121.412700",
    timeZone: "America/Los_Angeles",
    phone: "+19165550101",
    email: "elkgrove@cedarcreekvet.com",
    regularOpen: "09:00",
    regularClose: "17:00",
    closures: ["2026-12-24", "2026-12-31", "2027-12-24"],
    openHours: WEEKDAYS("09:00", "17:00", null),
    emergencyCoverage: "referral"
  }
];
var DASH = ["canAccessDashboard", "canSeeOtherPeople"];
var FRONT = ["canManageClients", "canManagePatients", "canReadClientPII", "canBook", "canCheckIn", "canMessageClients", "canTakePayments"];
var CLINICAL_READ4 = ["canReadClinical", "canReadClientPII"];
var ROLES = [
  {
    id: "seed_role_owner",
    name: "Owner / Medical Director",
    description: "Everything clinical and operational, incl. policies, fees, integrations, CS registrant duties and approvals. Break-glass is never seeded.",
    permissions: [
      ...DASH,
      ...FRONT,
      ...CLINICAL_READ4,
      "canEditOtherPeople",
      "canManagePeople",
      "canManageRoles",
      "canManageOnboarding",
      "canManagePayments",
      "canIssueRefunds",
      "canReadAudit",
      "canManagePractice",
      "canManageIntegrations",
      "canManagePolicies",
      "canManageFees",
      "canApprovePolicies",
      "canApproveFees",
      "canMergeRecords",
      "canApproveMerges",
      "canOverbook",
      "canManageSchedules",
      "canWriteRecord",
      "canSignRecord",
      "canOrder",
      "canAdminister",
      "canPrescribe",
      "canPerformSurgery",
      "canAuthoriseEuthanasia",
      "canDispense",
      "canFulfilRefill",
      "canManageRefills",
      "canAdministerControlled",
      "canWitnessControlled",
      "canCountControlled",
      "canReceiveControlled",
      "canManageControlled",
      "canViewControlled",
      "canManageInventory",
      "canApprovePurchase",
      "canReleaseQuarantine",
      "canPostInvoices",
      "canAddManualCharge",
      "canDiscount",
      "canApproveDiscount",
      "canApproveWriteOff",
      "canViewFinance",
      "canProcessRecordsRequests",
      "canApproveRecordsRelease",
      "canManageBoarding",
      "canManageTemplates",
      "canManageAgents",
      "canApproveAgentScopes"
    ]
  },
  {
    id: "seed_role_manager",
    name: "Practice Manager",
    description: "Schedules, staff, inventory, reports, approvals (discounts, refunds, write-offs) within thresholds; no clinical signing.",
    permissions: [
      ...DASH,
      ...FRONT,
      "canEditOtherPeople",
      "canManagePeople",
      "canManageOnboarding",
      "canManagePayments",
      "canIssueRefunds",
      "canReadAudit",
      "canManagePractice",
      "canManageIntegrations",
      "canManageFees",
      "canMergeRecords",
      "canOverbook",
      "canManageSchedules",
      "canManageInventory",
      "canApprovePurchase",
      "canPostInvoices",
      "canAddManualCharge",
      "canDiscount",
      "canApproveDiscount",
      "canApproveWriteOff",
      "canViewFinance",
      "canProcessRecordsRequests",
      "canManageBoarding",
      "canManageTemplates",
      "canManageAgents",
      "canApprovePolicies"
    ]
  },
  {
    id: "seed_role_dvm",
    name: "Veterinarian (DVM)",
    description: "Examine, sign records, order, prescribe, approve refills, authorise euthanasia; CS administration and witness. Licensed acts also need an active CA licence.",
    permissions: [
      ...DASH,
      ...FRONT,
      ...CLINICAL_READ4,
      "canOverbook",
      "canWriteRecord",
      "canSignRecord",
      "canOrder",
      "canAdminister",
      "canPrescribe",
      "canPerformSurgery",
      "canAuthoriseEuthanasia",
      "canDispense",
      "canFulfilRefill",
      "canManageRefills",
      "canAdministerControlled",
      "canWitnessControlled",
      "canCountControlled",
      "canViewControlled",
      "canDiscount",
      "canProcessRecordsRequests"
    ]
  },
  {
    id: "seed_role_relief_dvm",
    name: "Relief DVM",
    description: "As DVM, time-boxed by the user access expiry and limited to assigned locations.",
    permissions: [
      ...DASH,
      ...FRONT,
      ...CLINICAL_READ4,
      "canWriteRecord",
      "canSignRecord",
      "canOrder",
      "canAdminister",
      "canPrescribe",
      "canPerformSurgery",
      "canAuthoriseEuthanasia",
      "canDispense",
      "canFulfilRefill",
      "canManageRefills",
      "canAdministerControlled",
      "canWitnessControlled",
      "canViewControlled"
    ]
  },
  {
    id: "seed_role_rvt",
    name: "Credentialed Technician (RVT)",
    description: "History, vitals, treatments, anaesthesia records, supervised vaccines; CS administration under an order, witness and counts.",
    permissions: [...DASH, ...FRONT, ...CLINICAL_READ4, "canWriteRecord", "canOrder", "canAdminister", "canDispense", "canFulfilRefill", "canAdministerControlled", "canWitnessControlled", "canCountControlled", "canReceiveControlled", "canViewControlled", "canManageBoarding"]
  },
  {
    id: "seed_role_assistant",
    name: "Assistant / Kennel",
    description: "Tasks, run cards, daily care logs and feeding; no controlled substances.",
    permissions: [...DASH, "canReadClinical", "canCheckIn", "canAdminister", "canManageBoarding"]
  },
  {
    id: "seed_role_csr",
    name: "Client Service Representative",
    description: "Clients and patients, booking, check-in/out, payments, estimate presentation, records and refill intake.",
    permissions: [...DASH, ...FRONT, "canProcessRecordsRequests", "canPostInvoices"]
  },
  { id: "seed_role_groomer", name: "Groomer", description: "Groom schedule and notes.", permissions: [...DASH, "canGroom", "canCheckIn"] },
  {
    id: "seed_role_inventory",
    name: "Inventory Lead",
    description: "Items, purchase orders, receiving (CII receipts need a registrant co-sign), counts, quarantine.",
    permissions: [...DASH, "canManageInventory", "canReceiveStock", "canOrderStock", "canReceiveControlled", "canCountControlled", "canViewControlled"]
  },
  { id: "seed_role_bookkeeper", name: "Bookkeeper", description: "Invoices, payments, statements, exports, period close.", permissions: [...DASH, "canTakePayments", "canPostInvoices", "canViewFinance", "canManagePayments"] },
  { id: "seed_role_agent_owner", name: "Agent Owner", description: "Owns AI agent identities and requests their grants; a second person approves.", permissions: [...DASH, "canManageAgents"] },
  { id: "seed_role_ai_agent", name: "AI Agent", description: "Least privilege for AI agents. Holds no permission: an agent acts only through its tool grants and never inherits the person who connected it.", permissions: [] }
];
var BOTH = ["seed_loc_main", "seed_loc_elkgrove"];
var MAIN = ["seed_loc_main"];
var STAFF = [
  { id: "seed_staff_marsh", userId: "seed_user_marsh", name: "Dr. Elena Marsh", email: "elena.marsh@cedarcreekvet.com", title: "Owner & Medical Director", roleId: "seed_role_owner", kind: "dvm", credentials: "DVM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff", licence: { kind: "veterinarian", number: "VET 14862", issuedOn: "2009-07-01", expiresOn: "2027-06-30" } },
  { id: "seed_staff_okafor", userId: "seed_user_okafor", name: "Dr. Samuel Okafor", email: "samuel.okafor@cedarcreekvet.com", title: "Associate Veterinarian", roleId: "seed_role_dvm", kind: "dvm", credentials: "DVM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "veterinarian", number: "VET 19214", issuedOn: "2015-08-01", expiresOn: "2027-01-31" } },
  { id: "seed_staff_desai", userId: "seed_user_desai", name: "Dr. Priya Desai", email: "priya.desai@cedarcreekvet.com", title: "Associate Veterinarian", roleId: "seed_role_dvm", kind: "dvm", credentials: "DVM, DABVP", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: BOTH, userKind: "staff", licence: { kind: "veterinarian", number: "VET 21577", issuedOn: "2018-06-15", expiresOn: "2028-05-31" } },
  { id: "seed_staff_bennett", userId: "seed_user_bennett", name: "Dr. Lucas Bennett", email: "lucas.bennett@cedarcreekvet.com", title: "Associate Veterinarian", roleId: "seed_role_dvm", kind: "dvm", credentials: "DVM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "veterinarian", number: "VET 23940", issuedOn: "2021-07-01", expiresOn: "2026-10-31" } },
  { id: "seed_staff_cole", userId: "seed_user_cole", name: "Dr. Hannah Cole", email: "hannah.cole@cedarcreekvet.com", title: "Relief Veterinarian", roleId: "seed_role_relief_dvm", kind: "dvm", credentials: "DVM", employment: "relief", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "relief", accessDays: 90, licence: { kind: "veterinarian", number: "VET 20488", issuedOn: "2017-01-10", expiresOn: "2027-12-31" } },
  { id: "seed_staff_lopez", userId: "seed_user_lopez", name: "Maria Lopez", email: "maria.lopez@cedarcreekvet.com", title: "Lead RVT (controlled substances)", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 11873", issuedOn: "2012-03-01", expiresOn: "2027-02-28" } },
  { id: "seed_staff_price", userId: "seed_user_price", name: "Jordan Price", email: "jordan.price@cedarcreekvet.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 15302", issuedOn: "2016-09-01", expiresOn: "2027-08-31" } },
  { id: "seed_staff_rahman", userId: "seed_user_rahman", name: "Aisha Rahman", email: "aisha.rahman@cedarcreekvet.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: BOTH, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 16944", issuedOn: "2018-02-01", expiresOn: "2028-01-31" } },
  { id: "seed_staff_tran", userId: "seed_user_tran", name: "Kevin Tran", email: "kevin.tran@cedarcreekvet.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 17411", issuedOn: "2019-05-01", expiresOn: "2027-04-30" } },
  { id: "seed_staff_nguyen", userId: "seed_user_nguyen", name: "Beth Nguyen", email: "beth.nguyen@cedarcreekvet.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 18066", issuedOn: "2020-06-01", expiresOn: "2028-05-31" } },
  { id: "seed_staff_vega", userId: "seed_user_vega", name: "Carlos Vega", email: "carlos.vega@cedarcreekvet.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 18523", issuedOn: "2021-01-15", expiresOn: "2027-01-14" } },
  { id: "seed_staff_ellis", userId: "seed_user_ellis", name: "Noah Ellis", email: "noah.ellis@cedarcreekvet.com", title: "Veterinary Assistant", roleId: "seed_role_assistant", kind: "assistant", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_ito", userId: "seed_user_ito", name: "Mika Ito", email: "mika.ito@cedarcreekvet.com", title: "Veterinary Assistant", roleId: "seed_role_assistant", kind: "assistant", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_brooks", userId: "seed_user_brooks", name: "Dana Brooks", email: "dana.brooks@cedarcreekvet.com", title: "Kennel Attendant", roleId: "seed_role_assistant", kind: "kennel", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_ochoa", userId: "seed_user_ochoa", name: "Luis Ochoa", email: "luis.ochoa@cedarcreekvet.com", title: "Veterinary Assistant", roleId: "seed_role_assistant", kind: "assistant", credentials: "", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: ["seed_loc_elkgrove"], userKind: "staff" },
  { id: "seed_staff_reed", userId: "seed_user_reed", name: "Grace Reed", email: "grace.reed@cedarcreekvet.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_patel", userId: "seed_user_patel", name: "Ravi Patel", email: "ravi.patel@cedarcreekvet.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_kim", userId: "seed_user_kim", name: "Sun Kim", email: "sun.kim@cedarcreekvet.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: ["seed_loc_elkgrove"], userKind: "staff" },
  { id: "seed_staff_fox", userId: "seed_user_fox", name: "Amelia Fox", email: "amelia.fox@cedarcreekvet.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_morgan", userId: "seed_user_morgan", name: "Tess Morgan", email: "tess.morgan@cedarcreekvet.com", title: "Groomer", roleId: "seed_role_groomer", kind: "groomer", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_park", userId: "seed_user_park", name: "Linda Park", email: "linda.park@cedarcreekvet.com", title: "Practice Manager", roleId: "seed_role_manager", kind: "manager", credentials: "CVPM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff" },
  { id: "seed_staff_shah", userId: "seed_user_shah", name: "Omar Shah", email: "omar.shah@cedarcreekvet.com", title: "Inventory Lead", roleId: "seed_role_inventory", kind: "inventory", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff" }
];
var DEA_REGISTRATIONS = [
  { id: "seed_dea_main", registrationNumber: "BB7418521", registrantName: "Cedar Creek Animal Hospital, Inc.", registrantKind: "practitioner_institution", staffMemberId: null, locationId: "seed_loc_main", schedules: ["2", "2N", "3", "3N", "4", "5"], issuedOn: "2025-02-01", expiresOn: "2028-01-31" },
  { id: "seed_dea_elkgrove", registrationNumber: "BB7418533", registrantName: "Cedar Creek Animal Hospital, Inc. (Elk Grove Wellness Clinic)", registrantKind: "practitioner_institution", staffMemberId: null, locationId: "seed_loc_elkgrove", schedules: ["3", "3N", "4", "5"], issuedOn: "2025-05-01", expiresOn: "2028-04-30" },
  { id: "seed_dea_marsh_main", registrationNumber: "AM4826131", registrantName: "Elena Marsh, DVM", registrantKind: "practitioner_individual", staffMemberId: "seed_staff_marsh", locationId: "seed_loc_main", schedules: ["2", "2N", "3", "3N", "4", "5"], issuedOn: "2024-07-01", expiresOn: "2027-06-30" },
  { id: "seed_dea_marsh_eg", registrationNumber: "AM4826143", registrantName: "Elena Marsh, DVM", registrantKind: "practitioner_individual", staffMemberId: "seed_staff_marsh", locationId: "seed_loc_elkgrove", schedules: ["3", "3N", "4", "5"], issuedOn: "2025-05-01", expiresOn: "2028-04-30" },
  { id: "seed_dea_okafor", registrationNumber: "BO5172907", registrantName: "Samuel Okafor, DVM", registrantKind: "practitioner_individual", staffMemberId: "seed_staff_okafor", locationId: "seed_loc_main", schedules: ["2", "2N", "3", "3N", "4", "5"], issuedOn: "2024-02-01", expiresOn: "2027-01-31" },
  { id: "seed_dea_desai", registrationNumber: "FD6304187", registrantName: "Priya Desai, DVM", registrantKind: "practitioner_individual", staffMemberId: "seed_staff_desai", locationId: "seed_loc_elkgrove", schedules: ["3", "3N", "4", "5"], issuedOn: "2025-06-01", expiresOn: "2028-05-31" },
  // Expired on purpose: the Phase 0 exit gate shows a CS guard refusing it.
  { id: "seed_dea_cole", registrationNumber: "FC2965070", registrantName: "Hannah Cole, DVM", registrantKind: "practitioner_individual", staffMemberId: "seed_staff_cole", locationId: "seed_loc_main", schedules: ["2", "2N", "3", "3N", "4", "5"], issuedOn: "2023-09-01", expiresOn: "2026-08-31" }
];
var APPROVAL_POLICIES = [
  { action: "practice.controls", description: "Change practice-wide controls (thresholds, deposit rule, feature flags incl. the AI receptionist).", requiredPermission: "canApprovePolicies", expiresAfterMinutes: 1440 },
  { action: "policy.publish", description: "Publish a policy pack version.", requiredPermission: "canApprovePolicies", expiresAfterMinutes: 3 * 1440 },
  { action: "fee_schedule.publish", description: "Publish a fee schedule version.", requiredPermission: "canApproveFees", expiresAfterMinutes: 3 * 1440 },
  { action: "record.merge", description: "Merge duplicate client or patient records.", requiredPermission: "canApproveMerges", expiresAfterMinutes: 1440 },
  { action: "discount.apply", description: "Apply a discount over the practice threshold.", requiredPermission: "canApproveDiscount", expiresAfterMinutes: 240 },
  { action: "refund.issue", description: "Refund a payment over the practice threshold.", requiredPermission: "canIssueRefunds", expiresAfterMinutes: 1440, thresholdMinor: 25000n },
  { action: "write_off.post", description: "Write off a client balance.", requiredPermission: "canApproveWriteOff", expiresAfterMinutes: 1440 },
  { action: "records.release_third_party", description: "Release records to a third party (court, subpoena, insurer).", requiredPermission: "canApproveRecordsRelease", expiresAfterMinutes: 3 * 1440 },
  { action: "purchase_order.approve", description: "Approve a purchase order over threshold.", requiredPermission: "canApprovePurchase", expiresAfterMinutes: 3 * 1440 },
  { action: "agent_scope.grant", description: "Grant an AI agent a tool scope.", requiredPermission: "canApproveAgentScopes", expiresAfterMinutes: 1440 },
  { action: "role.assign_approval", description: "Give a person a role that can approve.", requiredPermission: "canManageRoles", expiresAfterMinutes: 1440 },
  { action: "encounter.void", description: "Void an unsigned visit record opened in error (nothing given, ordered or charged).", requiredPermission: "canSignRecord", expiresAfterMinutes: 1440 },
  { action: "cs.discrepancy_close", description: "Close a controlled-substance discrepancy case.", requiredPermission: "canManageControlled", expiresAfterMinutes: 3 * 1440 }
];

// features/keystone/seed/policies.ts
var VERIFIED_AT = "2026-11-07T00:00:00Z";
var ECFR = (part) => `https://www.law.cornell.edu/cfr/text/21/${part}`;
var S = {
  S25: { ref: "S25", title: "21 CFR 1304.11 Inventory requirements", url: ECFR("1304.11") },
  S27: { ref: "S27", title: "21 CFR 1304.04 Maintenance of records and inventories", url: ECFR("1304.04") },
  S30: { ref: "S30", title: "21 CFR 1301.76 Other security controls for practitioners", url: ECFR("1301.76"), section: "(b)" },
  S31: { ref: "S31", title: "21 CFR 1317.95 Destruction procedures", url: ECFR("1317.95") },
  S34: { ref: "S34", title: "21 CFR 530.3(i) Valid veterinarian-client-patient relationship", url: "https://www.ecfr.gov/current/title-21/part-530/section-530.3" },
  S35: { ref: "S35", title: "FDA, VCPR, prescribing/dispensing and telemedicine", url: "https://www.fda.gov/animal-veterinary/product-safety-information/veterinarian-client-patient-relationships-prescribingdispensing-animal-drugs-and-telemedicine" },
  S37: { ref: "S37", title: "NASPHV Compendium of Animal Rabies Prevention and Control", url: "https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5603a1.htm" },
  S39: { ref: "S39", title: "16 CCR 2032.3 Record keeping; records; contents; transfer", url: "https://www.law.cornell.edu/regulations/california/16-CCR-2032.3" },
  S46: { ref: "S46", title: "21 CFR 1304.21 General requirements for continuing records", url: ECFR("1304.21") },
  S47: { ref: "S47", title: "21 CFR 1305.13 Procedure for filling DEA Forms 222", url: ECFR("1305.13") },
  S48: { ref: "S48", title: "21 CFR 1301.12 Separate registrations for separate locations", url: ECFR("1301.12") },
  S49: { ref: "S49", title: "21 CFR 1306.12 Refilling prescriptions (Schedule II)", url: ECFR("1306.12") },
  S50: { ref: "S50", title: "21 CFR 1306.22 Refilling of prescriptions (Schedules III and IV)", url: ECFR("1306.22") },
  S52: { ref: "S52", title: "21 CFR 1304.04 (2-year retention; order forms at each location)", url: ECFR("1304.04") },
  S53: { ref: "S53", title: "California DOJ, CURES (HSC \xA711165(d); veterinarians report within 7 days)", url: "https://oag.ca.gov/cures" },
  S54: { ref: "S54", title: "21 CFR 558.6 Veterinary feed directive drugs", url: ECFR("558.6") },
  S56: { ref: "S56", title: "FCC 24-17 Declaratory Ruling (AI voices are artificial voices under the TCPA)", url: "https://docs.fcc.gov/public/attachments/FCC-24-17A1.pdf" },
  TCPA: { ref: "47 CFR 64.1200(c)(1)", title: "TCPA calling-time restriction (8 a.m. to 9 p.m. local)", url: "https://www.law.cornell.edu/cfr/text/47/64.1200" },
  WIRETAP: { ref: "18 U.S.C. 2511(2)(d)", title: "Federal one-party consent to record", url: "https://www.law.cornell.edu/uscode/text/18/2511" },
  CAPC632: { ref: "Cal. Penal Code \xA7632", title: "California confidential communications (all-party consent)", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=632.&lawCode=PEN" },
  CABP4857: { ref: "Cal. B&P \xA74857", title: "Confidentiality of veterinary records", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4857.&lawCode=BPC" },
  CABP4826: { ref: "Cal. B&P \xA74826.6", title: "Veterinarian-client-patient relationship and telehealth", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4826.6.&lawCode=BPC" },
  CABP17600: { ref: "Cal. B&P \xA717600 et seq.", title: "California Automatic Renewal Law", url: "https://leginfo.legislature.ca.gov/faces/codes_displayText.xhtml?lawCode=BPC&division=7.&part=3.&chapter=1.&article=9." },
  CAHSC121690: { ref: "Cal. HSC \xA7121690", title: "Dog rabies vaccination", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=121690.&lawCode=HSC" },
  CA2036: { ref: "16 CCR 2036", title: "Animal health care tasks for RVTs", url: "https://www.law.cornell.edu/regulations/california/16-CCR-2036" },
  CABP4836: { ref: "Cal. B&P \xA74836.1", title: "Veterinary assistant controlled substance permit", url: "https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?sectionNum=4836.1.&lawCode=BPC" },
  CDTFA: { ref: "CDTFA Pub. 32 / Reg. 1591", title: "Sales tax on veterinary medicines and products", url: "https://www.cdtfa.ca.gov/" },
  PRACTICE: { ref: "practice", title: "Cedar Creek Animal Hospital standard operating procedure (practice choice)" }
};
var ALL_CS = ["CII", "CIIN", "CIII", "CIIIN", "CIV", "CV"];
var POLICY_PACKS = [
  // ── Controlled substances ───────────────────────────────────────────────────────────────
  {
    code: "US/controlled_substances",
    name: "DEA controlled substances (federal)",
    kind: "controlled_substances",
    jurisdiction: "US",
    layer: "federal",
    bind: "practice",
    effectiveFrom: "2026-01-01",
    rules: {
      recordRetentionYears: 2,
      biennialInventoryMaxDays: 730,
      theftLossNoticeBusinessDays: 1,
      form106Days: 45,
      orderFormValidityDays: 60,
      destructionWitnesses: 2,
      separateRegistrationPerLocation: true,
      ciiSeparateRecords: true,
      witnessRequired: { destroy: true },
      stateScheduled: [],
      pdmp: { required: false, maxDays: 0, format: "none", schedules: [], program: "none" }
    },
    sourceRefs: [S.S27, S.S52, S.S25, S.S30, S.S47, S.S31, S.S48, S.S46],
    unverified: [],
    verifiedAt: VERIFIED_AT
  },
  {
    code: "US-CA/controlled_substances",
    name: "California controlled substances (CURES)",
    kind: "controlled_substances",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      recordRetentionYears: 3,
      stateScheduled: [],
      pdmp: { required: true, maxDays: 7, format: "ASAP 4.2B", schedules: [...ALL_CS], program: "CURES" }
    },
    sourceRefs: [S.S53, S.S39],
    unverified: ["recordRetentionYears (CA CS record retention aligned to 16 CCR 2032.3 three years)", "stateScheduled (gabapentin is not CA-scheduled as of this version)"],
    verifiedAt: VERIFIED_AT
  },
  {
    code: "CCAH/controlled_substances",
    name: "Cedar Creek controlled-substance procedure",
    kind: "controlled_substances",
    jurisdiction: "CCAH",
    layer: "local",
    bind: "practice",
    effectiveFrom: "2026-01-01",
    rules: {
      witnessRequired: { receive: false, administer: false, dispense: false, waste: true, destroy: true, transfer_out: true, transfer_in: false, adjust: true, return_to_supplier: true, loss: true },
      countFrequencyDays: { CI: 0, CII: 7, CIIN: 7, CIII: 7, CIIIN: 7, CIV: 30, CV: 30 }
    },
    sourceRefs: [S.PRACTICE],
    unverified: [],
    verifiedAt: VERIFIED_AT
  },
  // ── VCPR ─────────────────────────────────────────────────────────────────────────────────
  {
    code: "US/vcpr",
    name: "FDA VCPR (extralabel and VFD)",
    kind: "vcpr",
    jurisdiction: "US",
    layer: "federal",
    bind: "practice",
    effectiveFrom: "2026-01-01",
    rules: { establishment: "in_person_only", level: "dvm", requiredFor: ["prescription", "refill", "extralabel", "vfd", "telehealth_treatment"] },
    sourceRefs: [S.S34, S.S35, S.S54],
    unverified: [],
    verifiedAt: VERIFIED_AT
  },
  {
    code: "US-CA/vcpr",
    name: "California VCPR",
    kind: "vcpr",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: { establishment: "in_person_or_telehealth", durationMonths: 12, level: "practice" },
    sourceRefs: [S.CABP4826],
    unverified: ["establishment (telehealth establishment and its limits under B&P \xA74826.6)", "durationMonths", "level (practice-level VCPR coverage)"],
    verifiedAt: null
  },
  // ── Prescriptions ────────────────────────────────────────────────────────────────────────
  {
    code: "US/prescription",
    name: "Federal prescription rules",
    kind: "prescription",
    jurisdiction: "US",
    layer: "federal",
    bind: "practice",
    effectiveFrom: "2026-01-01",
    rules: {
      refillLimits: { CI: { maxRefills: 0, maxMonths: 0 }, CII: { maxRefills: 0, maxMonths: 0 }, CIIN: { maxRefills: 0, maxMonths: 0 }, CIII: { maxRefills: 5, maxMonths: 6 }, CIIIN: { maxRefills: 5, maxMonths: 6 }, CIV: { maxRefills: 5, maxMonths: 6 }, CV: { maxRefills: 5, maxMonths: 6 } },
      vfdDefaultExpiryMonths: 6
    },
    sourceRefs: [S.S49, S.S50, S.S54],
    unverified: ["refillLimits.CV (federal law leaves CV refills to the prescriber; the practice applies the CIII/IV limit)"],
    verifiedAt: VERIFIED_AT
  },
  {
    code: "US-CA/prescription",
    name: "California prescription and label rules",
    kind: "prescription",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      defaultExpiryMonths: 12,
      writtenRxOnRequest: true,
      labelFields: ["patient_name", "species", "client_name", "drug_name", "strength", "quantity", "directions", "prescriber_name", "practice_name_address_phone", "date_dispensed", "expiry_date", "cautionary_statements", "rx_number"]
    },
    sourceRefs: [S.S39],
    unverified: ["defaultExpiryMonths", "writtenRxOnRequest", "labelFields (CA label content)"],
    verifiedAt: null
  },
  // ── Medical records and confidentiality ─────────────────────────────────────────────────
  {
    code: "US-CA/medical_records",
    name: "California medical records (16 CCR 2032.3)",
    kind: "medical_records",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      retentionYearsAfterLastVisit: 3,
      requiredFields: ["client_name_address_phone", "patient_name_species_breed_age_sex_colour", "date_of_visit", "history", "physical_exam", "diagnosis_or_assessment", "treatment_plan", "medications_dose_route_frequency", "anaesthesia_record", "surgery_record", "prognosis", "author_identity"],
      clientCopyDays: 5,
      summaryInsteadOfCopyAllowed: true
    },
    sourceRefs: [S.S39],
    unverified: ["clientCopyDays (5-day summary deadline)"],
    verifiedAt: VERIFIED_AT
  },
  {
    code: "US-CA/confidentiality",
    name: "California record confidentiality",
    kind: "confidentiality",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      releaseBases: ["client_of_record", "authorised_person", "referral_with_authorisation", "insurer_with_authorisation", "court_order", "subpoena", "public_health"],
      agentMayRelease: ["client_of_record"]
    },
    sourceRefs: [S.CABP4857],
    unverified: ["releaseBases (B&P \xA74857 text)"],
    verifiedAt: null
  },
  // ── Contact, consent and AI voice ───────────────────────────────────────────────────────
  {
    code: "US/contact",
    name: "TCPA and FCC AI voice (federal)",
    kind: "contact",
    jurisdiction: "US",
    layer: "federal",
    bind: "practice",
    effectiveFrom: "2026-01-01",
    rules: {
      quietHours: { start: "21:00", end: "08:00" },
      aiVoiceDisclosure: true,
      recordingConsent: "one_party",
      consentPurposes: { care: "implied", transactional: "implied", marketing: "express_written", ai_voice: "express", recording: "implied" },
      outboundAiVoiceAllowed: false
    },
    sourceRefs: [S.TCPA, S.S56, S.WIRETAP],
    unverified: [],
    verifiedAt: VERIFIED_AT
  },
  {
    code: "US-CA/contact",
    name: "California recording consent",
    kind: "contact",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: { recordingConsent: "all_party", consentPurposes: { recording: "express" } },
    sourceRefs: [S.CAPC632],
    unverified: ["quietHours (no stricter CA window confirmed; federal 8 a.m.-9 p.m. applies)"],
    verifiedAt: null
  },
  // ── Rabies ───────────────────────────────────────────────────────────────────────────────
  {
    code: "US-CA/rabies",
    name: "California rabies vaccination",
    kind: "rabies",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      certificateFormat: "NASPHV Form 51 equivalent",
      maxDurationMonths: 36,
      firstDoseMinAgeWeeks: 12,
      boosterAfterFirstMonths: 12,
      reportBitesTo: "Sacramento County Animal Care Services",
      biteObservationDays: 10,
      certificateFields: ["owner_name_address", "animal_name_species_breed_sex_age_colour", "microchip", "vaccine_manufacturer_product_lot", "date_given", "duration", "next_due", "tag_number", "veterinarian_name_licence_signature"]
    },
    sourceRefs: [S.S37, S.CAHSC121690],
    unverified: ["firstDoseMinAgeWeeks", "reportBitesTo"],
    verifiedAt: null
  },
  // ── Supervision and licensure ───────────────────────────────────────────────────────────
  {
    code: "US-CA/supervision",
    name: "California RVT and assistant tasks",
    kind: "supervision",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      tasks: {
        induce_anaesthesia: { allowedKinds: ["dvm", "rvt"], supervision: "direct" },
        administer_controlled: { allowedKinds: ["dvm", "rvt", "assistant"], supervision: "indirect" },
        administer_vaccine: { allowedKinds: ["dvm", "rvt", "assistant"], supervision: "indirect" },
        dental_extraction: { allowedKinds: ["dvm"], supervision: "none" },
        euthanasia: { allowedKinds: ["dvm"], supervision: "none" }
      }
    },
    sourceRefs: [S.CA2036, S.CABP4836],
    unverified: ["tasks (task list and supervision levels per 16 CCR 2036)"],
    verifiedAt: null
  },
  {
    code: "US-CA/licensure",
    name: "California licensed acts",
    kind: "licensure",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      licenceKindsByAction: {
        examine: ["veterinarian"],
        diagnose: ["veterinarian"],
        prescribe: ["veterinarian"],
        sign_record: ["veterinarian"],
        approve_refill: ["veterinarian"],
        perform_surgery: ["veterinarian"],
        authorise_euthanasia: ["veterinarian"],
        establish_vcpr: ["veterinarian"],
        induce_anaesthesia: ["veterinarian", "registered_veterinary_technician"],
        administer_controlled: ["veterinarian", "registered_veterinary_technician", "veterinary_assistant_cs_permit"]
      },
      licenceMustMatchLocationState: true,
      expiryWarningDays: 60
    },
    sourceRefs: [S.CA2036, S.CABP4836],
    unverified: [],
    verifiedAt: VERIFIED_AT
  },
  // ── Telehealth, auto-renewal, tax, boarding ─────────────────────────────────────────────
  {
    code: "US-CA/telehealth",
    name: "California veterinary telehealth",
    kind: "telehealth",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: { allowed: true, mayEstablishVcpr: true, prescribingLimits: "Limits on supply without an in-person exam per B&P \xA74826.6; controlled substances need an in-person exam." },
    sourceRefs: [S.CABP4826],
    unverified: ["mayEstablishVcpr", "prescribingLimits"],
    verifiedAt: null
  },
  {
    code: "US-CA/auto_renewal",
    name: "California Automatic Renewal Law",
    kind: "auto_renewal",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: { disclosureRequired: true, affirmativeConsent: true, onlineCancellation: true, renewalNoticeDays: 15 },
    sourceRefs: [S.CABP17600],
    unverified: ["renewalNoticeDays"],
    verifiedAt: null
  },
  {
    code: "US-CA/sales_tax",
    name: "California sales tax on veterinary sales",
    kind: "sales_tax",
    jurisdiction: "US-CA",
    layer: "state",
    bind: "locations_in_state",
    effectiveFrom: "2026-01-01",
    rules: {
      baseRate: "0.0725",
      taxableCategories: ["retail_product", "diet", "otc_parasiticide", "supplies", "merchandise"],
      exemptCategories: ["professional_service", "rx_animal_drug", "vaccine_administered", "boarding", "grooming"]
    },
    sourceRefs: [S.CDTFA],
    unverified: ["baseRate (district add-ons apply per location)", "exemptCategories.rx_animal_drug", "exemptCategories.vaccine_administered"],
    verifiedAt: null
  },
  {
    code: "CCAH/boarding",
    name: "Cedar Creek boarding requirements",
    kind: "boarding",
    jurisdiction: "CCAH",
    layer: "local",
    bind: "practice",
    effectiveFrom: "2026-01-01",
    rules: { requiredVaccines: { dog: ["rabies", "dapp", "bordetella"], cat: ["rabies", "fvrcp"] }, gracePeriodDays: 0 },
    sourceRefs: [S.PRACTICE],
    unverified: [],
    verifiedAt: VERIFIED_AT
  }
];

// features/keystone/seed/platform.ts
var UNUSABLE_PASSWORD_HASH = "$2a$10$3dITCbIvf5zFA.1U8KZDhOHC3EEexi3KYy5ysZK1cRF6LHMm0H.ya";
var DAY = (d) => /* @__PURE__ */ new Date(`${d}T00:00:00Z`);
var meta = { metadata: { seed: true } };
async function seedPractice(uow, actor) {
  const { tx, now } = uow;
  const created = { practice: 0, locations: 0, calendars: 0, calendarExceptions: 0, roles: 0, staff: 0, licences: 0, deaRegistrations: 0, policyPacks: 0, policyVersions: 0, policyBindings: 0, approvalPolicies: 0 };
  if (!await tx.practiceSettings.findUnique({ where: { id: 1 } })) {
    await tx.practiceSettings.create({ data: { id: 1, ...PRACTICE, onboardingStatus: "in_progress" } });
    auditCreate(uow, actor, "PracticeSettings", "1", "practice.created", PRACTICE, meta);
    created.practice += 1;
  }
  let federal = await tx.businessCalendar.findUnique({ where: { code: US_FED.code } });
  if (!federal) {
    federal = await tx.businessCalendar.create({
      data: { id: "seed_cal_us_fed", code: US_FED.code, name: "US federal business days", timeZone: US_FED.timeZone, kind: "federal", weekendDays: US_FED.weekendDays, regularOpen: US_FED.regularOpen, regularClose: US_FED.regularClose, coverageThrough: DAY(US_FED.coverageThrough), source: US_FED_SOURCE }
    });
    auditCreate(uow, actor, "BusinessCalendar", federal.id, "calendar.created", { code: US_FED.code, coverageThrough: US_FED.coverageThrough }, meta);
    created.calendars += 1;
  }
  created.calendarExceptions += await loadDays(uow, actor, federal.id, US_FED_HOLIDAYS.map((date) => ({ date, kind: "holiday", note: "Federal holiday (observed)" })));
  for (const loc of LOCATIONS) {
    const code = `${loc.code}-CAL`;
    let cal = await tx.businessCalendar.findUnique({ where: { code } });
    if (!cal) {
      cal = await tx.businessCalendar.create({
        data: { id: `seed_cal_${loc.id.replace("seed_loc_", "")}`, code, name: `${loc.name} hours`, timeZone: loc.timeZone, kind: "location", weekendDays: [0, 6], regularOpen: loc.regularOpen, regularClose: loc.regularClose, coverageThrough: DAY(US_FED.coverageThrough), source: "Practice closures + US federal holidays", composedOf: { connect: [{ id: federal.id }] } }
      });
      auditCreate(uow, actor, "BusinessCalendar", cal.id, "calendar.created", { code }, meta);
      created.calendars += 1;
    }
    created.calendarExceptions += await loadDays(uow, actor, cal.id, loc.closures.map((date) => ({ date, kind: "closed", note: "Practice closed" })));
    if (!await tx.location.findUnique({ where: { id: loc.id } })) {
      const { id: id2, code: locCode, name, kind, addressLine1, city, postalCode, stateCode, lat, lng, timeZone, phone, email, openHours, emergencyCoverage } = loc;
      await tx.location.create({ data: { id: id2, code: locCode, name, kind, addressLine1, city, postalCode, stateCode, lat, lng, timeZone, phone, email, openHours, emergencyCoverage, calendarId: cal.id } });
      auditCreate(uow, actor, "Location", id2, "location.created", { code: locCode, name, stateCode, timeZone }, meta);
      created.locations += 1;
    }
  }
  const haveRoles = new Set((await tx.role.findMany({ where: { id: { in: ROLES.map((r) => r.id) } }, select: { id: true } })).map((r) => r.id));
  const newRoles = ROLES.filter((role) => !haveRoles.has(role.id));
  if (newRoles.length) {
    await tx.role.createMany({ data: newRoles.map((role) => ({ id: role.id, name: role.name, description: role.description, ...Object.fromEntries(permissionNames.map((name) => [name, role.permissions.includes(name)])) })) });
    for (const role of newRoles) auditCreate(uow, actor, "Role", role.id, "role.created", { name: role.name, permissions: role.permissions }, meta);
    created.roles = newRoles.length;
  }
  const haveUsers = await tx.user.findMany({ where: { OR: [{ id: { in: STAFF.map((p) => p.userId) } }, { email: { in: STAFF.map((p) => p.email) } }] }, select: { id: true, email: true } });
  const newUsers = STAFF.filter((person) => !haveUsers.some((u) => u.id === person.userId || u.email === person.email));
  if (newUsers.length) {
    await tx.user.createMany({
      data: newUsers.map((person) => ({
        id: person.userId,
        name: person.name,
        email: person.email,
        title: person.title,
        password: UNUSABLE_PASSWORD_HASH,
        kind: person.userKind,
        roleId: person.roleId,
        accessExpiresAt: person.accessDays ? new Date(now.getTime() + person.accessDays * 864e5) : null,
        onboardingStatus: "dismissed"
      }))
    });
    for (const person of newUsers) auditCreate(uow, actor, "User", person.userId, "user.created", { name: person.name, title: person.title, role: person.roleId, kind: person.userKind }, meta);
  }
  const haveStaff = new Set((await tx.staffMember.findMany({ where: { id: { in: STAFF.map((p) => p.id) } }, select: { id: true } })).map((r) => r.id));
  const userIds = new Map((await tx.user.findMany({ where: { OR: [{ id: { in: STAFF.map((p) => p.userId) } }, { email: { in: STAFF.map((p) => p.email) } }] }, select: { id: true, email: true } })).flatMap((u) => [[u.id, u.id], [u.email, u.id]]));
  const newStaff = STAFF.filter((person) => !haveStaff.has(person.id));
  for (const person of newStaff) {
    const userId = userIds.get(person.userId) ?? userIds.get(person.email);
    await tx.staffMember.create({
      data: {
        id: person.id,
        displayName: person.name,
        kind: person.kind,
        credentials: person.credentials,
        employment: person.employment,
        homeLocationId: person.homeLocationId,
        locations: { connect: person.locationIds.map((id2) => ({ id: id2 })) },
        ...userId ? { userId } : {}
      },
      select: { id: true }
    });
    auditCreate(uow, actor, "StaffMember", person.id, "staff.created", { name: person.name, kind: person.kind, employment: person.employment }, meta);
  }
  created.staff = newStaff.length;
  const licences = newStaff.filter((p) => p.licence).map((person) => ({ person, id: person.id.replace("seed_staff_", "seed_lic_"), licence: person.licence }));
  if (licences.length) {
    await tx.professionalLicense.createMany({
      data: licences.map(({ person, id: id2, licence }) => ({ id: id2, staffMemberId: person.id, kind: licence.kind, stateCode: "US-CA", licenseNumber: licence.number, issuedOn: DAY(licence.issuedOn), expiresOn: DAY(licence.expiresOn), status: "active", verifiedAt: now, verificationSource: "Seed (fictional licence; verify against the board in production)" }))
    });
    for (const { person, id: id2, licence } of licences) auditCreate(uow, actor, "ProfessionalLicense", id2, "licence.recorded", { staffMemberId: person.id, kind: licence.kind, number: licence.number, expiresOn: licence.expiresOn }, meta);
    created.licences = licences.length;
  }
  const haveDea = new Set((await tx.deaRegistration.findMany({ where: { id: { in: DEA_REGISTRATIONS.map((r) => r.id) } }, select: { id: true } })).map((r) => r.id));
  const newDea = DEA_REGISTRATIONS.filter((r) => !haveDea.has(r.id));
  if (newDea.length) {
    const today = now.toISOString().slice(0, 10);
    await tx.deaRegistration.createMany({
      data: newDea.map((reg) => ({ id: reg.id, registrationNumber: reg.registrationNumber, registrantName: reg.registrantName, registrantKind: reg.registrantKind, staffMemberId: reg.staffMemberId, locationId: reg.locationId, schedules: reg.schedules, issuedOn: DAY(reg.issuedOn), expiresOn: DAY(reg.expiresOn), status: reg.expiresOn < today ? "expired" : "active" }))
    });
    for (const reg of newDea) auditCreate(uow, actor, "DeaRegistration", reg.id, "dea_registration.recorded", { registrationNumber: reg.registrationNumber, locationId: reg.locationId, schedules: reg.schedules, expiresOn: reg.expiresOn }, meta);
    created.deaRegistrations = newDea.length;
  }
  await tx.practiceSettings.updateMany({ where: { id: 1, medicalDirectorId: null }, data: { medicalDirectorId: "seed_staff_marsh" } });
  const packId = (code) => `seed_pp_${code.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`;
  const packIds = new Map((await tx.policyPack.findMany({ where: { code: { in: POLICY_PACKS.map((p) => p.code) } }, select: { id: true, code: true } })).map((r) => [r.code, r.id]));
  const newPacks = POLICY_PACKS.filter((p) => !packIds.has(p.code));
  if (newPacks.length) {
    await tx.policyPack.createMany({ data: newPacks.map((pack) => ({ id: packId(pack.code), code: pack.code, name: pack.name, kind: pack.kind, jurisdiction: pack.jurisdiction })) });
    for (const pack of newPacks) {
      packIds.set(pack.code, packId(pack.code));
      auditCreate(uow, actor, "PolicyPack", packId(pack.code), "policy_pack.created", { code: pack.code, kind: pack.kind, jurisdiction: pack.jurisdiction }, meta);
    }
    created.policyPacks = newPacks.length;
  }
  const versioned = new Set((await tx.policyVersion.findMany({ where: { packId: { in: [...packIds.values()] } }, select: { packId: true } })).map((r) => r.packId));
  const versions = POLICY_PACKS.filter((p) => !versioned.has(packIds.get(p.code))).map((pack) => {
    const rules2 = validateLayer(pack.kind, pack.rules);
    const id2 = packIds.get(pack.code);
    return {
      id: `${id2}_v1`,
      packId: id2,
      label: `${pack.code} v1`,
      versionNumber: 1,
      rules: rules2,
      rulesHash: rulesHash(rules2),
      sourceRefs: pack.sourceRefs,
      verified: pack.unverified.length === 0,
      unverifiedRules: pack.unverified,
      verifiedAt: pack.verifiedAt ? new Date(pack.verifiedAt) : null,
      effectiveFrom: DAY(pack.effectiveFrom),
      status: "published",
      publishedAt: now,
      pack
    };
  });
  if (versions.length) {
    await tx.policyVersion.createMany({ data: versions.map(({ pack: _pack, ...row }) => row) });
    for (const v of versions) auditCreate(uow, actor, "PolicyVersion", v.id, "policy.published", { pack: v.pack.code, rulesHash: v.rulesHash, verified: v.verified, unverified: v.pack.unverified }, meta);
    created.policyVersions = versions.length;
  }
  const bindingKey = (pid, scope, locationId) => `${pid}|${scope}|${locationId ?? ""}`;
  const haveBindings = new Set((await tx.policyBinding.findMany({ where: { packId: { in: [...packIds.values()] } }, select: { packId: true, scope: true, locationId: true } })).map((b) => bindingKey(b.packId, b.scope, b.locationId)));
  const bindings = POLICY_PACKS.flatMap((pack) => {
    const pid = packIds.get(pack.code);
    const targets = pack.bind === "practice" ? [{ scope: "practice", locationId: null }] : LOCATIONS.filter((l) => l.stateCode === pack.jurisdiction).map((l) => ({ scope: "location", locationId: l.id }));
    return targets.filter((t) => !haveBindings.has(bindingKey(pid, t.scope, t.locationId))).map((t) => ({ id: `${pid}_${t.locationId ? t.locationId.replace("seed_loc_", "") : "practice"}`, packId: pid, scope: t.scope, locationId: t.locationId, layer: pack.layer, code: pack.code }));
  });
  if (bindings.length) {
    await tx.policyBinding.createMany({ data: bindings.map(({ code: _code, ...row }) => row) });
    for (const b of bindings) auditCreate(uow, actor, "PolicyBinding", b.id, "policy.bound", { pack: b.code, scope: b.scope, locationId: b.locationId }, meta);
    created.policyBindings = bindings.length;
  }
  const havePolicies = new Set((await tx.approvalPolicy.findMany({ select: { action: true } })).map((p) => p.action));
  const newPolicies = APPROVAL_POLICIES.filter((p) => !havePolicies.has(p.action));
  if (newPolicies.length) {
    const rows = newPolicies.map((policy) => ({ id: `seed_ap_${policy.action.replace(/[^a-z0-9]+/g, "_")}`, action: policy.action, description: policy.description, requiredPermission: policy.requiredPermission, minApprovals: 1, expiresAfterMinutes: policy.expiresAfterMinutes, thresholdMinor: policy.thresholdMinor ?? null }));
    await tx.approvalPolicy.createMany({ data: rows });
    for (const row of rows) auditCreate(uow, actor, "ApprovalPolicy", row.id, "approval_policy.created", { action: row.action, requiredPermission: row.requiredPermission }, meta);
    created.approvalPolicies = rows.length;
  }
  return created;
}
async function loadDays(uow, actor, calendarId, days2) {
  const have = new Set((await uow.tx.calendarException.findMany({ where: { calendarId }, select: { date: true } })).map((d) => d.date.toISOString().slice(0, 10)));
  const fresh = days2.filter((d) => !have.has(d.date));
  if (!fresh.length) return 0;
  await uow.tx.calendarException.createMany({ data: fresh.map((d) => ({ calendarId, date: DAY(d.date), kind: d.kind, note: d.note })) });
  uow.audit({ eventType: "calendar.exceptions_loaded", entityType: "BusinessCalendar", entityId: calendarId, actorUserId: actor.kind === "user" ? actor.userId : null, after: { count: fresh.length } });
  return fresh.length;
}

// features/keystone/mcp-oauth/agentSession.ts
var AGENT_ROLE_ID = "seed_role_ai_agent";
var agentUserId = (agentId) => `agent_user_${agentId}`;

// features/keystone/mcp-oauth/session.ts
async function resolveMcpAccessToken(context, token, listKey = "User") {
  try {
    const sudo = context.sudo();
    const record = await sudo.db.OAuthToken.findOne({ where: { token: digestToken(token) } });
    if (!record || record.tokenType !== "access_token" || record.isRevoked !== "false" || !record.userId || !record.expiresAt || new Date(record.expiresAt).getTime() <= Date.now()) {
      return void 0;
    }
    const app = await sudo.db.OAuthApp.findOne({ where: { clientId: record.clientId } });
    if (!app || app.status !== "active") return void 0;
    const mcp = {
      clientId: record.clientId,
      scopes: storedScopes(record.scopes),
      tokenId: String(record.id)
    };
    const bound = await sudo.db.AgentIdentity.findMany({ where: { oauthApp: { id: { equals: app.id } } }, take: 1 });
    const agent = bound[0];
    const issuedTo = String(record.agentId ?? "");
    if (issuedTo || agent) {
      if (!agent || !issuedTo || String(agent.id) !== issuedTo) return void 0;
      if (agent.status !== "active" || agent.killSwitch) return void 0;
      mcp.agentId = String(agent.id);
      return { itemId: agentUserId(String(agent.id)), listKey, mcp, agent: { id: String(agent.id) } };
    }
    return { itemId: String(record.userId), listKey, mcp };
  } catch {
    return void 0;
  }
}
function withMcpBearerSessions(strategy, listKey = "User") {
  return {
    ...strategy,
    async get({ context }) {
      const token = bearerToken(context?.req?.headers?.authorization);
      if (isMcpAccessToken(token)) return resolveMcpAccessToken(context, token, listKey);
      return strategy.get({ context });
    }
  };
}
function mcpSessionMarker(session) {
  const marker = session?.mcp;
  return marker && typeof marker.clientId === "string" && Array.isArray(marker.scopes) ? marker : null;
}

// features/keystone/mutations/actorFor.ts
async function actorFor(context) {
  const person = actorFromSession(context.session);
  const marker = mcpSessionMarker(context.session);
  if (!marker) return person;
  const agent = await context.prisma.agentIdentity.findFirst({
    where: { ...marker.agentId ? { id: marker.agentId } : {}, oauthApp: { clientId: { equals: marker.clientId } } },
    select: { id: true, name: true, status: true, killSwitch: true, ownerId: true, grants: { where: { status: "active" }, select: { scope: true } } }
  });
  if (!agent) {
    if (marker.agentId) throw new DomainError(Codes.NOT_AUTHORIZED, "This connection is no longer linked to an agent. Reconnect the app.");
    return person;
  }
  if (agent.status !== "active") throw new DomainError(Codes.NOT_AUTHORIZED, `The agent ${agent.name} is ${agent.status}.`);
  return { kind: "agent", agentId: agent.id, ownerUserId: agent.ownerId, name: agent.name, scopes: new Set(agent.grants.map((g) => g.scope)) };
}

// features/keystone/mutations/agentGuard.ts
var argsHash = (args) => keyedPayloadHash(args ?? {}, "agent-action-args");
async function logAgentAction(prisma, actor, tool, args, outcome, errorCode) {
  const agentId = actorAgentId(actor);
  if (!agentId) return;
  await prisma.agentAction.create({ data: { agentId, tool, argsHash: argsHash(args), outcome, errorCode: errorCode ?? "" } });
}
var outcomeOf = (error) => {
  const code = isDomainError(error) ? error.code : "ERROR";
  if (code === Codes.SCOPE_DENIED) return "scope_denied";
  if (code === Codes.NEVER_ALLOWED_FOR_AGENTS) return "never_allowed";
  if (code === Codes.FEATURE_DISABLED && error.details?.reason === "kill_switch") return "killed";
  if (isDomainError(error)) return "guard_failed";
  return "error";
};
async function gated(context, gate, args, run) {
  const actor = await actorFor(context);
  try {
    if (actor.kind === "agent") {
      if (gate.humanOnly) throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, `${gate.tool} is a human action.`);
      const agent = await context.prisma.agentIdentity.findUnique({ where: { id: actor.agentId }, select: { killSwitch: true, status: true, kind: true } });
      if (!agent || agent.status !== "active") throw new DomainError(Codes.NOT_AUTHORIZED, "The agent is not active.");
      if (agent.killSwitch) throw new DomainError(Codes.FEATURE_DISABLED, "The agent has been switched off.", { reason: "kill_switch" });
      if (!gate.scope || !actor.scopes.has(gate.scope)) throw new DomainError(Codes.SCOPE_DENIED, `The agent has no active ${gate.scope ?? gate.tool} grant.`);
      if (agent.kind === "voice_receptionist") {
        const practice = await context.prisma.practiceSettings.findUnique({ where: { id: 1 }, select: { features: true } });
        if (!practice?.features?.aiVoice) throw new DomainError(Codes.FEATURE_DISABLED, "The AI receptionist is turned off for this practice.");
      }
    } else {
      if (gate.agentOnly) throw new DomainError(Codes.NOT_AUTHORIZED, `${gate.tool} is for the AI receptionist.`);
      requirePermission(actor, ...gate.permissions);
    }
    const value = await run(actor);
    await logAgentAction(context.prisma, actor, gate.tool, args, "ok", null).catch(() => void 0);
    return value;
  } catch (error) {
    await logAgentAction(context.prisma, actor, gate.tool, args, outcomeOf(error), isDomainError(error) ? error.code : "ERROR").catch(() => void 0);
    throw error;
  }
}

// features/keystone/mutations/agents.ts
async function setAgentKillSwitch(_root, args, context) {
  return gated(context, { permissions: ["canManageAgents"], tool: "agent.kill_switch", humanOnly: true }, args, async (actor) => {
    const reason = String(args.reason ?? "").trim();
    if (!args.killSwitch && reason.length < 5) throw new DomainError(Codes.INVALID_INPUT, "Say why the agent can be switched back on.", { field: "reason" });
    const result = await command(context.prisma, { name: "agent.kill_switch", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const agent = await uow.tx.agentIdentity.findUnique({ where: { id: args.agentId }, select: { id: true, killSwitch: true, version: true, name: true } });
      if (!agent) throw new DomainError(Codes.NOT_FOUND, "Agent not found.");
      if (agent.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, "The agent changed since you loaded it. Reload and try again.", { currentVersion: agent.version });
      if (agent.killSwitch === args.killSwitch) return { id: agent.id, killSwitch: agent.killSwitch, status: args.killSwitch ? "killed" : "active" };
      const updated = await uow.tx.agentIdentity.updateMany({ where: { id: agent.id, version: agent.version }, data: { killSwitch: args.killSwitch, version: { increment: 1 } } });
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, "The agent changed since you loaded it. Reload and try again.");
      uow.audit({
        eventType: args.killSwitch ? "agent.killed" : "agent.revived",
        entityType: "AgentIdentity",
        entityId: agent.id,
        actorUserId: actorUserId(actor),
        actorAgentId: null,
        approverId: null,
        before: { killSwitch: agent.killSwitch },
        after: { killSwitch: args.killSwitch },
        reason: reason || null,
        metadata: {}
      });
      return { id: agent.id, killSwitch: args.killSwitch, status: args.killSwitch ? "killed" : "active" };
    });
    return result.value;
  });
}
var UNUSABLE_PASSWORD_HASH2 = "$2a$10$3dITCbIvf5zFA.1U8KZDhOHC3EEexi3KYy5ysZK1cRF6LHMm0H.ya";
async function revokeAppTokens(tx, appId) {
  const app = await tx.oAuthApp.findUnique({ where: { id: appId }, select: { clientId: true } });
  if (!app) return 0;
  const result = await tx.oAuthToken.updateMany({ where: { clientId: app.clientId, isRevoked: "false" }, data: { isRevoked: "true" } });
  return result.count;
}
async function ensureAgentUser(tx, agent) {
  const id2 = agentUserId(agent.id);
  const existing = await tx.user.findUnique({ where: { id: id2 }, select: { id: true } });
  if (existing) await tx.user.update({ where: { id: id2 }, data: { roleId: AGENT_ROLE_ID } });
  else await tx.user.create({ data: { id: id2, name: `${agent.name} (agent)`, email: `agent-${agent.id}@agents.invalid`, password: UNUSABLE_PASSWORD_HASH2, kind: "staff", roleId: AGENT_ROLE_ID, title: "AI agent", onboardingStatus: "dismissed" } });
  return id2;
}
async function bindAgentApp(_root, args, context) {
  return gated(context, { permissions: ["canManageAgents"], tool: "agent.bind_app", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "agent.bind_app", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const { tx } = uow;
      const agent = await tx.agentIdentity.findUnique({ where: { id: args.agentId }, select: { id: true, name: true, version: true, oauthAppId: true } });
      if (!agent) throw new DomainError(Codes.NOT_FOUND, "Agent not found.");
      if (agent.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, "The agent changed since you loaded it. Reload and try again.", { currentVersion: agent.version });
      const app = await tx.oAuthApp.findUnique({ where: { id: args.oauthAppId }, select: { id: true, name: true } });
      if (!app) throw new DomainError(Codes.NOT_FOUND, "App not found.");
      const taken = await tx.agentIdentity.findFirst({ where: { oauthAppId: app.id, id: { not: agent.id } }, select: { name: true } });
      if (taken) throw new DomainError(Codes.GUARD_FAILED, `${app.name} is already connected to ${taken.name}.`, { reason: "app_already_bound" });
      await ensureAgentUser(tx, agent);
      const updated = await tx.agentIdentity.updateMany({ where: { id: agent.id, version: agent.version }, data: { oauthAppId: app.id, version: { increment: 1 } } });
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, "The agent changed since you loaded it. Reload and try again.");
      let revoked = await revokeAppTokens(tx, app.id);
      if (agent.oauthAppId && agent.oauthAppId !== app.id) revoked += await revokeAppTokens(tx, agent.oauthAppId);
      auditCreate(uow, actor, "AgentIdentity", agent.id, "agent.app_bound", { revokedTokens: revoked, oauthAppId: app.id, previousAppId: agent.oauthAppId, role: AGENT_ROLE_ID, boundBy: actorUserId(actor) });
      return { agentId: agent.id, oauthAppId: app.id, revokedTokens: revoked, version: agent.version + 1 };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function unbindAgentApp(_root, args, context) {
  return gated(context, { permissions: ["canManageAgents"], tool: "agent.unbind_app", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "agent.unbind_app", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const { tx } = uow;
      const agent = await tx.agentIdentity.findUnique({ where: { id: args.agentId }, select: { id: true, version: true, oauthAppId: true } });
      if (!agent) throw new DomainError(Codes.NOT_FOUND, "Agent not found.");
      if (agent.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, "The agent changed since you loaded it. Reload and try again.", { currentVersion: agent.version });
      const updated = await tx.agentIdentity.updateMany({ where: { id: agent.id, version: agent.version }, data: { oauthAppId: null, version: { increment: 1 } } });
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, "The agent changed since you loaded it. Reload and try again.");
      const revoked = agent.oauthAppId ? await revokeAppTokens(tx, agent.oauthAppId) : 0;
      auditCreate(uow, actor, "AgentIdentity", agent.id, "agent.app_unbound", { revokedTokens: revoked, previousAppId: agent.oauthAppId });
      return { agentId: agent.id, revokedTokens: revoked, version: agent.version + 1 };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/domain/contact.ts
var import_node_crypto5 = require("node:crypto");
function normalisePhone(raw) {
  const digits = String(raw ?? "").replace(/[^\d+]/g, "");
  const plain2 = digits.replace(/\+/g, "");
  if (digits.startsWith("+") && /^\d{8,15}$/.test(plain2)) return `+${plain2}`;
  if (/^\d{10}$/.test(plain2)) return `+1${plain2}`;
  if (/^1\d{10}$/.test(plain2)) return `+${plain2}`;
  throw new DomainError(Codes.INVALID_INPUT, "Enter a phone number with area code.", { field: "phone" });
}
function normaliseEmail(raw) {
  const value = String(raw ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) || value.length > 254) throw new DomainError(Codes.INVALID_INPUT, "Enter a valid email address.", { field: "email" });
  return value;
}
var normaliseContact = (kind, raw) => kind === "email" ? normaliseEmail(raw) : normalisePhone(raw);
var contactHash = (normalised) => (0, import_node_crypto5.createHash)("sha256").update(`contact:${normalised}`).digest("hex");
function microchipStandard(number) {
  const n = String(number ?? "").replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{15}$/.test(n)) return "iso_11784";
  if (/^[0-9A-F]{9}$/.test(n)) return "avid_9";
  if (/^[0-9A-F]{10}$/.test(n)) return "avid_10";
  throw new DomainError(Codes.INVALID_INPUT, "A microchip number is 15 digits (ISO) or 9-10 characters (legacy).", { field: "microchip" });
}

// features/keystone/domain/triage.ts
var import_zod2 = require("zod");
var TRIAGE_LEVELS = ["routine", "soon", "urgent_today", "emergency_now"];
var rank = (level) => TRIAGE_LEVELS.indexOf(level);
var id = import_zod2.z.string().regex(/^[a-z][a-z0-9_]{1,60}$/);
var Question = import_zod2.z.object({ id, text: import_zod2.z.string().min(3), required: import_zod2.z.boolean().default(true) });
var RedFlag = import_zod2.z.object({
  id,
  label: import_zod2.z.string().min(3),
  /** Answer ids whose "yes" is this red flag. */
  whenYes: import_zod2.z.array(id).default([]),
  /** Complaint keywords (lower case) that are this red flag on their own: "rat poison", "can't breathe". */
  keywords: import_zod2.z.array(import_zod2.z.string().min(2)).default([])
});
var LevelRule = import_zod2.z.object({ level: import_zod2.z.enum(TRIAGE_LEVELS), whenYes: import_zod2.z.array(id).default([]), keywords: import_zod2.z.array(import_zod2.z.string().min(2)).default([]) });
var Scripts = import_zod2.z.object({ emergency_now: import_zod2.z.string().min(10), urgent_today: import_zod2.z.string().min(10), soon: import_zod2.z.string().min(10), routine: import_zod2.z.string().min(10) });
var TriageProtocolSchema = import_zod2.z.object({
  questions: import_zod2.z.array(Question).min(1),
  redFlags: import_zod2.z.array(RedFlag).min(1),
  levelRules: import_zod2.z.array(LevelRule),
  scripts: Scripts
});
function parseProtocol(input) {
  const parsed = TriageProtocolSchema.safeParse(input);
  if (!parsed.success) throw new DomainError(Codes.INVALID_INPUT, `The triage protocol is not valid: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`);
  const ids = new Set(parsed.data.questions.map((q) => q.id));
  for (const ref of [...parsed.data.redFlags.flatMap((f) => f.whenYes), ...parsed.data.levelRules.flatMap((r) => r.whenYes)]) {
    if (!ids.has(ref)) throw new DomainError(Codes.INVALID_INPUT, `The triage protocol refers to an unknown question ${ref}.`);
  }
  return parsed.data;
}
var protocolHash = (p) => payloadHash(p);
var normalise = (text17) => ` ${String(text17 ?? "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim()} `;
var mentions = (complaint, keyword) => complaint.includes(normalise(keyword));
function scoreTriage(protocol, input) {
  const complaint = normalise(input.complaint);
  const unanswered = protocol.questions.filter((q) => q.required && typeof input.answers[q.id] !== "boolean").map((q) => q.id);
  const yes = (qid) => input.answers[qid] === true || unanswered.includes(qid);
  const redFlagsHit = protocol.redFlags.filter((f) => f.whenYes.some(yes) || f.keywords.some((k) => mentions(complaint, k))).map((f) => f.id);
  if (redFlagsHit.length) {
    return { level: "emergency_now", redFlagsHit, reasons: redFlagsHit.map((fid) => protocol.redFlags.find((f) => f.id === fid).label), script: protocol.scripts.emergency_now, unanswered };
  }
  let level = "routine";
  const reasons = [];
  for (const rule2 of protocol.levelRules) {
    const hit = rule2.whenYes.some(yes) || rule2.keywords.some((k) => mentions(complaint, k));
    if (hit && rank(rule2.level) >= rank(level)) {
      if (rank(rule2.level) > rank(level)) reasons.length = 0;
      level = rule2.level;
      reasons.push(rule2.whenYes.filter(yes).concat(rule2.keywords.filter((k) => mentions(complaint, k))).join(", "));
    }
  }
  return { level, redFlagsHit: [], reasons, script: protocol.scripts[level], unanswered };
}
function assertNotDowngrade(previous, next) {
  if (previous && rank(next) < rank(previous)) throw new DomainError(Codes.GUARD_FAILED, `Triage can't be lowered from ${previous} to ${next}.`);
}
var outcomeAllowed = (level, outcome) => level === "emergency_now" ? outcome === "transferred" || outcome === "er_referred" : true;

// features/keystone/domain/scheduling.ts
var import_node_crypto6 = require("node:crypto");
var overlaps = (a, b) => a.start < b.end && b.start < a.end;
function subtract(free, busy) {
  let out = free.slice();
  for (const b of busy) {
    out = out.flatMap((f) => {
      if (!overlaps(f, b)) return [f];
      const parts = [];
      if (b.start > f.start) parts.push({ start: f.start, end: b.start });
      if (b.end < f.end) parts.push({ start: b.end, end: f.end });
      return parts;
    });
  }
  return out.sort((x, y) => x.start - y.start);
}
function workingIntervals(blocks, date, timeZone, category) {
  const weekday2 = (/* @__PURE__ */ new Date(`${date}T12:00:00Z`)).getUTCDay();
  const inEffect = (b) => (!b.effectiveFrom || b.effectiveFrom <= date) && (!b.effectiveTo || b.effectiveTo >= date);
  const allows = (b) => !category || !b.categories?.length || b.categories.includes(category);
  const toInterval = (b) => ({ start: zonedInstant(timeZone, date, b.startTime).getTime(), end: zonedInstant(timeZone, date, b.endTime).getTime() });
  const work = blocks.filter((b) => inEffect(b) && allows(b) && (b.kind === "recurring" && b.weekday === weekday2 || b.kind === "one_time" && b.localDate === date)).map(toInterval);
  const off = blocks.filter((b) => inEffect(b) && b.kind === "time_off" && b.localDate === date).map(toInterval);
  return subtract(work.filter((i) => i.end > i.start), off);
}
function findSlots(input) {
  const step = input.stepMinutes * 6e4;
  const length = input.minutes * 6e4;
  const out = [];
  const resources = [...input.resources].sort((a, b) => a.id.localeCompare(b.id));
  const providers = [...input.providers].sort((a, b) => a.id.localeCompare(b.id));
  const candidates = [];
  for (const p of providers) {
    const free = subtract(p.working, p.busy);
    for (const f of free) {
      const first = Math.max(f.start, Math.ceil(input.notBefore / step) * step);
      for (let t = Math.ceil(first / step) * step; t + length <= f.end; t += step) {
        const slot = { start: t, end: t + length };
        const room = resources.find((r) => !r.busy.some((b) => overlaps(b, slot)));
        if (room) candidates.push({ providerId: p.id, resourceId: room.id, ...slot });
      }
    }
  }
  candidates.sort((a, b) => a.start - b.start || a.providerId.localeCompare(b.providerId) || a.resourceId.localeCompare(b.resourceId));
  for (const c of candidates) {
    if (out.length >= input.limit) break;
    out.push(c);
  }
  return out;
}
function buildSegments(template, start, totalMinutes) {
  const list19 = template?.length ? template : [{ kind: "exam", offset: 0, minutes: totalMinutes }];
  return list19.map((s) => ({ kind: s.kind, startsAt: new Date(start + s.offset * 6e4), endsAt: new Date(start + (s.offset + s.minutes) * 6e4) }));
}
var SLOT_TTL_MS = 5 * 6e4;
var DEVELOPMENT_SECRET3 = "this secret should only be used in testing";
function key() {
  const secret2 = process.env.SESSION_SECRET;
  if (!secret2 && process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET is required to sign slot offers");
  return `slot-token:${secret2 || DEVELOPMENT_SECRET3}`;
}
function signSlot(claims, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...claims, exp: now + SLOT_TTL_MS })).toString("base64url");
  const mac = (0, import_node_crypto6.createHmac)("sha256", key()).update(body).digest("base64url");
  return `${body}.${mac}`;
}
function verifySlot(token, now = Date.now()) {
  const [body, mac] = String(token ?? "").split(".");
  if (!body || !mac) throw new DomainError(Codes.SLOT_TOKEN_INVALID, "That time slot is not valid. Search availability again.");
  const expected = (0, import_node_crypto6.createHmac)("sha256", key()).update(body).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !(0, import_node_crypto6.timingSafeEqual)(given, expected)) throw new DomainError(Codes.SLOT_TOKEN_INVALID, "That time slot is not valid. Search availability again.");
  const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!(claims.exp > now)) throw new DomainError(Codes.SLOT_TOKEN_INVALID, "That time slot offer has expired. Search availability again.");
  return claims;
}

// features/keystone/seed/clinicalData.ts
var REMINDER_TYPES = [
  { id: "seed_rt_rabies", code: "RABIES", name: "Rabies", kind: "vaccine" },
  { id: "seed_rt_dhpp", code: "DHPP", name: "Distemper / parvo (DHPP)", kind: "vaccine" },
  { id: "seed_rt_lepto", code: "LEPTO", name: "Leptospirosis", kind: "vaccine" },
  { id: "seed_rt_bord", code: "BORDETELLA", name: "Bordetella (kennel cough)", kind: "vaccine" },
  { id: "seed_rt_civ", code: "CIV", name: "Canine influenza", kind: "vaccine" },
  { id: "seed_rt_fvrcp", code: "FVRCP", name: "Feline distemper (FVRCP)", kind: "vaccine" },
  { id: "seed_rt_felv", code: "FELV", name: "Feline leukaemia (FeLV)", kind: "vaccine" },
  { id: "seed_rt_heartworm", code: "HW_TEST", name: "Heartworm test", kind: "test" },
  { id: "seed_rt_wellness", code: "WELLNESS", name: "Annual wellness exam", kind: "procedure" },
  { id: "seed_rt_dental", code: "DENTAL", name: "Dental check", kind: "procedure" }
];
var VACCINE_PRODUCTS = [
  { id: "seed_vx_rabies3_k9", name: "Rabies 3-year (canine/feline, killed)", manufacturer: "Zoetis", antigens: ["rabies"], species: ["canine", "feline"], doi: 36, minAgeWeeks: 12, isRabies: true, route: "sc", type: "seed_rt_rabies" },
  { id: "seed_vx_rabies1_fel", name: "Rabies 1-year (feline, recombinant)", manufacturer: "Boehringer Ingelheim", antigens: ["rabies"], species: ["feline"], doi: 12, minAgeWeeks: 12, isRabies: true, route: "sc", type: "seed_rt_rabies" },
  { id: "seed_vx_dapp", name: "DAPP (distemper, adenovirus-2, parvovirus, parainfluenza)", manufacturer: "Merck Animal Health", antigens: ["CDV", "CAV2", "CPV", "CPiV"], species: ["canine"], doi: 36, minAgeWeeks: 6, isRabies: false, route: "sc", type: "seed_rt_dhpp" },
  { id: "seed_vx_lepto4", name: "Leptospirosis 4-serovar", manufacturer: "Zoetis", antigens: ["L. canicola", "L. grippotyphosa", "L. icterohaemorrhagiae", "L. pomona"], species: ["canine"], doi: 12, minAgeWeeks: 8, isRabies: false, route: "sc", type: "seed_rt_lepto" },
  { id: "seed_vx_bord_in", name: "Bordetella intranasal", manufacturer: "Merck Animal Health", antigens: ["B. bronchiseptica", "CPiV"], species: ["canine"], doi: 12, minAgeWeeks: 8, isRabies: false, route: "intranasal", type: "seed_rt_bord" },
  { id: "seed_vx_civ", name: "Canine influenza bivalent (H3N2/H3N8)", manufacturer: "Merck Animal Health", antigens: ["H3N2", "H3N8"], species: ["canine"], doi: 12, minAgeWeeks: 8, isRabies: false, route: "sc", type: "seed_rt_civ" },
  { id: "seed_vx_fvrcp", name: "FVRCP (panleukopenia, herpesvirus-1, calicivirus)", manufacturer: "Boehringer Ingelheim", antigens: ["FPV", "FHV1", "FCV"], species: ["feline"], doi: 36, minAgeWeeks: 6, isRabies: false, route: "sc", type: "seed_rt_fvrcp" },
  { id: "seed_vx_felv", name: "FeLV (recombinant)", manufacturer: "Boehringer Ingelheim", antigens: ["FeLV"], species: ["feline"], doi: 12, minAgeWeeks: 8, isRabies: false, route: "transdermal", type: "seed_rt_felv" }
];
var VACCINE_LOTS = [
  { id: "seed_lot_rab_main", vaccine: "seed_vx_rabies3_k9", location: "seed_loc_main", lot: "RB3-2611A", expiresOn: "2027-08-31" },
  { id: "seed_lot_rab_eg", vaccine: "seed_vx_rabies3_k9", location: "seed_loc_elkgrove", lot: "RB3-2609C", expiresOn: "2027-06-30" },
  { id: "seed_lot_rabf_main", vaccine: "seed_vx_rabies1_fel", location: "seed_loc_main", lot: "PRF-25418", expiresOn: "2027-03-31" },
  { id: "seed_lot_dapp_main", vaccine: "seed_vx_dapp", location: "seed_loc_main", lot: "NB-77310", expiresOn: "2027-11-30" },
  { id: "seed_lot_dapp_old", vaccine: "seed_vx_dapp", location: "seed_loc_main", lot: "NB-70142", expiresOn: "2026-10-31" },
  { id: "seed_lot_dapp_eg", vaccine: "seed_vx_dapp", location: "seed_loc_elkgrove", lot: "NB-77294", expiresOn: "2027-10-31" },
  { id: "seed_lot_lepto_main", vaccine: "seed_vx_lepto4", location: "seed_loc_main", lot: "L4-60918", expiresOn: "2027-05-31" },
  { id: "seed_lot_bord_main", vaccine: "seed_vx_bord_in", location: "seed_loc_main", lot: "BIN-3305", expiresOn: "2027-02-28" },
  { id: "seed_lot_civ_main", vaccine: "seed_vx_civ", location: "seed_loc_main", lot: "CIV-2214", expiresOn: "2027-04-30" },
  { id: "seed_lot_fvrcp_main", vaccine: "seed_vx_fvrcp", location: "seed_loc_main", lot: "PF-48820", expiresOn: "2027-09-30" },
  { id: "seed_lot_felv_main", vaccine: "seed_vx_felv", location: "seed_loc_main", lot: "PL-10377", expiresOn: "2027-07-31" }
];
var DRUG_LOTS = [
  { id: "seed_lot_carprofen_main", drug: "seed_drug_carprofen", location: "seed_loc_main", lot: "CP-55102", expiresOn: "2027-12-31" },
  { id: "seed_lot_gabapentin_main", drug: "seed_drug_gabapentin", location: "seed_loc_main", lot: "GB-90311", expiresOn: "2028-01-31" },
  { id: "seed_lot_meloxicam_main", drug: "seed_drug_meloxicam", location: "seed_loc_main", lot: "MX-31877", expiresOn: "2027-06-30" },
  { id: "seed_lot_cefovecin_main", drug: "seed_drug_cefovecin", location: "seed_loc_main", lot: "CV-40219", expiresOn: "2027-03-31" },
  { id: "seed_lot_maropitant_main", drug: "seed_drug_maropitant", location: "seed_loc_main", lot: "MP-12088", expiresOn: "2027-08-31" },
  { id: "seed_lot_lrs_main", drug: "seed_drug_lrs", location: "seed_loc_main", lot: "LR-77015", expiresOn: "2028-04-30" }
];
var CLINICAL_DRUGS = [
  { id: "seed_drug_meloxicam", displayName: "Meloxicam 5 mg/mL injection", genericName: "meloxicam", brandName: "Metacam", form: "injectable", strength: "5", strengthUnit: "mg", per: "mL", concentration: "5", concentrationUnit: "mg/mL", packageQty: "20", packageUnit: "mL", approvalStatus: "fda_approved", multiDoseBudDays: 28, ndc: "0010-6013-01" },
  { id: "seed_drug_cefovecin", displayName: "Cefovecin 80 mg/mL injection", genericName: "cefovecin", brandName: "Convenia", form: "injectable", strength: "80", strengthUnit: "mg", per: "mL", concentration: "80", concentrationUnit: "mg/mL", packageQty: "10", packageUnit: "mL", approvalStatus: "fda_approved", multiDoseBudDays: 28, ndc: "54771-5850-1" },
  { id: "seed_drug_maropitant", displayName: "Maropitant 10 mg/mL injection", genericName: "maropitant", brandName: "Cerenia", form: "injectable", strength: "10", strengthUnit: "mg", per: "mL", concentration: "10", concentrationUnit: "mg/mL", packageQty: "20", packageUnit: "mL", approvalStatus: "fda_approved", multiDoseBudDays: 90, ndc: "54771-5640-1" },
  { id: "seed_drug_lrs", displayName: "Lactated Ringer's solution 1 L", genericName: "lactated Ringer's", brandName: "", form: "injectable", strength: null, strengthUnit: "", per: "mL", concentration: null, concentrationUnit: "", packageQty: "1000", packageUnit: "mL", approvalStatus: "human_label", multiDoseBudDays: null, ndc: "0338-0117-04" }
];
var mgkg = (min, max) => ({ min, max, unit: "mg", per: "kg" });
var DOSE_FORMULARY = {
  seed_drug_meloxicam: { doseRanges: { canine: mgkg("0.1", "0.2"), feline: mgkg("0.05", "0.3") }, measurableIncrement: "0.01" },
  seed_drug_cefovecin: { doseRanges: { canine: mgkg("8", "8"), feline: mgkg("8", "8") }, measurableIncrement: "0.01" },
  seed_drug_maropitant: { doseRanges: { canine: mgkg("1", "1"), feline: mgkg("1", "1") }, measurableIncrement: "0.01" },
  seed_drug_carprofen: { doseRanges: { canine: mgkg("2", "4.4") }, measurableIncrement: "0.25" },
  seed_drug_gabapentin: { doseRanges: { canine: mgkg("5", "20"), feline: mgkg("5", "20") }, measurableIncrement: "1" },
  seed_drug_butorphanol: { doseRanges: { canine: mgkg("0.2", "0.4"), feline: mgkg("0.2", "0.4") }, cautionFlags: ["MDR1_risk"], measurableIncrement: "0.01" },
  seed_drug_buprenorphine: { doseRanges: { canine: mgkg("0.01", "0.02"), feline: mgkg("0.01", "0.03") }, measurableIncrement: "0.01" },
  seed_drug_hydromorphone: { doseRanges: { canine: mgkg("0.05", "0.1"), feline: mgkg("0.025", "0.05") }, measurableIncrement: "0.01" },
  seed_drug_midazolam: { doseRanges: { canine: mgkg("0.1", "0.3"), feline: mgkg("0.1", "0.3") }, measurableIncrement: "0.01" },
  seed_drug_ketamine: { doseRanges: { canine: mgkg("2", "5"), feline: mgkg("2", "5") }, measurableIncrement: "0.01" }
};
var MDR1_BREEDS = ["Border Collie", "Rough Collie", "Australian Shepherd"];
var REMINDER_PROTOCOLS = [
  {
    id: "seed_rp_canine",
    code: "CANINE_CORE",
    name: "Canine wellness and vaccines",
    species: "canine",
    rules: [
      { code: "RABIES", satisfies: "seed_rt_rabies", vaccines: ["seed_vx_rabies3_k9"], schedule: { boosterAfterFirstMonths: 12 }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: "DHPP", satisfies: "seed_rt_dhpp", vaccines: ["seed_vx_dapp"], schedule: { initialSeries: { doses: 4, intervalWeeks: 3, untilAgeWeeks: 16 } }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: "LEPTO", satisfies: "seed_rt_lepto", vaccines: ["seed_vx_lepto4"], schedule: { initialSeries: { doses: 2, intervalWeeks: 3, untilAgeWeeks: 52 } }, leadDays: 30, graceDays: 30, lapseDays: 180 },
      { code: "BORDETELLA", satisfies: "seed_rt_bord", vaccines: ["seed_vx_bord_in"], schedule: {}, leadDays: 21, graceDays: 14, lapseDays: 180 },
      { code: "CIV", satisfies: "seed_rt_civ", vaccines: ["seed_vx_civ"], schedule: { initialSeries: { doses: 2, intervalWeeks: 3, untilAgeWeeks: 520 } }, leadDays: 21, graceDays: 14, lapseDays: 180 }
    ],
    sourceRefs: [{ ref: "S37", title: "NASPHV Compendium of Animal Rabies Prevention and Control", url: "https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5603a1.htm" }, { ref: "AAHA-C", title: "AAHA Canine Vaccination Guidelines (practice to verify current edition)" }],
    unverified: ["DHPP", "LEPTO", "BORDETELLA", "CIV"]
  },
  {
    id: "seed_rp_feline",
    code: "FELINE_CORE",
    name: "Feline wellness and vaccines",
    species: "feline",
    rules: [
      { code: "RABIES", satisfies: "seed_rt_rabies", vaccines: ["seed_vx_rabies3_k9", "seed_vx_rabies1_fel"], schedule: { boosterAfterFirstMonths: 12 }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: "FVRCP", satisfies: "seed_rt_fvrcp", vaccines: ["seed_vx_fvrcp"], schedule: { initialSeries: { doses: 3, intervalWeeks: 4, untilAgeWeeks: 16 } }, leadDays: 30, graceDays: 30, lapseDays: 365 },
      { code: "FELV", satisfies: "seed_rt_felv", vaccines: ["seed_vx_felv"], schedule: { initialSeries: { doses: 2, intervalWeeks: 4, untilAgeWeeks: 52 } }, leadDays: 30, graceDays: 30, lapseDays: 180 }
    ],
    sourceRefs: [{ ref: "S37", title: "NASPHV Compendium of Animal Rabies Prevention and Control", url: "https://www.cdc.gov/mmwr/preview/mmwrhtml/rr5603a1.htm" }, { ref: "AAHA-F", title: "AAHA/AAFP Feline Vaccination Guidelines (practice to verify current edition)" }],
    unverified: ["FVRCP", "FELV"]
  }
];
var WARDS = [
  { id: "seed_ward_main_gen", location: "seed_loc_main", name: "Main ward", kind: "general", cages: [["MW-01", "small"], ["MW-02", "small"], ["MW-03", "medium"], ["MW-04", "medium"], ["MW-05", "large"], ["MW-06", "run"]] },
  { id: "seed_ward_main_icu", location: "seed_loc_main", name: "ICU", kind: "icu", cages: [["ICU-1", "medium"], ["ICU-2", "large"]] },
  { id: "seed_ward_main_iso", location: "seed_loc_main", name: "Isolation", kind: "isolation", cages: [["ISO-1", "large"]] },
  { id: "seed_ward_main_cat", location: "seed_loc_main", name: "Cat ward", kind: "general", cages: [["CW-01", "small"], ["CW-02", "small"], ["CW-03", "small"]] },
  { id: "seed_ward_eg_gen", location: "seed_loc_elkgrove", name: "Elk Grove ward", kind: "general", cages: [["EG-01", "small"], ["EG-02", "medium"], ["EG-03", "large"]] }
];
var DIAGNOSIS_CODES = [
  ["P-0001", "Otitis externa", ["canine", "feline"]],
  ["P-0002", "Acute gastroenteritis", ["canine", "feline"]],
  ["P-0003", "Periodontal disease", ["canine", "feline"]],
  ["P-0004", "Atopic dermatitis", ["canine"]],
  ["P-0005", "Cranial cruciate ligament rupture", ["canine"]],
  ["P-0006", "Osteoarthritis", ["canine", "feline"]],
  ["P-0007", "Chronic kidney disease", ["feline", "canine"]],
  ["P-0008", "Hyperthyroidism", ["feline"]],
  ["P-0009", "Diabetes mellitus", ["canine", "feline"]],
  ["P-0010", "Feline lower urinary tract disease", ["feline"]],
  ["P-0011", "Pyoderma", ["canine"]],
  ["P-0012", "Dental fracture", ["canine", "feline"]],
  ["P-0013", "Healthy, wellness visit", ["canine", "feline", "rabbit", "ferret"]],
  ["P-0014", "Laceration", ["canine", "feline"]],
  ["P-0015", "Foreign body ingestion", ["canine", "feline"]],
  ["P-0016", "Pancreatitis", ["canine", "feline"]],
  ["P-0017", "Hypothyroidism", ["canine"]],
  ["P-0018", "Mitral valve disease", ["canine"]],
  ["P-0019", "Upper respiratory infection", ["feline", "rabbit"]],
  ["P-0020", "Gastrointestinal stasis", ["rabbit"]]
];
var RECORD_TEMPLATES = [
  { id: "seed_tpl_wellness_obj", name: "Wellness exam (normal)", kind: "wellness", sectionKind: "objective", body: "Bright, alert and responsive. Hydration normal. MM pink, CRT < 2 s. Heart: no murmur or arrhythmia. Lungs clear bilaterally. Abdomen soft, non-painful, no masses. Lymph nodes normal. Skin and coat healthy. Eyes, ears and nose clear. Musculoskeletal normal gait. Teeth: grade 1 tartar." },
  { id: "seed_tpl_wellness_plan", name: "Wellness plan", kind: "wellness", sectionKind: "plan", body: "Vaccines per protocol today. Continue monthly heartworm, flea and tick prevention. Dental home care discussed. Recheck in 12 months or sooner if concerns." },
  { id: "seed_tpl_sick_hx", name: "Sick visit history", kind: "sick", sectionKind: "history", body: "Presenting complaint:\nDuration:\nAppetite / water intake:\nVomiting / diarrhoea:\nUrination:\nEnergy:\nMedications and diet:\nToxin exposure:" },
  { id: "seed_tpl_discharge_dental", name: "Dental discharge", kind: "discharge", sectionKind: "discharge", body: "Soft food only for 3 days. No chew toys for 7 days. Give pain medication as labelled with food. Call us if you see facial swelling, bleeding that does not stop, or refusal to eat for more than 24 hours." }
];
var GLOSSARY = [
  ["BAR", "bright, alert, responsive"],
  ["QAR", "quiet, alert, responsive"],
  ["MM", "mucous membranes"],
  ["CRT", "capillary refill time"],
  ["BCS", "body condition score"],
  ["NSF", "no significant findings"],
  ["WNL", "within normal limits"],
  ["V/D", "vomiting and diarrhoea"],
  ["PU/PD", "polyuria and polydipsia"],
  ["TPR", "temperature, pulse, respiration"],
  ["SID", "once daily"],
  ["BID", "twice daily"],
  ["TID", "three times daily"],
  ["PRN", "as needed"],
  ["SQ", "subcutaneous"],
  ["CCL", "cranial cruciate ligament"]
];

// features/keystone/seed/clinical.ts
var DAY2 = (d) => /* @__PURE__ */ new Date(`${d}T00:00:00Z`);
var meta2 = { metadata: { seed: true } };
async function seedClinical(uow, actor, count) {
  const { tx, now } = uow;
  const species = new Map((await tx.species.findMany({ select: { id: true, code: true } })).map((s) => [s.code, s.id]));
  const haveDrugs = new Set((await tx.drugProduct.findMany({ where: { id: { in: CLINICAL_DRUGS.map((d) => d.id) } }, select: { id: true } })).map((d) => d.id));
  const newDrugs = CLINICAL_DRUGS.filter((d) => !haveDrugs.has(d.id));
  if (newDrugs.length) {
    await tx.drugProduct.createMany({ data: newDrugs.map((d) => ({ ...d, csSchedule: "none", isHumanLabel: d.approvalStatus === "human_label", requiresWitnessOnAdminister: false, active: true })) });
    count("drugProducts", newDrugs.length);
  }
  const needsRanges = (await tx.drugProduct.findMany({ where: { id: { in: Object.keys(DOSE_FORMULARY) } }, select: { id: true, doseRanges: true } })).filter((d) => d.doseRanges == null);
  for (const d of needsRanges) {
    const f = DOSE_FORMULARY[d.id];
    await tx.drugProduct.update({ where: { id: d.id }, data: { doseRanges: f.doseRanges, cautionFlags: f.cautionFlags ?? [], measurableIncrement: f.measurableIncrement ?? null } });
  }
  if (needsRanges.length) {
    auditCreate(uow, actor, "DrugProduct", "seed_formulary", "formulary.dose_ranges_loaded", { drugs: needsRanges.map((d) => d.id), verified: false }, meta2);
    count("doseRanges", needsRanges.length);
  }
  const mdr1 = await tx.breed.findMany({ where: { name: { in: MDR1_BREEDS }, speciesId: species.get("canine") }, select: { id: true, geneticFlags: true } });
  for (const b of mdr1.filter((b2) => !b2.geneticFlags?.MDR1_risk)) {
    await tx.breed.update({ where: { id: b.id }, data: { geneticFlags: { ...b.geneticFlags ?? {}, MDR1_risk: true } } });
  }
  const haveDrugLots = new Set((await tx.inventoryLot.findMany({ where: { id: { in: DRUG_LOTS.map((l) => l.id) } }, select: { id: true } })).map((l) => l.id));
  const newDrugLots = DRUG_LOTS.filter((l) => !haveDrugLots.has(l.id));
  if (newDrugLots.length) {
    await tx.inventoryLot.createMany({ data: newDrugLots.map((l) => ({ id: l.id, drugId: l.drug, locationId: l.location, lotNumber: l.lot, expiresOn: DAY2(l.expiresOn), status: "available" })) });
    count("drugLots", newDrugLots.length);
  }
  const haveTypes = new Set((await tx.reminderType.findMany({ where: { id: { in: REMINDER_TYPES.map((t) => t.id) } }, select: { id: true } })).map((t) => t.id));
  const newTypes = REMINDER_TYPES.filter((t) => !haveTypes.has(t.id));
  if (newTypes.length) {
    await tx.reminderType.createMany({ data: newTypes.map((t) => ({ ...t, active: true })) });
    count("reminderTypes", newTypes.length);
  }
  const haveVx = new Set((await tx.vaccineProduct.findMany({ where: { id: { in: VACCINE_PRODUCTS.map((v) => v.id) } }, select: { id: true } })).map((v) => v.id));
  for (const v of VACCINE_PRODUCTS.filter((v2) => !haveVx.has(v2.id))) {
    await tx.vaccineProduct.create({ data: { id: v.id, name: v.name, manufacturer: v.manufacturer, antigens: [...v.antigens], licensedDoiMonths: v.doi, minAgeWeeks: v.minAgeWeeks, isRabies: v.isRabies, usdaProductCode: "", defaultRoute: v.route, reminderTypeId: v.type, active: true, species: { connect: v.species.map((code) => ({ id: species.get(code) })) } } });
    auditCreate(uow, actor, "VaccineProduct", v.id, "vaccine_product.created", { name: v.name, doiMonths: v.doi, isRabies: v.isRabies }, meta2);
    count("vaccineProducts", 1);
  }
  const haveVxLots = new Set((await tx.inventoryLot.findMany({ where: { id: { in: VACCINE_LOTS.map((l) => l.id) } }, select: { id: true } })).map((l) => l.id));
  const newVxLots = VACCINE_LOTS.filter((l) => !haveVxLots.has(l.id));
  if (newVxLots.length) {
    await tx.inventoryLot.createMany({ data: newVxLots.map((l) => ({ id: l.id, vaccineId: l.vaccine, locationId: l.location, lotNumber: l.lot, expiresOn: DAY2(l.expiresOn), status: "available" })) });
    count("vaccineLots", newVxLots.length);
  }
  for (const p of REMINDER_PROTOCOLS) {
    if (await tx.reminderProtocol.findUnique({ where: { id: p.id }, select: { id: true } })) continue;
    await tx.reminderProtocol.create({ data: { id: p.id, code: p.code, name: p.name, speciesId: species.get(p.species) ?? null } });
    const content = p.rules.map((r) => ({ code: r.code, satisfies: r.satisfies, vaccines: [...r.vaccines], schedule: r.schedule, leadDays: r.leadDays, graceDays: r.graceDays, lapseDays: r.lapseDays }));
    const versionId = `${p.id}_v1`;
    await tx.reminderProtocolVersion.create({ data: { id: versionId, protocolId: p.id, label: "v1 (Cedar Creek, pending medical-director review)", versionNumber: 1, sourceRefs: toJsonValue(p.sourceRefs), verified: false, unverifiedRules: [...p.unverified], status: "draft", contentHash: sha256(canonicalJson(content)) } });
    for (const r of p.rules) {
      await tx.reminderRule.create({ data: { id: `${versionId}_${r.code.toLowerCase()}`, protocolVersionId: versionId, code: r.code, satisfiesId: r.satisfies, schedule: toJsonValue(r.schedule), leadDays: r.leadDays, graceDays: r.graceDays, lapseDays: r.lapseDays, triggerVaccines: { connect: r.vaccines.map((id2) => ({ id: id2 })) } } });
    }
    await tx.reminderProtocolVersion.update({ where: { id: versionId }, data: { status: "published", publishedAt: now, version: { increment: 1 } } });
    auditCreate(uow, actor, "ReminderProtocolVersion", versionId, "reminder_protocol.published", { code: p.code, rules: p.rules.length, verified: false, unverified: p.unverified }, meta2);
    count("reminderProtocols", 1);
  }
  for (const w of WARDS) {
    if (await tx.ward.findUnique({ where: { id: w.id }, select: { id: true } })) continue;
    await tx.ward.create({ data: { id: w.id, locationId: w.location, name: w.name, kind: w.kind } });
    await tx.cage.createMany({ data: w.cages.map(([code, size]) => ({ id: `seed_cage_${code.toLowerCase().replace(/[^a-z0-9]/g, "")}`, wardId: w.id, code, size, features: {}, active: true })) });
    count("cages", w.cages.length);
  }
  const haveCodes = new Set((await tx.diagnosisCode.findMany({ where: { codeSystem: "practice" }, select: { code: true } })).map((c) => c.code));
  for (const [code, term, sp] of DIAGNOSIS_CODES.filter(([code2]) => !haveCodes.has(code2))) {
    await tx.diagnosisCode.create({ data: { codeSystem: "practice", code, term, active: true, species: { connect: sp.map((s) => species.get(s)).filter((id2) => !!id2).map((id2) => ({ id: id2 })) } } });
    count("diagnosisCodes", 1);
  }
  const haveTpl = new Set((await tx.recordTemplate.findMany({ where: { id: { in: RECORD_TEMPLATES.map((t) => t.id) } }, select: { id: true } })).map((t) => t.id));
  const newTpl = RECORD_TEMPLATES.filter((t) => !haveTpl.has(t.id));
  if (newTpl.length) {
    await tx.recordTemplate.createMany({ data: newTpl.map((t) => ({ ...t, templateVersion: 1, active: true })) });
    count("recordTemplates", newTpl.length);
  }
  const haveGloss = new Set((await tx.glossary.findMany({ select: { term: true } })).map((g) => g.term));
  const newGloss = GLOSSARY.filter(([term]) => !haveGloss.has(term));
  if (newGloss.length) {
    await tx.glossary.createMany({ data: newGloss.map(([term, expansion]) => ({ term, expansion })) });
    count("glossary", newGloss.length);
  }
}

// features/keystone/seed/inventory.ts
var PLACES = [
  { id: "seed_stock_main_pharmacy", name: "Pharmacy shelf", kind: "shelf", min: null, max: null },
  { id: "seed_stock_main_fridge", name: "Vaccine fridge", kind: "fridge", min: "2", max: "8" },
  { id: "seed_stock_main_treatment", name: "Treatment room cabinet", kind: "cabinet", min: null, max: null }
];
var OPENING = {
  seed_lot_carprofen_main: 240,
  seed_lot_gabapentin_main: 180,
  seed_lot_meloxicam_main: 120,
  seed_lot_cefovecin_main: 24,
  seed_lot_maropitant_main: 40,
  seed_lot_lrs_main: 12,
  seed_lot_dapp_main: 60,
  seed_lot_dapp_old: 8,
  seed_lot_lepto_main: 40,
  seed_lot_bord_main: 30,
  seed_lot_civ_main: 20,
  seed_lot_fvrcp_main: 36,
  seed_lot_felv_main: 18
};
var SUPPLIERS = [
  { id: "seed_sup_covetrus", name: "Covetrus", accountNumber: "CC-204118", phone: "800-555-0143", email: "orders@covetrus.example.com" },
  { id: "seed_sup_patterson", name: "Patterson Veterinary", accountNumber: "PV-77302", phone: "800-555-0187", email: "sales@pattersonvet.example.com" }
];
async function seedInventory(uow, actor, count) {
  const { tx, now } = uow;
  if (await tx.stockLocation.findUnique({ where: { id: PLACES[0].id }, select: { id: true } })) return;
  const staff = await tx.staffMember.findUnique({ where: { id: "seed_staff_lopez" }, select: { id: true } });
  await tx.stockLocation.createMany({ data: PLACES.map((p) => ({ id: p.id, name: p.name, locationId: "seed_loc_main", kind: p.kind, minTempC: p.min, maxTempC: p.max, active: true })) });
  count("stockLocations", PLACES.length);
  await tx.supplier.createMany({ data: SUPPLIERS.map((s) => ({ ...s, active: true })) });
  count("suppliers", SUPPLIERS.length);
  const lots = [...DRUG_LOTS.map((l) => ({ id: l.id, drugId: l.drug, vaccineId: null })), ...VACCINE_LOTS.filter((l) => l.location === "seed_loc_main").map((l) => ({ id: l.id, drugId: null, vaccineId: l.vaccine }))];
  const itemFor = /* @__PURE__ */ new Map();
  for (const l of lots) {
    const key2 = l.drugId ?? l.vaccineId;
    if (itemFor.has(key2)) continue;
    const name = l.drugId ? (await tx.drugProduct.findUniqueOrThrow({ where: { id: l.drugId }, select: { displayName: true } })).displayName : (await tx.vaccineProduct.findUniqueOrThrow({ where: { id: l.vaccineId }, select: { name: true } })).name;
    const item = await tx.item.create({ data: { ref: await nextReference(tx, "ITM", now), name, kind: l.drugId ? "drug" : "vaccine", drugId: l.drugId, vaccineId: l.vaccineId, baseUnit: l.drugId ? "unit" : "dose", coldChain: !!l.vaccineId, active: true } });
    itemFor.set(key2, item.id);
  }
  count("items", itemFor.size);
  let moves = 0;
  for (const l of lots) {
    const qty2 = OPENING[l.id];
    if (!qty2) continue;
    const itemId = itemFor.get(l.drugId ?? l.vaccineId);
    await tx.stockMovement.create({ data: { itemId, lotId: l.id, stockLocationId: l.vaccineId ? "seed_stock_main_fridge" : l.id === "seed_lot_lrs_main" ? "seed_stock_main_treatment" : "seed_stock_main_pharmacy", kind: "receive", qtySigned: String(qty2), unit: l.drugId ? "unit" : "dose", sourceType: "opening_stock", sourceId: l.id, reason: "Opening stock", actorId: staff?.id ?? null, occurredAt: now } });
    moves += 1;
  }
  count("stockMovements", moves);
  const rule2 = (drug, min, target) => ({ itemId: itemFor.get(drug), locationId: "seed_loc_main", minQty: String(min), targetQty: String(target) });
  await tx.reorderRule.createMany({ data: [rule2("seed_drug_carprofen", 100, 300), rule2("seed_drug_gabapentin", 60, 200), rule2("seed_drug_cefovecin", 30, 60), rule2("seed_drug_lrs", 12, 24), rule2("seed_vx_dapp", 20, 80)] });
  count("reorderRules", 5);
  const po = await tx.purchaseOrder.create({ data: { ref: await nextReference(tx, "PO", now), supplierId: "seed_sup_covetrus", locationId: "seed_loc_main", status: "draft", orderedById: staff?.id ?? null, note: "Weekly pharmacy top-up", lines: { create: [{ itemId: itemFor.get("seed_drug_cefovecin"), qtyOrdered: "36", qtyReceived: "0", unit: "unit", unitCostMinor: 8450n }, { itemId: itemFor.get("seed_drug_lrs"), qtyOrdered: "12", qtyReceived: "0", unit: "unit", unitCostMinor: 1275n }] } } });
  auditCreate(uow, actor, "PurchaseOrder", po.id, "po.drafted", { ref: po.ref, lines: 2 });
  count("purchaseOrders", 1);
}

// features/keystone/seed/clinicData.ts
var SPECIES = [
  { id: "seed_sp_canine", code: "canine", name: "Dog", module: "companion", defaultWeightUnit: "lb", breeds: ["Labrador Retriever", "Golden Retriever", "German Shepherd", "French Bulldog", "Border Collie", "Rough Collie", "Australian Shepherd", "Dachshund", "Beagle", "Boxer", "Chihuahua", "Pit Bull Terrier", "Siberian Husky", "Poodle (Standard)", "Poodle (Miniature)", "Shih Tzu", "Yorkshire Terrier", "Cavalier King Charles Spaniel", "Great Dane", "Mixed Breed"] },
  { id: "seed_sp_feline", code: "feline", name: "Cat", module: "companion", defaultWeightUnit: "lb", breeds: ["Domestic Shorthair", "Domestic Longhair", "Maine Coon", "Siamese", "Ragdoll", "Bengal", "Persian", "British Shorthair", "Sphynx"] },
  { id: "seed_sp_rabbit", code: "rabbit", name: "Rabbit", module: "companion", defaultWeightUnit: "kg", breeds: ["Holland Lop", "Netherland Dwarf", "Mini Rex", "Mixed"] },
  { id: "seed_sp_ferret", code: "ferret", name: "Ferret", module: "companion", defaultWeightUnit: "g", breeds: ["Standard"] },
  { id: "seed_sp_reptile", code: "bearded_dragon", name: "Bearded dragon", module: "companion", defaultWeightUnit: "g", breeds: ["Central Bearded Dragon"] },
  { id: "seed_sp_avian", code: "cockatiel", name: "Cockatiel", module: "companion", defaultWeightUnit: "g", breeds: ["Normal Grey", "Lutino"] }
];
var COLOURS = {
  canine: ["Black", "Yellow", "Chocolate", "Brindle", "Tricolour", "Sable", "White", "Merle", "Red"],
  feline: ["Black", "Grey tabby", "Orange tabby", "Calico", "Tortoiseshell", "Tuxedo", "Seal point", "White"]
};
var REFERRAL_HOSPITALS = [
  { id: "seed_er_river", name: "River City Veterinary Emergency (24 h)", kind: "emergency", phone: "+19165550190", email: "er@rivercityvetemergency.com", addressLine1: "2200 Riverside Blvd", city: "Sacramento", stateCode: "US-CA", lat: "38.553100", lng: "-121.507800", open24h: true },
  { id: "seed_er_south", name: "South Valley Animal Emergency (24 h)", kind: "emergency", phone: "+19165550191", email: "triage@southvalleyanimaler.com", addressLine1: "8800 Calvine Rd", city: "Elk Grove", stateCode: "US-CA", lat: "38.464000", lng: "-121.390500", open24h: true },
  { id: "seed_ref_specialty", name: "Capitol Veterinary Specialists", kind: "specialty", phone: "+19165550192", email: "referrals@capitolvetspecialists.com", addressLine1: "1500 Expo Pkwy", city: "Sacramento", stateCode: "US-CA", lat: "38.594400", lng: "-121.433900", open24h: false }
];
var RESOURCES = [
  ...[1, 2, 3, 4].map((n) => ({ id: `seed_res_main_exam${n}`, locationId: "seed_loc_main", kind: "exam_room", name: `Exam ${n}`, sortOrder: n })),
  { id: "seed_res_main_surgery", locationId: "seed_loc_main", kind: "surgery_suite", name: "Surgery suite", sortOrder: 10 },
  { id: "seed_res_main_dental", locationId: "seed_loc_main", kind: "dental_table", name: "Dental table", sortOrder: 11 },
  { id: "seed_res_main_treat", locationId: "seed_loc_main", kind: "treatment_table", name: "Treatment table", sortOrder: 12 },
  { id: "seed_res_main_xray", locationId: "seed_loc_main", kind: "radiography", name: "Digital radiography", sortOrder: 13 },
  { id: "seed_res_main_us", locationId: "seed_loc_main", kind: "ultrasound", name: "Ultrasound", sortOrder: 14 },
  { id: "seed_res_main_groom", locationId: "seed_loc_main", kind: "grooming_table", name: "Grooming table", sortOrder: 20 },
  { id: "seed_res_eg_examA", locationId: "seed_loc_elkgrove", kind: "exam_room", name: "Exam A", sortOrder: 1 },
  { id: "seed_res_eg_examB", locationId: "seed_loc_elkgrove", kind: "exam_room", name: "Exam B", sortOrder: 2 }
];
var APPOINTMENT_TYPES = [
  { id: "seed_at_wellness", code: "wellness_exam", name: "Wellness exam", category: "wellness", durationMinutes: 30, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: true, colour: "#16a34a", providerKinds: ["dvm"], requiredResourceKinds: ["exam_room"] },
  { id: "seed_at_new_client", code: "new_client_exam", name: "New client exam", category: "wellness", durationMinutes: 40, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: true, vcprQualifying: true, colour: "#0d9488", providerKinds: ["dvm"], requiredResourceKinds: ["exam_room"] },
  { id: "seed_at_vaccine", code: "vaccine_visit", name: "Vaccine visit (exam within 12 months)", category: "vaccine_only", durationMinutes: 20, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: "#2563eb", providerKinds: ["dvm"], requiredResourceKinds: ["exam_room"] },
  { id: "seed_at_sick", code: "sick_exam", name: "Sick pet exam", category: "sick", durationMinutes: 30, aiBookable: true, portalBookable: false, requestOnly: false, newClientAllowed: true, vcprQualifying: true, colour: "#dc2626", providerKinds: ["dvm"], requiredResourceKinds: ["exam_room"] },
  { id: "seed_at_recheck", code: "recheck", name: "Recheck", category: "recheck", durationMinutes: 20, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: true, colour: "#f59e0b", providerKinds: ["dvm"], requiredResourceKinds: ["exam_room"] },
  { id: "seed_at_tech", code: "tech_appointment", name: "Technician appointment (nails, anal glands, injections)", category: "tech", durationMinutes: 15, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: "#7c3aed", providerKinds: ["rvt"], requiredResourceKinds: ["treatment_table"] },
  {
    id: "seed_at_dental",
    code: "dental_cleaning",
    name: "Dental cleaning under anaesthesia (COHAT)",
    category: "dental",
    durationMinutes: 540,
    aiBookable: false,
    portalBookable: false,
    requestOnly: true,
    newClientAllowed: false,
    vcprQualifying: true,
    colour: "#0891b2",
    providerKinds: ["dvm"],
    requiredResourceKinds: ["dental_table"],
    depositRequired: "estimate",
    segments: [{ kind: "drop_off", offset: 0, minutes: 30 }, { kind: "anaesthesia", offset: 60, minutes: 120, resourceKind: "dental_table" }, { kind: "recovery", offset: 180, minutes: 180 }, { kind: "pickup", offset: 510, minutes: 30 }]
  },
  {
    id: "seed_at_spay",
    code: "spay_neuter",
    name: "Spay / neuter",
    category: "surgery",
    durationMinutes: 540,
    aiBookable: false,
    portalBookable: false,
    requestOnly: true,
    newClientAllowed: false,
    vcprQualifying: true,
    colour: "#be123c",
    providerKinds: ["dvm"],
    requiredResourceKinds: ["surgery_suite"],
    depositRequired: "fixed",
    depositMinor: 10000n,
    segments: [{ kind: "drop_off", offset: 0, minutes: 30 }, { kind: "procedure", offset: 60, minutes: 90, resourceKind: "surgery_suite" }, { kind: "recovery", offset: 150, minutes: 210 }, { kind: "pickup", offset: 510, minutes: 30 }]
  },
  { id: "seed_at_euthanasia", code: "euthanasia", name: "Euthanasia (quiet room)", category: "euthanasia", durationMinutes: 60, aiBookable: false, portalBookable: false, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: "#475569", providerKinds: ["dvm"], requiredResourceKinds: ["exam_room"] },
  { id: "seed_at_groom", code: "groom_full", name: "Full groom", category: "grooming", durationMinutes: 120, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: "#db2777", providerKinds: ["groomer"], requiredResourceKinds: ["grooming_table"], species: ["canine"] }
];
var SCHEDULES = [
  { staffId: "seed_staff_marsh", locationId: "seed_loc_main", days: [1, 2, 3, 4], start: "08:00", end: "17:30" },
  { staffId: "seed_staff_marsh", locationId: "seed_loc_main", days: [6], start: "08:00", end: "13:30" },
  { staffId: "seed_staff_marsh", locationId: "seed_loc_elkgrove", days: [5], start: "09:00", end: "16:30" },
  { staffId: "seed_staff_okafor", locationId: "seed_loc_main", days: [1, 2, 3, 4, 5], start: "08:00", end: "17:30" },
  { staffId: "seed_staff_desai", locationId: "seed_loc_elkgrove", days: [1, 2, 3, 4], start: "09:00", end: "16:30" },
  { staffId: "seed_staff_desai", locationId: "seed_loc_main", days: [5], start: "08:00", end: "17:30" },
  { staffId: "seed_staff_cole", locationId: "seed_loc_main", days: [2, 4, 6], start: "08:00", end: "17:30" },
  // Dr. Bennett's licence lapsed on 2026-10-31: he has no bookable hours until it is renewed.
  { staffId: "seed_staff_lopez", locationId: "seed_loc_main", days: [1, 2, 3, 4, 5], start: "07:30", end: "16:00" },
  { staffId: "seed_staff_price", locationId: "seed_loc_main", days: [1, 2, 3, 4, 5], start: "09:30", end: "18:00" },
  { staffId: "seed_staff_rahman", locationId: "seed_loc_elkgrove", days: [1, 2, 3, 4, 5], start: "09:00", end: "17:00" },
  { staffId: "seed_staff_morgan", locationId: "seed_loc_main", days: [2, 3, 4, 5, 6], start: "08:00", end: "16:00", categories: ["grooming"] }
];
var TRIAGE_PROTOCOL = {
  questions: [
    { id: "breathing", text: "Is your pet having any trouble breathing, breathing with the mouth open (cats), or are the gums blue, grey or very pale?", required: true },
    { id: "collapse", text: "Has your pet collapsed or fainted, or are they unable to stand or walk?", required: true },
    { id: "toxin", text: "Could your pet have eaten or touched anything poisonous: rat or mouse bait, antifreeze, human medicines, chocolate, grapes or raisins, sugar-free gum, or lilies (cats)?", required: true },
    { id: "bloat", text: "Is your dog's belly swollen or tight, or are they trying to vomit without bringing anything up?", required: true },
    { id: "bleeding", text: "Is there bleeding that will not stop, or a deep wound?", required: true },
    { id: "seizure", text: "Is your pet having a seizure now, or have they had more than one seizure today?", required: true },
    { id: "urinary_block", text: "Is your cat straining in the litter box with little or no urine coming out?", required: true },
    { id: "trauma", text: "In the last few hours, was your pet hit by a car, did they fall from a height, or were they attacked by another animal?", required: true },
    { id: "labour", text: "Is your pet giving birth and has been pushing for more than 30 minutes without delivering?", required: true },
    { id: "heat", text: "Has your pet been in the heat and is now panting very hard, drooling heavily or weak?", required: true },
    { id: "vomiting_repeated", text: "Has your pet vomited or had diarrhoea more than three times today, or is there blood in it?", required: false },
    { id: "not_eating", text: "Has your pet stopped eating or drinking for more than a day?", required: false },
    { id: "eye", text: "Is there an injury to an eye, or is an eye suddenly cloudy, bulging or held shut?", required: false },
    { id: "pain", text: "Is your pet crying out in pain or unable to settle?", required: false },
    { id: "limping", text: "Is your pet limping but still putting some weight on the leg?", required: false }
  ],
  redFlags: [
    { id: "rf_breathing", label: "Breathing difficulty or abnormal gum colour", whenYes: ["breathing"], keywords: ["cant breathe", "can not breathe", "not breathing", "struggling to breathe", "choking", "blue gums"] },
    { id: "rf_collapse", label: "Collapse or unable to stand", whenYes: ["collapse"], keywords: ["collapsed", "unconscious", "unresponsive", "fainted", "cant stand"] },
    { id: "rf_toxin", label: "Possible poisoning", whenYes: ["toxin"], keywords: ["rat poison", "mouse poison", "rat bait", "mouse bait", "antifreeze", "ate chocolate", "xylitol", "sugar free gum", "grapes", "raisins", "lily", "lilies", "ibuprofen", "advil", "tylenol", "acetaminophen", "marijuana", "edible"] },
    { id: "rf_bloat", label: "Possible bloat (GDV)", whenYes: ["bloat"], keywords: ["bloated", "swollen belly", "retching"] },
    { id: "rf_bleeding", label: "Uncontrolled bleeding or deep wound", whenYes: ["bleeding"], keywords: ["bleeding a lot", "wont stop bleeding", "deep cut", "bleeding heavily"] },
    { id: "rf_seizure", label: "Active or cluster seizures", whenYes: ["seizure"], keywords: ["seizure", "seizing", "convulsing", "fitting"] },
    { id: "rf_urinary", label: "Possible urinary blockage", whenYes: ["urinary_block"], keywords: ["cant pee", "straining to pee", "blocked cat"] },
    { id: "rf_trauma", label: "Recent major trauma", whenYes: ["trauma"], keywords: ["hit by a car", "hit by car", "run over", "fell off", "dog attack", "attacked by"] },
    { id: "rf_labour", label: "Difficult birth", whenYes: ["labour"], keywords: ["stuck puppy", "stuck kitten"] },
    { id: "rf_heat", label: "Possible heatstroke", whenYes: ["heat"], keywords: ["heatstroke", "heat stroke", "overheated"] }
  ],
  levelRules: [
    { level: "urgent_today", whenYes: ["vomiting_repeated", "not_eating", "eye", "pain"], keywords: ["vomiting blood", "blood in stool", "swollen face", "hives", "bee sting", "snake"] },
    { level: "soon", whenYes: ["limping"], keywords: ["limping", "ear infection", "scratching", "diarrhea", "diarrhoea", "lump", "cough"] }
  ],
  scripts: {
    emergency_now: "What you are describing can be an emergency. Please take your pet to an emergency hospital now; I am connecting you to our team straight away, and I will text you the address of the nearest open emergency hospital.",
    urgent_today: "Your pet should be seen today. I will look for the first available time today; if there is none, our team will call you back within 30 minutes to arrange care.",
    soon: "Your pet should be seen in the next day or two. Let me find the first available appointment. If anything gets worse before then, call us right away.",
    routine: "Let me find a time that works for you."
  }
};
var MESSAGE_TEMPLATES = [
  { code: "appointment_booked", purpose: "transactional", body: "{{practice}}: {{pet}} is booked for {{when}} with {{provider}}. Reply C to confirm, STOP to opt out." },
  { code: "appointment_requested", purpose: "transactional", body: "{{practice}}: we have your request for {{pet}} on {{when}}. Our team will confirm shortly. Reply STOP to opt out." },
  { code: "appointment_reminder", purpose: "transactional", body: "{{practice}}: reminder, {{pet}} is due {{when}} with {{provider}}. Reply C to confirm or call {{phone}} to change." },
  { code: "stop_confirmation", purpose: "transactional", body: "{{practice}}: you will no longer receive texts from us. Reply START to opt back in." },
  { code: "help_reply", purpose: "transactional", body: "{{practice}}: for help call {{phone}}. Reply STOP to opt out. Msg & data rates may apply." },
  { code: "refill_received", purpose: "care", body: "{{practice}}: we have your refill request for {{pet}}. A veterinarian reviews requests within one business day." },
  { code: "records_received", purpose: "transactional", body: "{{practice}}: we have your records request for {{pet}}. We will send them to the address on file." }
];
var KNOWLEDGE_BASE = [
  { topic: "Hours", keywords: ["hours", "open", "close", "saturday", "sunday"], visibility: "public", locationId: "seed_loc_main", content: "Cedar Creek Animal Hospital is open Monday to Friday 7:30 am to 6:00 pm and Saturday 8:00 am to 2:00 pm. We are closed on Sundays and federal holidays. For emergencies after hours, go to River City Veterinary Emergency (open 24 hours)." },
  { topic: "Hours", keywords: ["hours", "open", "close", "elk grove"], visibility: "public", locationId: "seed_loc_elkgrove", content: "Elk Grove Wellness Clinic is open Monday to Friday 9:00 am to 5:00 pm. It offers wellness, vaccine and sick-pet visits; surgery and dentistry are done at the main hospital." },
  { topic: "Address and parking", keywords: ["address", "where", "parking", "directions"], visibility: "public", locationId: null, content: "The main hospital is at 4120 Cedar Creek Road, Sacramento, with free parking at the front. The Elk Grove clinic is at 9175 Laguna Springs Way, Elk Grove." },
  { topic: "New clients", keywords: ["new client", "new patient", "first visit", "records"], visibility: "public", locationId: null, content: "New clients are welcome. Please bring any previous vaccine records, and arrive 10 minutes early to complete check-in. A first visit is a new client exam." },
  { topic: "Payment", keywords: ["pay", "payment", "credit card", "insurance", "cost", "price"], visibility: "public", locationId: null, content: "We accept cash, all major cards and pay-by-link. Payment is due at the time of service. We will give you a written estimate before any procedure. We can submit claims to pet insurers for you. Exact prices come from our published fee list; the front desk can give you an estimate." },
  { topic: "Prescription refills", keywords: ["refill", "medication", "prescription", "pharmacy"], visibility: "public", locationId: null, content: "Refill requests are reviewed by a veterinarian within one business day. Some medications need a recent exam before they can be refilled. We will text you when the refill is ready or if the doctor needs to see your pet." },
  { topic: "Records requests", keywords: ["records", "copy", "history", "transfer"], visibility: "public", locationId: null, content: "Clients of record can request a copy of their pet's records. We send them to the email address on file. Requests from other clinics need your authorisation." },
  { topic: "Vaccines for boarding and grooming", keywords: ["boarding", "grooming", "vaccines required", "bordetella", "kennel cough"], visibility: "public", locationId: null, content: "Dogs boarding or grooming with us need current rabies, DAPP and Bordetella vaccines. Cats need current rabies and FVRCP." },
  { topic: "Emergencies", keywords: ["emergency", "urgent", "after hours", "night"], visibility: "public", locationId: null, content: "If your pet has trouble breathing, has collapsed, may have eaten something poisonous, or is bleeding heavily, go to an emergency hospital now. River City Veterinary Emergency (2200 Riverside Blvd, Sacramento) and South Valley Animal Emergency (8800 Calvine Rd, Elk Grove) are open 24 hours." },
  { topic: "Front-desk note: dental estimates", keywords: ["dental", "estimate"], visibility: "staff", locationId: null, content: "Dental cleanings are booked as requests: the DVM reviews pre-anaesthetic bloodwork and the estimate range before confirming. Never quote a fixed price on the phone." }
];
var DRUG_PRODUCTS = [
  { id: "seed_drug_ketamine", displayName: "Ketamine 100 mg/mL injection", genericName: "ketamine", brandName: "Ketaset", form: "injectable", strength: "100", strengthUnit: "mg", per: "mL", concentration: "100", concentrationUnit: "mg/mL", packageQty: "10", packageUnit: "mL", csSchedule: "CIII", approvalStatus: "fda_approved", multiDoseBudDays: 28, ndc: "54771-2016-1", requiresWitnessOnAdminister: true },
  { id: "seed_drug_butorphanol", displayName: "Butorphanol 10 mg/mL injection", genericName: "butorphanol", brandName: "Torbugesic", form: "injectable", strength: "10", strengthUnit: "mg", per: "mL", concentration: "10", concentrationUnit: "mg/mL", packageQty: "10", packageUnit: "mL", csSchedule: "CIV", approvalStatus: "fda_approved", multiDoseBudDays: 28, ndc: "54771-5521-1", requiresWitnessOnAdminister: false },
  { id: "seed_drug_buprenorphine", displayName: "Buprenorphine 0.3 mg/mL injection", genericName: "buprenorphine", brandName: "Buprenex", form: "injectable", strength: "0.3", strengthUnit: "mg", per: "mL", concentration: "0.3", concentrationUnit: "mg/mL", packageQty: "1", packageUnit: "mL", csSchedule: "CIII", approvalStatus: "human_label", multiDoseBudDays: null, ndc: "12496-0757-1", requiresWitnessOnAdminister: false },
  { id: "seed_drug_hydromorphone", displayName: "Hydromorphone 2 mg/mL injection", genericName: "hydromorphone", brandName: "", form: "injectable", strength: "2", strengthUnit: "mg", per: "mL", concentration: "2", concentrationUnit: "mg/mL", packageQty: "1", packageUnit: "mL", csSchedule: "CII", approvalStatus: "human_label", multiDoseBudDays: null, ndc: "0409-2634-01", requiresWitnessOnAdminister: true },
  { id: "seed_drug_midazolam", displayName: "Midazolam 5 mg/mL injection", genericName: "midazolam", brandName: "", form: "injectable", strength: "5", strengthUnit: "mg", per: "mL", concentration: "5", concentrationUnit: "mg/mL", packageQty: "10", packageUnit: "mL", csSchedule: "CIV", approvalStatus: "human_label", multiDoseBudDays: 28, ndc: "0641-6060-10", requiresWitnessOnAdminister: false },
  { id: "seed_drug_pentobarbital", displayName: "Pentobarbital sodium 390 mg/mL euthanasia solution", genericName: "pentobarbital", brandName: "Euthasol", form: "injectable", strength: "390", strengthUnit: "mg", per: "mL", concentration: "390", concentrationUnit: "mg/mL", packageQty: "100", packageUnit: "mL", csSchedule: "CIIIN", approvalStatus: "fda_approved", multiDoseBudDays: 28, ndc: "051311-050-01", requiresWitnessOnAdminister: true },
  { id: "seed_drug_phenobarbital", displayName: "Phenobarbital 64.8 mg tablet", genericName: "phenobarbital", brandName: "", form: "tablet", strength: "64.8", strengthUnit: "mg", per: "tablet", concentration: null, concentrationUnit: "", packageQty: "100", packageUnit: "tablet", csSchedule: "CIV", approvalStatus: "human_label", multiDoseBudDays: null, ndc: "0603-5168-21", requiresWitnessOnAdminister: false },
  { id: "seed_drug_gabapentin", displayName: "Gabapentin 100 mg capsule", genericName: "gabapentin", brandName: "", form: "capsule", strength: "100", strengthUnit: "mg", per: "capsule", concentration: null, concentrationUnit: "", packageQty: "100", packageUnit: "capsule", csSchedule: "none", approvalStatus: "human_label", multiDoseBudDays: null, ndc: "0228-2665-11", requiresWitnessOnAdminister: false, stateCsSchedule: { "US-CA": { schedule: "none", reportable: false, note: "verify: some states schedule gabapentin as CV or require PDMP reporting" } } },
  { id: "seed_drug_carprofen", displayName: "Carprofen 75 mg chewable", genericName: "carprofen", brandName: "Rimadyl", form: "chewable", strength: "75", strengthUnit: "mg", per: "tablet", concentration: null, concentrationUnit: "", packageQty: "60", packageUnit: "tablet", csSchedule: "none", approvalStatus: "fda_approved", multiDoseBudDays: null, ndc: "0069-0127-01", requiresWitnessOnAdminister: false }
];
var FIRST = ["Olivia", "Liam", "Emma", "Noah", "Ava", "Mateo", "Sophia", "Ethan", "Isabella", "Lucas", "Mia", "Elijah", "Amara", "James", "Harper", "Benjamin", "Camila", "Daniel", "Aria", "Henry", "Zoe", "Jack", "Layla", "Owen", "Nora", "Wyatt", "Leah", "Caleb", "Hazel", "Isaac", "Ivy", "Julian"];
var MAIL_DOMAINS = ["gmail.com", "yahoo.com", "outlook.com", "icloud.com", "comcast.net", "sbcglobal.net", "hotmail.com", "aol.com"];
var LAST = ["Alvarez", "Bishop", "Castillo", "Dalton", "Espinoza", "Fairbanks", "Gallagher", "Hayward", "Ingram", "Jaramillo", "Kowalski", "Lindqvist", "Mendoza", "Nakamura", "Oyelaran", "Pemberton", "Quintero", "Rasmussen", "Sorensen", "Takahashi", "Underwood", "Valdivia", "Whitfield", "Xiong", "Yamamoto", "Zielinski", "Abernathy", "Bergstrom", "Chaudhry", "Delacroix", "Eriksen", "Fontaine"];
var DOGS = ["Biscuit", "Maple", "Juniper", "Moose", "Pepper", "Rosie", "Bear", "Winnie", "Scout", "Hazel", "Tucker", "Olive", "Ranger", "Daisy", "Koda", "Penny", "Murphy", "Luna", "Gus", "Ruby", "Finn", "Willow", "Otis", "Ginger"];
var CATS = ["Miso", "Clementine", "Toast", "Mochi", "Jasper", "Pumpkin", "Nimbus", "Sage", "Felix", "Poppy", "Ziggy", "Mabel", "Tofu", "Cleo", "Basil", "Pickles"];
var BREED_KG = {
  "Labrador Retriever": [25, 36],
  "Golden Retriever": [25, 34],
  "German Shepherd": [24, 40],
  "French Bulldog": [8, 13],
  "Border Collie": [13, 20],
  "Rough Collie": [18, 29],
  "Australian Shepherd": [16, 30],
  Dachshund: [7, 14],
  Beagle: [9, 14],
  Boxer: [25, 32],
  Chihuahua: [1.5, 3],
  "Pit Bull Terrier": [14, 30],
  "Siberian Husky": [16, 27],
  "Poodle (Standard)": [18, 30],
  "Poodle (Miniature)": [4, 8],
  "Shih Tzu": [4, 7.5],
  "Yorkshire Terrier": [2, 3.5],
  "Cavalier King Charles Spaniel": [5.5, 8.5],
  "Great Dane": [50, 80],
  "Mixed Breed": [8, 30],
  "Domestic Shorthair": [3.5, 6],
  "Domestic Longhair": [3.5, 6],
  "Maine Coon": [5.5, 9],
  Siamese: [3, 5],
  Ragdoll: [4.5, 8],
  Bengal: [3.5, 6.5],
  Persian: [3.5, 5.5],
  "British Shorthair": [4, 7.5],
  Sphynx: [3, 5]
};
function rng(seed) {
  let x = seed >>> 0;
  return () => {
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 4294967296;
  };
}
var HOUSEHOLD_COUNT = 400;
function households() {
  const r = rng(20261107);
  const pick = (items) => items[Math.floor(r() * items.length)];
  const out = [];
  const dogBreeds = SPECIES[0].breeds;
  const catBreeds = SPECIES[1].breeds;
  for (let i = 0; i < HOUSEHOLD_COUNT; i++) {
    const n = String(i + 1).padStart(3, "0");
    const last = LAST[i % LAST.length];
    const first = FIRST[i * 7 % FIRST.length];
    const eg = i % 4 === 3;
    const phone = i + 2 < 90 ? `+1916555${String(100 + i + 2).padStart(4, "0")}` : null;
    const people = [{ id: `seed_cp_${n}_1`, firstName: first, lastName: last, relationship: "owner", dob: `19${60 + i % 38}-${String(i % 12 + 1).padStart(2, "0")}-${String(i % 27 + 1).padStart(2, "0")}`, phone, email: `${first}.${last}${n}@${MAIL_DOMAINS[i % MAIL_DOMAINS.length]}`.toLowerCase() }];
    if (i % 3 === 0) people.push({ id: `seed_cp_${n}_2`, firstName: FIRST[(i * 7 + 5) % FIRST.length], lastName: last, relationship: "co_owner", dob: `19${62 + i % 35}-0${i % 9 + 1}-1${i % 9}`, phone: null, email: `${FIRST[(i * 7 + 5) % FIRST.length]}.${last}${n}@${MAIL_DOMAINS[(i + 2) % MAIL_DOMAINS.length]}`.toLowerCase() });
    const petCount = i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1;
    const pets = [];
    for (let p = 0; p < petCount; p++) {
      const roll = r();
      const species = roll < 0.58 ? "canine" : roll < 0.93 ? "feline" : pick(["rabbit", "ferret", "bearded_dragon", "cockatiel"]);
      const name = species === "canine" ? DOGS[(i + p * 5) % DOGS.length] : species === "feline" ? CATS[(i + p * 3) % CATS.length] : pick(["Clover", "Bandit", "Spike", "Kiwi"]);
      const breed = species === "canine" ? pick(dogBreeds) : species === "feline" ? pick(catBreeds) : SPECIES.find((s) => s.code === species).breeds[0];
      const year = 2012 + Math.floor(r() * 14);
      const [lo, hi] = BREED_KG[breed] ?? (species === "canine" ? [8, 30] : [3, 6]);
      const base = species === "canine" || species === "feline" ? lo + r() * (hi - lo) : species === "rabbit" ? 1.2 + r() : species === "ferret" ? 0.7 + r() * 0.6 : species === "bearded_dragon" ? 0.35 + r() * 0.15 : 0.08 + r() * 0.02;
      const weights = [94, 98, 100].map((pct) => {
        const places = base < 1 ? 3 : 2;
        const units = Math.round(base * pct / 100 * 10 ** places);
        return toScale(dec(units).div(10 ** places), places);
      });
      const sex = r() < 0.5 ? "male" : "female";
      pets.push({
        id: `seed_pet_${n}_${p + 1}`,
        name,
        species,
        breed,
        sex,
        repro: species === "canine" || species === "feline" ? sex === "male" ? "neutered" : "spayed" : "unknown",
        dob: `${year}-${String(1 + Math.floor(r() * 12)).padStart(2, "0")}-${String(1 + Math.floor(r() * 27)).padStart(2, "0")}`,
        colour: COLOURS[species]?.[Math.floor(r() * (COLOURS[species]?.length ?? 1))] ?? "",
        weightsKg: weights,
        microchip: species === "canine" || species === "feline" ? `985112${String(4e6 + i * 37 + p).padStart(9, "0")}` : null
      });
    }
    out.push({ id: `seed_cl_${n}`, displayName: `${last} household`, kind: "household", locationId: eg ? "seed_loc_elkgrove" : "seed_loc_main", city: eg ? "Elk Grove" : "Sacramento", postalCode: eg ? "95758" : "95823", addressLine1: `${100 + i * 13} ${pick(["Oak", "Willow", "Riverside", "Laguna", "Florin", "Freeport", "Elm"])} ${pick(["St", "Ave", "Way", "Ct"])}`, people, pets });
  }
  const collie = out[4].pets[0];
  Object.assign(collie, { name: "Laddie", species: "canine", breed: "Rough Collie", alerts: [{ kind: "genetic", severity: "warn", text: "MDR1 (ABCB1) mutant/mutant: avoid ivermectin at high doses, loperamide, acepromazine at full dose; check every drug." }] });
  out[7].pets[0].alerts = [{ kind: "behaviour_caution", severity: "warn", text: "Bites when restrained: muzzle on arrival, two-person handling." }];
  const nsaidCat = out[9].pets.find((p) => p.species === "feline") ?? out[9].pets[0];
  Object.assign(nsaidCat, { species: "feline", breed: "Domestic Shorthair", name: "Saffron", alerts: [{ kind: "drug_sensitivity", severity: "block", text: "NSAID intolerance (acute kidney injury after meloxicam, 2025). No NSAIDs." }] });
  for (const pet of [collie, nsaidCat]) {
    const [lo, hi] = BREED_KG[pet.breed] ?? [3, 6];
    const mid = (lo + hi) / 2;
    pet.weightsKg = [94, 98, 100].map((pct) => toScale(dec(Math.round(mid * pct)).div(100), 2));
  }
  out[12].pets[0].alerts = [{ kind: "allergy", severity: "warn", text: "Vaccine reaction (facial swelling) after leptospirosis vaccine: pre-medicate and split vaccines." }];
  Object.assign(out[15].pets[0], { status: "deceased", diedOn: "2026-09-18" });
  out[20] = {
    ...out[20],
    displayName: "Second Chance Cat Rescue",
    kind: "rescue",
    pets: Array.from({ length: 12 }, (_, k) => ({ id: `seed_pet_021_${k + 1}`, name: ["Ash", "Birch", "Cedar", "Dune", "Ember", "Fern", "Glade", "Heath", "Iris", "Jade", "Kestrel", "Linden"][k], species: "feline", breed: "Domestic Shorthair", sex: k % 2 ? "female" : "male", repro: k % 2 ? "spayed" : "neutered", dob: `2025-0${k % 9 + 1}-15`, colour: COLOURS.feline[k % COLOURS.feline.length], weightsKg: ["2.10", "2.60", "3.05"], microchip: `985112${String(51e5 + k).padStart(9, "0")}` }))
  };
  out[HOUSEHOLD_COUNT - 1] = { ...out[HOUSEHOLD_COUNT - 1], status: "prospect", source: "ai_voice", people: [{ ...out[HOUSEHOLD_COUNT - 1].people[0], phone: "+19165550193" }], pets: out[HOUSEHOLD_COUNT - 1].pets.slice(0, 1).map((p) => ({ ...p, status: "pending", microchip: null, weightsKg: [] })) };
  return out;
}

// features/keystone/seed/clinic.ts
var DAY3 = (d) => /* @__PURE__ */ new Date(`${d}T00:00:00Z`);
var meta3 = { metadata: { seed: true } };
async function seedClinic(uow, actor) {
  const { tx, now } = uow;
  const created = {};
  const count = (k, n) => {
    created[k] = (created[k] ?? 0) + n;
  };
  if (!await tx.location.findUnique({ where: { id: "seed_loc_main" }, select: { id: true } })) {
    throw new Error("Load the practice (locations, staff and policies) before the clinic data.");
  }
  const haveSpecies = new Set((await tx.species.findMany({ where: { id: { in: SPECIES.map((s) => s.id) } }, select: { id: true } })).map((s) => s.id));
  const newSpecies = SPECIES.filter((s) => !haveSpecies.has(s.id));
  if (newSpecies.length) {
    await tx.species.createMany({ data: newSpecies.map((s) => ({ id: s.id, code: s.code, name: s.name, module: s.module, defaultWeightUnit: s.defaultWeightUnit, active: true })) });
    await tx.breed.createMany({ data: newSpecies.flatMap((s) => s.breeds.map((name, i) => ({ id: `${s.id}_b${i + 1}`, speciesId: s.id, name }))) });
    await tx.colourMarking.createMany({ data: newSpecies.flatMap((s) => (COLOURS[s.code] ?? []).map((name, i) => ({ id: `${s.id}_c${i + 1}`, speciesId: s.id, name }))) });
    auditCreate(uow, actor, "Species", "seed_species", "species.loaded", { species: newSpecies.map((s) => s.code), breeds: newSpecies.reduce((n, s) => n + s.breeds.length, 0) }, meta3);
    count("species", newSpecies.length);
  }
  const speciesByCode = new Map((await tx.species.findMany({ select: { id: true, code: true } })).map((s) => [s.code, s.id]));
  const breedId = new Map((await tx.breed.findMany({ select: { id: true, name: true, speciesId: true } })).map((b) => [`${b.speciesId}|${b.name}`, b.id]));
  const haveEr = new Set((await tx.referralHospital.findMany({ where: { id: { in: REFERRAL_HOSPITALS.map((h) => h.id) } }, select: { id: true } })).map((h) => h.id));
  const newEr = REFERRAL_HOSPITALS.filter((h) => !haveEr.has(h.id));
  if (newEr.length) {
    await tx.referralHospital.createMany({ data: newEr.map((h) => ({ ...h, fax: "", verifiedChannel: true, active: true })) });
    for (const h of newEr) auditCreate(uow, actor, "ReferralHospital", h.id, "referral_hospital.created", { name: h.name, kind: h.kind, open24h: h.open24h }, meta3);
    count("referralHospitals", newEr.length);
  }
  const haveRes = new Set((await tx.resource.findMany({ where: { id: { in: RESOURCES.map((r) => r.id) } }, select: { id: true } })).map((r) => r.id));
  const newRes = RESOURCES.filter((r) => !haveRes.has(r.id));
  if (newRes.length) {
    await tx.resource.createMany({ data: newRes.map((r) => ({ ...r, active: true })) });
    auditCreate(uow, actor, "Resource", "seed_resources", "resources.loaded", { count: newRes.length }, meta3);
    count("resources", newRes.length);
  }
  const haveTypes = new Set((await tx.appointmentType.findMany({ where: { id: { in: APPOINTMENT_TYPES.map((t) => t.id) } }, select: { id: true } })).map((t) => t.id));
  for (const t of APPOINTMENT_TYPES.filter((t2) => !haveTypes.has(t2.id))) {
    await tx.appointmentType.create({
      data: {
        id: t.id,
        code: t.code,
        name: t.name,
        category: t.category,
        durationMinutes: t.durationMinutes,
        segments: t.segments ?? null,
        requiredResourceKinds: t.requiredResourceKinds,
        providerKinds: t.providerKinds,
        aiBookable: t.aiBookable,
        portalBookable: t.portalBookable,
        requestOnly: t.requestOnly,
        newClientAllowed: t.newClientAllowed,
        depositRequired: t.depositRequired ?? "none",
        depositMinor: t.depositMinor ?? null,
        vcprQualifying: t.vcprQualifying,
        colour: t.colour,
        active: true,
        ...t.species ? { species: { connect: t.species.map((code) => ({ id: speciesByCode.get(code) })) } } : {}
      },
      select: { id: true }
    });
    auditCreate(uow, actor, "AppointmentType", t.id, "appointment_type.created", { code: t.code, aiBookable: t.aiBookable, requestOnly: t.requestOnly }, meta3);
    count("appointmentTypes", 1);
  }
  if (!await tx.staffSchedule.findFirst({ where: { id: { startsWith: "seed_sch_" } }, select: { id: true } })) {
    const rows = SCHEDULES.flatMap((s, i) => s.days.map((weekday2) => ({ id: `seed_sch_${i}_${weekday2}`, staffMemberId: s.staffId, locationId: s.locationId, kind: "recurring", weekday: weekday2, startTime: s.start, endTime: s.end, appointmentCategories: s.categories ?? null, effectiveFrom: DAY3("2026-01-01") })));
    await tx.staffSchedule.createMany({ data: rows });
    auditCreate(uow, actor, "StaffSchedule", "seed_schedules", "schedules.loaded", { blocks: rows.length }, meta3);
    count("scheduleBlocks", rows.length);
  }
  if (!await tx.triageProtocol.findUnique({ where: { code: "phone_triage" }, select: { id: true } })) {
    const protocol = parseProtocol(TRIAGE_PROTOCOL);
    await tx.triageProtocol.create({ data: { id: "seed_tp_phone", code: "phone_triage", name: "Phone triage (front desk and AI receptionist)" } });
    await tx.triageProtocolVersion.create({ data: { id: "seed_tpv_phone_1", protocolId: "seed_tp_phone", versionNumber: 1, label: "v1 (Cedar Creek, reviewed by Dr. Marsh)", questions: protocol.questions, redFlags: protocol.redFlags, levelRules: protocol.levelRules, scripts: protocol.scripts, contentHash: protocolHash(protocol), status: "published", publishedAt: now } });
    auditCreate(uow, actor, "TriageProtocolVersion", "seed_tpv_phone_1", "triage_protocol.published", { code: "phone_triage", version: 1, redFlags: protocol.redFlags.length, contentHash: protocolHash(protocol) }, meta3);
    count("triageProtocols", 1);
  }
  const haveTemplates = new Set((await tx.messageTemplate.findMany({ where: { channel: "sms" }, select: { code: true } })).map((t) => t.code));
  const newTemplates = MESSAGE_TEMPLATES.filter((t) => !haveTemplates.has(t.code));
  if (newTemplates.length) {
    await tx.messageTemplate.createMany({ data: newTemplates.map((t) => ({ id: `seed_tpl_${t.code}`, code: t.code, purpose: t.purpose, channel: "sms", locale: "en-US", body: t.body, templateVersion: 1, active: true })) });
    count("messageTemplates", newTemplates.length);
  }
  if (!await tx.knowledgeBaseEntry.findFirst({ where: { id: { startsWith: "seed_kb_" } }, select: { id: true } })) {
    await tx.knowledgeBaseEntry.createMany({ data: KNOWLEDGE_BASE.map((k, i) => ({ id: `seed_kb_${i + 1}`, topic: k.topic, keywords: k.keywords, content: k.content, visibility: k.visibility, locationId: k.locationId, entryVersion: 1, active: true })) });
    auditCreate(uow, actor, "KnowledgeBaseEntry", "seed_kb", "knowledge_base.loaded", { entries: KNOWLEDGE_BASE.length }, meta3);
    count("knowledgeBase", KNOWLEDGE_BASE.length);
  }
  if (!await tx.publicSiteProfile.findFirst({ select: { id: true } })) {
    await tx.publicSiteProfile.create({ data: { id: 1, headline: "Cedar Creek Animal Hospital", onlineBookingEnabled: true, newClientBookingMode: "request", bookingWindowDays: 60, minimumNoticeMinutes: 120 } });
    const publicTypes = APPOINTMENT_TYPES.filter((t) => t.portalBookable || t.requestOnly);
    await tx.publicAppointmentType.createMany({ data: publicTypes.map((t, i) => ({ id: `seed_pat_${t.code}`, appointmentTypeId: t.id, publicName: t.name, description: "", mode: t.requestOnly ? "request" : "book", newClients: t.newClientAllowed, sortOrder: i, active: true })) });
    count("publicAppointmentTypes", publicTypes.length);
  }
  if (!await tx.agentIdentity.findUnique({ where: { id: "seed_agent_reception" }, select: { id: true } })) {
    await tx.oAuthApp.create({ data: { id: "seed_oauth_reception", name: "Cedar Creek AI receptionist (voice runtime)", clientId: "ccah-voice-receptionist", tokenEndpointAuthMethod: "none", redirectUris: ["https://voice.cedarcreekvet.com/oauth/callback"], scopes: ["mcp:read", "mcp:write"], status: "active", description: "The voice runtime signs in as this client; its token acts as the receptionist agent, never as a person." } });
    await tx.agentIdentity.create({ data: { id: "seed_agent_reception", name: "Cedar Creek AI receptionist", kind: "voice_receptionist", model: "operator-selected (OpenRouter)", provider: "openrouter", ownerId: "seed_user_park", status: "active", killSwitch: false, limits: { toolCallsPerRun: 40, maxBookingsPerCall: 3 }, oauthAppId: "seed_oauth_reception" } });
    await ensureAgentUser(tx, { id: "seed_agent_reception", name: "Cedar Creek AI receptionist" });
    const scopes = ["reception.read", "reception.book", "reception.register", "triage.run", "pharmacy.intake", "records.request"];
    await tx.agentToolGrant.createMany({ data: scopes.map((scope) => ({ id: `seed_grant_reception_${scope.replace(".", "_")}`, agentId: "seed_agent_reception", scope, status: "active", constraints: { locations: ["seed_loc_main", "seed_loc_elkgrove"] } })) });
    auditCreate(uow, actor, "AgentIdentity", "seed_agent_reception", "agent.created", { kind: "voice_receptionist", owner: "seed_user_park", scopes, note: "aiVoice feature is off until a practice-controls change is approved" }, meta3);
    count("agents", 1);
  }
  const homes = households();
  const haveClients = new Set((await tx.client.findMany({ where: { id: { in: homes.map((h) => h.id) } }, select: { id: true } })).map((c) => c.id));
  const newHomes = homes.filter((h) => !haveClients.has(h.id));
  if (newHomes.length) {
    const clientRefs = await reserveSerials(tx, "C", newHomes.length);
    const pets = newHomes.flatMap((h) => h.pets.map((p) => ({ home: h, pet: p })));
    const patientRefs = await reserveSerials(tx, "P", pets.length);
    await tx.client.createMany({
      data: newHomes.map((h, i) => ({ id: h.id, ref: clientRefs[i], displayName: h.displayName, kind: h.kind, status: h.status ?? "active", primaryLocationId: h.locationId, addressLine1: h.addressLine1, city: h.city, stateCode: "US-CA", postalCode: h.postalCode, source: h.source ?? "import", accountFlags: h.status === "prospect" ? { possibleDuplicate: false } : {} }))
    });
    const people = newHomes.flatMap((h) => h.people.map((p, i) => ({ home: h, person: p, primary: i === 0 })));
    await tx.clientPerson.createMany({
      data: people.map(({ home, person, primary }) => ({ id: person.id, clientId: home.id, firstName: person.firstName, lastName: person.lastName, relationship: person.relationship, isPrimary: primary, canBook: true, canApproveTreatment: primary, canReceiveRecords: primary, canPay: true, canAuthoriseEuthanasia: primary, dateOfBirth: DAY3(person.dob), preferredLanguage: "en" }))
    });
    const contacts = people.flatMap(({ person }) => [
      ...person.phone ? [{ id: `${person.id}_m`, personId: person.id, kind: "mobile", value: person.phone, valueHash: contactHash(person.phone), isPrimary: true, canText: true, status: "active", verifiedAt: now }] : [],
      { id: `${person.id}_e`, personId: person.id, kind: "email", value: person.email, valueHash: contactHash(person.email), isPrimary: true, canText: false, status: "active", verifiedAt: null }
    ]);
    await tx.contactPoint.createMany({ data: contacts });
    await tx.consentRecord.createMany({ data: contacts.map((c) => ({ contactPointId: c.id, purpose: "transactional", action: "grant", method: "import", at: now })) });
    await tx.patient.createMany({
      data: pets.map(({ pet }, i) => {
        const spId = speciesByCode.get(pet.species);
        return { id: pet.id, ref: patientRefs[i], name: pet.name, kind: "individual", speciesId: spId, breedId: breedId.get(`${spId}|${pet.breed}`) ?? null, sex: pet.sex, reproductiveStatus: pet.repro, dateOfBirth: DAY3(pet.dob), dobEstimated: false, colourMarkings: pet.colour, status: pet.status ?? "active", deceasedAt: pet.diedOn ? /* @__PURE__ */ new Date(`${pet.diedOn}T17:00:00Z`) : null, codeStatus: "unspecified" };
      })
    });
    await tx.patientOwnership.createMany({ data: pets.map(({ home, pet }) => ({ id: `${pet.id}_own`, patientId: pet.id, clientId: home.id, role: "primary", effectiveFrom: DAY3("2024-01-01"), basis: "import" })) });
    const weights = pets.flatMap(({ pet }) => pet.weightsKg.map((kg, k) => ({ id: `${pet.id}_w${k + 1}`, patientId: pet.id, value: toScale(dec(kg), "wt"), unit: "kg", valueKg: toScale(dec(kg), "wt"), method: "scale", measuredAt: new Date(now.getTime() - (2 - k) * 180 * 864e5 - 30 * 864e5) })));
    if (weights.length) await tx.weightMeasurement.createMany({ data: weights });
    const chips = pets.filter(({ pet }) => pet.microchip).map(({ pet }) => ({ id: `${pet.id}_chip`, patientId: pet.id, number: pet.microchip, standard: microchipStandard(pet.microchip), registry: "Found Animals (fictional entry)", registeredToClient: true, active: true }));
    if (chips.length) await tx.microchip.createMany({ data: chips });
    const alerts = pets.flatMap(({ pet }) => (pet.alerts ?? []).map((a, k) => ({ id: `${pet.id}_alert${k + 1}`, patientId: pet.id, kind: a.kind, severity: a.severity, text: a.text, active: true })));
    if (alerts.length) await tx.patientAlert.createMany({ data: alerts });
    const vcprs = pets.filter(({ pet }) => (pet.status ?? "active") === "active").map(({ home, pet }, k) => {
      const lapsed = k % 9 === 4;
      const established = new Date(now.getTime() - (lapsed ? 430 : 40 + k % 200) * 864e5);
      return { id: `${pet.id}_vcpr`, patientId: pet.id, scope: "practice", locationId: home.locationId, establishedByRef: "import", establishedVia: "import", establishedAt: established, expiresAt: new Date(established.getTime() + 365 * 864e5), status: lapsed ? "expired" : "active" };
    });
    if (vcprs.length) await tx.vcprRecord.createMany({ data: vcprs });
    for (const { home, pet } of pets.filter(({ pet: pet2 }) => pet2.status === "deceased")) {
      await tx.suppression.create({ data: { id: `${pet.id}_supp`, patientId: pet.id, clientId: home.id, reason: "deceased", active: true } });
    }
    auditCreate(uow, actor, "Client", "seed_clients", "clients.imported", { households: newHomes.length, people: people.length, patients: pets.length, alerts: alerts.length, deceased: pets.filter(({ pet }) => pet.status === "deceased").length }, meta3);
    count("clients", newHomes.length);
    count("patients", pets.length);
  }
  if (!await tx.appointment.findFirst({ where: { id: { startsWith: "seed_apt_" } }, select: { id: true } })) {
    const tz = "America/Los_Angeles";
    let today = localDate({ timeZone: tz }, now);
    if ((/* @__PURE__ */ new Date(`${today}T12:00:00Z`)).getUTCDay() === 0) today = addDays(today, 1);
    const saturday = (/* @__PURE__ */ new Date(`${today}T12:00:00Z`)).getUTCDay() === 6;
    const dvm = saturday ? "seed_staff_marsh" : "seed_staff_okafor";
    const dvm2 = saturday ? "seed_staff_cole" : "seed_staff_okafor";
    const nextDay = addDays(today, saturday ? 2 : (/* @__PURE__ */ new Date(`${today}T12:00:00Z`)).getUTCDay() === 5 ? 3 : 1);
    const types = new Map((await tx.appointmentType.findMany({ where: { id: { in: APPOINTMENT_TYPES.map((t) => t.id) } } })).map((t) => [t.id, t]));
    const plan = [
      { day: today, time: "08:00", type: "seed_at_wellness", provider: dvm, room: "seed_res_main_exam1", home: 0, status: "checked_in", channel: "csr" },
      { day: today, time: "08:30", type: "seed_at_vaccine", provider: dvm, room: "seed_res_main_exam1", home: 1, status: "confirmed", channel: "ai_voice" },
      { day: today, time: "09:00", type: "seed_at_sick", provider: dvm2, room: "seed_res_main_exam2", home: 4, status: "booked", channel: "csr" },
      { day: today, time: "09:30", type: "seed_at_recheck", provider: dvm, room: "seed_res_main_exam1", home: 7, status: "booked", channel: "portal" },
      { day: today, time: "10:00", type: "seed_at_wellness", provider: dvm2, room: "seed_res_main_exam3", home: 9, status: "confirmed", channel: "csr" },
      { day: today, time: "11:00", type: "seed_at_sick", provider: dvm, room: "seed_res_main_exam2", home: 12, status: "booked", channel: "ai_voice" },
      { day: today, time: saturday ? "12:30" : "13:30", type: "seed_at_wellness", provider: dvm, room: "seed_res_main_exam1", home: 16, status: "booked", channel: "csr" },
      { day: today, time: "09:00", type: "seed_at_tech", provider: "seed_staff_lopez", room: "seed_res_main_treat", home: 18, status: "confirmed", channel: "csr" },
      { day: today, time: "10:00", type: "seed_at_groom", provider: "seed_staff_morgan", room: "seed_res_main_groom", home: 22, status: "booked", channel: "portal" },
      { day: nextDay, time: "07:30", type: "seed_at_dental", provider: "seed_staff_marsh", room: "seed_res_main_dental", home: 24, status: "requested", channel: "portal" },
      { day: nextDay, time: "08:00", type: "seed_at_wellness", provider: "seed_staff_okafor", room: "seed_res_main_exam1", home: 26, status: "booked", channel: "ai_voice" },
      { day: nextDay, time: "08:30", type: "seed_at_sick", provider: "seed_staff_okafor", room: "seed_res_main_exam2", home: 28, status: "booked", channel: "csr" }
    ];
    const refs = await reserveReferences(tx, "APT", plan.length, now);
    const homesById = homes;
    for (const [i, p] of plan.entries()) {
      const type = types.get(p.type);
      const home = homesById[p.home];
      const pet = home.pets.find((x) => (x.status ?? "active") === "active") ?? home.pets[0];
      const startsAt = zonedInstant(tz, p.day, p.time);
      const endsAt = new Date(startsAt.getTime() + type.durationMinutes * 6e4);
      const id2 = `seed_apt_${String(i + 1).padStart(2, "0")}`;
      const hold = p.status === "requested" ? "held" : "confirmed";
      await tx.appointment.create({ data: { id: id2, ref: refs[i], locationId: "seed_loc_main", clientId: home.id, appointmentTypeId: type.id, providerId: p.provider, startsAt, endsAt, status: p.status, channel: p.channel, reason: type.name, confirmedAt: p.status === "confirmed" || p.status === "checked_in" ? now : null, checkedInAt: p.status === "checked_in" ? now : null } });
      await tx.appointmentPatient.create({ data: { appointmentId: id2, patientId: pet.id, reason: type.name, status: p.status === "checked_in" ? "checked_in" : "scheduled" } });
      const segments = buildSegments(type.segments, startsAt.getTime(), type.durationMinutes);
      await tx.appointmentSegment.createMany({ data: segments.map((s) => ({ appointmentId: id2, kind: s.kind, startsAt: s.startsAt, endsAt: s.endsAt, resourceId: p.room, staffId: p.provider })) });
      await tx.resourceReservation.create({ data: { resourceId: p.room, appointmentId: id2, startsAt, endsAt, status: hold } });
      await tx.providerReservation.create({ data: { staffMemberId: p.provider, appointmentId: id2, startsAt, endsAt, status: hold } });
      if (p.status === "checked_in") await tx.whiteboardEntry.create({ data: { locationId: "seed_loc_main", patientId: pet.id, appointmentId: id2, status: "in_exam", roomId: p.room, assignedDvmId: p.provider, assignedTechId: "seed_staff_price", since: now, flags: {} } });
    }
    auditCreate(uow, actor, "Appointment", "seed_day_sheet", "appointments.loaded", { count: plan.length, day: today }, meta3);
    count("appointments", plan.length);
  }
  const haveDrugs = new Set((await tx.drugProduct.findMany({ where: { id: { in: DRUG_PRODUCTS.map((d) => d.id) } }, select: { id: true } })).map((d) => d.id));
  const newDrugs = DRUG_PRODUCTS.filter((d) => !haveDrugs.has(d.id));
  if (newDrugs.length) {
    await tx.drugProduct.createMany({
      data: newDrugs.map((d) => ({ id: d.id, displayName: d.displayName, genericName: d.genericName, brandName: d.brandName, form: d.form, strength: d.strength, strengthUnit: d.strengthUnit, per: d.per, concentration: d.concentration, concentrationUnit: d.concentrationUnit, packageQty: d.packageQty, packageUnit: d.packageUnit, csSchedule: d.csSchedule, stateCsSchedule: "stateCsSchedule" in d ? d.stateCsSchedule : null, isHumanLabel: d.approvalStatus === "human_label", approvalStatus: d.approvalStatus, multiDoseBudDays: d.multiDoseBudDays, ndc: d.ndc, requiresWitnessOnAdminister: d.requiresWitnessOnAdminister, active: true }))
    });
    count("drugProducts", newDrugs.length);
  }
  if (!await tx.csContainer.findFirst({ where: { id: { startsWith: "seed_csc_" } }, select: { id: true } })) {
    const containers = [
      { id: "seed_csc_ketamine_1", ref: "CSC-MAIN-0001", productId: "seed_drug_ketamine", locationId: "seed_loc_main", dea: "seed_dea_main", lot: "KT24117", label: "10", unit: "mL", used: "2.4" },
      { id: "seed_csc_hydromorphone_1", ref: "CSC-MAIN-0002", productId: "seed_drug_hydromorphone", locationId: "seed_loc_main", dea: "seed_dea_main", lot: "HM25031", label: "1", unit: "mL", used: "0.35" },
      { id: "seed_csc_butorphanol_eg", ref: "CSC-EG-0001", productId: "seed_drug_butorphanol", locationId: "seed_loc_elkgrove", dea: "seed_dea_elkgrove", lot: "BT25210", label: "10", unit: "mL", used: "0.8" }
    ];
    for (const c of containers) {
      await tx.csContainer.create({ data: { id: c.id, ref: c.ref, productId: c.productId, locationId: c.locationId, deaRegistrationId: c.dea, lotNumber: c.lot, lotExpiresOn: DAY3("2027-09-30"), status: "open", labelQty: c.label, labelUnit: c.unit, openedAt: new Date(now.getTime() - 3 * 864e5), openedById: "seed_staff_lopez", budAt: new Date(now.getTime() + 25 * 864e5) } });
      await appendCsEntry(tx, { containerId: c.id, type: "receive", qtySigned: c.label, unit: c.unit, occurredAt: new Date(now.getTime() - 3 * 864e5), actorId: "seed_staff_lopez", reason: "Opening balance" }, now);
      await appendCsEntry(tx, { containerId: c.id, type: "administer", qtySigned: dec(c.used).negated(), unit: c.unit, occurredAt: new Date(now.getTime() - 2 * 864e5), actorId: "seed_staff_lopez", witnessId: "seed_staff_okafor", patientId: homes[0].pets[0].id, clientId: homes[0].id, reason: "Premedication" }, now);
    }
    auditCreate(uow, actor, "CsContainer", "seed_cs", "cs.containers_opened", { containers: containers.map((c) => c.ref) }, meta3);
    count("csContainers", containers.length);
  }
  await seedClinical(uow, actor, count);
  await seedInventory(uow, actor, count);
  return created;
}

// features/keystone/mutations/setup.ts
async function loadPracticeSetup(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canManageOnboarding");
  const result = await command(context.prisma, { name: "setup.load_practice", actor, idempotencyKey: args.idempotencyKey, params: {} }, (uow) => seedPractice(uow, actor));
  return { replay: result.replay, created: result.value };
}
async function loadClinicSetup(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canManageOnboarding");
  const result = await command(context.prisma, { name: "setup.load_clinic", actor, idempotencyKey: args.idempotencyKey, params: {} }, (uow) => seedClinic(uow, actor));
  return { replay: result.replay, created: result.value };
}

// features/keystone/mutations/audit.ts
async function verifyAuditChain2(_root, _args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canReadAudit");
  return verifyAuditChain(context.prisma);
}

// features/keystone/lib/separationOfDuties.ts
var SELF_APPROVAL_MESSAGE = "You can't approve your own request.";
var AGENT_APPROVAL_MESSAGE = "An agent can propose but never approve.";
function assertCanDecide(actor, requesterUserId, requesterAgentOwnerId, strictAgentOwner = true) {
  if (actor.kind !== "user") throw new DomainError(Codes.AGENT_CANNOT_APPROVE, AGENT_APPROVAL_MESSAGE);
  if (requesterUserId && requesterUserId === actor.userId) throw new DomainError(Codes.SELF_APPROVAL, SELF_APPROVAL_MESSAGE);
  if (strictAgentOwner && requesterAgentOwnerId && requesterAgentOwnerId === actor.userId) throw new DomainError(Codes.SELF_APPROVAL, "You can't approve a proposal made by your own agent.");
}

// features/keystone/lib/approval.ts
async function requestApproval(uow, actor, input) {
  const policy = await uow.tx.approvalPolicy.findUnique({ where: { action: input.action } });
  const requiredPermission = policy?.requiredPermission ?? input.requiredPermission;
  const minutes = input.expiresInMinutes ?? policy?.expiresAfterMinutes ?? 1440;
  const created = await uow.tx.approvalRequest.create({
    data: {
      action: input.action,
      summary: input.summary ?? "",
      targetList: input.targetList,
      targetId: input.targetId,
      payload: toJsonValue(input.payload),
      payloadHash: payloadHash(input.payload),
      requiredPermission,
      requestedById: actorUserId(actor),
      requestedByAgentId: actorAgentId(actor),
      status: "pending",
      expiresAt: new Date(uow.now.getTime() + minutes * 6e4)
    }
  });
  uow.audit({ eventType: "approval.requested", entityType: "ApprovalRequest", entityId: created.id, actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), after: { action: input.action, targetList: input.targetList, targetId: input.targetId, payloadHash: created.payloadHash, requiredPermission } });
  return created;
}
async function decideApproval(uow, actor, input) {
  const request = await lockRow(uow.tx, "ApprovalRequest", input.requestId);
  let agentOwnerId = null;
  if (request.requestedByAgentId) {
    const agent = await uow.tx.agentIdentity.findUnique({ where: { id: request.requestedByAgentId }, select: { ownerId: true } });
    agentOwnerId = agent?.ownerId ?? null;
  }
  assertCanDecide(actor, request.requestedById, agentOwnerId, input.strictAgentOwner ?? true);
  if (actor.kind !== "user" || !actor.permissions.has(request.requiredPermission)) {
    throw new DomainError(Codes.NOT_AUTHORIZED, `Deciding this needs the ${request.requiredPermission} permission.`);
  }
  if (request.expiresAt && new Date(request.expiresAt).getTime() <= uow.now.getTime()) {
    await transition(uow, { model: "ApprovalRequest", id: input.requestId, from: ["pending"], to: "expired", actor, eventType: "approval.expired" });
    throw new DomainError(Codes.GUARD_FAILED, "This approval request has expired.");
  }
  const to = input.decision === "approve" ? "approved" : "rejected";
  const updated = await transition(uow, {
    model: "ApprovalRequest",
    id: input.requestId,
    from: ["pending"],
    to,
    expectedVersion: input.expectedVersion,
    actor,
    eventType: `approval.${to}`,
    reason: input.reason ?? null,
    approverId: actor.userId
  });
  await uow.tx.approvalDecision.create({ data: { requestId: input.requestId, decidedById: actor.userId, decision: input.decision, reason: input.reason ?? "", at: uow.now } });
  return updated;
}
async function consumeApproval(uow, input) {
  const request = await lockRow(uow.tx, "ApprovalRequest", input.requestId);
  if (request.status !== "approved") throw new DomainError(Codes.APPROVAL_REQUIRED, "This action needs an approved request.");
  if (request.consumedAt) throw new DomainError(Codes.APPROVAL_MISMATCH, "This approval was already used.");
  if (request.action !== input.action || request.targetList !== input.targetList || request.targetId !== input.targetId || request.payloadHash !== payloadHash(input.payload)) {
    throw new DomainError(Codes.APPROVAL_MISMATCH, "The approval was given for a different action or payload.");
  }
  if (request.expiresAt && new Date(request.expiresAt).getTime() <= uow.now.getTime()) throw new DomainError(Codes.GUARD_FAILED, "The approval has expired.");
  const decision = await uow.tx.approvalDecision.findFirst({ where: { requestId: input.requestId, decision: "approve" }, orderBy: { at: "desc" } });
  await uow.tx.approvalRequest.update({ where: { id: input.requestId }, data: { consumedAt: uow.now, version: { increment: 1 } } });
  uow.audit({ eventType: "approval.consumed", entityType: "ApprovalRequest", entityId: input.requestId, approverId: decision?.decidedById ?? null, after: { action: input.action, targetId: input.targetId } });
  return { approverId: decision?.decidedById ?? null };
}

// features/keystone/lib/approvalAppliers.ts
var appliers = /* @__PURE__ */ new Map();
function registerApplier(action, apply, options = {}) {
  if (appliers.has(action)) throw new Error(`Applier for ${action} already registered`);
  appliers.set(action, { apply, applyOnApprove: options.applyOnApprove ?? true });
}
function applierFor(action) {
  return appliers.get(action) ?? null;
}

// features/keystone/lib/practiceControls.ts
var FEATURE_KEYS = ["boarding", "grooming", "wellnessPlans", "insurance", "aiVoice", "scribe", "multiLocation", "pdmp", "csos", "drugCabinet"];
var CONTROL_KEYS = ["refundApprovalThresholdMinor", "discountApprovalThresholdBps", "writeOffRequiresApproval", "electiveDepositPct", "estimateValidityDays", "noShowGraceMinutes", "strictAgentOwnerSoD", "features"];
var intIn = (value, min, max, name) => {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new DomainError(Codes.INVALID_INPUT, `${name} must be a whole number from ${min} to ${max}.`, { field: name });
};
var bool = (value, name) => {
  if (typeof value !== "boolean") throw new DomainError(Codes.INVALID_INPUT, `${name} must be true or false.`, { field: name });
  return value;
};
function validatePracticeControls(input) {
  const out = {};
  const keys = Object.keys(input ?? {});
  if (!keys.length) throw new DomainError(Codes.INVALID_INPUT, "Nothing to change.");
  for (const key2 of keys) if (!CONTROL_KEYS.includes(key2)) throw new DomainError(Codes.INVALID_INPUT, `${key2} is not a practice control.`, { field: key2 });
  if (input.refundApprovalThresholdMinor !== void 0) {
    const text17 = String(input.refundApprovalThresholdMinor);
    if (!/^\d{1,12}$/.test(text17)) throw new DomainError(Codes.INVALID_INPUT, "refundApprovalThresholdMinor must be whole cents, as text.", { field: "refundApprovalThresholdMinor" });
    out.refundApprovalThresholdMinor = text17;
  }
  if (input.discountApprovalThresholdBps !== void 0) {
    intIn(input.discountApprovalThresholdBps, 0, 1e4, "discountApprovalThresholdBps");
    out.discountApprovalThresholdBps = input.discountApprovalThresholdBps;
  }
  if (input.writeOffRequiresApproval !== void 0) out.writeOffRequiresApproval = bool(input.writeOffRequiresApproval, "writeOffRequiresApproval");
  if (input.electiveDepositPct !== void 0) {
    const pct = dec(String(input.electiveDepositPct));
    if (pct.isNegative() || pct.greaterThan(1) || pct.decimalPlaces() > 6) throw new DomainError(Codes.INVALID_INPUT, "electiveDepositPct is a fraction from 0 to 1 (0.5 = 50%).", { field: "electiveDepositPct" });
    out.electiveDepositPct = plain(pct);
  }
  if (input.estimateValidityDays !== void 0) {
    intIn(input.estimateValidityDays, 1, 365, "estimateValidityDays");
    out.estimateValidityDays = input.estimateValidityDays;
  }
  if (input.noShowGraceMinutes !== void 0) {
    intIn(input.noShowGraceMinutes, 0, 240, "noShowGraceMinutes");
    out.noShowGraceMinutes = input.noShowGraceMinutes;
  }
  if (input.strictAgentOwnerSoD !== void 0) out.strictAgentOwnerSoD = bool(input.strictAgentOwnerSoD, "strictAgentOwnerSoD");
  if (input.features !== void 0) {
    if (!input.features || typeof input.features !== "object") throw new DomainError(Codes.INVALID_INPUT, "features must be an object of flags.");
    const features = {};
    for (const [k, v] of Object.entries(input.features)) {
      if (!FEATURE_KEYS.includes(k)) throw new DomainError(Codes.INVALID_INPUT, `${k} is not a feature flag.`, { field: k });
      features[k] = bool(v, k);
    }
    out.features = features;
  }
  return out;
}
async function requestPracticeControlsChange(uow, actor, input, reason) {
  const changes = validatePracticeControls(input);
  const practice = await uow.tx.practiceSettings.findUnique({ where: { id: 1 } });
  if (!practice) throw new DomainError(Codes.NOT_FOUND, "Practice settings are not set up yet.");
  return requestApproval(uow, actor, {
    action: "practice.controls",
    targetList: "PracticeSettings",
    targetId: "1",
    payload: { changes, baseVersion: practice.version },
    requiredPermission: "canApprovePolicies",
    summary: `Change practice controls: ${Object.keys(changes).join(", ")}${reason ? ` (${reason})` : ""}`
  });
}
registerApplier("practice.controls", async (uow, actor, request) => {
  const [row] = await uow.tx.$queryRaw`SELECT version FROM "PracticeSettings" WHERE id = 1 FOR UPDATE`;
  if (!row) throw new DomainError(Codes.NOT_FOUND, "Practice settings are not set up yet.");
  const { changes, baseVersion } = request.payload;
  if (row.version !== baseVersion) throw new DomainError(Codes.STALE_STATE, "Practice settings changed after this was approved. Request the change again.", { currentVersion: row.version });
  const before = await uow.tx.practiceSettings.findUniqueOrThrow({ where: { id: 1 } });
  const data = { ...changes, version: { increment: 1 } };
  if (changes.refundApprovalThresholdMinor !== void 0) data.refundApprovalThresholdMinor = BigInt(changes.refundApprovalThresholdMinor);
  if (changes.features) data.features = { ...before.features ?? {}, ...changes.features };
  const updated = await uow.tx.practiceSettings.updateMany({ where: { id: 1, version: baseVersion }, data });
  if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, "Practice settings changed while applying.");
  const pick = (k) => before[k];
  uow.audit({
    eventType: "practice.controls_changed",
    entityType: "PracticeSettings",
    entityId: "1",
    actorUserId: actor.kind === "user" ? actor.userId : null,
    before: Object.fromEntries(Object.keys(changes).map((k) => [k, typeof pick(k) === "bigint" ? String(pick(k)) : pick(k)])),
    after: changes
  });
  return { applied: Object.keys(changes) };
});

// features/keystone/mutations/approvals.ts
async function decideApprovalRequest(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canAccessDashboard");
  if (args.decision !== "approve" && args.decision !== "reject") throw new DomainError(Codes.INVALID_INPUT, "Decision must be approve or reject.");
  if (args.decision === "reject" && !args.reason?.trim()) throw new DomainError(Codes.INVALID_INPUT, "Say why you are rejecting it.", { field: "reason" });
  const result = await command(context.prisma, { name: "approval.decide", actor, idempotencyKey: args.idempotencyKey, params: { requestId: args.requestId, decision: args.decision, reason: args.reason ?? "", expectedVersion: args.expectedVersion } }, async (uow) => {
    const practice = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { strictAgentOwnerSoD: true } });
    const decided = await decideApproval(uow, actor, { requestId: args.requestId, decision: args.decision, reason: args.reason ?? void 0, expectedVersion: args.expectedVersion, strictAgentOwner: practice?.strictAgentOwnerSoD ?? true });
    let applied = null;
    const registration = applierFor(String(decided.action));
    if (args.decision === "approve" && registration?.applyOnApprove) {
      const request = await uow.tx.approvalRequest.findUniqueOrThrow({ where: { id: args.requestId } });
      await consumeApproval(uow, { requestId: request.id, action: request.action, targetList: request.targetList, targetId: request.targetId, payload: request.payload });
      applied = await registration.apply(uow, actor, request);
    }
    return { id: decided.id, status: decided.status, applied };
  });
  return { replay: result.replay, ...result.value };
}
async function cancelApprovalRequest(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canAccessDashboard");
  const result = await command(context.prisma, { name: "approval.cancel", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
    const row = await transition(uow, {
      model: "ApprovalRequest",
      id: args.requestId,
      from: ["pending"],
      to: "cancelled",
      expectedVersion: args.expectedVersion,
      actor,
      eventType: "approval.cancelled",
      reason: args.reason ?? null,
      guard: (request) => {
        if (actor.kind !== "user" || request.requestedById !== actor.userId) throw new DomainError(Codes.NOT_AUTHORIZED, "Only the person who asked can withdraw a request.");
      }
    });
    return { id: row.id, status: row.status };
  });
  return { replay: result.replay, ...result.value };
}
async function requestPracticeControls(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canManagePractice", "canManagePolicies");
  if (!args.reason?.trim()) throw new DomainError(Codes.INVALID_INPUT, "Say why the controls should change.", { field: "reason" });
  const result = await command(context.prisma, { name: "practice.controls.request", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
    const request = await requestPracticeControlsChange(uow, actor, args.changes, args.reason.trim());
    return { id: request.id, status: request.status };
  });
  return { replay: result.replay, ...result.value };
}

// features/keystone/mutations/practice.ts
async function policyInForce(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canAccessDashboard");
  if (!POLICY_KIND_NAMES.includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, `Unknown policy kind ${args.kind}.`, { field: "kind" });
  const location = await context.prisma.location.findUnique({ where: { id: args.locationId }, select: { timeZone: true } });
  if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
  const on = args.on || localDate({ timeZone: location.timeZone }, /* @__PURE__ */ new Date());
  return resolvePolicy(context.prisma, args.kind, { locationId: args.locationId, on });
}
async function policyMatrix(_root, _args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canAccessDashboard");
  const locations = await context.prisma.location.findMany({ where: { active: true }, select: { id: true, code: true, name: true, timeZone: true }, orderBy: { code: "asc" } });
  const snapshot = await loadPolicySnapshot(context.prisma, POLICY_KIND_NAMES);
  const rows = [];
  for (const loc of locations) {
    const on = localDate({ timeZone: loc.timeZone }, /* @__PURE__ */ new Date());
    for (const kind of POLICY_KIND_NAMES) {
      try {
        const p = resolveFromSnapshot(snapshot, kind, { locationId: loc.id, on });
        rows.push({ location: loc.code, locationName: loc.name, kind, on, ok: true, verified: p.verified, versions: p.versions, unverifiedRules: p.unverifiedRules });
      } catch (error) {
        rows.push({ location: loc.code, locationName: loc.name, kind, on, ok: false, code: error.code ?? "ERROR", message: error.message });
      }
    }
  }
  return rows;
}

// features/keystone/mutations/clients.ts
var text15 = (value, field, max = 200, required = true) => {
  const out = String(value ?? "").trim();
  if (required && !out) throw new DomainError(Codes.INVALID_INPUT, `${field} is required.`, { field });
  if (out.length > max) throw new DomainError(Codes.INVALID_INPUT, `${field} is too long.`, { field });
  return out;
};
async function existingContacts(uow, contacts) {
  const hashes = contacts.map((c) => contactHash(normaliseContact(c.kind, c.value)));
  if (!hashes.length) return [];
  return uow.tx.contactPoint.findMany({ where: { valueHash: { in: hashes }, status: "active" }, select: { id: true, person: { select: { clientId: true } } } });
}
async function createPerson(uow, actor, clientId, person, isPrimary, source) {
  const row = await uow.tx.clientPerson.create({
    data: {
      clientId,
      firstName: text15(person.firstName, "firstName", 80),
      lastName: text15(person.lastName, "lastName", 80),
      relationship: person.relationship ?? "owner",
      isPrimary,
      canBook: true,
      canApproveTreatment: isPrimary,
      canReceiveRecords: isPrimary,
      canPay: true,
      canAuthoriseEuthanasia: isPrimary
    }
  });
  auditCreate(uow, actor, "ClientPerson", row.id, "client_person.created", { clientId, isPrimary, relationship: row.relationship, source });
  const seenKinds = /* @__PURE__ */ new Set();
  for (const contact of person.contacts) {
    const value = normaliseContact(contact.kind, contact.value);
    const primary = !seenKinds.has(contact.kind);
    seenKinds.add(contact.kind);
    const cp = await uow.tx.contactPoint.create({ data: { personId: row.id, kind: contact.kind, value, valueHash: contactHash(value), isPrimary: primary, canText: contact.kind === "mobile" && contact.canText !== false, status: "active" } });
    auditCreate(uow, actor, "ContactPoint", cp.id, "contact_point.created", { personId: row.id, kind: contact.kind, isPrimary: primary });
    await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: "transactional", action: "grant", method: source === "ai_voice" ? "verbal_recorded" : "staff_entry", capturedByUserId: actorUserId(actor), capturedByAgentId: actorAgentId(actor), at: uow.now } });
  }
  return row;
}
async function createPatient(uow, actor, clientId, input, status) {
  const species = await uow.tx.species.findUnique({ where: { code: text15(input.speciesCode, "speciesCode", 40) } });
  if (!species || !species.active) throw new DomainError(Codes.INVALID_INPUT, `Unknown species ${input.speciesCode}.`, { field: "speciesCode" });
  const breed = input.breedName ? await uow.tx.breed.findFirst({ where: { speciesId: species.id, name: { equals: input.breedName.trim(), mode: "insensitive" } } }) : null;
  if (input.dateOfBirth && !/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) throw new DomainError(Codes.INVALID_INPUT, "dateOfBirth is YYYY-MM-DD.", { field: "dateOfBirth" });
  if (input.dateOfBirth && input.dateOfBirth > uow.now.toISOString().slice(0, 10)) throw new DomainError(Codes.INVALID_INPUT, "dateOfBirth is in the future.", { field: "dateOfBirth" });
  let chip = null;
  if (input.microchip) {
    const number = input.microchip.replace(/[\s-]/g, "").toUpperCase();
    chip = { number, standard: microchipStandard(number) };
    const clash = await uow.tx.microchip.findFirst({ where: { number, active: true }, select: { patient: { select: { ref: true } } } });
    if (clash) throw new DomainError(Codes.DUPLICATE_SUSPECTED, `That microchip is already on file (${clash.patient?.ref ?? "another patient"}).`, { field: "microchip" });
  }
  const ref = await nextSerial(uow.tx, "P");
  const patient = await uow.tx.patient.create({
    data: {
      ref,
      name: text15(input.name, "name", 80),
      kind: "individual",
      speciesId: species.id,
      breedId: breed?.id ?? null,
      sex: input.sex ?? "unknown",
      reproductiveStatus: input.reproductiveStatus ?? "unknown",
      dateOfBirth: input.dateOfBirth ? /* @__PURE__ */ new Date(`${input.dateOfBirth}T00:00:00Z`) : null,
      dobEstimated: input.dobEstimated === true,
      status,
      codeStatus: "unspecified"
    }
  });
  await uow.tx.patientOwnership.create({ data: { patientId: patient.id, clientId, role: "primary", effectiveFrom: uow.now, basis: "registration", recordedById: actorUserId(actor) } });
  if (chip) await uow.tx.microchip.create({ data: { patientId: patient.id, number: chip.number, standard: chip.standard, active: true } });
  auditCreate(uow, actor, "Patient", patient.id, "patient.registered", { ref, clientId, species: species.code, status, microchip: chip?.number ?? null });
  return patient;
}
async function registerClient(_root, args, context) {
  return gated(context, { permissions: ["canManageClients"], tool: "client.register", humanOnly: true }, args, async (actor) => {
    const input = args.input;
    if (!input.people?.length) throw new DomainError(Codes.INVALID_INPUT, "Add at least one person.", { field: "people" });
    const result = await command(context.prisma, { name: "client.register", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, stateCode: true } });
      if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
      const contacts = input.people.flatMap((p) => p.contacts ?? []);
      const dupes = await existingContacts(uow, contacts);
      if (dupes.length && !input.allowDuplicate) {
        throw new DomainError(Codes.DUPLICATE_SUSPECTED, "A household with this phone or email is already on file. Open it, or confirm this is a different household.", { reason: "contact_match" });
      }
      const primary = input.people[0];
      const ref = await nextSerial(uow.tx, "C");
      const client = await uow.tx.client.create({
        data: {
          ref,
          publicCode: publicCode("CL"),
          displayName: text15(input.displayName || `${primary.lastName} household`, "displayName", 120),
          kind: input.kind ?? "household",
          status: "active",
          primaryLocationId: location.id,
          addressLine1: input.addressLine1 ?? "",
          city: input.city ?? "",
          stateCode: location.stateCode,
          postalCode: input.postalCode ?? "",
          source: "csr",
          accountFlags: {}
        }
      });
      auditCreate(uow, actor, "Client", client.id, "client.registered", { ref, kind: client.kind, source: "csr", duplicateOverride: dupes.length > 0 });
      for (const [i, person] of input.people.entries()) await createPerson(uow, actor, client.id, person, i === 0, "csr");
      const patients = [];
      for (const p of input.patients ?? []) patients.push(await createPatient(uow, actor, client.id, p, "active"));
      return { id: client.id, ref, patients: patients.map((p) => ({ id: p.id, ref: p.ref, name: p.name })) };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function registerPendingClient(_root, args, context) {
  return gated(context, { permissions: ["canManageClients", "canBook"], scope: "reception.register", tool: "client.register_pending" }, args, async (actor) => {
    const input = args.input;
    const result = await command(context.prisma, { name: "client.register_pending", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, stateCode: true } });
      if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
      const contacts = [{ kind: "mobile", value: input.phone }, ...input.email ? [{ kind: "email", value: input.email }] : []];
      const dupes = await existingContacts(uow, contacts);
      const ref = await nextSerial(uow.tx, "C");
      const source = actor.kind === "agent" ? "ai_voice" : "csr";
      const client = await uow.tx.client.create({
        data: { ref, publicCode: publicCode("CL"), displayName: `${text15(input.lastName, "lastName", 80)} household`, kind: "household", status: "prospect", primaryLocationId: location.id, stateCode: location.stateCode, source, accountFlags: dupes.length ? { possibleDuplicate: true } : {} }
      });
      auditCreate(uow, actor, "Client", client.id, "client.registered_pending", { ref, source, possibleDuplicate: dupes.length > 0 });
      await createPerson(uow, actor, client.id, { firstName: input.firstName, lastName: input.lastName, relationship: "owner", contacts }, true, source);
      const patient = await createPatient(uow, actor, client.id, input.pet, "pending");
      const task = await uow.tx.task.create({
        data: { kind: "registration_review", title: `Confirm new client ${ref}${dupes.length ? " (possible duplicate)" : ""}`, subjectType: "Client", subjectId: client.id, locationId: location.id, priority: dupes.length ? "high" : "normal", status: "open", dueAt: new Date(uow.now.getTime() + 24 * 36e5), createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) }
      });
      auditCreate(uow, actor, "Task", task.id, "task.created", { kind: "registration_review", clientId: client.id });
      return { clientId: client.id, clientRef: ref, patientId: patient.id, patientRef: patient.ref, possibleDuplicate: dupes.length > 0 };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function confirmRegistration(_root, args, context) {
  return gated(context, { permissions: ["canManageClients"], tool: "client.confirm", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "client.confirm", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "Client", id: args.clientId, from: ["prospect"], to: "active", expectedVersion: args.expectedVersion, actor, eventType: "client.confirmed" });
      const pets = await uow.tx.patient.findMany({ where: { status: "pending", ownerships: { some: { clientId: args.clientId, effectiveTo: null } } }, select: { id: true, version: true } });
      for (const p of pets) await transition(uow, { model: "Patient", id: p.id, from: ["pending"], to: "active", actor, eventType: "patient.confirmed" });
      await uow.tx.task.updateMany({ where: { subjectType: "Client", subjectId: args.clientId, kind: "registration_review", status: { in: ["open", "in_progress"] } }, data: { status: "done", completedAt: uow.now, version: { increment: 1 } } });
      return { id: row.id, status: row.status, patientsConfirmed: pets.length };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addPatient(_root, args, context) {
  return gated(context, { permissions: ["canManagePatients", "canManageClients"], scope: "reception.register", tool: "patient.register_pending" }, args, async (actor) => {
    const result = await command(context.prisma, { name: "patient.add", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const client = await uow.tx.client.findUnique({ where: { id: args.clientId }, select: { status: true } });
      if (!client) throw new DomainError(Codes.NOT_FOUND, "Client not found.");
      if (["merged", "closed"].includes(client.status)) throw new DomainError(Codes.GUARD_FAILED, `The client is ${client.status}.`);
      const patient = await createPatient(uow, actor, args.clientId, args.input, actor.kind === "agent" ? "pending" : "active");
      return { id: patient.id, ref: patient.ref, status: patient.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
var DUPLICATE_WEIGHT_WINDOW_MS = 10 * 60 * 1e3;
async function recordWeight(_root, args, context) {
  return gated(context, { permissions: ["canCheckIn", "canWriteRecord"], tool: "patient.weight", humanOnly: true }, args, async (actor) => {
    if (!["kg", "lb", "g"].includes(args.unit)) throw new DomainError(Codes.INVALID_INPUT, "Unit is kg, lb or g.", { field: "unit" });
    if (!/^\d{1,6}(\.\d{1,4})?$/.test(String(args.value))) throw new DomainError(Codes.INVALID_INPUT, "Weight is a positive number with up to 4 decimals.", { field: "value" });
    const value = dec(args.value);
    if (value.lte(0)) throw new DomainError(Codes.INVALID_INPUT, "Weight must be above zero.", { field: "value" });
    const result = await command(context.prisma, { name: "patient.weight", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const patient = await uow.tx.patient.findUnique({ where: { id: args.patientId }, select: { status: true } });
      if (!patient) throw new DomainError(Codes.NOT_FOUND, "Patient not found.");
      if (patient.status === "deceased" || patient.status === "merged") throw new DomainError(Codes.PATIENT_DECEASED, `The patient is ${patient.status}.`);
      const staff = actor.kind === "user" ? await uow.tx.staffMember.findFirst({ where: { userId: actor.userId }, select: { id: true } }) : null;
      const recent = await uow.tx.weightMeasurement.findFirst({
        where: { patientId: args.patientId, unit: args.unit, value: toScale(value, "wt"), measuredAt: { gte: new Date(uow.now.getTime() - DUPLICATE_WEIGHT_WINDOW_MS) } },
        orderBy: { measuredAt: "desc" },
        select: { id: true, valueKg: true }
      });
      if (recent) return { id: recent.id, valueKg: recent.valueKg.toString(), duplicate: true };
      const row = await uow.tx.weightMeasurement.create({
        data: {
          patientId: args.patientId,
          value: toScale(value, "wt"),
          unit: args.unit,
          valueKg: toScale(toKg(value, args.unit), "wt"),
          method: args.method ?? "scale",
          bodyConditionScore: args.bodyConditionScore ?? null,
          measuredAt: uow.now,
          measuredById: staff?.id ?? null,
          appointmentId: args.appointmentId ?? null
        }
      });
      auditCreate(uow, actor, "WeightMeasurement", row.id, "patient.weight_recorded", { patientId: args.patientId, value: row.value.toString(), unit: row.unit, valueKg: row.valueKg.toString() });
      return { id: row.id, valueKg: row.valueKg.toString(), duplicate: false };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addPatientAlert(_root, args, context) {
  return gated(context, { permissions: ["canManagePatients", "canWriteRecord"], tool: "patient.alert", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "patient.alert.add", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await uow.tx.patientAlert.create({ data: { patientId: args.patientId, kind: args.kind, severity: args.severity, text: text15(args.text, "text", 500), active: true, createdById: actorUserId(actor) } });
      auditCreate(uow, actor, "PatientAlert", row.id, "patient.alert_added", { patientId: args.patientId, kind: args.kind, severity: args.severity });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function recordConsent(_root, args, context) {
  return gated(context, { permissions: ["canManageClients", "canMessageClients"], tool: "consent.record", humanOnly: true }, args, async (actor) => {
    if (!["care", "transactional", "marketing", "ai_voice", "recording"].includes(args.purpose)) throw new DomainError(Codes.INVALID_INPUT, "Unknown consent purpose.", { field: "purpose" });
    if (!["grant", "revoke"].includes(args.action)) throw new DomainError(Codes.INVALID_INPUT, "Action is grant or revoke.", { field: "action" });
    if (args.action === "grant" && ["marketing", "ai_voice"].includes(args.purpose) && !["web_form", "sms_keyword", "verbal_recorded", "paper", "portal"].includes(args.method)) {
      throw new DomainError(Codes.CONSENT_REQUIRED, `${args.purpose} consent needs written or recorded evidence.`, { field: "method" });
    }
    const result = await command(context.prisma, { name: "consent.record", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await uow.tx.consentRecord.create({ data: { contactPointId: args.contactPointId, purpose: args.purpose, action: args.action, method: args.method, callRecordId: args.callRecordId ?? null, keyword: args.keyword ?? "", capturedByUserId: actorUserId(actor), at: uow.now } });
      auditCreate(uow, actor, "ConsentRecord", row.id, `consent.${args.action}`, { contactPointId: args.contactPointId, purpose: args.purpose, method: args.method });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function recordPatientDeath(_root, args, context) {
  return gated(context, { permissions: ["canManagePatients"], tool: "patient.record_death", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "patient.record_death", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const at = args.diedAt ? new Date(args.diedAt) : uow.now;
      if (Number.isNaN(at.getTime()) || at > uow.now) throw new DomainError(Codes.INVALID_INPUT, "diedAt must be a past time.", { field: "diedAt" });
      await transition(uow, { model: "Patient", id: args.patientId, from: ["active", "pending", "inactive"], to: "deceased", expectedVersion: args.expectedVersion, actor, eventType: "patient.deceased", data: { deceasedAt: at } });
      await uow.tx.suppression.create({ data: { patientId: args.patientId, reason: "deceased", active: true } });
      const future = await uow.tx.appointmentPatient.findMany({ where: { patientId: args.patientId, appointment: { startsAt: { gt: uow.now }, status: { in: ["requested", "booked", "confirmed"] } } }, select: { appointmentId: true } });
      let cancelled = 0;
      for (const { appointmentId } of future) {
        const others = await uow.tx.appointmentPatient.count({ where: { appointmentId, patientId: { not: args.patientId }, status: { notIn: ["cancelled"] } } });
        if (others === 0 && appointmentId) {
          await transition(uow, { model: "Appointment", id: appointmentId, from: ["requested", "booked", "confirmed"], to: "cancelled", actor, eventType: "appointment.cancelled", reason: "deceased", data: { cancelReason: "deceased", cancelledAt: uow.now } });
          await uow.tx.resourceReservation.updateMany({ where: { appointmentId, status: { not: "released" } }, data: { status: "released" } });
          await uow.tx.providerReservation.updateMany({ where: { appointmentId, status: { not: "released" } }, data: { status: "released" } });
          cancelled += 1;
        }
      }
      return { id: args.patientId, status: "deceased", appointmentsCancelled: cancelled };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/mutations/schedule.ts
var STEP_MINUTES = 15;
var list18 = (v) => Array.isArray(v) ? v.map(String) : [];
async function loadAvailability(tx, input) {
  const [location, type] = await Promise.all([
    tx.location.findUnique({ where: { id: input.locationId }, select: { id: true, timeZone: true, active: true } }),
    tx.appointmentType.findUnique({ where: { id: input.appointmentTypeId } })
  ]);
  if (!location?.active) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
  if (!type?.active) throw new DomainError(Codes.NOT_FOUND, "Appointment type not found.");
  const providerKinds = list18(type.providerKinds);
  const resourceKinds = list18(type.requiredResourceKinds);
  const windowStart = (/* @__PURE__ */ new Date(`${input.from}T00:00:00Z`)).getTime() - 864e5;
  const windowEnd = (/* @__PURE__ */ new Date(`${addDays(input.from, input.days)}T00:00:00Z`)).getTime() + 864e5;
  const range = { startsAt: { lt: new Date(windowEnd) }, endsAt: { gt: new Date(windowStart) }, status: { not: "released" } };
  const [staff, resources] = await Promise.all([
    tx.staffMember.findMany({
      where: { active: true, kind: { in: providerKinds.length ? providerKinds : ["dvm"] }, ...input.providerId ? { id: input.providerId } : {}, OR: [{ homeLocationId: location.id }, { locations: { some: { id: location.id } } }] },
      select: { id: true, displayName: true }
    }),
    tx.resource.findMany({ where: { locationId: location.id, active: true, kind: { in: resourceKinds.length ? resourceKinds : ["exam_room"] } }, select: { id: true, name: true, kind: true } })
  ]);
  const staffIds = staff.map((s) => s.id);
  const [schedules, providerBusy, resourceBusy] = await Promise.all([
    tx.staffSchedule.findMany({ where: { staffMemberId: { in: staffIds }, locationId: location.id } }),
    tx.providerReservation.findMany({ where: { staffMemberId: { in: staffIds }, ...range }, select: { staffMemberId: true, startsAt: true, endsAt: true } }),
    tx.resourceReservation.findMany({ where: { resourceId: { in: resources.map((r) => r.id) }, ...range }, select: { resourceId: true, startsAt: true, endsAt: true } })
  ]);
  return { location, type, staff, resources, schedules, providerBusy, resourceBusy };
}
var asInterval = (r) => ({ start: r.startsAt.getTime(), end: r.endsAt.getTime() });
var isoDay2 = (d) => d ? d.toISOString().slice(0, 10) : null;
function computeSlots(data, input) {
  const category = String(data.type.category);
  const out = [];
  for (let i = 0; i < input.days && out.length < input.limit; i += 1) {
    const date = addDays(input.from, i);
    const providers = data.staff.map((s) => ({
      id: s.id,
      working: workingIntervals(
        data.schedules.filter((b) => b.staffMemberId === s.id).map((b) => ({
          kind: b.kind,
          weekday: b.weekday,
          localDate: isoDay2(b.localDate),
          startTime: b.startTime,
          endTime: b.endTime,
          categories: list18(b.appointmentCategories),
          effectiveFrom: isoDay2(b.effectiveFrom),
          effectiveTo: isoDay2(b.effectiveTo)
        })),
        date,
        data.location.timeZone,
        category
      ),
      busy: data.providerBusy.filter((r) => r.staffMemberId === s.id).map(asInterval)
    }));
    const resources = data.resources.map((r) => ({ id: r.id, busy: data.resourceBusy.filter((b) => b.resourceId === r.id).map(asInterval) }));
    out.push(...findSlots({ minutes: data.type.durationMinutes, stepMinutes: STEP_MINUTES, notBefore: input.notBefore, providers, resources, limit: input.limit - out.length }));
  }
  return out;
}
async function searchAvailability(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.read", tool: "schedule.search" }, args, async (actor) => {
    const days2 = Math.min(Math.max(args.days ?? 7, 1), 21);
    const limit = Math.min(Math.max(args.limit ?? 12, 1), 50);
    const now = Date.now();
    const location = await context.prisma.location.findUnique({ where: { id: args.locationId }, select: { timeZone: true } });
    if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
    const from = args.from && /^\d{4}-\d{2}-\d{2}$/.test(args.from) ? args.from : localDate({ timeZone: location.timeZone }, now);
    const data = await loadAvailability(context.prisma, { locationId: args.locationId, appointmentTypeId: args.appointmentTypeId, from, days: days2, providerId: args.providerId });
    if (actor.kind === "agent" && !data.type.aiBookable) throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, `${data.type.name} is booked by the front desk, not the AI receptionist.`);
    const names = new Map([...data.staff.map((s) => [s.id, s.displayName]), ...data.resources.map((r) => [r.id, r.name])]);
    const slots = computeSlots(data, { from, days: days2, notBefore: now + 15 * 6e4, limit });
    return {
      appointmentType: { id: data.type.id, name: data.type.name, durationMinutes: data.type.durationMinutes, requestOnly: data.type.requestOnly },
      slots: slots.map((s) => ({
        startsAt: new Date(s.start).toISOString(),
        endsAt: new Date(s.end).toISOString(),
        providerId: s.providerId,
        providerName: names.get(s.providerId) ?? "",
        resourceName: names.get(s.resourceId) ?? "",
        slotToken: signSlot({ providerId: s.providerId, resourceId: s.resourceId, appointmentTypeId: data.type.id, locationId: args.locationId, start: s.start, end: s.end }, now)
      }))
    };
  });
}
async function lockSlot(uow, claims, timeZone) {
  const keys = [`resource:${claims.resourceId}`, `provider-day:${claims.providerId}:${localDate({ timeZone }, claims.start)}`].sort();
  for (const key2 of keys) await advisoryLock(uow.tx, key2);
}
async function agentBookingChecks(uow, input, category) {
  if (!input.callRecordId) throw new DomainError(Codes.GUARD_FAILED, "An AI booking belongs to a call.", { field: "callRecordId" });
  const call2 = await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { disclosurePlayedAt: true, callerVerifiedAt: true, clientId: true, status: true } });
  if (!call2 || call2.status !== "in_progress") throw new DomainError(Codes.GUARD_FAILED, "The call is not in progress.");
  if (!call2.disclosurePlayedAt) throw new DomainError(Codes.GUARD_FAILED, "The AI disclosure has not been played on this call.");
  const client = await uow.tx.client.findUnique({ where: { id: input.clientId }, select: { status: true } });
  if (client?.status !== "prospect" && (!call2.callerVerifiedAt || call2.clientId !== input.clientId)) {
    throw new DomainError(Codes.CALLER_NOT_VERIFIED, "Verify the caller before booking for an existing client.");
  }
  if (category === "sick" || category === "recheck") {
    if (!input.triageId) throw new DomainError(Codes.GUARD_FAILED, "A sick visit booked by the AI receptionist needs the urgency screen first.", { field: "triageId" });
  }
}
async function bookAppointment(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.book", tool: "appointment.book" }, args, async (actor) => {
    const input = args.input;
    const claims = verifySlot(input.slotToken);
    if (!input.patientIds?.length) throw new DomainError(Codes.INVALID_INPUT, "Pick at least one patient.", { field: "patientIds" });
    const result = await command(context.prisma, { name: "appointment.book", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => bookInTx(uow, actor, input, claims));
    return { replay: result.replay, ...result.value };
  });
}
async function bookInTx(uow, actor, input, claims) {
  const [type, location] = await Promise.all([
    uow.tx.appointmentType.findUnique({ where: { id: claims.appointmentTypeId } }),
    uow.tx.location.findUnique({ where: { id: claims.locationId }, select: { id: true, timeZone: true } })
  ]);
  if (!type?.active || !location) throw new DomainError(Codes.SLOT_TOKEN_INVALID, "That slot is no longer offered.");
  if (actor.kind === "agent") {
    if (!type.aiBookable) throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, `${type.name} is booked by the front desk.`);
    await agentBookingChecks(uow, input, String(type.category));
  }
  if (input.triageId) {
    const triage = await uow.tx.triageAssessment.findUnique({ where: { id: input.triageId }, select: { level: true } });
    if (!triage) throw new DomainError(Codes.NOT_FOUND, "Triage not found.");
    if (triage.level === "emergency_now") throw new DomainError(Codes.GUARD_FAILED, "This is an emergency: transfer the call or refer to the ER now. It is never booked as an appointment.");
  }
  const patients = await uow.tx.patient.findMany({ where: { id: { in: input.patientIds } }, select: { id: true, status: true, name: true, ownerships: { where: { effectiveTo: null }, select: { clientId: true } } } });
  if (patients.length !== new Set(input.patientIds).size) throw new DomainError(Codes.NOT_FOUND, "A patient was not found.");
  for (const p of patients) {
    if (p.status === "deceased") throw new DomainError(Codes.PATIENT_DECEASED, `${p.name} has died. Appointments can't be booked.`);
    if (p.status === "merged" || p.status === "inactive") throw new DomainError(Codes.GUARD_FAILED, `${p.name}'s record is ${p.status}.`);
    if (!p.ownerships.some((o) => o.clientId === input.clientId)) throw new DomainError(Codes.GUARD_FAILED, `${p.name} is not on this client's account.`);
  }
  const startsAt = new Date(claims.start);
  const endsAt = new Date(claims.end);
  const clash = async () => {
    const [providerClash, resourceClash] = await Promise.all([
      uow.tx.providerReservation.count({ where: { staffMemberId: claims.providerId, status: { not: "released" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } }),
      uow.tx.resourceReservation.count({ where: { resourceId: claims.resourceId, status: { not: "released" }, startsAt: { lt: endsAt }, endsAt: { gt: startsAt } } })
    ]);
    if (providerClash || resourceClash) throw new DomainError(Codes.SLOT_TAKEN, "That time was just taken. Pick another slot.");
  };
  await clash();
  await lockSlot(uow, claims, location.timeZone);
  await clash();
  const status = type.requestOnly ? "requested" : "booked";
  const holdStatus = type.requestOnly ? "held" : "confirmed";
  const ref = await nextReference(uow.tx, "APT", uow.now);
  const channel = actor.kind === "agent" ? "ai_voice" : input.channel ?? "csr";
  const appointment = await uow.tx.appointment.create({
    data: {
      ref,
      locationId: location.id,
      clientId: input.clientId,
      appointmentTypeId: type.id,
      providerId: claims.providerId,
      startsAt,
      endsAt,
      status,
      channel,
      bookedByUserId: actorUserId(actor),
      bookedByAgentId: actorAgentId(actor),
      slotToken: input.slotToken.slice(-43),
      reason: String(input.reason ?? "").slice(0, 500),
      triageId: input.triageId ?? null,
      callRecordId: input.callRecordId ?? null
    }
  });
  await uow.tx.appointmentPatient.createMany({ data: input.patientIds.map((patientId) => ({ appointmentId: appointment.id, patientId, reason: String(input.reason ?? "").slice(0, 500) })) });
  const segments = buildSegments(type.segments, claims.start, type.durationMinutes);
  await uow.tx.appointmentSegment.createMany({ data: segments.map((s) => ({ appointmentId: appointment.id, kind: s.kind, startsAt: s.startsAt, endsAt: s.endsAt, resourceId: claims.resourceId, staffId: claims.providerId })) });
  await uow.tx.resourceReservation.create({ data: { resourceId: claims.resourceId, appointmentId: appointment.id, startsAt, endsAt, status: holdStatus } });
  await uow.tx.providerReservation.create({ data: { staffMemberId: claims.providerId, appointmentId: appointment.id, startsAt, endsAt, status: holdStatus } });
  auditCreate(uow, actor, "Appointment", appointment.id, "appointment.booked", { ref, status, startsAt, endsAt, typeCode: type.code, channel, patients: input.patientIds.length });
  return { id: appointment.id, ref, status, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
}
async function noteFreedSlot(uow, appointmentId) {
  const appt = await uow.tx.appointment.findUnique({ where: { id: appointmentId }, select: { id: true, ref: true, startsAt: true, locationId: true, appointmentTypeId: true } });
  if (!appt) return;
  const waiting = await uow.tx.waitlistEntry.count({ where: { status: "waiting", locationId: appt.locationId, OR: [{ appointmentTypeId: appt.appointmentTypeId }, { appointmentTypeId: null }] } });
  if (!waiting) return;
  const open = await uow.tx.task.findFirst({ where: { subjectType: "Appointment", subjectId: appt.id, kind: "follow_up" }, select: { id: true } });
  if (!open) await uow.tx.task.create({ data: { kind: "follow_up", priority: "normal", status: "open", dueAt: uow.now, subjectType: "Appointment", subjectId: appt.id, locationId: appt.locationId, roleName: "csr", title: `Slot freed (${appt.ref}): ${waiting} waiting`, detail: `Offer ${appt.startsAt.toISOString()} to the waitlist.` } });
}
async function releaseHolds(uow, appointmentId) {
  await uow.tx.resourceReservation.updateMany({ where: { appointmentId, status: { not: "released" } }, data: { status: "released" } });
  await uow.tx.providerReservation.updateMany({ where: { appointmentId, status: { not: "released" } }, data: { status: "released" } });
}
async function cancelAppointment(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.book", tool: "appointment.cancel" }, args, async (actor) => {
    if (!args.reason?.trim()) throw new DomainError(Codes.INVALID_INPUT, "Give a reason.", { field: "reason" });
    const result = await command(context.prisma, { name: "appointment.cancel", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, {
        model: "Appointment",
        id: args.appointmentId,
        from: ["requested", "booked", "confirmed"],
        to: "cancelled",
        expectedVersion: args.expectedVersion,
        actor,
        eventType: "appointment.cancelled",
        reason: args.reason,
        data: { cancelReason: args.reason.trim().slice(0, 300), cancelledAt: uow.now },
        guard: async (appt) => {
          if (actor.kind !== "agent") return;
          const call2 = args.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null;
          if (!call2?.callerVerifiedAt || call2.clientId !== appt.clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, "Verify the caller before changing their appointment.");
        }
      });
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id }, data: { status: "cancelled" } });
      await releaseHolds(uow, row.id);
      await noteFreedSlot(uow, row.id);
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function rescheduleAppointment(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.book", tool: "appointment.reschedule" }, args, async (actor) => {
    const claims = verifySlot(args.slotToken);
    const result = await command(context.prisma, { name: "appointment.reschedule", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const old = await uow.tx.appointment.findUnique({ where: { id: args.appointmentId }, select: { id: true, clientId: true, appointmentTypeId: true, triageId: true, reason: true, patients: { select: { patientId: true } } } });
      if (!old) throw new DomainError(Codes.NOT_FOUND, "Appointment not found.");
      if (old.appointmentTypeId !== claims.appointmentTypeId) throw new DomainError(Codes.SLOT_TOKEN_INVALID, "That slot is for a different appointment type.");
      await transition(uow, {
        model: "Appointment",
        id: old.id,
        from: ["requested", "booked", "confirmed"],
        to: "cancelled",
        expectedVersion: args.expectedVersion,
        actor,
        eventType: "appointment.rescheduled_from",
        reason: "rescheduled",
        data: { cancelReason: "rescheduled", cancelledAt: uow.now },
        guard: async () => {
          if (actor.kind !== "agent") return;
          const call2 = args.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null;
          if (!call2?.callerVerifiedAt || call2.clientId !== old.clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, "Verify the caller before changing their appointment.");
        }
      });
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: old.id }, data: { status: "cancelled" } });
      await releaseHolds(uow, old.id);
      const booked = await bookInTx(uow, actor, { slotToken: args.slotToken, clientId: old.clientId, patientIds: old.patients.map((p) => p.patientId), reason: old.reason, callRecordId: args.callRecordId, triageId: old.triageId }, claims);
      return { previousId: old.id, ...booked };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function confirmAppointment(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.book", tool: "appointment.confirm" }, args, async (actor) => {
    const result = await command(context.prisma, { name: "appointment.confirm", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "Appointment", id: args.appointmentId, from: ["booked"], to: "confirmed", expectedVersion: args.expectedVersion, actor, eventType: "appointment.confirmed", data: { confirmedAt: uow.now } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function acceptAppointmentRequest(_root, args, context) {
  return gated(context, { permissions: ["canBook"], tool: "appointment.accept", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "appointment.accept", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "Appointment", id: args.appointmentId, from: ["requested"], to: "booked", expectedVersion: args.expectedVersion, actor, eventType: "appointment.accepted" });
      await uow.tx.resourceReservation.updateMany({ where: { appointmentId: row.id, status: "held" }, data: { status: "confirmed" } });
      await uow.tx.providerReservation.updateMany({ where: { appointmentId: row.id, status: "held" }, data: { status: "confirmed" } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function checkInAppointment(_root, args, context) {
  return gated(context, { permissions: ["canCheckIn"], tool: "appointment.check_in", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "appointment.check_in", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const appt = await uow.tx.appointment.findUnique({ where: { id: args.appointmentId }, select: { locationId: true, patients: { select: { patientId: true } }, segments: { select: { resourceId: true }, take: 1 } } });
      if (!appt) throw new DomainError(Codes.NOT_FOUND, "Appointment not found.");
      const patientIds = appt.patients.map((p) => p.patientId);
      const alerts = await uow.tx.patientAlert.findMany({ where: { patientId: { in: patientIds }, active: true, severity: { in: ["warn", "block"] } }, select: { id: true, text: true } });
      const acked = new Set(args.acknowledgedAlertIds ?? []);
      const missing = alerts.filter((a) => !acked.has(a.id));
      if (missing.length) throw new DomainError(Codes.GUARD_FAILED, `Acknowledge the patient alerts first: ${missing.map((a) => a.text).join("; ")}`, { problems: missing.map((a) => a.id) });
      const row = await transition(uow, { model: "Appointment", id: args.appointmentId, from: ["booked", "confirmed"], to: "checked_in", expectedVersion: args.expectedVersion, actor, eventType: "appointment.checked_in", data: { checkedInAt: uow.now } });
      if (alerts.length) await uow.tx.alertAcknowledgement.createMany({ data: alerts.map((a) => ({ alertId: a.id, userId: actorUserId(actor), appointmentId: row.id, at: uow.now })) });
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id, status: "scheduled" }, data: { status: "checked_in", version: { increment: 1 } } });
      for (const patientId of patientIds) {
        const live = await uow.tx.whiteboardEntry.findFirst({ where: { locationId: appt.locationId, patientId, status: { not: "discharged" } }, select: { id: true } });
        if (!live) {
          const entry = await uow.tx.whiteboardEntry.create({ data: { locationId: appt.locationId, patientId, appointmentId: row.id, status: "waiting", roomId: appt.segments[0]?.resourceId ?? null, since: uow.now, flags: [] } });
          auditCreate(uow, actor, "WhiteboardEntry", entry.id, "whiteboard.added", { patientId, appointmentId: row.id });
        }
      }
      return { id: row.id, status: row.status, alertsAcknowledged: alerts.length };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function markNoShow(_root, args, context) {
  return gated(context, { permissions: ["canCheckIn", "canBook"], tool: "appointment.no_show", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "appointment.no_show", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, {
        model: "Appointment",
        id: args.appointmentId,
        from: ["booked", "confirmed"],
        to: "no_show",
        expectedVersion: args.expectedVersion,
        actor,
        eventType: "appointment.no_show",
        guard: (appt) => {
          if (appt.startsAt.getTime() > uow.now.getTime()) throw new DomainError(Codes.GUARD_FAILED, "The appointment has not started yet.");
        }
      });
      await uow.tx.appointmentPatient.updateMany({ where: { appointmentId: row.id }, data: { status: "no_show" } });
      await releaseHolds(uow, row.id);
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
var BOARD_MOVES = {
  waiting: ["in_exam", "treatment", "diagnostics", "hospitalised", "surgery", "boarding", "ready_for_discharge"],
  in_exam: ["treatment", "diagnostics", "hospitalised", "surgery", "ready_for_discharge", "waiting"],
  treatment: ["in_exam", "diagnostics", "hospitalised", "surgery", "ready_for_discharge"],
  diagnostics: ["in_exam", "treatment", "hospitalised", "surgery", "ready_for_discharge"],
  hospitalised: ["treatment", "diagnostics", "surgery", "ready_for_discharge"],
  surgery: ["recovery"],
  recovery: ["hospitalised", "treatment", "ready_for_discharge"],
  boarding: ["ready_for_discharge", "treatment"],
  ready_for_discharge: ["discharged", "treatment", "hospitalised"]
};
async function moveWhiteboardEntry(_root, args, context) {
  return gated(context, { permissions: ["canCheckIn", "canWriteRecord"], tool: "whiteboard.move", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "whiteboard.move", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const current = await uow.tx.whiteboardEntry.findUnique({ where: { id: args.entryId }, select: { status: true, appointmentId: true } });
      if (!current) throw new DomainError(Codes.NOT_FOUND, "Board entry not found.");
      const allowed = BOARD_MOVES[current.status] ?? [];
      if (!allowed.includes(args.to)) throw new DomainError(Codes.INVALID_TRANSITION, `A patient in ${current.status} can't move to ${args.to}.`, { currentStatus: current.status, to: args.to });
      const row = await transition(uow, {
        model: "WhiteboardEntry",
        id: args.entryId,
        from: [current.status],
        to: args.to,
        expectedVersion: args.expectedVersion,
        actor,
        eventType: "whiteboard.moved",
        data: { since: uow.now, ...args.roomId !== void 0 ? { roomId: args.roomId } : {}, ...args.assignedDvmId !== void 0 ? { assignedDvmId: args.assignedDvmId } : {}, ...args.assignedTechId !== void 0 ? { assignedTechId: args.assignedTechId } : {} }
      });
      if (current.appointmentId && args.to === "in_exam") {
        await uow.tx.appointment.updateMany({ where: { id: current.appointmentId, status: "checked_in" }, data: { status: "in_progress", version: { increment: 1 } } });
      }
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addToWaitlist(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.book", tool: "waitlist.add" }, args, async (actor) => {
    const input = args.input;
    const result = await command(context.prisma, { name: "waitlist.add", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const row = await uow.tx.waitlistEntry.create({
        data: { clientId: input.clientId, locationId: input.locationId, appointmentTypeId: input.appointmentTypeId, urgency: input.urgency, preferredWindows: input.preferredWindows ?? [], note: String(input.note ?? "").slice(0, 500), status: "waiting", patients: { connect: input.patientIds.map((id2) => ({ id: id2 })) } }
      });
      auditCreate(uow, actor, "WaitlistEntry", row.id, "waitlist.added", { clientId: input.clientId, urgency: input.urgency });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/mutations/reception.ts
async function locationDay(uow, locationId) {
  const location = await uow.tx.location.findUnique({ where: { id: locationId }, select: { timeZone: true } });
  if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
  return localDate({ timeZone: location.timeZone }, uow.now);
}
async function startCall(_root, args, context) {
  return gated(context, { permissions: ["canBook", "canMessageClients"], scope: "reception.read", tool: "call.start" }, args, async (actor) => {
    const input = args.input;
    if (input.direction === "outbound" && input.answeredBy === "ai") throw new DomainError(Codes.FEATURE_DISABLED, "Outbound AI calls are disabled.");
    if (actor.kind === "agent" && input.answeredBy !== "ai") throw new DomainError(Codes.INVALID_INPUT, "The AI receptionist only answers calls as the AI.");
    const result = await command(context.prisma, { name: "call.start", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { id: true } });
      if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
      const from = normalisePhone(input.from);
      const match = await uow.tx.contactPoint.findFirst({ where: { valueHash: contactHash(from), status: "active" }, select: { person: { select: { id: true, clientId: true } } } });
      const ref = await nextReference(uow.tx, "CALL", uow.now);
      const row = await uow.tx.callRecord.create({
        data: {
          ref,
          direction: input.direction,
          from,
          to: normalisePhone(input.to),
          locationId: location.id,
          answeredBy: input.answeredBy,
          agentId: actorAgentId(actor),
          providerCallId: String(input.providerCallId ?? ""),
          adapterKey: String(input.adapterKey ?? "manual"),
          recordingConsent: "not_asked",
          verificationMethod: "none",
          disposition: "open",
          startedAt: uow.now,
          status: input.answeredBy === "ai" ? "ringing" : "in_progress",
          transcript: [],
          // The number match is a hint for the screen; the account is attached only after verification.
          personId: null,
          clientId: null
        }
      });
      auditCreate(uow, actor, "CallRecord", row.id, "call.started", { ref, direction: input.direction, answeredBy: input.answeredBy, knownNumber: !!match });
      return { id: row.id, ref, knownNumber: !!match };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function recordCallDisclosure(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.read", tool: "call.disclosure" }, args, async (actor) => {
    const result = await command(context.prisma, { name: "call.disclosure", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, {
        model: "CallRecord",
        id: args.callRecordId,
        from: ["ringing"],
        to: "in_progress",
        actor,
        eventType: "call.disclosed",
        data: { disclosurePlayedAt: uow.now, recordingConsent: args.recordingConsent }
      });
      const contact = await resolvePolicy(uow.tx, "contact", { locationId: row.locationId, on: await locationDay(uow, row.locationId) });
      return { id: row.id, status: row.status, recording: contact.rules.recordingConsent === "all_party" ? args.recordingConsent === "accepted" : true };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function verifyCaller(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.read", tool: "call.verify" }, args, async (actor) => {
    if (args.method !== "pet_name_dob") throw new DomainError(Codes.INVALID_INPUT, "Unsupported verification method.");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.petDateOfBirth)) throw new DomainError(Codes.INVALID_INPUT, "Date of birth is YYYY-MM-DD.", { field: "petDateOfBirth" });
    const result = await command(context.prisma, { name: "call.verify", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const call2 = await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { from: true, status: true, callerVerifiedAt: true } });
      if (!call2 || call2.status !== "in_progress") throw new DomainError(Codes.GUARD_FAILED, "The call is not in progress.");
      const person = await uow.tx.clientPerson.findFirst({ where: { contactPoints: { some: { valueHash: contactHash(call2.from), status: "active" } } }, select: { id: true, clientId: true, canBook: true } });
      const pet = person ? await uow.tx.patient.findFirst({
        where: { name: { equals: args.petName.trim(), mode: "insensitive" }, dateOfBirth: /* @__PURE__ */ new Date(`${args.petDateOfBirth}T00:00:00Z`), ownerships: { some: { clientId: person.clientId, effectiveTo: null } } },
        select: { id: true }
      }) : null;
      if (!person || !pet) {
        uow.audit({ eventType: "call.verification_failed", entityType: "CallRecord", entityId: args.callRecordId, actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), after: { method: args.method } });
        return { verified: false };
      }
      await uow.tx.callRecord.update({ where: { id: args.callRecordId }, data: { callerVerifiedAt: uow.now, verificationMethod: "pet_name_dob", clientId: person.clientId, personId: person.id, version: { increment: 1 } } });
      uow.audit({ eventType: "call.caller_verified", entityType: "CallRecord", entityId: args.callRecordId, actorUserId: actorUserId(actor), actorAgentId: actorAgentId(actor), after: { method: args.method, clientId: person.clientId } });
      return { verified: true, clientId: person.clientId, canBook: person.canBook };
    });
    return { replay: result.replay, ...result.value };
  });
}
var MAX_TRANSCRIPT_TURNS = 400;
async function appendCallTranscript(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.read", tool: "call.transcript" }, args, async (actor) => {
    const result = await command(context.prisma, { name: "call.transcript", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const call2 = await uow.tx.callRecord.findUnique({ where: { id: args.callRecordId }, select: { transcript: true, status: true } });
      if (!call2) throw new DomainError(Codes.NOT_FOUND, "Call not found.");
      if (call2.status === "completed" || call2.status === "failed") throw new DomainError(Codes.GUARD_FAILED, "The call has ended.");
      const existing = Array.isArray(call2.transcript) ? call2.transcript : [];
      const turns = args.turns.slice(0, 50).map((t) => ({ speaker: ["caller", "agent", "staff"].includes(t.speaker) ? t.speaker : "caller", text: String(t.text ?? "").slice(0, 2e3), at: t.at ?? uow.now.toISOString() }));
      const next = [...existing, ...turns].slice(-MAX_TRANSCRIPT_TURNS);
      await uow.tx.callRecord.update({ where: { id: args.callRecordId }, data: { transcript: next, version: { increment: 1 } } });
      return { turns: next.length };
    });
    return { replay: result.replay, ...result.value };
  });
}
var DISPOSITIONS = ["booked", "rescheduled", "cancelled", "refill_request", "records_request", "info", "transferred", "urgent_transfer", "er_referred", "voicemail", "abandoned", "callback_task"];
async function endCall(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "reception.read", tool: "call.end" }, args, async (actor) => {
    if (!DISPOSITIONS.includes(args.disposition)) throw new DomainError(Codes.INVALID_INPUT, "Unknown disposition.", { field: "disposition" });
    const result = await command(context.prisma, { name: "call.end", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, {
        model: "CallRecord",
        id: args.callRecordId,
        from: ["ringing", "in_progress"],
        to: "completed",
        actor,
        eventType: "call.ended",
        data: (call2) => ({ endedAt: uow.now, durationSeconds: Math.max(0, Math.round((uow.now.getTime() - new Date(call2.startedAt).getTime()) / 1e3)), disposition: args.disposition, summary: String(args.summary ?? "").slice(0, 2e3), transferTo: String(args.transferTo ?? "").slice(0, 40) })
      });
      if (args.disposition === "callback_task" || args.disposition === "voicemail") {
        await uow.tx.task.create({ data: { kind: "call_back", title: `Call back (${row.ref})`, detail: String(args.summary ?? "").slice(0, 2e3), subjectType: "CallRecord", subjectId: row.id, locationId: row.locationId, priority: "normal", status: "open", dueAt: new Date(uow.now.getTime() + 4 * 36e5), createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } });
      }
      return { id: row.id, status: row.status, disposition: args.disposition };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function publishedProtocol(uow, code = "phone_triage") {
  const version = await uow.tx.triageProtocolVersion.findFirst({ where: { status: "published", protocol: { code } }, orderBy: { versionNumber: "desc" } });
  if (!version) throw new DomainError(Codes.POLICY_UNRESOLVED, "No triage protocol is published. The front desk transfers every sick-pet call until one is.");
  return { version, protocol: parseProtocol({ questions: version.questions, redFlags: version.redFlags, levelRules: version.levelRules, scripts: version.scripts }) };
}
async function triageQuestions(_root, _args, context) {
  return gated(context, { permissions: ["canBook"], scope: "triage.run", tool: "triage.questions" }, {}, async () => {
    const version = await context.prisma.triageProtocolVersion.findFirst({ where: { status: "published", protocol: { code: "phone_triage" } }, orderBy: { versionNumber: "desc" } });
    if (!version) throw new DomainError(Codes.POLICY_UNRESOLVED, "No triage protocol is published.");
    const protocol = parseProtocol({ questions: version.questions, redFlags: version.redFlags, levelRules: version.levelRules, scripts: version.scripts });
    return { protocolVersionId: version.id, label: version.label, questions: protocol.questions.map((q) => ({ id: q.id, text: q.text, required: q.required })) };
  });
}
async function runTriage(_root, args, context) {
  return gated(context, { permissions: ["canBook"], scope: "triage.run", tool: "triage.run" }, args, async (actor) => {
    const input = args.input;
    const result = await command(context.prisma, { name: "triage.run", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const { version, protocol } = await publishedProtocol(uow);
      const scored = scoreTriage(protocol, { complaint: String(input.complaint ?? "").slice(0, 1e3), answers: input.answers ?? {} });
      if (input.callRecordId) {
        const previous = await uow.tx.triageAssessment.findFirst({ where: { callRecordId: input.callRecordId }, orderBy: { at: "desc" }, select: { level: true } });
        if (previous) assertNotDowngrade(previous.level, scored.level);
      }
      const outcome = input.outcome ?? (scored.level === "emergency_now" ? actor.kind === "agent" ? "transferred" : "er_referred" : "booked");
      if (!outcomeAllowed(scored.level, outcome)) throw new DomainError(Codes.GUARD_FAILED, "An emergency is transferred or referred to the ER. It is never booked.");
      let referral = null;
      if (scored.level === "emergency_now") {
        const location = await uow.tx.location.findUnique({ where: { id: input.locationId }, select: { emergencyCoverage: true, stateCode: true } });
        if (location?.emergencyCoverage !== "in_house") {
          referral = await uow.tx.referralHospital.findFirst({ where: { kind: "emergency", active: true, open24h: true, stateCode: location?.stateCode ?? void 0 }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true, addressLine1: true, city: true } });
        }
      }
      const row = await uow.tx.triageAssessment.create({
        data: {
          patientId: input.patientId ?? null,
          clientId: input.clientId ?? null,
          callRecordId: input.callRecordId ?? null,
          protocolVersionId: version.id,
          complaint: String(input.complaint ?? "").slice(0, 1e3),
          answers: input.answers ?? {},
          redFlagsHit: scored.redFlagsHit,
          level: scored.level,
          outcome,
          referredToId: outcome === "er_referred" ? referral?.id ?? null : null,
          actorKind: actor.kind === "agent" ? "agent" : "user",
          actorUserId: actorUserId(actor),
          actorAgentId: actorAgentId(actor),
          at: uow.now
        }
      });
      auditCreate(uow, actor, "TriageAssessment", row.id, "triage.assessed", { level: scored.level, outcome, redFlags: scored.redFlagsHit, protocolVersion: version.versionNumber });
      if (scored.level === "emergency_now" || scored.level === "urgent_today") {
        const who = input.patientId ? (await uow.tx.patient.findUnique({ where: { id: input.patientId }, select: { name: true } }))?.name : null;
        const call2 = input.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { locationId: true } }) : null;
        const task = await uow.tx.task.create({ data: {
          kind: "call_back",
          priority: "urgent",
          status: "open",
          dueAt: uow.now,
          subjectType: "TriageAssessment",
          subjectId: row.id,
          locationId: call2?.locationId ?? input.locationId ?? null,
          roleName: "csr",
          title: scored.level === "emergency_now" ? `EMERGENCY call: ${who ? `${who}: ` : ""}transfer or confirm ER referral now` : `Urgent call-back today: ${who ? `${who}: ` : ""}${String(input.complaint ?? "").slice(0, 80)}`,
          detail: input.callRecordId ? `Call ${input.callRecordId}` : ""
        } });
        uow.audit({ eventType: "task.raised", entityType: "Task", entityId: task.id, after: { kind: "call_back", priority: "urgent", level: scored.level }, metadata: { system: "triage" } });
      }
      return { id: row.id, level: scored.level, outcome, script: scored.script, redFlags: scored.reasons, unanswered: scored.unanswered, emergencyReferral: referral };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function referToEmergency(_root, args, context) {
  return gated(context, { permissions: ["canBook", "canWriteRecord"], tool: "triage.refer_er", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "triage.refer_er", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const prior = await uow.tx.triageAssessment.findUnique({ where: { id: args.triageId } });
      if (!prior) throw new DomainError(Codes.NOT_FOUND, "Triage not found.");
      const er = await uow.tx.referralHospital.findUnique({ where: { id: args.referralHospitalId }, select: { id: true, active: true } });
      if (!er?.active) throw new DomainError(Codes.NOT_FOUND, "Referral hospital not found.");
      const row = await uow.tx.triageAssessment.create({
        data: {
          patientId: prior.patientId,
          clientId: prior.clientId,
          callRecordId: prior.callRecordId,
          protocolVersionId: prior.protocolVersionId,
          complaint: prior.complaint,
          answers: prior.answers ?? {},
          redFlagsHit: prior.redFlagsHit ?? [],
          level: prior.level === "routine" || prior.level === "soon" ? "urgent_today" : prior.level,
          outcome: "er_referred",
          referredToId: er.id,
          actorKind: "user",
          actorUserId: actorUserId(actor),
          at: uow.now
        }
      });
      auditCreate(uow, actor, "TriageAssessment", row.id, "triage.er_referred", { previous: prior.id, referralHospitalId: er.id });
      return { id: row.id, outcome: row.outcome };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function requestRefill(_root, args, context) {
  return gated(context, { permissions: ["canManageRefills", "canBook"], scope: "pharmacy.intake", tool: "refill.request" }, args, async (actor) => {
    const input = args.input;
    const result = await command(context.prisma, { name: "refill.request", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const patient = await uow.tx.patient.findUnique({ where: { id: input.patientId }, select: { status: true, name: true, ownerships: { where: { effectiveTo: null, role: "primary" }, select: { clientId: true } } } });
      if (!patient) throw new DomainError(Codes.NOT_FOUND, "Patient not found.");
      if (patient.status === "deceased") throw new DomainError(Codes.PATIENT_DECEASED, `${patient.name} has died.`);
      const clientId = patient.ownerships[0]?.clientId ?? null;
      if (actor.kind === "agent") {
        const call2 = input.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null;
        if (!call2?.callerVerifiedAt || call2.clientId !== clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, "Verify the caller before taking a refill request.");
      }
      const ref = await nextReference(uow.tx, "RFR", uow.now);
      const row = await uow.tx.refillRequest.create({
        data: {
          ref,
          patientId: input.patientId,
          clientId,
          channel: actor.kind === "agent" ? "ai_voice" : input.channel ?? "csr",
          productText: String(input.productText ?? "").slice(0, 300),
          pharmacyNote: String(input.pharmacyNote ?? "").slice(0, 500),
          status: "received",
          slaDueAt: new Date(uow.now.getTime() + 24 * 36e5),
          callRecordId: input.callRecordId ?? null,
          createdByAgentId: actorAgentId(actor)
        }
      });
      auditCreate(uow, actor, "RefillRequest", row.id, "refill.requested", { ref, patientId: input.patientId, channel: row.channel });
      await uow.tx.task.create({ data: { kind: "refill_review", title: `Refill request ${ref}: ${row.productText}`.slice(0, 200), subjectType: "RefillRequest", subjectId: row.id, priority: "normal", status: "open", dueAt: row.slaDueAt, createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } });
      return { id: row.id, ref, status: row.status, dueAt: row.slaDueAt?.toISOString() ?? null };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function requestRecords(_root, args, context) {
  return gated(context, { permissions: ["canProcessRecordsRequests", "canBook"], scope: "records.request", tool: "records.request" }, args, async (actor) => {
    const input = args.input;
    const result = await command(context.prisma, { name: "records.request", actor, idempotencyKey: args.idempotencyKey, params: input }, async (uow) => {
      const patient = await uow.tx.patient.findUnique({ where: { id: input.patientId }, select: { ownerships: { where: { effectiveTo: null, role: "primary" }, select: { clientId: true } } } });
      if (!patient) throw new DomainError(Codes.NOT_FOUND, "Patient not found.");
      const clientId = patient.ownerships[0]?.clientId ?? null;
      if (actor.kind === "agent") {
        if (input.requesterKind !== "client_person" || input.basis !== "client_of_record") throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, "The AI receptionist takes records requests from the client of record only; others go to staff.");
        const call2 = input.callRecordId ? await uow.tx.callRecord.findUnique({ where: { id: input.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null;
        if (!call2?.callerVerifiedAt || call2.clientId !== clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, "Verify the caller before taking a records request.");
      }
      const today = await locationDay(uow, input.locationId);
      const records = await resolvePolicy(uow.tx, "medical_records", { locationId: input.locationId, on: today });
      const ref = await nextReference(uow.tx, "REC", uow.now);
      const due = addDays(today, records.rules.clientCopyDays);
      const row = await uow.tx.recordsRequest.create({
        data: {
          ref,
          patientId: input.patientId,
          clientId,
          requesterKind: input.requesterKind,
          requesterName: String(input.requesterName ?? "").slice(0, 120),
          requesterContact: String(input.requesterContact ?? "").slice(0, 200),
          channel: actor.kind === "agent" ? "ai_voice" : input.channel ?? "csr",
          basis: input.basis,
          scope: String(input.scope ?? "full record").slice(0, 300),
          status: "received",
          responseDueAt: /* @__PURE__ */ new Date(`${due}T23:59:00Z`),
          policyVersionId: records.versions[records.versions.length - 1]?.id ?? null,
          callRecordId: input.callRecordId ?? null,
          createdByAgentId: actorAgentId(actor)
        }
      });
      auditCreate(uow, actor, "RecordsRequest", row.id, "records.requested", { ref, basis: input.basis, requesterKind: input.requesterKind, dueOn: due, policyVerified: records.verified });
      await uow.tx.task.create({ data: { kind: "records_request", title: `Records request ${ref}`, subjectType: "RecordsRequest", subjectId: row.id, locationId: input.locationId, priority: "normal", status: "open", dueAt: row.responseDueAt, createdByAgentId: actorAgentId(actor), createdByUserId: actorUserId(actor) } });
      return { id: row.id, ref, status: row.status, dueOn: due };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function lookupKnowledge(_root, args, context) {
  return gated(context, { permissions: ["canAccessDashboard"], scope: "reception.read", tool: "knowledge.lookup" }, args, async (actor) => {
    const words2 = String(args.question ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);
    const entries = await context.prisma.knowledgeBaseEntry.findMany({ where: { active: true, ...actor.kind === "agent" ? { visibility: "public" } : {}, OR: [{ locationId: null }, { locationId: args.locationId ?? void 0 }] }, select: { id: true, topic: true, keywords: true, content: true } });
    const scored = entries.map((e) => {
      const keys = (Array.isArray(e.keywords) ? e.keywords : []).map((k) => k.toLowerCase());
      return { e, score: words2.filter((w) => keys.includes(w) || e.topic.toLowerCase().includes(w)).length };
    }).filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    return { answers: scored.map((x) => ({ topic: x.e.topic, content: x.e.content })) };
  });
}
async function receptionContext(_root, args, context) {
  return gated(context, { permissions: ["canBook", "canReadClientPII"], scope: "reception.read", tool: "reception.context" }, args, async (actor) => {
    let clientId = args.clientId ?? null;
    if (actor.kind === "agent" || args.callRecordId) {
      const call2 = args.callRecordId ? await context.prisma.callRecord.findUnique({ where: { id: args.callRecordId }, select: { callerVerifiedAt: true, clientId: true } }) : null;
      if (!call2?.callerVerifiedAt || !call2.clientId) throw new DomainError(Codes.CALLER_NOT_VERIFIED, "Verify the caller first.");
      clientId = call2.clientId;
    }
    if (!clientId) throw new DomainError(Codes.INVALID_INPUT, "Name the client or the call.", { field: "clientId" });
    const client = await context.prisma.client.findUnique({
      where: { id: clientId },
      select: {
        id: true,
        ref: true,
        displayName: true,
        status: true,
        primaryLocationId: true,
        ownerships: { where: { effectiveTo: null }, select: { patient: { select: { id: true, ref: true, name: true, status: true, species: { select: { name: true } } } } } }
      }
    });
    if (!client) throw new DomainError(Codes.NOT_FOUND, "Client not found.");
    const appointments = await context.prisma.appointment.findMany({
      where: { clientId, status: { in: ["requested", "booked", "confirmed"] }, startsAt: { gt: /* @__PURE__ */ new Date() } },
      orderBy: { startsAt: "asc" },
      take: 10,
      select: { id: true, ref: true, startsAt: true, status: true, version: true, appointmentType: { select: { name: true } }, provider: { select: { displayName: true } } }
    });
    const pets = client.ownerships.map((o) => o.patient).filter((p) => p && p.status !== "merged");
    const { writeReadAudit: writeReadAudit2, actorFromSession: actorFromSession3 } = await Promise.resolve().then(() => (init_readAudit(), readAudit_exports));
    const reader = actorFromSession3(context.session) ?? { actorKind: actor.kind === "agent" ? "agent" : "user", actorId: actor.kind === "agent" ? actor.agentId : actor.kind === "user" ? actor.userId : "system" };
    await writeReadAudit2(context.prisma, reader, [
      { resourceType: "Client", resourceId: client.id, fields: /* @__PURE__ */ new Set(["ref", "displayName", "status"]) },
      ...pets.map((p) => ({ resourceType: "Patient", resourceId: p.id, fields: /* @__PURE__ */ new Set(["ref", "name", "status", "species"]) })),
      ...appointments.map((a) => ({ resourceType: "Appointment", resourceId: a.id, fields: /* @__PURE__ */ new Set(["ref", "startsAt", "status", "appointmentType", "provider"]) }))
    ], actor.kind === "agent" ? "agent_tool" : "operations", null);
    return {
      client: { id: client.id, ref: client.ref, displayName: client.displayName, status: client.status, locationId: client.primaryLocationId },
      pets: pets.map((p) => ({ id: p.id, ref: p.ref, name: p.name, species: p.species?.name ?? "", status: p.status })),
      upcoming: appointments.map((a) => ({ id: a.id, ref: a.ref, startsAt: a.startsAt.toISOString(), status: a.status, version: a.version, type: a.appointmentType?.name ?? "", provider: a.provider?.displayName ?? "" }))
    };
  });
}

// features/keystone/domain/licensure.ts
var DEA_SCHEDULE_CODE = { CI: "1", CII: "2", CIIN: "2N", CIII: "3", CIIIN: "3N", CIV: "4", CV: "5" };
var day = (d) => d == null ? null : typeof d === "string" ? d.slice(0, 10) : d.toISOString().slice(0, 10);
async function locationOf(tx, locationId) {
  const location = await tx.location.findUnique({ where: { id: locationId }, select: { id: true, stateCode: true, timeZone: true, active: true } });
  if (!location || !location.active) throw new DomainError(Codes.NOT_FOUND, "Location not found or inactive.", { locationId });
  return location;
}
async function requireLicence(tx, input) {
  const location = await locationOf(tx, input.locationId);
  const onDate = localDate({ timeZone: location.timeZone }, input.at);
  const policy = await resolvePolicy(tx, "licensure", { locationId: location.id, on: onDate });
  const kinds = policy.rules.licenceKindsByAction[input.action];
  if (!kinds?.length) throw new DomainError(Codes.POLICY_UNRESOLVED, `The licensure policy does not say who may ${input.action.replaceAll("_", " ")}.`, { action: input.action });
  const licences = await tx.professionalLicense.findMany({
    where: { staffMemberId: input.staffMemberId, kind: { in: kinds }, ...policy.rules.licenceMustMatchLocationState ? { stateCode: location.stateCode } : {} },
    orderBy: { expiresOn: "desc" }
  });
  const valid = licences.find((l) => l.status === "active" && (!l.issuedOn || day(l.issuedOn) <= onDate) && day(l.expiresOn) >= onDate);
  if (!valid) {
    const latest = licences[0];
    const why = !latest ? `no ${kinds.join(" or ")} licence in ${location.stateCode}` : latest.status !== "active" ? `the ${location.stateCode} licence is ${latest.status}` : `the ${location.stateCode} licence expired on ${day(latest.expiresOn)}`;
    throw new DomainError(Codes.LICENSE_INACTIVE, `This needs an active licence: ${why}.`, { action: input.action, staffMemberId: input.staffMemberId, onDate });
  }
  const evaluation = await tx.licenseEvaluation.create({
    data: {
      action: input.action,
      staffMemberId: input.staffMemberId,
      locationId: location.id,
      at: input.at,
      onDate: /* @__PURE__ */ new Date(`${onDate}T00:00:00Z`),
      licenseId: valid.id,
      policyVersions: policy.versions.map((v) => v.id),
      result: "allowed",
      findings: { kinds, state: location.stateCode, verified: policy.verified }
    }
  });
  return { evaluationId: evaluation.id, licenseId: valid.id, policyVersionIds: policy.versions.map((v) => v.id), onDate };
}
async function requireDeaRegistration(tx, input) {
  const location = await locationOf(tx, input.locationId);
  const onDate = localDate({ timeZone: location.timeZone }, input.at);
  if (input.schedule === "CI") throw new DomainError(Codes.DEA_REGISTRATION_INVALID, "Schedule I substances have no veterinary use under a practitioner registration.");
  const code = DEA_SCHEDULE_CODE[input.schedule];
  const registrations = await tx.deaRegistration.findMany({
    where: { locationId: location.id, ...input.registrantStaffMemberId ? { staffMemberId: input.registrantStaffMemberId } : {} },
    orderBy: { expiresOn: "desc" }
  });
  const covers = (r) => Array.isArray(r.schedules) && r.schedules.includes(code);
  const valid = registrations.find((r) => r.status === "active" && (!r.issuedOn || day(r.issuedOn) <= onDate) && day(r.expiresOn) >= onDate && covers(r));
  if (!valid) {
    const latest = registrations[0];
    const why = !latest ? "no DEA registration for this location" + (input.registrantStaffMemberId ? " held by this prescriber" : "") : latest.status !== "active" ? `the registration is ${latest.status}` : day(latest.expiresOn) < onDate ? `the registration expired on ${day(latest.expiresOn)}` : `the registration does not cover schedule ${code}`;
    throw new DomainError(Codes.DEA_REGISTRATION_INVALID, `This controlled-substance action needs a valid DEA registration: ${why}.`, { locationId: location.id, schedule: input.schedule, onDate });
  }
  const evaluation = await tx.licenseEvaluation.create({
    data: {
      action: input.action,
      staffMemberId: input.actorStaffMemberId ?? input.registrantStaffMemberId ?? null,
      locationId: location.id,
      at: input.at,
      onDate: /* @__PURE__ */ new Date(`${onDate}T00:00:00Z`),
      deaRegistrationId: valid.id,
      result: "allowed",
      findings: { schedule: input.schedule, code }
    }
  });
  return { evaluationId: evaluation.id, deaRegistrationId: valid.id, registrationNumber: valid.registrationNumber, onDate };
}

// features/keystone/domain/record.ts
var has = (sections, kinds) => sections.some((s) => kinds.includes(s.kind) && s.body.trim().length > 0);
var CHECKS = {
  client_name_address_phone: (e) => e.client && e.client.name && e.client.phone ? null : "The client name and phone number are missing.",
  patient_name_species_breed_age_sex_colour: (e) => e.patient.name && e.patient.species ? null : "The patient identity (name, species) is incomplete.",
  date_of_visit: (e) => e.startedAt ? null : "The visit date is missing.",
  history: (e) => has(e.sections, ["history", "subjective"]) ? null : "Write the history (subjective).",
  physical_exam: (e) => has(e.sections, ["objective"]) || e.findingsCount > 0 || e.vitalsCount > 0 ? null : "Record the physical exam (objective, findings or vitals).",
  diagnosis_or_assessment: (e) => has(e.sections, ["assessment"]) || e.diagnosesCount > 0 ? null : "Write the assessment or add a diagnosis.",
  treatment_plan: (e) => has(e.sections, ["plan"]) ? null : "Write the plan.",
  medications_dose_route_frequency: (e) => {
    const bad = e.medications.filter((m) => !m.dose || !m.route || !m.frequency);
    if (bad.length) return `Medication orders need dose, route and frequency: ${bad.map((m) => m.description).join(", ")}.`;
    const lots = e.vaccines.filter((v) => !v.lotNumber || !v.lotExpiresOn);
    return lots.length ? "Every vaccine needs its lot number and expiry." : null;
  },
  anaesthesia_record: (e) => !e.anaesthesiaGiven || e.anaesthesiaRecordClosed ? null : "Anaesthesia was given: close the anaesthesia record first.",
  surgery_record: (e) => !e.surgeryPerformed || e.surgeryReportPresent || has(e.sections, ["surgery_report"]) ? null : "Surgery was performed: write the surgery report.",
  prognosis: (e) => has(e.sections, ["assessment", "plan", "discharge"]) ? null : "State the prognosis in the assessment or plan.",
  author_identity: (e) => e.signerIsDvm ? null : "The record must be signed by a veterinarian."
};
var LIGHT_KINDS = /* @__PURE__ */ new Set(["phone_consult", "records_import", "tech_visit"]);
var LIGHT_SKIPS = /* @__PURE__ */ new Set(["physical_exam", "diagnosis_or_assessment", "prognosis"]);
function checkCompleteness(requiredFields, evidence) {
  const missing = [];
  for (const field of requiredFields) {
    if (LIGHT_KINDS.has(evidence.kind) && LIGHT_SKIPS.has(field)) continue;
    const check = CHECKS[field];
    const message = check ? check(evidence) : `The records policy requires "${field}", which this system cannot check yet.`;
    if (message) missing.push({ field, message });
  }
  return { complete: missing.length === 0, missing };
}
var KNOWN_RECORD_FIELDS = Object.keys(CHECKS);
var revisionHash = (input) => sha256(canonicalJson(input));
function establishesVcpr(kind, establishment) {
  if (["outpatient", "inpatient_day", "surgery", "dental", "emergency"].includes(kind)) return true;
  return kind === "telehealth" && establishment === "in_person_or_telehealth";
}
function signedContentHash(content) {
  return sha256(canonicalJson(content));
}
var addendumHash = (input) => sha256(canonicalJson(input));

// features/keystone/domain/vaccines.ts
function addMonths(date, months) {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = total % 12 + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${String(ny).padStart(4, "0")}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}
function ageInWeeks(dateOfBirth, on) {
  const ms = Date.parse(`${on}T00:00:00Z`) - Date.parse(`${dateOfBirth}T00:00:00Z`);
  return Math.floor(ms / (7 * 864e5));
}
function vaccineProblems(input) {
  const problems = [];
  if (input.patient.status !== "active") problems.push(`The patient is ${input.patient.status}.`);
  if (!input.product.active) problems.push(`${input.product.name} is not an active product.`);
  if (!input.lot) problems.push("Choose the lot the dose came from.");
  else {
    if (input.lot.status !== "available") problems.push(`Lot ${input.lot.lotNumber} is ${input.lot.status}.`);
    if (input.lot.expiresOn < input.on) problems.push(`Lot ${input.lot.lotNumber} expired on ${input.lot.expiresOn}.`);
  }
  if (input.product.speciesCodes.length && (!input.patient.speciesCode || !input.product.speciesCodes.includes(input.patient.speciesCode))) {
    problems.push(`${input.product.name} is not labelled for this species.`);
  }
  const minWeeks = Math.max(input.product.minAgeWeeks, input.product.isRabies && input.rabiesPolicy ? input.rabiesPolicy.firstDoseMinAgeWeeks : 0);
  if (input.patient.dateOfBirth && ageInWeeks(input.patient.dateOfBirth, input.on) < minWeeks) {
    problems.push(`The patient is under the minimum age (${minWeeks} weeks) for ${input.product.name}.`);
  }
  if (input.product.isRabies && input.giverKind !== "dvm" && !input.supervisingDvmPresent) {
    problems.push("A rabies vaccine is given by a veterinarian or under a supervising veterinarian; name the supervising veterinarian.");
  }
  if (input.product.isRabies && !input.rabiesPolicy) problems.push("No rabies policy is in force for this location.");
  return problems;
}
function vaccineDuration(input) {
  if (input.seriesIntervalWeeks) return { months: 0, weeks: input.seriesIntervalWeeks, reason: "initial_series" };
  if (input.isRabies && input.rabiesPolicy) {
    if (input.priorRabiesDoses === 0) return { months: Math.min(input.labelMonths, input.rabiesPolicy.boosterAfterFirstMonths), weeks: 0, reason: "first_rabies_dose" };
    return { months: Math.min(input.labelMonths, input.rabiesPolicy.maxDurationMonths), weeks: 0, reason: "label_capped" };
  }
  return { months: input.labelMonths, weeks: 0, reason: "label" };
}
function dueDate(on, duration) {
  return duration.weeks ? addDays(on, duration.weeks * 7) : addMonths(on, duration.months);
}
function inInitialSeries(schedule, dateOfBirth, on) {
  const s = schedule?.initialSeries;
  if (!s || !dateOfBirth) return null;
  return ageInWeeks(dateOfBirth, on) < s.untilAgeWeeks ? s : null;
}
function reminderStatusOn(r, rule2, on) {
  if (["satisfied", "suppressed"].includes(r.status)) return r.status;
  if (on >= addDays(r.dueOn, rule2.lapseDays)) return "lapsed";
  if (on >= addDays(r.dueOn, rule2.graceDays)) return "overdue";
  if (on >= addDays(r.dueOn, -rule2.leadDays)) return "due";
  return "scheduled";
}
function rabiesCertificateFields(required, snapshot) {
  const fields = {};
  const missing = [];
  for (const name of required) {
    const value = snapshot[name];
    if (value && String(value).trim()) fields[name] = String(value);
    else missing.push(name);
  }
  return { fields, missing };
}
function calendarDayText(isoDay3) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDay3 ?? "");
  if (!m) return isoDay3 ?? "";
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric", year: "numeric" }).format(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])));
}

// features/keystone/lib/documents.ts
var import_node_crypto7 = require("node:crypto");
var esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
var words = (code) => String(code ?? "").replace(/_/g, " ");
var zoned = (iso, timeZone) => new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));
var instant = (iso, timeZone) => {
  if (!iso) return "";
  const d = new Date(String(iso));
  return Number.isNaN(d.getTime()) ? esc(iso) : new Intl.DateTimeFormat("en-US", { timeZone, dateStyle: "medium", timeStyle: "short" }).format(d);
};
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${esc(title)}</title><style>
body{font:14px/1.5 system-ui,sans-serif;color:#111;max-width:760px;margin:24px auto;padding:0 16px}
h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:20px 0 6px;border-bottom:1px solid #ddd}
dl{display:grid;grid-template-columns:max-content 1fr;gap:2px 12px;margin:0}dt{color:#555}dd{margin:0}
pre{white-space:pre-wrap;font:inherit;margin:0}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:2px 6px;border-bottom:1px solid #eee;vertical-align:top}
.meta{color:#555;font-size:12px}@media print{body{margin:0}}
</style></head><body>${body}</body></html>`;
}
var dl = (rows) => `<dl>${rows.filter(([, v]) => v !== null && v !== void 0 && v !== "").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("")}</dl>`;
var SECTION_ORDER = ["history", "subjective", "objective", "assessment", "plan", "surgery_report", "discharge", "communication"];
function renderEncounterRecord(c, hash2, timeZone, practice) {
  const sections = [...c.sections].sort((a, b) => SECTION_ORDER.indexOf(a.kind) - SECTION_ORDER.indexOf(b.kind) || a.ordinal - b.ordinal).filter((s) => s.body.trim());
  const signer = c.signer?.source ? `${c.signer.name || "Unnamed clinician"} (imported from ${c.signer.source})` : c.signer?.name;
  const body = `
<h1>Medical record ${esc(c.encounter.ref)}</h1>
<p class="meta">${esc(practice)} \xB7 ${esc(words(c.encounter.kind))} \xB7 ${instant(c.encounter.startedAt, timeZone)}</p>
<h2>Patient</h2>${dl([["Name", c.patient.name], ["Patient no.", c.patient.ref], ["Species", c.patient.species], ["Breed", c.patient.breed], ["Sex", [c.patient.sex, c.patient.reproductiveStatus].filter(Boolean).map(words).join(", ")], ["Born", calendarDayText(c.patient.dateOfBirth)]])}
${c.client ? `<h2>Client</h2>${dl([["Name", c.client.name], ["Client no.", c.client.ref], ["Address", c.client.address], ["Phone", c.client.phone]])}` : ""}
${c.encounter.reason ? `<h2>Reason for visit</h2><pre>${esc(c.encounter.reason)}</pre>` : ""}
${sections.map((s) => `<h2>${esc(words(s.kind).replace(/^\w/, (ch) => ch.toUpperCase()))}</h2><pre>${esc(s.body)}</pre>`).join("")}
${c.vitals.length ? `<h2>Vitals</h2><table>${c.vitals.map((v) => `<tr><td>${instant(v.at, timeZone)}</td><td>${esc(Object.entries(v).filter(([k, x]) => k !== "at" && x !== null && x !== "").map(([k, x]) => `${words(k)} ${x}`).join(" \xB7 "))}</td></tr>`).join("")}</table>` : ""}
${c.findings.length ? `<h2>Physical exam</h2><table>${c.findings.map((f) => `<tr><td>${esc(words(f.system))}</td><td>${esc(words(f.status))}</td><td>${esc(f.text)}</td></tr>`).join("")}</table>` : ""}
${c.diagnoses.length ? `<h2>Diagnoses</h2><table>${c.diagnoses.map((d) => `<tr><td>${esc(d.term)}</td><td>${esc(words(d.certainty))}</td></tr>`).join("")}</table>` : ""}
${c.orders.length ? `<h2>Orders and treatments</h2><table>${c.orders.map((o) => `<tr><td>${esc(o.ref)}</td><td>${esc(o.description)}${o.route ? ` \xB7 ${esc(o.route)}` : ""}${o.frequency ? ` \xB7 ${esc(o.frequency)}` : ""}</td><td>${esc(words(o.status))}</td></tr>${(o.administrations ?? []).map((a) => `<tr><td></td><td class="meta">Given ${esc(a.qty)} ${esc(a.unit)} ${esc(a.route)} ${a.lotNumber ? `lot ${esc(a.lotNumber)}` : ""}</td><td class="meta">${instant(a.givenAt, timeZone)}</td></tr>`).join("")}`).join("")}</table>` : ""}
${c.vaccines.length ? `<h2>Vaccines</h2><table>${c.vaccines.map((v) => `<tr><td>${esc(v.product?.name)}</td><td>lot ${esc(v.lotNumber)}</td><td>${esc(calendarDayText(v.administeredOn))}</td><td>${v.dueNextOn ? `next due ${esc(calendarDayText(v.dueNextOn))}` : ""}</td></tr>`).join("")}</table>` : ""}
${c.anaesthesia.length ? `<h2>Anaesthesia</h2><table>${c.anaesthesia.map((a) => `<tr><td>${esc(a.ref)}</td><td>ASA ${esc(a.asaStatus)}</td><td>${esc(words(a.status))}</td></tr>`).join("")}</table>` : ""}
<h2>Signature</h2>${dl([["Signed by", signer], ["Signed at", instant(c.signedAt, timeZone)], ["Content hash (SHA-256)", hash2]])}
<p class="meta">This record is frozen at signing. Corrections appear as dated addenda and never change the text above.</p>`;
  return page(`Medical record ${c.encounter.ref}`, body);
}
function renderRabiesCertificate(cert, practice, timeZone = "America/Los_Angeles") {
  const f = cert.fields ?? {};
  const label = (k) => words(k).replace(/^\w/, (ch) => ch.toUpperCase());
  const rows = Object.entries(f).map(([k, v]) => [label(k), k === "date_given" || k === "next_due" ? calendarDayText(String(v)) : v]);
  const body = `
<h1>Rabies vaccination certificate ${esc(cert.ref)}</h1>
<p class="meta">${esc(practice)} \xB7 Form 51-equivalent (NASPHV) fields \xB7 ${esc(cert.durationMonths)}-month vaccination</p>
${dl([["Vaccinated", `${calendarDayText(cert.vaccinatedOn.toISOString())} (clinic date, ${timeZone})`], ["Next due", calendarDayText(cert.nextDueOn.toISOString())], ["Tag number", cert.tagNumber], ["Issued", cert.createdAt ? `${zoned(cert.createdAt.toISOString(), timeZone)}` : null], ["Clinic time zone", timeZone]])}
<h2>Certificate</h2>${dl(rows)}
${cert.missingFields.length ? `<h2>Incomplete</h2><p>This certificate is missing: ${esc(cert.missingFields.map(words).join(", "))}. Complete them before giving it to the owner or the licensing agency.</p>` : ""}`;
  return page(`Rabies certificate ${cert.ref}`, body);
}
function renderDischarge(d, timeZone, practice) {
  const body = `
<h1>Discharge instructions for ${esc(d.patientName)}</h1>
<p class="meta">${esc(practice)} \xB7 ${instant(d.at.toISOString(), timeZone)}${d.staffName ? ` \xB7 ${esc(d.staffName)}` : ""}</p>
<h2>Home care</h2><pre>${esc(d.body)}</pre>
${d.medsSummary ? `<h2>Medications</h2><pre>${esc(d.medsSummary)}</pre>` : ""}
${d.recheckOn ? `<h2>Recheck</h2><p>Please book a recheck for ${esc(calendarDayText(d.recheckOn.toISOString()))}.</p>` : ""}
<p class="meta">If your pet's breathing changes, it collapses, bleeds, or cannot keep water down, call us or the nearest emergency hospital now.</p>`;
  return page(`Discharge instructions for ${d.patientName}`, body);
}
var sha = (html) => (0, import_node_crypto7.createHash)("sha256").update(html, "utf8").digest("hex");
async function practiceName(tx) {
  const loc = await tx.location.findFirst({ where: { active: true }, orderBy: { code: "asc" }, select: { name: true, timeZone: true } });
  return { name: loc?.name ?? "", timeZone: loc?.timeZone ?? "America/Los_Angeles" };
}
async function store(uow, docId, html, link) {
  const hash2 = sha(html);
  const updated = await uow.tx.clinicalDocument.updateMany({ where: { id: docId, status: { in: ["pending_render", "failed"] } }, data: { status: "rendered", body: html, mimeType: "text/html", sha256: hash2, renderedAt: uow.now, renderError: "", version: { increment: 1 } } });
  if (updated.count !== 1) return hash2;
  if (link) await link(uow.tx);
  uow.audit({ eventType: "document.rendered", entityType: "ClinicalDocument", entityId: docId, after: { sha256: hash2 }, metadata: { system: "document-render" } });
  return hash2;
}
async function renderEncounterDocument(uow, documentId) {
  const tx = uow.tx;
  const practice = await practiceName(tx);
  const doc = await tx.clinicalDocument.findUnique({ where: { id: documentId }, select: { id: true, status: true, encounterId: true, sourceHash: true } });
  if (!doc || doc.status === "rendered" || !doc.encounterId) return;
  const enc = await tx.encounter.findUniqueOrThrow({ where: { id: doc.encounterId }, select: { id: true, signedContent: true, contentHash: true, location: { select: { name: true, timeZone: true } } } });
  if (!enc.signedContent || enc.contentHash !== doc.sourceHash) throw new Error(`Encounter ${enc.id} content does not match the document source hash`);
  const html = renderEncounterRecord(enc.signedContent, enc.contentHash, enc.location?.timeZone ?? practice.timeZone, enc.location?.name ?? practice.name);
  await store(uow, doc.id, html, (t) => t.encounter.update({ where: { id: enc.id }, data: { documentId: doc.id } }));
}
async function renderRabiesDocument(uow, certificateId, locationId) {
  const tx = uow.tx;
  const practice = await practiceName(tx);
  const cert = await tx.rabiesCertificate.findUnique({ where: { id: certificateId }, select: { id: true, ref: true, patientId: true, documentId: true, vaccinatedOn: true, nextDueOn: true, durationMonths: true, tagNumber: true, fields: true, missingFields: true, createdAt: true } });
  if (!cert || cert.documentId) return;
  const loc = await tx.location.findUnique({ where: { id: locationId }, select: { name: true, timeZone: true } });
  const html = renderRabiesCertificate({ ...cert, fields: cert.fields ?? {}, missingFields: cert.missingFields ?? [] }, loc?.name ?? practice.name, loc?.timeZone ?? practice.timeZone);
  const doc = await tx.clinicalDocument.create({ data: { patientId: cert.patientId, kind: "rabies_certificate", title: `Rabies certificate ${cert.ref}`, status: "pending_render", sourceType: "RabiesCertificate", sourceId: cert.id, sourceHash: sha(JSON.stringify(cert.fields ?? {})) } });
  await store(uow, doc.id, html, (t) => t.rabiesCertificate.update({ where: { id: cert.id }, data: { documentId: doc.id } }));
}
async function renderDischargeDocument(uow, instructionId) {
  const tx = uow.tx;
  const practice = await practiceName(tx);
  const d = await tx.dischargeInstruction.findUnique({ where: { id: instructionId }, select: { id: true, body: true, medsSummary: true, recheckOn: true, createdAt: true, encounterId: true, patientId: true, patient: { select: { name: true } }, author: { select: { displayName: true } } } });
  if (!d) return;
  const exists = await tx.clinicalDocument.findFirst({ where: { sourceType: "DischargeInstruction", sourceId: d.id }, select: { id: true, status: true } });
  if (exists?.status === "rendered") return;
  const html = renderDischarge({ body: d.body, medsSummary: d.medsSummary || null, recheckOn: d.recheckOn, patientName: d.patient?.name ?? "your pet", staffName: d.author?.displayName ?? null, at: d.createdAt ?? /* @__PURE__ */ new Date() }, practice.timeZone, practice.name);
  const doc = exists ?? await tx.clinicalDocument.create({ data: { patientId: d.patientId, encounterId: d.encounterId, kind: "discharge", title: `Discharge instructions for ${d.patient?.name ?? "patient"}`, status: "pending_render", sourceType: "DischargeInstruction", sourceId: d.id, sourceHash: sha(d.body) } });
  await store(uow, doc.id, html);
}

// features/keystone/mutations/clinical.ts
var text16 = (value, field, max = 200, required = true) => {
  const out = String(value ?? "").trim();
  if (required && !out) throw new DomainError(Codes.INVALID_INPUT, `${field} is required.`, { field });
  if (out.length > max) throw new DomainError(Codes.INVALID_INPUT, `${field} is too long.`, { field });
  return out;
};
var DECIMAL_TEXT2 = /^\d{1,9}(\.\d{1,6})?$/;
function decimalText(value, field) {
  const out = String(value ?? "").trim();
  if (!DECIMAL_TEXT2.test(out)) throw new DomainError(Codes.INVALID_INPUT, `${field} is a positive number with up to 6 decimals.`, { field });
  return out;
}
async function staffOf(uow, actor) {
  if (actor.kind !== "user") throw new DomainError(Codes.NEVER_ALLOWED_FOR_AGENTS, "Clinical records are written by people.");
  const staff = await uow.tx.staffMember.findFirst({ where: { userId: actor.userId, active: true }, select: { id: true, kind: true, displayName: true, homeLocationId: true } });
  if (!staff) throw new DomainError(Codes.NOT_AUTHORIZED, "Your user is not linked to an active staff member.");
  return staff;
}
async function staffById(uow, id2) {
  const staff = await uow.tx.staffMember.findUnique({ where: { id: id2 }, select: { id: true, kind: true, displayName: true, homeLocationId: true, active: true } });
  if (!staff || !staff.active) throw new DomainError(Codes.NOT_FOUND, "Staff member not found.");
  return staff;
}
async function witnessFor(uow, witnessId, administratorId) {
  if (witnessId === administratorId) throw new DomainError(Codes.GUARD_FAILED, "The witness must be someone other than the person giving the dose.", { field: "witnessId" });
  const staff = await uow.tx.staffMember.findUnique({ where: { id: witnessId }, select: { id: true, kind: true, displayName: true, homeLocationId: true, active: true, user: { select: { accessExpiresAt: true, role: { select: { canWitnessControlled: true } } } } } });
  if (!staff || !staff.active) throw new DomainError(Codes.NOT_FOUND, "Witness not found.", { field: "witnessId" });
  const expired = staff.user?.accessExpiresAt && staff.user.accessExpiresAt <= uow.now;
  if (!staff.user?.role?.canWitnessControlled || expired) throw new DomainError(Codes.NOT_AUTHORIZED, `${staff.displayName} is not authorised to witness controlled drugs. Ask a veterinarian or a credentialed technician.`, { field: "witnessId" });
  return { id: staff.id, kind: staff.kind, displayName: staff.displayName, homeLocationId: staff.homeLocationId };
}
async function activePatient(uow, patientId) {
  const patient = await uow.tx.patient.findUnique({
    where: { id: patientId },
    select: { id: true, ref: true, name: true, status: true, dateOfBirth: true, sex: true, codeStatus: true, speciesId: true, species: { select: { code: true, name: true } }, breed: { select: { name: true, geneticFlags: true } } }
  });
  if (!patient) throw new DomainError(Codes.NOT_FOUND, "Patient not found.");
  if (patient.status === "deceased" || patient.status === "merged") throw new DomainError(Codes.PATIENT_DECEASED, `The patient is ${patient.status}.`);
  if (patient.status !== "active") throw new DomainError(Codes.GUARD_FAILED, `The patient is ${patient.status}; confirm the registration first.`);
  return patient;
}
async function locationDay2(uow, locationId, at) {
  const location = await uow.tx.location.findUnique({ where: { id: locationId }, select: { id: true, timeZone: true, stateCode: true, name: true } });
  if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
  return { location, on: localDate({ timeZone: location.timeZone }, at) };
}
async function chartableEncounter(uow, encounterId) {
  const enc = await uow.tx.encounter.findUnique({ where: { id: encounterId }, select: { id: true, ref: true, status: true, version: true, patientId: true, locationId: true, kind: true, stayId: true, attendingDvmId: true } });
  if (!enc) throw new DomainError(Codes.NOT_FOUND, "Encounter not found.");
  if (enc.status === "signed") throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} is signed. Add an addendum instead.`, { reason: "signed" });
  if (enc.status === "voided") throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} was voided.`, { reason: "voided" });
  return enc;
}
async function markInProgress(uow, enc) {
  if (enc.status !== "open") return;
  await uow.tx.encounter.updateMany({ where: { id: enc.id, status: "open" }, data: { status: "in_progress", version: { increment: 1 } } });
}
var day2 = (d) => d ? d.toISOString().slice(0, 10) : null;
async function latestWeight(uow, patientId) {
  const w = await uow.tx.weightMeasurement.findFirst({ where: { patientId }, orderBy: { measuredAt: "desc" }, select: { id: true, valueKg: true, measuredAt: true } });
  if (!w) return null;
  return { id: w.id, valueKg: w.valueKg.toString(), measuredAt: w.measuredAt, ageHours: Math.floor((uow.now.getTime() - w.measuredAt.getTime()) / 36e5) };
}
async function practiceSettings(uow) {
  const row = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { weightMaxAgeHours: true, features: true, unsignedRecordTaskHours: true, unsignedRecordEscalateHours: true, medicalDirectorId: true } });
  return {
    weightMaxAgeHours: row?.weightMaxAgeHours ?? { anaesthesia: 24, inpatient: 72, outpatient: 720 },
    features: row?.features ?? {},
    unsignedTaskHours: row?.unsignedRecordTaskHours ?? 24,
    unsignedEscalateHours: row?.unsignedRecordEscalateHours ?? 72,
    medicalDirectorId: row?.medicalDirectorId ?? null
  };
}

// features/keystone/mutations/record.ts
var IN_PERSON = /* @__PURE__ */ new Set(["outpatient", "inpatient_day", "surgery", "dental", "emergency", "euthanasia"]);
async function openEncounter(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "encounter.open", humanOnly: true }, args, async (actor) => {
    if (!ENCOUNTER_KINDS.includes(args.kind) || args.kind === "records_import") throw new DomainError(Codes.INVALID_INPUT, "Choose the kind of visit.", { field: "kind" });
    const result = await command(context.prisma, { name: "encounter.open", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const patient = await activePatient(uow, args.patientId);
      await locationDay2(uow, args.locationId, uow.now);
      if (args.appointmentId) {
        const appt = await uow.tx.appointment.findUnique({ where: { id: args.appointmentId }, select: { status: true, locationId: true, providerId: true, patients: { select: { patientId: true } } } });
        if (!appt) throw new DomainError(Codes.NOT_FOUND, "Appointment not found.");
        if (!appt.patients.some((p) => p.patientId === args.patientId)) throw new DomainError(Codes.INVALID_INPUT, "That patient is not on the appointment.", { field: "patientId" });
        if (["cancelled", "no_show", "declined"].includes(appt.status)) throw new DomainError(Codes.GUARD_FAILED, `The appointment is ${appt.status}.`);
        const existing = await uow.tx.encounter.findFirst({ where: { appointmentId: args.appointmentId, patientId: args.patientId, status: { not: "voided" } }, select: { id: true, ref: true, status: true } });
        if (existing) return { id: existing.id, ref: existing.ref, status: existing.status, existing: true };
        if (!args.attendingDvmId && appt.providerId) args = { ...args, attendingDvmId: appt.providerId };
      }
      let attending = args.attendingDvmId ? await staffById(uow, args.attendingDvmId) : staff.kind === "dvm" ? staff : null;
      if (attending && attending.kind !== "dvm") attending = null;
      const weight = await latestWeight(uow, patient.id);
      const ref = await nextReference(uow.tx, "ENC", uow.now);
      const enc = await uow.tx.encounter.create({
        data: {
          ref,
          patientId: patient.id,
          locationId: args.locationId,
          appointmentId: args.appointmentId ?? null,
          kind: args.kind,
          vcprQualifying: IN_PERSON.has(args.kind),
          status: "open",
          reason: text16(args.reason ?? "", "reason", 300, false),
          attendingDvmId: attending?.id ?? null,
          weightUsedId: weight?.id ?? null,
          startedAt: uow.now,
          participants: { connect: [{ id: staff.id }] }
        }
      });
      auditCreate(uow, actor, "Encounter", enc.id, "encounter.opened", { ref, patientId: patient.id, kind: args.kind, appointmentId: args.appointmentId ?? null, attendingDvmId: attending?.id ?? null });
      return { id: enc.id, ref, status: enc.status, existing: false };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function writeSection(uow, actor, staff, encounterId, input) {
  if (!SECTION_KINDS.includes(input.kind)) throw new DomainError(Codes.INVALID_INPUT, "Unknown record section.", { field: "kind" });
  const body = text16(input.body, "body", 2e4, false);
  const enc = await chartableEncounter(uow, encounterId);
  const repeatable = REPEATABLE_SECTIONS.includes(input.kind);
  let ordinal = input.ordinal ?? 1;
  if (repeatable && input.ordinal == null) {
    const last = await uow.tx.soapSection.findFirst({ where: { encounterId, kind: input.kind }, orderBy: { ordinal: "desc" }, select: { ordinal: true } });
    ordinal = (last?.ordinal ?? 0) + 1;
  }
  const existing = await uow.tx.soapSection.findFirst({ where: { encounterId, kind: input.kind, ordinal }, select: { id: true } });
  let sectionId;
  let version;
  if (!existing) {
    if (input.expectedVersion != null && input.expectedVersion !== 0) throw new DomainError(Codes.STALE_STATE, "This section was removed or never saved. Reload and try again.", { currentVersion: 0 });
    try {
      const created = await uow.tx.soapSection.create({ data: { encounterId, kind: input.kind, ordinal, body, structured: input.structured ?? null, source: input.source, lastAuthorId: staff.id } });
      sectionId = created.id;
      version = created.version;
    } catch (error) {
      if (String(error?.code) === "P2002") throw new DomainError(Codes.STALE_STATE, "Someone else just started this section. Reload to see their text.", { currentVersion: 0 });
      throw error;
    }
  } else {
    const row = await lockRow(uow.tx, "SoapSection", existing.id);
    if (row.lockedAt) throw new DomainError(Codes.GUARD_FAILED, "This section is signed. Add an addendum instead.", { reason: "signed" });
    if (input.expectedVersion == null || input.expectedVersion !== row.version) {
      throw new DomainError(Codes.STALE_STATE, "Someone else saved this section since you opened it. Reload to see their changes, then save again.", { currentVersion: row.version });
    }
    const updated = await uow.tx.soapSection.updateMany({ where: { id: row.id, version: row.version }, data: { body, structured: input.structured ?? null, source: input.source, lastAuthorId: staff.id, version: { increment: 1 } } });
    if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, "Someone else saved this section since you opened it.", { currentVersion: row.version });
    sectionId = row.id;
    version = row.version + 1;
  }
  const revisionNumber = await uow.tx.soapSectionRevision.count({ where: { sectionId } }) + 1;
  const hash2 = revisionHash({ kind: input.kind, ordinal, body, structured: input.structured ?? null, source: input.source, author: staff.id });
  await uow.tx.soapSectionRevision.create({
    data: { sectionId, revisionNumber, body, structured: input.structured ?? null, source: input.source, templateId: input.templateId ?? null, scribeDraftId: input.scribeDraftId ?? null, authorId: staff.id, authorUserId: actorUserId(actor), at: uow.now, contentHash: hash2 }
  });
  await markInProgress(uow, enc);
  await uow.tx.encounter.update({ where: { id: encounterId }, data: { participants: { connect: [{ id: staff.id }] } } });
  uow.audit({ eventType: "record.section_saved", entityType: "SoapSection", entityId: sectionId, actorUserId: actorUserId(actor), after: { encounterId, kind: input.kind, ordinal, version, revisionNumber, source: input.source, contentHash: hash2 } });
  return { id: sectionId, kind: input.kind, ordinal, version, revisionNumber };
}
async function saveSoapSection(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "record.section_save", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "record.section_save", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      return writeSection(uow, actor, staff, args.encounterId, { kind: args.kind, ordinal: args.ordinal, body: args.body, structured: args.structured, source: args.templateId ? "template" : "typed", templateId: args.templateId, expectedVersion: args.expectedVersion });
    });
    return { replay: result.replay, ...result.value };
  });
}
var intOrNull = (v, field, min, max) => {
  if (v === null || v === void 0 || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new DomainError(Codes.INVALID_INPUT, `${field} must be a whole number from ${min} to ${max}.`, { field });
  return n;
};
var decOrNull = (v, field) => {
  if (v === null || v === void 0 || v === "") return null;
  const s = String(v).trim();
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(s)) throw new DomainError(Codes.INVALID_INPUT, `${field} is a number with up to 2 decimals.`, { field });
  return s;
};
async function recordVitals(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord", "canAdminister"], tool: "record.vitals", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "record.vitals", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      const data = {
        encounterId: enc.id,
        patientId: enc.patientId,
        temperature: decOrNull(args.temperature, "temperature"),
        temperatureUnit: args.temperatureUnit === "C" ? "C" : "F",
        heartRate: intOrNull(args.heartRate, "heartRate", 1, 500),
        respRate: intOrNull(args.respRate, "respRate", 1, 300),
        mucousMembranes: args.mucousMembranes ?? null,
        crtSeconds: decOrNull(args.crtSeconds, "crtSeconds"),
        painScore: intOrNull(args.painScore, "painScore", 0, 10),
        bodyConditionScore: intOrNull(args.bodyConditionScore, "bodyConditionScore", 1, 9),
        mentation: args.mentation ?? null,
        hydrationPct: decOrNull(args.hydrationPct, "hydrationPct"),
        at: uow.now,
        byId: staff.id
      };
      if (args.temperatureUnit && !["F", "C"].includes(args.temperatureUnit)) throw new DomainError(Codes.INVALID_INPUT, "Temperature unit is \xB0F or \xB0C.", { field: "temperatureUnit" });
      if (data.temperature !== null) {
        const t = Number(data.temperature);
        const [lo, hi] = data.temperatureUnit === "F" ? [80, 115] : [26, 46];
        if (t < lo || t > hi) throw new DomainError(Codes.INVALID_INPUT, `Temperature ${data.temperature} \xB0${data.temperatureUnit} is outside ${lo}\u2013${hi} \xB0${data.temperatureUnit}. Check the reading and the unit.`, { field: "temperature" });
      }
      if (data.crtSeconds !== null && Number(data.crtSeconds) > 10) throw new DomainError(Codes.INVALID_INPUT, "Capillary refill time is 0\u201310 seconds.", { field: "crtSeconds" });
      if (data.hydrationPct !== null && Number(data.hydrationPct) > 20) throw new DomainError(Codes.INVALID_INPUT, "Dehydration is 0\u201320 %.", { field: "hydrationPct" });
      if (![data.temperature, data.heartRate, data.respRate, data.mucousMembranes, data.crtSeconds, data.painScore, data.bodyConditionScore, data.mentation, data.hydrationPct].some((v) => v !== null)) {
        throw new DomainError(Codes.INVALID_INPUT, "Enter at least one vital sign.");
      }
      const row = await uow.tx.vitalsObservation.create({ data });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "VitalsObservation", row.id, "record.vitals_recorded", { encounterId: enc.id });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function setExamFinding(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "record.exam_finding", humanOnly: true }, args, async (actor) => {
    if (!EXAM_SYSTEMS.includes(args.system)) throw new DomainError(Codes.INVALID_INPUT, "Unknown body system.", { field: "system" });
    if (!["normal", "abnormal", "not_examined"].includes(args.status)) throw new DomainError(Codes.INVALID_INPUT, "Choose normal, abnormal or not examined.", { field: "status" });
    if (args.status === "abnormal" && !String(args.text ?? "").trim()) throw new DomainError(Codes.INVALID_INPUT, "Describe the abnormal finding.", { field: "text" });
    const result = await command(context.prisma, { name: "record.exam_finding", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      const existing = await uow.tx.physicalExamFinding.findFirst({ where: { encounterId: enc.id, system: args.system }, select: { id: true } });
      const data = { status: args.status, text: text16(args.text ?? "", "text", 2e3, false), byId: staff.id };
      const row = existing ? await uow.tx.physicalExamFinding.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await uow.tx.physicalExamFinding.create({ data: { encounterId: enc.id, system: args.system, ...data } });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "PhysicalExamFinding", row.id, "record.exam_finding_set", { encounterId: enc.id, system: args.system, status: args.status });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addDiagnosis(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "record.diagnosis", humanOnly: true }, args, async (actor) => {
    if (!["presumptive", "differential", "confirmed", "ruled_out"].includes(args.certainty)) throw new DomainError(Codes.INVALID_INPUT, "Choose how certain the diagnosis is.", { field: "certainty" });
    const result = await command(context.prisma, { name: "record.diagnosis", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      const code = args.codeId ? await uow.tx.diagnosisCode.findUnique({ where: { id: args.codeId }, select: { id: true, term: true, active: true } }) : null;
      if (args.codeId && (!code || !code.active)) throw new DomainError(Codes.NOT_FOUND, "Diagnosis code not found.");
      const term = code?.term ?? text16(args.term, "term", 200);
      let problemId = null;
      if (args.addToProblems && args.certainty !== "ruled_out") {
        const open = await uow.tx.problem.findFirst({ where: { patientId: enc.patientId, term, status: "active" }, select: { id: true } });
        problemId = open?.id ?? (await uow.tx.problem.create({ data: { patientId: enc.patientId, encounterId: enc.id, codeId: code?.id ?? null, term, status: "active", chronic: args.chronic === true, onset: /* @__PURE__ */ new Date(`${uow.now.toISOString().slice(0, 10)}T00:00:00Z`) } })).id;
      }
      const row = await uow.tx.diagnosis.create({ data: { encounterId: enc.id, patientId: enc.patientId, codeId: code?.id ?? null, term, certainty: args.certainty, problemId, byId: staff.id } });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "Diagnosis", row.id, "record.diagnosis_added", { encounterId: enc.id, term, certainty: args.certainty, problemId });
      return { id: row.id, problemId };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function resolveProblem(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "record.problem_resolve", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "record.problem_resolve", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "Problem", id: args.problemId, from: ["active", "inactive"], to: "resolved", expectedVersion: args.expectedVersion, actor, eventType: "record.problem_resolved", data: { resolvedAt: uow.now } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function encounterEvidence(uow, encounterId, signer) {
  const enc = await uow.tx.encounter.findUniqueOrThrow({
    where: { id: encounterId },
    select: {
      id: true,
      ref: true,
      kind: true,
      startedAt: true,
      locationId: true,
      patientId: true,
      reason: true,
      attendingDvmId: true,
      weightUsedId: true,
      patient: { select: {
        ref: true,
        name: true,
        dateOfBirth: true,
        sex: true,
        reproductiveStatus: true,
        colourMarkings: true,
        species: { select: { code: true, name: true } },
        breed: { select: { name: true } },
        ownerships: { where: { role: "primary", effectiveTo: null }, select: { client: { select: { ref: true, displayName: true, addressLine1: true, city: true, postalCode: true, people: { where: { isPrimary: true }, select: { firstName: true, lastName: true, contactPoints: { where: { isPrimary: true, status: "active" }, select: { kind: true, value: true } } } } } } } }
      } },
      sections: { orderBy: [{ kind: "asc" }, { ordinal: "asc" }], select: { id: true, kind: true, ordinal: true, body: true, structured: true } },
      vitals: { orderBy: { at: "asc" }, select: { temperature: true, temperatureUnit: true, heartRate: true, respRate: true, mucousMembranes: true, crtSeconds: true, painScore: true, bodyConditionScore: true, mentation: true, hydrationPct: true, at: true } },
      findings: { orderBy: { system: "asc" }, select: { system: true, status: true, text: true } },
      diagnoses: { orderBy: { createdAt: "asc" }, select: { term: true, certainty: true } },
      orders: { orderBy: { createdAt: "asc" }, select: { ref: true, kind: true, description: true, status: true, route: true, frequency: true, quantity: true, quantityUnit: true, dose: { select: { doseAmount: true, doseUnit: true, dosePer: true, totalAmount: true, roundedQty: true, computedUnit: true, manualOverrideQty: true, hash: true } }, administrations: { orderBy: { givenAt: "asc" }, select: { qty: true, unit: true, route: true, lotNumber: true, givenAt: true, givenById: true } } } }
    }
  });
  const vaccines = await uow.tx.vaccineAdministration.findMany({ where: { encounterId }, orderBy: { administeredOn: "asc" }, select: { lotNumber: true, lotExpiresOn: true, administeredOn: true, dueNextOn: true, site: true, route: true, product: { select: { name: true } } } });
  const anaesthesia = await uow.tx.anaesthesiaRecord.findMany({ where: { encounterId }, select: { ref: true, status: true, asaStatus: true, inductionAt: true, recoveryEndAt: true } });
  const surgery = await uow.tx.surgeryReport.count({ where: { encounterId } });
  const client = enc.patient?.ownerships[0]?.client ?? null;
  const person = client?.people[0];
  const phone = person?.contactPoints.find((c) => c.kind !== "email")?.value ?? "";
  const meds = enc.orders.filter((o) => o.kind === "medication" && o.status !== "cancelled");
  const evidence = {
    kind: enc.kind,
    startedAt: enc.startedAt,
    client: client ? { name: person ? `${person.firstName} ${person.lastName}` : client.displayName, address: [client.addressLine1, client.city, client.postalCode].filter(Boolean).join(", "), phone } : null,
    patient: { name: enc.patient?.name ?? "", species: enc.patient?.species?.code ?? null, breed: enc.patient?.breed?.name ?? null, ageKnown: Boolean(enc.patient?.dateOfBirth), sex: enc.patient?.sex ?? null, colour: enc.patient?.colourMarkings ?? null },
    sections: enc.sections.map((s) => ({ kind: s.kind, ordinal: s.ordinal, body: s.body, structured: s.structured })),
    vitalsCount: enc.vitals.length,
    findingsCount: enc.findings.filter((f) => f.status !== "not_examined").length,
    diagnosesCount: enc.diagnoses.filter((d) => d.certainty !== "ruled_out").length,
    medications: meds.map((o) => ({ description: o.description, dose: o.dose ? `${(o.dose.manualOverrideQty ?? o.dose.roundedQty ?? o.dose.totalAmount).toString()} ${o.dose.computedUnit ?? ""}`.trim() : null, route: o.route || null, frequency: o.frequency || null, quantity: o.quantity?.toString() ?? null })),
    vaccines: vaccines.map((v) => ({ lotNumber: v.lotNumber, lotExpiresOn: day2(v.lotExpiresOn) })),
    anaesthesiaGiven: anaesthesia.length > 0,
    anaesthesiaRecordClosed: anaesthesia.every((a) => a.status === "closed"),
    surgeryPerformed: enc.kind === "surgery",
    surgeryReportPresent: surgery > 0,
    signerIsDvm: signer?.kind === "dvm"
  };
  const content = {
    encounter: { ref: enc.ref, kind: enc.kind, startedAt: enc.startedAt, reason: enc.reason, weightUsedId: enc.weightUsedId },
    patient: { ref: enc.patient?.ref, name: enc.patient?.name, species: enc.patient?.species?.name, breed: enc.patient?.breed?.name ?? null, sex: enc.patient?.sex, reproductiveStatus: enc.patient?.reproductiveStatus, dateOfBirth: day2(enc.patient?.dateOfBirth) },
    client: client ? { ref: client.ref, name: evidence.client?.name, address: evidence.client?.address, phone } : null,
    sections: enc.sections.map((s) => ({ kind: s.kind, ordinal: s.ordinal, body: s.body, structured: s.structured ?? null })),
    vitals: enc.vitals,
    findings: enc.findings,
    diagnoses: enc.diagnoses,
    orders: enc.orders,
    vaccines,
    anaesthesia
  };
  return { enc, evidence, content };
}
async function recordsPolicy(uow, locationId, at) {
  const { on } = await locationDay2(uow, locationId, at);
  return resolvePolicy(uow.tx, "medical_records", { locationId, on });
}
async function submitEncounter(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "encounter.submit", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "encounter.submit", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      const policy = await recordsPolicy(uow, enc.locationId, uow.now);
      const { evidence } = await encounterEvidence(uow, enc.id, null);
      const check = checkCompleteness(policy.rules.requiredFields.filter((f) => f !== "author_identity"), evidence);
      if (!check.complete) throw new DomainError(Codes.GUARD_FAILED, `The record is incomplete: ${check.missing.map((m) => m.message).join(" ")}`, { reason: "incomplete", problems: check.missing });
      const row = await transition(uow, { model: "Encounter", id: enc.id, from: ["open", "in_progress"], to: "pending_signature", expectedVersion: args.expectedVersion, actor, eventType: "encounter.submitted", data: { submittedAt: uow.now, completeness: toJsonValue({ ...check, policyVersions: policy.versions.map((v) => v.id), checkedAt: uow.now }) } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function returnEncounter(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "encounter.return", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "encounter.return", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "Encounter", id: args.encounterId, from: ["pending_signature"], to: "in_progress", expectedVersion: args.expectedVersion, actor, eventType: "encounter.returned", reason });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function signEncounter(_root, args, context) {
  return gated(context, { permissions: ["canSignRecord"], tool: "encounter.sign", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "encounter.sign", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (staff.kind !== "dvm") throw new DomainError(Codes.LICENSE_INACTIVE, "Only a veterinarian signs the medical record.");
      const current = await lockRow(uow.tx, "Encounter", args.encounterId);
      if (current.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, `${current.ref} changed since you loaded it. Reload and try again.`, { currentStatus: current.status, currentVersion: current.version });
      if (!["in_progress", "pending_signature"].includes(current.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${current.ref} is ${current.status.replace(/_/g, " ")}; it cannot be signed.`, { currentStatus: current.status });
      const settings = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { medicalDirectorId: true } });
      const participants = await uow.tx.encounter.findUnique({ where: { id: current.id }, select: { participants: { select: { id: true } } } });
      const onEncounter = current.attendingDvmId === staff.id || participants?.participants.some((p) => p.id === staff.id) || settings?.medicalDirectorId === staff.id;
      if (current.attendingDvmId && !onEncounter) throw new DomainError(Codes.GUARD_FAILED, "Only the attending veterinarian, a veterinarian who charted this visit, or the medical director can sign it.");
      const licence = await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: current.locationId, action: "sign_record", at: uow.now });
      const policy = await recordsPolicy(uow, current.locationId, uow.now);
      const { evidence, content } = await encounterEvidence(uow, current.id, staff);
      const check = checkCompleteness(policy.rules.requiredFields, evidence);
      if (!check.complete) throw new DomainError(Codes.GUARD_FAILED, `The record is incomplete: ${check.missing.map((m) => m.message).join(" ")}`, { reason: "incomplete", problems: check.missing });
      let vcprId = null;
      const { on } = await locationDay2(uow, current.locationId, uow.now);
      const vcpr = await resolvePolicy(uow.tx, "vcpr", { locationId: current.locationId, on });
      if (establishesVcpr(current.kind, vcpr.rules.establishment)) {
        await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: current.locationId, action: "establish_vcpr", at: uow.now });
        const expiresOn = addMonths(on, vcpr.rules.durationMonths);
        const row = await uow.tx.vcprRecord.create({
          data: { patientId: current.patientId, scope: vcpr.rules.level, dvmId: staff.id, locationId: current.locationId, establishedByRef: current.ref, establishedVia: "encounter", establishedAt: uow.now, expiresAt: /* @__PURE__ */ new Date(`${expiresOn}T23:59:59Z`), status: "active", policyVersionId: vcpr.versions[vcpr.versions.length - 1]?.id ?? null }
        });
        vcprId = row.id;
        auditCreate(uow, actor, "VcprRecord", row.id, "vcpr.established", { patientId: current.patientId, scope: vcpr.rules.level, encounter: current.ref, expiresOn });
      }
      const signedContent = toJsonValue({ ...content, signer: { staffMemberId: staff.id, name: staff.displayName, licenseId: licence.licenseId }, signedAt: uow.now });
      const contentHash = signedContentHash(signedContent);
      await uow.tx.soapSection.updateMany({ where: { encounterId: current.id, lockedAt: null }, data: { lockedAt: uow.now, version: { increment: 1 } } });
      await uow.tx.surgeryReport.updateMany({ where: { encounterId: current.id, status: "draft" }, data: { status: "signed", version: { increment: 1 } } });
      const doc = await uow.tx.clinicalDocument.create({ data: { patientId: current.patientId, encounterId: current.id, kind: "encounter_record", title: `Medical record ${current.ref}`, status: "pending_render", sourceType: "Encounter", sourceId: current.id, sourceHash: contentHash, signedById: staff.id } });
      const updated = await uow.tx.encounter.updateMany({
        where: { id: current.id, version: current.version },
        data: {
          status: "signed",
          signedById: staff.id,
          signedAt: uow.now,
          contentHash,
          signedContent,
          licenseEvaluationId: licence.evaluationId,
          vcprId,
          policyVersionId: policy.versions[policy.versions.length - 1]?.id ?? null,
          completeness: toJsonValue({ ...check, checkedAt: uow.now }),
          version: { increment: 1 },
          ...current.attendingDvmId ? {} : { attendingDvmId: staff.id }
        }
      });
      if (updated.count !== 1) throw new DomainError(Codes.STALE_STATE, `${current.ref} changed while signing.`);
      await uow.tx.task.updateMany({ where: { subjectType: "Encounter", subjectId: current.id, kind: "record_unsigned", status: { in: ["open", "in_progress"] } }, data: { status: "done", completedAt: uow.now, version: { increment: 1 } } });
      await renderEncounterDocument(uow, doc.id);
      uow.audit({ eventType: "encounter.signed", entityType: "Encounter", entityId: current.id, actorUserId: actorUserId(actor), before: { status: current.status, version: current.version }, after: { status: "signed", version: current.version + 1, contentHash, signedById: staff.id, licenseEvaluationId: licence.evaluationId, vcprId, documentId: doc.id } });
      return { id: current.id, ref: current.ref, status: "signed", contentHash, vcprId, documentId: doc.id, verified: policy.verified };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addAddendum(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "record.addendum", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const body = text16(args.body, "body", 1e4);
    if (![...SECTION_KINDS, "general"].includes(args.sectionKind)) throw new DomainError(Codes.INVALID_INPUT, "Choose which part of the record this amends.", { field: "sectionKind" });
    const result = await command(context.prisma, { name: "record.addendum", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { id: true, ref: true, status: true, contentHash: true } });
      if (!enc) throw new DomainError(Codes.NOT_FOUND, "Encounter not found.");
      if (enc.status !== "signed") throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} is not signed yet; edit the section instead.`);
      if (["assessment", "plan"].includes(args.sectionKind) && staff.kind !== "dvm") throw new DomainError(Codes.GUARD_FAILED, "A change to the assessment or plan is a veterinarian's addendum.");
      const hash2 = addendumHash({ encounterId: enc.id, contentHash: enc.contentHash, sectionKind: args.sectionKind, reason, body, author: staff.id, signedAt: uow.now });
      const row = await uow.tx.addendum.create({ data: { encounterId: enc.id, sectionKind: args.sectionKind, authorId: staff.id, authorIsDvm: staff.kind === "dvm", reason, body, signedAt: uow.now, hash: hash2 } });
      auditCreate(uow, actor, "Addendum", row.id, "record.addendum_added", { encounterId: enc.id, ref: enc.ref, sectionKind: args.sectionKind, hash: hash2 }, { reason });
      return { id: row.id, hash: hash2 };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function voidBlockers(uow, encounterId) {
  const [orders, administrations, vaccines] = await Promise.all([
    uow.tx.clinicalOrder.count({ where: { encounterId, status: { notIn: ["cancelled", "reversed"] } } }),
    // Doses still standing: neither a reversal row nor reversed since (M5).
    uow.tx.administration.count({ where: { encounterId, reversesId: null, from_Administration_reverses: { none: {} } } }),
    uow.tx.vaccineAdministration.count({ where: { encounterId, reversesId: null, from_VaccineAdministration_reverses: { none: {} } } })
  ]);
  const blockers = [];
  if (orders) blockers.push(`${orders} active order${orders === 1 ? "" : "s"}`);
  if (administrations) blockers.push(`${administrations} administration${administrations === 1 ? "" : "s"}`);
  if (vaccines) blockers.push(`${vaccines} vaccine${vaccines === 1 ? "" : "s"}`);
  return blockers;
}
async function requestVoidEncounter(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "encounter.void_request", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "encounter.void_request", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const enc = await uow.tx.encounter.findUnique({ where: { id: args.encounterId }, select: { id: true, ref: true, status: true, version: true } });
      if (!enc) throw new DomainError(Codes.NOT_FOUND, "Encounter not found.");
      if (!["open", "in_progress"].includes(enc.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${enc.ref} is ${enc.status.replace(/_/g, " ")}; only an open or in-progress record can be voided.`);
      const blockers = await voidBlockers(uow, enc.id);
      if (blockers.length) throw new DomainError(Codes.GUARD_FAILED, `${enc.ref} has ${blockers.join(", ")}; cancel or reverse them first.`);
      const request = await requestApproval(uow, actor, { action: "encounter.void", targetList: "Encounter", targetId: enc.id, payload: { encounterId: enc.id, reason, baseVersion: enc.version }, summary: `Void ${enc.ref}: ${reason}`, requiredPermission: "canSignRecord" });
      return { approvalRequestId: request.id, status: request.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
registerApplier("encounter.void", async (uow, actor, request) => {
  const { encounterId, reason, baseVersion } = request.payload;
  const blockers = await voidBlockers(uow, encounterId);
  if (blockers.length) throw new DomainError(Codes.GUARD_FAILED, `The encounter now has ${blockers.join(", ")}; it can no longer be voided.`);
  const row = await transition(uow, { model: "Encounter", id: encounterId, from: ["open", "in_progress"], to: "voided", expectedVersion: baseVersion, actor, eventType: "encounter.voided", reason, approverId: actorUserId(actor), data: { voidReason: reason, voidApprovalId: request.id } });
  await uow.tx.task.updateMany({ where: { subjectType: "Encounter", subjectId: encounterId, kind: "record_unsigned", status: { in: ["open", "in_progress"] } }, data: { status: "cancelled", completedAt: uow.now, version: { increment: 1 } } });
  return { id: row.id, status: row.status };
});
async function runUnsignedRecordClock(uow) {
  const settings = await uow.tx.practiceSettings.findUnique({ where: { id: 1 }, select: { unsignedRecordTaskHours: true, unsignedRecordEscalateHours: true, medicalDirectorId: true } });
  const taskHours = settings?.unsignedRecordTaskHours ?? 24;
  const escalateHours = settings?.unsignedRecordEscalateHours ?? 72;
  const due = await uow.tx.encounter.findMany({
    where: { status: { in: ["open", "in_progress", "pending_signature"] }, startedAt: { lte: new Date(uow.now.getTime() - taskHours * 36e5) } },
    select: { id: true, ref: true, startedAt: true, locationId: true, attendingDvmId: true, patient: { select: { name: true } } },
    take: 500
  });
  let raised = 0;
  let escalated = 0;
  for (const enc of due) {
    const ageHours = Math.floor((uow.now.getTime() - enc.startedAt.getTime()) / 36e5);
    const task = await uow.tx.task.findFirst({ where: { subjectType: "Encounter", subjectId: enc.id, kind: "record_unsigned" }, select: { id: true, status: true, priority: true } });
    if (!task) {
      const row = await uow.tx.task.create({ data: { kind: "record_unsigned", title: `Sign ${enc.ref} (${enc.patient?.name ?? "patient"})`, detail: `Unsigned for ${ageHours} hours.`, subjectType: "Encounter", subjectId: enc.id, locationId: enc.locationId, assigneeId: enc.attendingDvmId, roleName: "dvm", priority: ageHours >= escalateHours ? "urgent" : "high", status: "open", dueAt: uow.now } });
      uow.audit({ eventType: "task.raised", entityType: "Task", entityId: row.id, after: { kind: "record_unsigned", encounterId: enc.id, ageHours }, metadata: { system: "record-clock" } });
      raised++;
    } else if (ageHours >= escalateHours && task.priority !== "urgent" && ["open", "in_progress"].includes(task.status)) {
      await uow.tx.task.update({ where: { id: task.id }, data: { priority: "urgent", assigneeId: settings?.medicalDirectorId ?? enc.attendingDvmId, detail: `Unsigned for ${ageHours} hours; escalated to the medical director.`, version: { increment: 1 } } });
      uow.audit({ eventType: "task.escalated", entityType: "Task", entityId: task.id, after: { encounterId: enc.id, ageHours, to: settings?.medicalDirectorId ?? null }, metadata: { system: "record-clock" } });
      escalated++;
    }
  }
  return { checked: due.length, raised, escalated, through: addDays(uow.now.toISOString().slice(0, 10), 0) };
}

// features/integrations/scribe/index.ts
var import_zod3 = require("zod");
var DRAFT_SECTION_KINDS = ["history", "subjective", "objective", "assessment", "plan", "discharge", "communication"];
var DraftSchema = import_zod3.z.object({
  sections: import_zod3.z.array(import_zod3.z.object({
    kind: import_zod3.z.enum(DRAFT_SECTION_KINDS),
    body: import_zod3.z.string().min(1).max(8e3),
    evidence: import_zod3.z.array(import_zod3.z.string().max(400)).max(20).default([])
  })).max(10),
  suggestedCharges: import_zod3.z.array(import_zod3.z.object({ description: import_zod3.z.string().max(200), reason: import_zod3.z.string().max(400) })).max(20).default([]),
  confidence: import_zod3.z.string().regex(/^(0(\.\d{1,4})?|1(\.0{1,4})?)$/).default("0")
});
function parsePasted(text17) {
  const lines = text17.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  return lines.map((line) => {
    const m = /^([A-Za-z][A-Za-z .'-]{0,30}):\s*(.+)$/.exec(line);
    return m ? { speaker: m[1].trim(), text: m[2].trim() } : { speaker: "unknown", text: line };
  });
}
var manualTranscription = {
  key: "manual",
  async transcribe(input) {
    const text17 = (input.pastedText ?? "").trim();
    if (!text17) throw new Error("Paste or dictate the conversation; no transcription service is connected.");
    return { text: text17, segments: parsePasted(text17), provider: "manual", ref: `manual:${text17.length}` };
  }
};
var manualScribeModel = {
  key: "manual",
  modelRef: "none",
  async draft({ transcript }) {
    const owner = transcript.segments.filter((s) => !/^(dr|doctor|vet|tech|rvt)\b/i.test(s.speaker)).map((s) => s.text);
    return { sections: [{ kind: "history", body: (owner.length ? owner : [transcript.text]).join(" ").slice(0, 8e3), evidence: owner.slice(0, 5) }], suggestedCharges: [], confidence: "0" };
  }
};
var transcription = manualTranscription;
var scribeModel = manualScribeModel;
var scribeAdapters = () => ({ transcription, model: scribeModel });

// features/keystone/mutations/scribe.ts
async function startScribeSession(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "scribe.start", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "scribe.start", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const settings = await practiceSettings(uow);
      if (!settings.features.scribe) throw new DomainError(Codes.FEATURE_DISABLED, "The ambient scribe is turned off for this practice. An owner turns it on in Settings.");
      const enc = await chartableEncounter(uow, args.encounterId);
      const { on } = await locationDay2(uow, enc.locationId, uow.now);
      const contact = await resolvePolicy(uow.tx, "contact", { locationId: enc.locationId, on });
      if (!args.staffAcknowledged) throw new DomainError(Codes.CONSENT_REQUIRED, "Everyone on the team in the room must know the visit is being recorded.");
      let consentId = null;
      if (contact.rules.recordingConsent === "all_party" || contact.rules.consentPurposes.recording !== "implied") {
        if (!args.clientConsent) throw new DomainError(Codes.CONSENT_REQUIRED, "This state requires everyone's consent to record. Ask the client and record their answer first.", { reason: "all_party" });
      }
      if (args.clientConsent) {
        const owner = await uow.tx.patientOwnership.findFirst({ where: { patientId: enc.patientId, role: "primary", effectiveTo: null }, select: { client: { select: { people: { where: { isPrimary: true }, select: { contactPoints: { where: { isPrimary: true, status: "active" }, select: { id: true }, take: 1 } } } } } } });
        const contactPointId = owner?.client?.people[0]?.contactPoints[0]?.id;
        if (!contactPointId) throw new DomainError(Codes.CONSENT_REQUIRED, "The client has no contact on file to attach the recording consent to.");
        const consent = await uow.tx.consentRecord.create({ data: { contactPointId, purpose: "recording", action: "grant", method: args.consentMethod ?? "staff_entry", capturedByUserId: actorUserId(actor), policyVersionId: contact.versions[contact.versions.length - 1]?.id ?? null, at: uow.now } });
        consentId = consent.id;
      }
      const { transcription: transcription2, model } = scribeAdapters();
      const session = await uow.tx.scribeSession.create({ data: { encounterId: enc.id, startedById: staff.id, clientConsentId: consentId, staffAcknowledged: true, status: "recording", transcriptionProvider: transcription2.key, modelProvider: model.key, modelRef: model.modelRef, audioDeleteAfter: new Date(uow.now.getTime() + 30 * 864e5) } });
      auditCreate(uow, actor, "ScribeSession", session.id, "scribe.started", { encounterId: enc.id, consentId, recordingConsent: contact.rules.recordingConsent, transcription: transcription2.key, model: model.key });
      return { id: session.id, status: session.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function draftScribeSession(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "scribe.draft", humanOnly: true }, args, async (actor) => {
    const prisma = context.prisma;
    const session = await prisma.scribeSession.findUnique({ where: { id: args.sessionId }, select: { id: true, status: true, encounter: { select: { id: true, status: true, patient: { select: { name: true, species: { select: { code: true } } } } } } } });
    if (!session) throw new DomainError(Codes.NOT_FOUND, "Scribe session not found.");
    if (!["recording", "transcribing", "drafted"].includes(session.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The scribe session is ${session.status}.`);
    if (!session.encounter || ["signed", "voided"].includes(session.encounter.status)) throw new DomainError(Codes.GUARD_FAILED, "The visit record is closed.");
    const replay = await prisma.commandReceipt.findUnique({ where: { idempotencyKey: args.idempotencyKey }, select: { id: true } });
    let draft = null;
    let transcript = null;
    if (!replay) {
      const { transcription: transcription2, model } = scribeAdapters();
      const t = await transcription2.transcribe({ pastedText: args.pastedTranscript ?? null });
      transcript = { text: t.text, ref: t.ref, provider: t.provider };
      draft = DraftSchema.parse(await model.draft({ transcript: t, species: session.encounter.patient?.species?.code ?? null, patientName: session.encounter.patient?.name ?? "the patient" }));
    }
    const result = await command(prisma, { name: "scribe.draft", actor, idempotencyKey: args.idempotencyKey, params: { sessionId: args.sessionId, transcriptLength: args.pastedTranscript?.length ?? 0 } }, async (uow) => {
      const row = await lockRow(uow.tx, "ScribeSession", args.sessionId);
      if (!draft || !transcript) throw new DomainError(Codes.IN_PROGRESS, "The draft is being prepared; try again.");
      await uow.tx.scribeSession.update({ where: { id: row.id }, data: { status: "drafted", transcript: transcript.text.slice(0, 1e5), transcriptRef: transcript.ref, version: { increment: 1 } } });
      const created = await uow.tx.scribeDraft.create({ data: { sessionId: row.id, sections: toJsonValue(draft.sections), suggestedCharges: toJsonValue(draft.suggestedCharges), confidence: draft.confidence, modelRef: row.modelRef, acceptedBlocks: [], status: "proposed" } });
      auditCreate(uow, actor, "ScribeDraft", created.id, "scribe.drafted", { sessionId: row.id, sections: draft.sections.map((s) => s.kind), provider: transcript.provider, modelRef: row.modelRef });
      return { id: created.id, sections: draft.sections, suggestedCharges: draft.suggestedCharges, confidence: draft.confidence };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function acceptScribeDraft(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "scribe.accept", humanOnly: true }, args, async (actor) => {
    if (!Array.isArray(args.blocks) || !args.blocks.length) throw new DomainError(Codes.INVALID_INPUT, "Choose at least one block to accept, or reject the draft.");
    const result = await command(context.prisma, { name: "scribe.accept", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const draft = await lockRow(uow.tx, "ScribeDraft", args.draftId);
      if (!["proposed", "partly_accepted"].includes(draft.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The draft is ${draft.status.replace(/_/g, " ")}.`);
      const session = await uow.tx.scribeSession.findUniqueOrThrow({ where: { id: draft.sessionId }, select: { id: true, encounterId: true } });
      const accepted = new Set(draft.acceptedBlocks ?? []);
      const written = [];
      for (const block of args.blocks) {
        const section = draft.sections[block.index];
        if (!section) throw new DomainError(Codes.INVALID_INPUT, "That draft block does not exist.", { field: "blocks" });
        if (accepted.has(block.index)) continue;
        const existing = await uow.tx.soapSection.findFirst({ where: { encounterId: session.encounterId, kind: section.kind, ordinal: 1 }, select: { version: true, body: true } });
        const edited = block.body != null ? text16(block.body, "body", 2e4) : section.body;
        const body = existing?.body?.trim() ? `${existing.body.trim()}

${edited}` : edited;
        written.push(await writeSection(uow, actor, staff, session.encounterId, { kind: section.kind, body, source: "scribe", scribeDraftId: draft.id, expectedVersion: block.expectedVersion ?? existing?.version ?? 0 }));
        accepted.add(block.index);
      }
      const status = accepted.size >= draft.sections.length ? "accepted" : "partly_accepted";
      await uow.tx.scribeDraft.update({ where: { id: draft.id }, data: { acceptedBlocks: [...accepted].sort((a, b) => a - b), status, decidedById: staff.id, decidedAt: uow.now, version: { increment: 1 } } });
      if (status === "accepted") await uow.tx.scribeSession.update({ where: { id: session.id }, data: { status: "accepted", version: { increment: 1 } } });
      uow.audit({ eventType: "scribe.accepted", entityType: "ScribeDraft", entityId: draft.id, actorUserId: actorUserId(actor), after: { blocks: args.blocks.map((b) => ({ index: b.index, edited: b.body != null })), status } });
      return { id: draft.id, status, sections: written };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function rejectScribeDraft(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "scribe.reject", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "scribe.reject", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const draft = await lockRow(uow.tx, "ScribeDraft", args.draftId);
      if (!["proposed", "partly_accepted"].includes(draft.status)) throw new DomainError(Codes.INVALID_TRANSITION, `The draft is ${draft.status.replace(/_/g, " ")}.`);
      await uow.tx.scribeDraft.update({ where: { id: draft.id }, data: { status: "rejected", decidedById: staff.id, decidedAt: uow.now, version: { increment: 1 } } });
      await uow.tx.scribeSession.update({ where: { id: draft.sessionId }, data: { status: "discarded", version: { increment: 1 } } });
      auditCreate(uow, actor, "ScribeDraft", draft.id, "scribe.rejected", { sessionId: draft.sessionId }, { reason });
      return { id: draft.id, status: "rejected" };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/domain/dose.ts
var DOSE_CALC_VERSION = "dose-2026.11-3";
var HARD_BLOCKS = ["above_range", "below_range", "override_out_of_range", "range_unconvertible_override"];
var DOSE_PERS = ["kg", "m2", "animal"];
var DOSE_UNITS = ["mg", "mcg", "g", "mL", "IU", "unit", "tablet", "capsule", "dose"];
var KG_PER_LB2 = "0.45359237";
var BSA_CONSTANTS = { canine: "10.1", feline: "10.0" };
var MASS_TO_MG = { mcg: "0.001", mg: "1", g: "1000" };
function bodySurfaceArea(weightKg, species) {
  const k = BSA_CONSTANTS[species];
  if (!k) throw new RangeError(`No body-surface-area constant for ${species}; dose this drug per kg or per animal.`);
  const grams = dec(weightKg).times(1e3);
  const m2 = dec(k).times(grams.pow(dec(2).div(3))).div(1e4);
  return { m2: m2.toDecimalPlaces(4, Decimal.ROUND_HALF_EVEN), constant: dec(k) };
}
function convertAmount(amount, from, to) {
  if (from === to) return amount;
  if (MASS_TO_MG[from] && MASS_TO_MG[to]) return amount.times(MASS_TO_MG[from]).div(MASS_TO_MG[to]);
  throw new RangeError(`Cannot convert ${from} to ${to}.`);
}
function defaultIncrement(form, volumeOrQty) {
  if (form === "tablet" || form === "chewable") return "0.25";
  if (form === "capsule") return "1";
  if (volumeOrQty.lt("1")) return "0.01";
  if (volumeOrQty.lt("10")) return "0.1";
  return "0.2";
}
function roundTo(value, increment) {
  const step = dec(increment);
  if (step.lte(0)) throw new RangeError("Rounding increment must be positive");
  return value.div(step).toDecimalPlaces(0, Decimal.ROUND_HALF_EVEN).times(step);
}
function numeratorUnit(concentrationUnit) {
  const [num] = String(concentrationUnit ?? "").split("/");
  return num || null;
}
function calculateDose(input) {
  const warnings = [];
  const weightKg = dec(input.weightKg);
  if (weightKg.lte(0)) throw new RangeError("A dose needs a positive weight.");
  const doseAmount = dec(input.doseAmount);
  if (doseAmount.lte(0)) throw new RangeError("A dose rate must be positive.");
  if (!DOSE_PERS.includes(input.dosePer)) throw new RangeError(`"${input.dosePer}" is not a dose basis: dose per kg, per m\xB2 or per animal (1 mg/lb = 2.2046 mg/kg).`);
  if (!DOSE_UNITS.includes(input.doseUnit)) throw new RangeError(`"${input.doseUnit}" is not a dose unit.`);
  if (input.maxWeightAgeHours != null && input.weightAgeHours != null && input.weightAgeHours > input.maxWeightAgeHours) {
    warnings.push({ code: "weight_stale", severity: "block", message: `The weight is ${input.weightAgeHours} hours old; this context allows ${input.maxWeightAgeHours}. Weigh the patient or record why the old weight is used.` });
  }
  let multiplier = new Decimal(1);
  let bsa = null;
  if (input.dosePer === "kg") multiplier = weightKg;
  else if (input.dosePer === "m2") {
    bsa = bodySurfaceArea(weightKg, input.species);
    multiplier = bsa.m2;
  }
  const total = doseAmount.times(multiplier);
  const product = input.product ?? null;
  let computed = null;
  let computedUnit = null;
  let roundingIncrement = null;
  let rounded = null;
  let delivered = null;
  let deviationBps = null;
  let concentration = null;
  if (product) {
    const isMass = Boolean(MASS_TO_MG[input.doseUnit]);
    const concUnit = numeratorUnit(product.concentrationUnit);
    if (product.concentration != null && concUnit && (isMass ? MASS_TO_MG[concUnit] : concUnit === input.doseUnit)) {
      concentration = dec(product.concentration);
      if (concentration.lte(0)) throw new RangeError("Product concentration must be positive.");
      const totalInConc = isMass ? convertAmount(total, input.doseUnit, concUnit) : total;
      computed = totalInConc.div(concentration);
      computedUnit = "mL";
    } else if (product.strength != null && product.strengthUnit && (isMass ? MASS_TO_MG[product.strengthUnit] : product.strengthUnit === input.doseUnit)) {
      const strength = dec(product.strength);
      if (strength.lte(0)) throw new RangeError("Product strength must be positive.");
      const totalInStrength = isMass ? convertAmount(total, input.doseUnit, product.strengthUnit) : total;
      computed = totalInStrength.div(strength);
      computedUnit = product.per || product.form;
      concentration = strength;
    } else if (["tablet", "capsule", "mL", "dose"].includes(input.doseUnit)) {
      computed = total;
      computedUnit = input.doseUnit;
    }
    if (computed) {
      roundingIncrement = product.measurableIncrement != null ? dec(product.measurableIncrement).toString() : defaultIncrement(product.form, computed);
      rounded = roundTo(computed, roundingIncrement);
      if (rounded.isZero()) {
        warnings.push({ code: "below_measurable", severity: "block", message: `The dose (${toScale(computed, 4)} ${computedUnit}) is below the smallest measurable amount (${roundingIncrement}); dilute or choose another product.` });
      }
      delivered = concentration && computedUnit !== input.doseUnit ? rounded.times(concentration) : rounded;
      deviationBps = toBpsInt(rounded.minus(computed).div(computed));
      if (Math.abs(deviationBps) > 1e3) warnings.push({ code: "rounding_deviation", severity: "warn", message: `Rounding changes the delivered dose by ${(deviationBps / 100).toString()}%.` });
    }
    const range = product.doseRanges?.[input.species];
    if (range) {
      const conc = product.concentration != null ? dec(product.concentration) : null;
      const rate2 = rateInRangeBasis(total, input.doseUnit, range, weightKg, input.species, conc && conc.gt(0) ? conc : null, numeratorUnit(product.concentrationUnit));
      const shown = `${doseAmount.toString()} ${input.doseUnit}/${input.dosePer}`;
      if (!rate2) {
        warnings.push({ code: "range_unconvertible", severity: "block", message: `${shown} cannot be compared with the formulary range (${range.unit}/${range.per}); enter the dose in ${range.unit}/${range.per}.` });
      } else {
        const asRange = `${toScale(rate2, 4).replace(/\.?0+$/, "")} ${range.unit}/${range.per}`;
        const same = range.unit === input.doseUnit && range.per === input.dosePer;
        if (range.max && rate2.gt(range.max)) warnings.push({ code: "above_range", severity: "block", message: `${shown}${same ? "" : ` (${asRange})`} is above the formulary maximum for a ${input.species} (${range.max} ${range.unit}/${range.per}).` });
        if (range.min && rate2.lt(range.min)) warnings.push({ code: "below_range", severity: "block", message: `${shown}${same ? "" : ` (${asRange})`} is below the formulary minimum for a ${input.species} (${range.min} ${range.unit}/${range.per}).` });
      }
      const manual = input.manualOverrideQty != null && input.manualOverrideQty !== "" ? dec(input.manualOverrideQty) : null;
      if (manual && manual.gt(0)) {
        const manualTotal = !concentration || !computedUnit || computedUnit === input.doseUnit ? { amount: manual, unit: input.doseUnit } : { amount: manual.times(concentration), unit: (product.concentration != null ? numeratorUnit(product.concentrationUnit) : product.strengthUnit) ?? input.doseUnit };
        const manualRate = rateInRangeBasis(manualTotal.amount, manualTotal.unit, range, weightKg, input.species, null, null);
        const qtyShown = `${manual.toString()} ${computedUnit ?? input.doseUnit}`;
        if (!manualRate) {
          warnings.push({ code: "range_unconvertible_override", severity: "block", message: `The manual quantity ${qtyShown} cannot be checked against the formulary range; order the dose rate instead.` });
        } else if (range.max && manualRate.gt(range.max) || range.min && manualRate.lt(range.min)) {
          const asRange = `${toScale(manualRate, 4).replace(/\.?0+$/, "")} ${range.unit}/${range.per}`;
          warnings.push({ code: "override_out_of_range", severity: "block", message: `The manual quantity ${qtyShown} delivers ${asRange}, outside the formulary range for a ${input.species} (${range.min ?? "0"}\u2013${range.max ?? "\u221E"} ${range.unit}/${range.per}). A manual quantity only adjusts measuring; order the dose rate itself.` });
        }
      }
    } else if (product.doseRanges && !range) {
      warnings.push({ code: "no_species_range", severity: "warn", message: `The formulary has no ${input.species} dose range for ${product.genericName}; check the dose against a current reference.` });
    }
    const flags = (product.cautionFlags ?? []).filter((f) => (input.geneticFlags ?? []).includes(f));
    for (const f of flags) warnings.push({ code: "genetic_caution", severity: "block", message: `${product.genericName} is a caution for this breed (${f.replace(/_/g, " ")}).` });
    const generic = product.genericName.toLowerCase();
    if ((input.sensitivities ?? []).some((s) => s.toLowerCase().includes(generic))) {
      warnings.push({ code: "patient_sensitivity", severity: "block", message: `The patient has a recorded sensitivity to ${product.genericName}.` });
    }
  }
  const override2 = input.manualOverrideQty != null && input.manualOverrideQty !== "" ? dec(input.manualOverrideQty) : null;
  const overrideReason = (input.overrideReason ?? "").trim();
  if (override2 && overrideReason.length < 8) throw new RangeError("A manual dose override needs a reason.");
  const body = {
    weightKg: toScale(weightKg, "wt"),
    doseAmount: toScale(doseAmount, "qty"),
    doseUnit: input.doseUnit,
    dosePer: input.dosePer,
    bsaM2: bsa ? toScale(bsa.m2, "qty") : null,
    bsaConstant: bsa ? toScale(bsa.constant, "qty") : null,
    totalAmount: toScale(total, "qty"),
    totalUnit: input.doseUnit,
    concentration: concentration ? toScale(concentration, "qty") : null,
    concentrationUnit: concentration ? product?.concentration != null ? product?.concentrationUnit ?? null : `${product?.strengthUnit}/${product?.per || product?.form}` : null,
    computedQty: computed ? toScale(computed, "qty") : null,
    computedUnit,
    roundingRule: roundingIncrement ? { increment: roundingIncrement, mode: "half_even" } : null,
    roundedQty: rounded ? toScale(rounded, "qty") : null,
    deliveredAmount: delivered ? toScale(delivered, "qty") : null,
    deviationBps,
    manualOverrideQty: override2 ? toScale(override2, "qty") : null,
    overrideReason,
    warnings,
    calcVersion: DOSE_CALC_VERSION
  };
  return { ...body, hash: sha256(canonicalJson({ input: { ...input, product: product ? { ...product, id: product.id ?? null } : null }, output: body })) };
}
function rateInRangeBasis(total, unit2, range, weightKg, species, concentration, concentrationUnit) {
  let amount = null;
  if (unit2 === range.unit) amount = total;
  else if (MASS_TO_MG[unit2] && MASS_TO_MG[range.unit]) amount = convertAmount(total, unit2, range.unit);
  else if (unit2 === "mL" && concentration && concentrationUnit && MASS_TO_MG[concentrationUnit] && MASS_TO_MG[range.unit]) amount = convertAmount(total.times(concentration), concentrationUnit, range.unit);
  if (!amount) return null;
  if (range.per === "animal") return amount;
  if (range.per === "kg") return amount.div(weightKg);
  if (range.per === "lb") return amount.div(weightKg.div(KG_PER_LB2));
  if (range.per === "m2") {
    if (!BSA_CONSTANTS[species]) return null;
    return amount.div(bodySurfaceArea(weightKg, species).m2);
  }
  return null;
}
var quantityToGive = (dose) => dose.manualOverrideQty ?? dose.roundedQty ?? dose.computedQty ?? null;
var ADMIN_QTY_TOLERANCE = { fraction: "0.10", floor: "0.01" };
function administrationQtyProblem(planned, given, unit2) {
  if (planned == null) return null;
  const p = dec(planned);
  const g = dec(given);
  if (p.lte(0)) return null;
  const tolerance = Decimal.max(p.times(ADMIN_QTY_TOLERANCE.fraction), dec(ADMIN_QTY_TOLERANCE.floor));
  if (g.minus(p).abs().lte(tolerance)) return null;
  const show = (d) => d.toDecimalPlaces(4).toString();
  return `${show(g)} ${unit2} is ${g.gt(p) ? "more" : "less"} than the ordered ${show(p)} ${unit2} (allowed ${show(p.minus(tolerance).clamp(0, p))}\u2013${show(p.plus(tolerance))} ${unit2}).`;
}
var blockingWarnings = (warnings) => warnings.filter((w) => w.severity === "block");

// features/keystone/domain/treatment.ts
var FREQUENCY_HOURS = {
  q1h: 1,
  q2h: 2,
  q4h: 4,
  q6h: 6,
  q8h: 8,
  q12h: 12,
  q24h: 24,
  sid: 24,
  bid: 12,
  tid: 8,
  qid: 6,
  prn: null,
  cri: null,
  once: null
};
function sheetFrequency(raw) {
  const f = raw.trim().toLowerCase();
  return f in FREQUENCY_HOURS ? f : null;
}
var HOUR = 36e5;
function dueTimes(input, from, to) {
  const hours = FREQUENCY_HOURS[input.frequency];
  const end = input.endAt && input.endAt < to ? input.endAt : to;
  if (input.frequency === "once") return input.startAt >= from && input.startAt < end ? [input.startAt] : [];
  if (hours == null) return [];
  const step = hours * HOUR;
  const out = [];
  const first = input.startAt.getTime() >= from.getTime() ? input.startAt.getTime() : input.startAt.getTime() + Math.ceil((from.getTime() - input.startAt.getTime()) / step) * step;
  for (let t = first; t < end.getTime(); t += step) out.push(new Date(t));
  return out;
}
function missedAfterMinutes(frequency, graceMinutes) {
  const f = frequency ? sheetFrequency(frequency) : null;
  const hours = f ? FREQUENCY_HOURS[f] ?? null : null;
  const half = hours ? hours * 60 / 2 : 240;
  return Math.max(half, graceMinutes, 60);
}
function taskStatusAt(task, now) {
  if (!["scheduled", "due", "overdue"].includes(task.status)) return task.status;
  const t = now.getTime();
  if (task.frequency !== void 0 && t >= task.dueAt.getTime() + missedAfterMinutes(task.frequency, task.graceMinutes) * 6e4) return "missed";
  if (t >= task.dueAt.getTime() + task.graceMinutes * 6e4) return "overdue";
  if (t >= task.dueAt.getTime() - HOUR) return "due";
  return "scheduled";
}
var TASK_EARLY_MINUTES = 60;
function taskWindowProblem(input) {
  const hhmm2 = (d) => new Intl.DateTimeFormat("en-US", { timeZone: input.timeZone ?? "UTC", hour: "numeric", minute: "2-digit", month: "short", day: "numeric" }).format(d);
  const hours = FREQUENCY_HOURS[input.frequency] ?? null;
  if (input.lastDoneAt && hours) {
    const minGapMs = hours * HOUR / 2;
    const since = input.now.getTime() - input.lastDoneAt.getTime();
    if (since < minGapMs) {
      const next = new Date(input.lastDoneAt.getTime() + minGapMs);
      return { code: "too_soon", message: `A ${input.frequency} dose was already given ${Math.round(since / 6e4)} minutes ago; the next one cannot be given before ${hhmm2(next)}.` };
    }
  }
  const opens = input.dueAt.getTime() - TASK_EARLY_MINUTES * 6e4;
  if (input.now.getTime() < opens && !input.earlyOverride) {
    return { code: "too_early", message: `This task is due ${hhmm2(input.dueAt)}; it can be done from ${hhmm2(new Date(opens))}. A veterinarian can give it early with a reason.` };
  }
  return null;
}

// features/keystone/mutations/treatment.ts
var ORDER_KINDS = ["medication", "procedure", "treatment", "lab", "imaging", "vaccine", "fluid", "diet", "nursing"];
var LICENSED_ORDER = { medication: "prescribe", procedure: "diagnose", euthanasia: "authorise_euthanasia" };
function checkDoseArgs(args) {
  if (!DOSE_PERS.includes(args.dosePer)) throw new DomainError(Codes.INVALID_INPUT, "Dose per kg, per m\xB2 or per animal. For a per-lb dose, multiply by 2.2046 to get per kg.", { field: "dosePer" });
  if (!DOSE_UNITS.includes(args.doseUnit)) throw new DomainError(Codes.INVALID_INPUT, "Choose the dose unit.", { field: "doseUnit" });
}
async function doseFor(uow, patientId, drugId, args, staff) {
  checkDoseArgs(args);
  const patient = await activePatient(uow, patientId);
  const drug = await uow.tx.drugProduct.findUnique({ where: { id: drugId } });
  if (!drug || !drug.active) throw new DomainError(Codes.NOT_FOUND, "Drug not found.");
  const weight = args.weightId ? await uow.tx.weightMeasurement.findFirst({ where: { id: args.weightId, patientId }, select: { id: true, valueKg: true, measuredAt: true } }).then((w) => w && { id: w.id, valueKg: w.valueKg.toString(), measuredAt: w.measuredAt, ageHours: Math.floor((uow.now.getTime() - w.measuredAt.getTime()) / 36e5) }) : await latestWeight(uow, patientId);
  if (!weight) throw new DomainError(Codes.GUARD_FAILED, "Weigh the patient first: every dose is calculated from a recorded weight (I-C4).", { reason: "no_weight" });
  const settings = await practiceSettings(uow);
  const sensitivities = (await uow.tx.patientAlert.findMany({ where: { patientId, active: true, kind: { in: ["allergy", "drug_sensitivity"] } }, select: { text: true } })).map((a) => a.text);
  const geneticFlags = Object.entries(patient.breed?.geneticFlags ?? {}).filter(([, v]) => v).map(([k]) => k);
  const input = {
    weightKg: weight.valueKg,
    weightAgeHours: weight.ageHours,
    maxWeightAgeHours: settings.weightMaxAgeHours[args.context ?? "outpatient"] ?? null,
    doseAmount: decimalText(args.doseAmount, "doseAmount"),
    doseUnit: args.doseUnit,
    dosePer: args.dosePer,
    species: patient.species?.code ?? "unknown",
    product: { id: drug.id, genericName: drug.genericName, form: drug.form, strength: drug.strength?.toString() ?? null, strengthUnit: drug.strengthUnit, per: drug.per, concentration: drug.concentration?.toString() ?? null, concentrationUnit: drug.concentrationUnit, measurableIncrement: drug.measurableIncrement?.toString() ?? null, doseRanges: drug.doseRanges, cautionFlags: drug.cautionFlags ?? [] },
    geneticFlags,
    sensitivities,
    manualOverrideQty: args.manualOverrideQty || null,
    overrideReason: args.overrideReason ?? null
  };
  let result;
  try {
    result = calculateDose(input);
  } catch (error) {
    throw new DomainError(Codes.INVALID_INPUT, error.message, { field: "doseAmount" });
  }
  const blocks = blockingWarnings(result.warnings);
  const hard = blocks.filter((b) => HARD_BLOCKS.includes(b.code));
  if (hard.length) throw new DomainError(Codes.GUARD_FAILED, `${hard.map((b) => b.message).join(" ")} Outside the formulary range a dose is not given; change the dose, or change the formulary range.`, { reason: "dose_refused", problems: result.warnings });
  if (blocks.length && !(args.overrideReason && args.overrideReason.trim().length >= 8)) {
    throw new DomainError(Codes.GUARD_FAILED, `${blocks.map((b) => b.message).join(" ")} To go ahead, a veterinarian records an override reason.`, { reason: "dose_blocked", problems: result.warnings });
  }
  if (blocks.length && staff.kind !== "dvm") throw new DomainError(Codes.GUARD_FAILED, `${blocks.map((b) => b.message).join(" ")} Only a veterinarian can override this.`, { reason: "dose_blocked", problems: result.warnings });
  const row = await uow.tx.doseCalculation.create({
    data: {
      patientId,
      weightId: weight.id,
      weightKg: result.weightKg,
      weightAgeHours: weight.ageHours,
      doseAmount: result.doseAmount,
      doseUnit: result.doseUnit,
      dosePer: result.dosePer,
      bsaM2: result.bsaM2,
      bsaConstant: result.bsaConstant,
      totalAmount: result.totalAmount,
      totalUnit: result.totalUnit,
      productId: drug.id,
      concentration: result.concentration,
      concentrationUnit: result.concentrationUnit ?? "",
      computedQty: result.computedQty,
      computedUnit: result.computedUnit ?? "",
      roundingRule: toJsonValue(result.roundingRule),
      roundedQty: result.roundedQty,
      deliveredAmount: result.deliveredAmount,
      deviationBps: result.deviationBps,
      manualOverrideQty: result.manualOverrideQty,
      overrideReason: result.overrideReason,
      warnings: toJsonValue(result.warnings),
      calcVersion: result.calcVersion,
      hash: result.hash,
      byId: staff.id,
      at: uow.now
    }
  });
  return { row, result, drug, input };
}
async function previewDose(_root, args, context) {
  return gated(context, { permissions: ["canOrder", "canReadClinical"], tool: "dose.preview", humanOnly: true }, args, async () => {
    checkDoseArgs(args);
    const prisma = context.prisma;
    const patient = await prisma.patient.findUnique({ where: { id: args.patientId }, select: { species: { select: { code: true } }, breed: { select: { geneticFlags: true } } } });
    const drug = await prisma.drugProduct.findUnique({ where: { id: args.drugId } });
    const w = await prisma.weightMeasurement.findFirst({ where: { patientId: args.patientId, ...args.weightId ? { id: args.weightId } : {} }, orderBy: { measuredAt: "desc" }, select: { valueKg: true, measuredAt: true } });
    if (!patient || !drug) throw new DomainError(Codes.NOT_FOUND, "Patient or drug not found.");
    if (!w) throw new DomainError(Codes.GUARD_FAILED, "Weigh the patient first.", { reason: "no_weight" });
    const settings = await prisma.practiceSettings.findUnique({ where: { id: 1 }, select: { weightMaxAgeHours: true } });
    const sensitivities = (await prisma.patientAlert.findMany({ where: { patientId: args.patientId, active: true, kind: { in: ["allergy", "drug_sensitivity"] } }, select: { text: true } })).map((a) => a.text);
    try {
      return calculateDose({
        weightKg: w.valueKg.toString(),
        weightAgeHours: Math.floor((Date.now() - w.measuredAt.getTime()) / 36e5),
        maxWeightAgeHours: settings?.weightMaxAgeHours?.[args.context ?? "outpatient"] ?? null,
        doseAmount: decimalText(args.doseAmount, "doseAmount"),
        doseUnit: args.doseUnit,
        dosePer: args.dosePer,
        species: patient.species?.code ?? "unknown",
        product: { genericName: drug.genericName, form: drug.form, strength: drug.strength?.toString() ?? null, strengthUnit: drug.strengthUnit, per: drug.per, concentration: drug.concentration?.toString() ?? null, concentrationUnit: drug.concentrationUnit, measurableIncrement: drug.measurableIncrement?.toString() ?? null, doseRanges: drug.doseRanges, cautionFlags: drug.cautionFlags ?? [] },
        geneticFlags: Object.entries(patient.breed?.geneticFlags ?? {}).filter(([, v]) => v).map(([k]) => k),
        sensitivities,
        manualOverrideQty: args.manualOverrideQty || null,
        overrideReason: args.overrideReason ?? null
      });
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(Codes.INVALID_INPUT, error.message);
    }
  });
}
async function placeOrder(_root, args, context) {
  return gated(context, { permissions: ["canOrder"], tool: "order.place", humanOnly: true }, args, async (actor) => {
    if (!ORDER_KINDS.includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, "Choose the kind of order.", { field: "kind" });
    if (args.route && !ROUTES.includes(args.route)) throw new DomainError(Codes.INVALID_INPUT, "Unknown route.", { field: "route" });
    const result = await command(context.prisma, { name: "order.place", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      await activePatient(uow, enc.patientId);
      const licensedAction = LICENSED_ORDER[args.kind];
      const licence = licensedAction ? await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: enc.locationId, action: licensedAction, at: uow.now }) : null;
      let doseId = null;
      let description = text16(args.description ?? "", "description", 300, args.kind !== "medication");
      let warnings = [];
      let drug = null;
      if (args.kind === "medication") {
        if (!args.drugId || !args.dose) throw new DomainError(Codes.INVALID_INPUT, "A medication order needs the drug and the dose.", { field: "dose" });
        if (!args.route || !args.frequency) throw new DomainError(Codes.INVALID_INPUT, "A medication order needs the route and frequency.", { field: "route" });
        const { on } = await locationDay2(uow, enc.locationId, uow.now);
        if (args.extralabel) {
          const vcpr = await resolvePolicy(uow.tx, "vcpr", { locationId: enc.locationId, on });
          if (vcpr.rules.requiredFor.includes("extralabel")) {
            const active = await uow.tx.vcprRecord.findFirst({ where: { patientId: enc.patientId, status: "active", expiresAt: { gt: uow.now }, OR: [{ scope: "practice" }, { dvmId: staff.id }] }, select: { id: true } });
            if (!active && !["outpatient", "inpatient_day", "surgery", "dental", "emergency"].includes(enc.kind)) throw new DomainError(Codes.VCPR_REQUIRED, "Extralabel use needs an active veterinarian-client-patient relationship.");
          }
        }
        const dose = await doseFor(uow, enc.patientId, args.drugId, { ...args.dose, context: args.dose.context ?? (enc.stayId || args.sheet ? "inpatient" : "outpatient") }, staff);
        doseId = dose.row.id;
        warnings = dose.result.warnings;
        drug = { id: dose.drug.id, displayName: dose.drug.displayName, csSchedule: dose.drug.csSchedule };
        description ||= `${dose.drug.displayName}: ${dose.result.doseAmount.replace(/\.?0+$/, "")} ${args.dose.doseUnit}/${args.dose.dosePer} = ${quantityToGive(dose.result)?.replace(/\.?0+$/, "")} ${dose.result.computedUnit ?? ""}`.trim();
      }
      const ref = await nextReference(uow.tx, "ORD", uow.now);
      const order = await uow.tx.clinicalOrder.create({
        data: {
          ref,
          encounterId: enc.id,
          patientId: enc.patientId,
          locationId: enc.locationId,
          kind: args.kind,
          description,
          drugId: drug?.id ?? null,
          status: "ordered",
          orderedById: staff.id,
          licenseEvaluationId: licence?.evaluationId ?? null,
          doseId,
          frequency: args.frequency ?? "",
          route: args.route ?? "other",
          quantity: args.quantity ? decimalText(args.quantity, "quantity") : null,
          quantityUnit: args.quantityUnit ?? "",
          extralabel: args.extralabel === true,
          warnings: toJsonValue(warnings),
          overrideReason: args.dose?.overrideReason ?? "",
          schedule: args.sheet ? toJsonValue({ frequency: args.sheet.frequency, startAt: args.sheet.startAt ?? uow.now, durationHours: args.sheet.durationHours ?? null }) : void 0
        }
      });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "ClinicalOrder", order.id, "order.placed", { ref, kind: args.kind, encounterId: enc.id, drugId: drug?.id ?? null, doseId, csSchedule: drug?.csSchedule ?? null, warnings: warnings.map((w) => w.code) });
      let sheetOrderId = null;
      let tasks = 0;
      if (args.sheet) {
        const created = await addSheetOrder(uow, { orderId: order.id, stayId: args.sheet.stayId, patientId: enc.patientId, frequency: args.sheet.frequency, startAt: args.sheet.startAt ? new Date(args.sheet.startAt) : uow.now, durationHours: args.sheet.durationHours ?? null, instructions: args.sheet.instructions ?? "" });
        sheetOrderId = created.id;
        tasks = created.tasks;
      }
      return { id: order.id, ref, description, doseId, warnings, sheetOrderId, tasks };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function cancelOrder(_root, args, context) {
  return gated(context, { permissions: ["canOrder"], tool: "order.cancel", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "order.cancel", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const given = await uow.tx.administration.count({ where: { orderId: args.orderId, reverses: null } });
      if (given) throw new DomainError(Codes.GUARD_FAILED, "Doses were already given on this order; reverse them instead of cancelling.");
      const row = await transition(uow, { model: "ClinicalOrder", id: args.orderId, from: ["ordered", "in_progress"], to: "cancelled", expectedVersion: args.expectedVersion, actor, eventType: "order.cancelled", reason, data: { cancelReason: reason } });
      const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { orderId: args.orderId, active: true }, select: { id: true } });
      for (const s of sheets) {
        await uow.tx.treatmentSheetOrder.update({ where: { id: s.id }, data: { active: false, endAt: uow.now, version: { increment: 1 } } });
        await uow.tx.treatmentTask.updateMany({ where: { sheetOrderId: s.id, status: { in: ["scheduled", "due", "overdue"] }, dueAt: { gte: uow.now } }, data: { status: "skipped", skipReason: `Order cancelled: ${reason}`, version: { increment: 1 } } });
      }
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function recordAdministration(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "order.administer", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "order.administer", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      return administer(uow, actor, staff, args);
    });
    return { replay: result.replay, ...result.value };
  });
}
async function administer(uow, actor, staff, args) {
  const order = await lockRow(uow.tx, "ClinicalOrder", args.orderId);
  if (!["ordered", "in_progress"].includes(order.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${order.ref} is ${order.status}; nothing more can be given on it.`);
  await activePatient(uow, order.patientId);
  const enc = await uow.tx.encounter.findUnique({ where: { id: order.encounterId }, select: { status: true } });
  if (enc?.status === "voided") throw new DomainError(Codes.GUARD_FAILED, "The visit record was voided.");
  const drug = order.drugId ? await uow.tx.drugProduct.findUnique({ where: { id: order.drugId }, select: { id: true, displayName: true, csSchedule: true, requiresWitnessOnAdminister: true } }) : null;
  const dose = order.doseId ? await uow.tx.doseCalculation.findUnique({ where: { id: order.doseId }, select: { roundedQty: true, computedQty: true, manualOverrideQty: true, computedUnit: true } }) : null;
  const planned = dose ? quantityToGive({ manualOverrideQty: dose.manualOverrideQty?.toString() ?? null, roundedQty: dose.roundedQty?.toString() ?? null, computedQty: dose.computedQty?.toString() ?? null }) : null;
  const qty2 = args.qty ? decimalText(args.qty, "qty") : planned;
  if (!qty2 || dec(qty2).lte(0)) throw new DomainError(Codes.INVALID_INPUT, "Enter the amount given.", { field: "qty" });
  const unit2 = dose?.computedUnit || "dose";
  const qtyProblem = administrationQtyProblem(planned, qty2, unit2);
  const qtyOverrideReason = (args.qtyOverrideReason ?? "").trim();
  if (qtyProblem) {
    if (staff.kind !== "dvm") throw new DomainError(Codes.GUARD_FAILED, `${qtyProblem} Give the ordered amount, or ask a veterinarian to record it with a reason.`, { field: "qty", reason: "qty_outside_order" });
    if (qtyOverrideReason.length < 8) throw new DomainError(Codes.GUARD_FAILED, `${qtyProblem} To record it anyway, give the reason (at least 8 characters).`, { field: "qtyOverrideReason", reason: "qty_outside_order" });
  }
  const { on } = await locationDay2(uow, order.locationId, uow.now);
  const controlled = Boolean(drug && drug.csSchedule && drug.csSchedule !== "none");
  let licenceId = null;
  let lotNumber = "";
  let lotExpiresOn = null;
  let lotId = null;
  let csEntryId = null;
  let wasteEntryId = null;
  let witnessId = null;
  if (controlled) {
    if (!args.csContainerId) throw new DomainError(Codes.INVALID_INPUT, "Choose the controlled-substance container the dose was drawn from.", { field: "csContainerId" });
    licenceId = (await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: order.locationId, action: "administer_controlled", at: uow.now })).evaluationId;
    const container = await lockRow(uow.tx, "CsContainer", args.csContainerId);
    if (container.productId !== drug.id) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} holds a different drug.`);
    if (container.locationId !== order.locationId) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} belongs to another location.`);
    if (container.status !== "open") throw new DomainError(Codes.GUARD_FAILED, `${container.ref} is ${container.status}.`);
    if (container.lotExpiresOn && day2(container.lotExpiresOn) < on) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} expired on ${day2(container.lotExpiresOn)}.`);
    if (container.budAt && container.budAt < uow.now) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} is past its beyond-use date.`);
    const waste = args.wasteQty ? dec(decimalText(args.wasteQty, "wasteQty")) : dec(0);
    const scheduleII = drug.csSchedule === "CII" || drug.csSchedule === "CIIN";
    if (args.witnessId) witnessId = (await witnessFor(uow, args.witnessId, staff.id)).id;
    if ((drug.requiresWitnessOnAdminister || scheduleII || waste.gt(0)) && !witnessId) {
      throw new DomainError(Codes.INVALID_INPUT, waste.gt(0) ? "Wasting a controlled drug needs a witness." : "A second person must witness this controlled drug.", { field: "witnessId" });
    }
    const balance = await containerBalance(uow.tx, container.id);
    if (balance.lt(dec(qty2).plus(waste))) throw new DomainError(Codes.GUARD_FAILED, `${container.ref} has ${balance.toString()} ${container.labelUnit} left; that is not enough.`);
    const entry = await appendCsEntry(uow.tx, { containerId: container.id, type: "administer", qtySigned: dec(qty2).neg(), unit: container.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId, patientId: order.patientId, reason: order.ref }, uow.now);
    csEntryId = entry.id;
    if (waste.gt(0)) wasteEntryId = (await appendCsEntry(uow.tx, { containerId: container.id, type: "waste", qtySigned: waste.neg(), unit: container.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId, patientId: order.patientId, reason: `Waste on ${order.ref}` }, uow.now)).id;
    lotNumber = container.lotNumber;
    lotExpiresOn = container.lotExpiresOn;
  } else if (args.lotId) {
    const lot = await uow.tx.inventoryLot.findUnique({ where: { id: args.lotId }, select: { id: true, lotNumber: true, expiresOn: true, status: true, drugId: true, locationId: true } });
    if (!lot) throw new DomainError(Codes.NOT_FOUND, "Lot not found.");
    if (drug && lot.drugId !== drug.id) throw new DomainError(Codes.GUARD_FAILED, "That lot is a different product.");
    if (lot.status !== "available") throw new DomainError(Codes.GUARD_FAILED, `Lot ${lot.lotNumber} is ${lot.status}.`);
    if (day2(lot.expiresOn) < on) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lot.lotNumber} expired on ${day2(lot.expiresOn)}.`);
    lotId = lot.id;
    lotNumber = lot.lotNumber;
    lotExpiresOn = lot.expiresOn;
  } else if (drug) {
    throw new DomainError(Codes.INVALID_INPUT, "Choose the lot the dose came from.", { field: "lotId" });
  }
  const row = await uow.tx.administration.create({
    data: {
      orderId: order.id,
      patientId: order.patientId,
      encounterId: order.encounterId,
      treatmentTaskId: args.treatmentTaskId ?? null,
      lotId,
      lotNumber: lotNumber || (drug ? "" : "n/a"),
      lotExpiresOn,
      csContainerId: controlled ? args.csContainerId : null,
      csLogEntryId: csEntryId,
      wasteLogEntryId: wasteEntryId,
      qty: toScale(qty2, "qty"),
      unit: unit2,
      route: args.route ?? order.route ?? "other",
      site: args.site ?? "",
      givenById: staff.id,
      supervisingDvmId: args.supervisingDvmId ?? null,
      witnessId,
      licenseEvaluationId: licenceId,
      givenAt: uow.now,
      wasteQty: args.wasteQty ? toScale(args.wasteQty, "qty") : null,
      qtyOverrideReason: qtyProblem ? text16(qtyOverrideReason, "qtyOverrideReason", 300) : ""
    }
  });
  if (order.status === "ordered") await uow.tx.clinicalOrder.update({ where: { id: order.id }, data: { status: "in_progress", version: { increment: 1 } } });
  auditCreate(uow, actor, "Administration", row.id, "order.administered", { orderRef: order.ref, qty: row.qty.toString(), planned, unit: unit2, controlled, csLogEntryId: csEntryId, wasteLogEntryId: wasteEntryId, lotNumber, qtyOverride: Boolean(qtyProblem) }, { reason: qtyProblem ? qtyOverrideReason : null });
  return { id: row.id, qty: row.qty.toString(), unit: unit2, csLogEntryId: csEntryId, wasteLogEntryId: wasteEntryId };
}
async function reverseAdministration(_root, args, context) {
  return gated(context, { permissions: ["canOrder", "canAdminister"], tool: "order.reverse_administration", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    if (reason.length < 8) throw new DomainError(Codes.INVALID_INPUT, "Give the reason for the reversal (at least 8 characters).", { field: "reason" });
    const result = await command(context.prisma, { name: "order.reverse_administration", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (staff.kind !== "dvm") throw new DomainError(Codes.NOT_AUTHORIZED, "Only a veterinarian can reverse an administration.");
      const original = await uow.tx.administration.findUnique({ where: { id: args.administrationId }, include: { csLogEntry: { select: { id: true, ref: true, qtySigned: true, unit: true, containerId: true } }, wasteLogEntry: { select: { ref: true } } } });
      if (!original) throw new DomainError(Codes.NOT_FOUND, "Administration not found.");
      if (original.reversesId) throw new DomainError(Codes.GUARD_FAILED, "That row is itself a reversal.");
      const order = await lockRow(uow.tx, "ClinicalOrder", original.orderId);
      if (await uow.tx.administration.count({ where: { reversesId: original.id } })) throw new DomainError(Codes.GUARD_FAILED, "This dose was already reversed.", { reason: "already_reversed" });
      let contraId = null;
      let witnessId = null;
      if (original.csLogEntry) {
        if (args.witnessId) witnessId = (await witnessFor(uow, args.witnessId, staff.id)).id;
        await lockRow(uow.tx, "CsContainer", original.csLogEntry.containerId);
        contraId = (await appendCsEntry(uow.tx, { containerId: original.csLogEntry.containerId, type: "adjust", qtySigned: dec(original.csLogEntry.qtySigned.toString()).neg(), unit: original.csLogEntry.unit ?? "mL", occurredAt: uow.now, actorId: staff.id, witnessId, patientId: original.patientId, reversesId: original.csLogEntry.id, reason: `Reversal of ${original.csLogEntry.ref} on ${order.ref}: ${reason}`.slice(0, 300) }, uow.now)).id;
      }
      const row = await uow.tx.administration.create({
        data: {
          orderId: original.orderId,
          patientId: original.patientId,
          encounterId: original.encounterId,
          lotId: original.lotId,
          lotNumber: original.lotNumber,
          lotExpiresOn: original.lotExpiresOn,
          csContainerId: original.csContainerId,
          csLogEntryId: contraId,
          qty: toScale(dec(original.qty.toString()).neg(), "qty"),
          unit: original.unit,
          route: original.route,
          site: original.site,
          givenById: staff.id,
          witnessId,
          givenAt: uow.now,
          reversesId: original.id,
          reason
        }
      });
      const live = await uow.tx.administration.count({ where: { orderId: order.id, reversesId: null, from_Administration_reverses: { none: {} } } });
      let orderStatus = order.status;
      if (!live && ["ordered", "in_progress"].includes(order.status)) {
        const t = await transition(uow, { model: "ClinicalOrder", id: order.id, from: ["ordered", "in_progress"], to: "reversed", expectedVersion: order.version, actor, eventType: "order.reversed", reason, data: { cancelReason: `Doses reversed: ${reason}`.slice(0, 300) } });
        orderStatus = String(t.status);
        const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { orderId: order.id, active: true }, select: { id: true } });
        for (const s of sheets) {
          await uow.tx.treatmentSheetOrder.update({ where: { id: s.id }, data: { active: false, endAt: uow.now, version: { increment: 1 } } });
          await uow.tx.treatmentTask.updateMany({ where: { sheetOrderId: s.id, status: { in: ["scheduled", "due", "overdue"] } }, data: { status: "skipped", skipReason: `Order reversed: ${reason}`.slice(0, 300), version: { increment: 1 } } });
        }
      }
      auditCreate(uow, actor, "Administration", row.id, "order.administration_reversed", { reverses: original.id, orderRef: order.ref, qty: original.qty.toString(), contraCsLogEntryId: contraId, reason, orderStatus });
      return { id: row.id, reverses: original.id, contraCsLogEntryId: contraId, orderStatus };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function completeOrder(_root, args, context) {
  return gated(context, { permissions: ["canOrder", "canAdminister"], tool: "order.complete", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "order.complete", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "ClinicalOrder", id: args.orderId, from: ["ordered", "in_progress"], to: "completed", expectedVersion: args.expectedVersion, actor, eventType: "order.completed" });
      await uow.tx.treatmentSheetOrder.updateMany({ where: { orderId: args.orderId, active: true }, data: { active: false, endAt: uow.now, version: { increment: 1 } } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function cageFree(uow, cage) {
  const taken = await uow.tx.cageAssignment.findFirst({ where: { cageId: cage.id, toAt: null }, select: { stay: { select: { ref: true, patient: { select: { name: true } } } } } });
  if (taken) throw new DomainError(Codes.GUARD_FAILED, `Cage ${cage.code} is occupied${taken.stay?.patient?.name ? ` by ${taken.stay.patient.name}` : ""} (${taken.stay?.ref ?? "another stay"}). Choose a free cage.`, { reason: "cage_occupied" });
}
async function admitPatient(_root, args, context) {
  return gated(context, { permissions: ["canOrder"], tool: "stay.admit", humanOnly: true }, args, async (actor) => {
    if (!["full", "closed_chest_only", "dnr"].includes(args.codeStatus)) throw new DomainError(Codes.INVALID_INPUT, "Record the CPR code status.", { field: "codeStatus" });
    const result = await command(context.prisma, { name: "stay.admit", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      await activePatient(uow, enc.patientId);
      await advisoryLock(uow.tx, `cage:${args.cageId}`);
      const cage = await uow.tx.cage.findUnique({ where: { id: args.cageId }, select: { id: true, code: true, active: true, ward: { select: { locationId: true } } } });
      if (!cage || !cage.active) throw new DomainError(Codes.NOT_FOUND, "Cage not found.");
      if (cage.ward?.locationId !== enc.locationId) throw new DomainError(Codes.GUARD_FAILED, "That cage is at another location.");
      await cageFree(uow, cage);
      const live = await uow.tx.hospitalStay.findFirst({ where: { patientId: enc.patientId, status: { in: ["admitted", "in_care", "ready_for_discharge"] } }, select: { ref: true } });
      if (live) throw new DomainError(Codes.GUARD_FAILED, `The patient is already admitted (${live.ref}).`);
      const ref = await nextReference(uow.tx, "STAY", uow.now);
      const stay = await uow.tx.hospitalStay.create({ data: { ref, patientId: enc.patientId, locationId: enc.locationId, encounterId: enc.id, cageId: cage.id, admittedAt: uow.now, status: "admitted", codeStatus: args.codeStatus, attendingDvmId: enc.attendingDvmId ?? (staff.kind === "dvm" ? staff.id : null), reason: text16(args.reason ?? "", "reason", 300, false) } });
      await uow.tx.cageAssignment.create({ data: { stayId: stay.id, cageId: cage.id, fromAt: uow.now } });
      await uow.tx.encounter.update({ where: { id: enc.id }, data: { stayId: stay.id, version: { increment: 1 } } });
      await uow.tx.patient.update({ where: { id: enc.patientId }, data: { codeStatus: args.codeStatus, version: { increment: 1 } } });
      const board = await uow.tx.whiteboardEntry.findFirst({ where: { patientId: enc.patientId, status: { not: "discharged" } }, select: { id: true } });
      if (board) await uow.tx.whiteboardEntry.update({ where: { id: board.id }, data: { status: "hospitalised", since: uow.now, version: { increment: 1 } } });
      else await uow.tx.whiteboardEntry.create({ data: { locationId: enc.locationId, patientId: enc.patientId, status: "hospitalised", since: uow.now, assignedDvmId: stay.attendingDvmId } });
      auditCreate(uow, actor, "HospitalStay", stay.id, "stay.admitted", { ref, cage: cage.code, codeStatus: args.codeStatus, encounterId: enc.id });
      return { id: stay.id, ref, cage: cage.code };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function moveCage(_root, args, context) {
  return gated(context, { permissions: ["canOrder", "canAdminister"], tool: "stay.move", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "stay.move", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const stay = await lockRow(uow.tx, "HospitalStay", args.stayId);
      if (!["admitted", "in_care", "ready_for_discharge"].includes(stay.status)) throw new DomainError(Codes.GUARD_FAILED, `${stay.ref} is ${stay.status}.`);
      if (stay.cageId === args.cageId) return { id: stay.id, unchanged: true };
      await advisoryLock(uow.tx, `cage:${args.cageId}`);
      const cage = await uow.tx.cage.findUnique({ where: { id: args.cageId }, select: { id: true, code: true, active: true, ward: { select: { locationId: true } } } });
      if (!cage || !cage.active || cage.ward?.locationId !== stay.locationId) throw new DomainError(Codes.NOT_FOUND, "Cage not found at this location.");
      await cageFree(uow, cage);
      await uow.tx.cageAssignment.updateMany({ where: { stayId: stay.id, toAt: null }, data: { toAt: uow.now } });
      await uow.tx.cageAssignment.create({ data: { stayId: stay.id, cageId: cage.id, fromAt: uow.now } });
      await uow.tx.hospitalStay.update({ where: { id: stay.id }, data: { cageId: cage.id, version: { increment: 1 } } });
      auditCreate(uow, actor, "HospitalStay", stay.id, "stay.moved", { to: cage.code });
      return { id: stay.id, cage: cage.code };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function dischargePatient(_root, args, context) {
  return gated(context, { permissions: ["canOrder"], tool: "stay.discharge", humanOnly: true }, args, async (actor) => {
    const body = text16(args.instructions, "instructions", 1e4);
    if (args.recheckOn && !/^\d{4}-\d{2}-\d{2}$/.test(args.recheckOn)) throw new DomainError(Codes.INVALID_INPUT, "recheckOn is YYYY-MM-DD.", { field: "recheckOn" });
    const result = await command(context.prisma, { name: "stay.discharge", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const row = await transition(uow, { model: "HospitalStay", id: args.stayId, from: ["admitted", "in_care", "ready_for_discharge"], to: "discharged", expectedVersion: args.expectedVersion, actor, eventType: "stay.discharged", data: { dischargedAt: uow.now } });
      await uow.tx.cageAssignment.updateMany({ where: { stayId: row.id, toAt: null }, data: { toAt: uow.now } });
      const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { stayId: row.id, active: true }, select: { id: true } });
      for (const s of sheets) {
        await uow.tx.treatmentSheetOrder.update({ where: { id: s.id }, data: { active: false, endAt: uow.now, version: { increment: 1 } } });
        await uow.tx.treatmentTask.updateMany({ where: { sheetOrderId: s.id, status: { in: ["scheduled", "due", "overdue"] }, dueAt: { gte: uow.now } }, data: { status: "skipped", skipReason: "Patient discharged", version: { increment: 1 } } });
      }
      const instr = await uow.tx.dischargeInstruction.create({ data: { encounterId: row.encounterId, stayId: row.id, patientId: row.patientId, body, recheckOn: args.recheckOn ? /* @__PURE__ */ new Date(`${args.recheckOn}T00:00:00Z`) : null, authorId: staff.id } });
      await uow.tx.whiteboardEntry.updateMany({ where: { patientId: row.patientId, status: "hospitalised" }, data: { status: "ready_for_discharge", since: uow.now, version: { increment: 1 } } });
      await renderDischargeDocument(uow, instr.id);
      return { id: row.id, status: "discharged", instructionId: instr.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addSheetOrder(uow, input) {
  const frequency = sheetFrequency(input.frequency);
  if (!frequency) throw new DomainError(Codes.INVALID_INPUT, `"${input.frequency}" is not a treatment-sheet frequency: use q1h to q24h, SID, BID, TID, QID, PRN, CRI or once.`, { field: "frequency" });
  input = { ...input, frequency };
  const stay = await uow.tx.hospitalStay.findUnique({ where: { id: input.stayId }, select: { id: true, status: true, patientId: true } });
  if (!stay || stay.patientId !== input.patientId) throw new DomainError(Codes.NOT_FOUND, "Hospital stay not found for this patient.");
  if (!["admitted", "in_care"].includes(stay.status)) throw new DomainError(Codes.GUARD_FAILED, `The stay is ${stay.status}.`);
  const sheet = await uow.tx.treatmentSheetOrder.create({ data: { stayId: stay.id, orderId: input.orderId, patientId: input.patientId, frequency: input.frequency, startAt: input.startAt, endAt: input.durationHours ? new Date(input.startAt.getTime() + input.durationHours * 36e5) : null, instructions: input.instructions, active: true } });
  if (stay.status === "admitted") await uow.tx.hospitalStay.update({ where: { id: stay.id }, data: { status: "in_care", version: { increment: 1 } } });
  const tasks = await materialiseSheetOrder(uow, sheet.id, new Date(uow.now.getTime() + 24 * 36e5));
  return { id: sheet.id, tasks };
}
async function materialiseSheetOrder(uow, sheetOrderId, horizon) {
  const sheet = await uow.tx.treatmentSheetOrder.findUniqueOrThrow({ where: { id: sheetOrderId }, select: { id: true, stayId: true, patientId: true, frequency: true, startAt: true, endAt: true, active: true, materialisedThrough: true } });
  if (!sheet.active) return 0;
  const from = sheet.materialisedThrough ?? sheet.startAt;
  const times = dueTimes({ frequency: sheet.frequency, startAt: sheet.startAt, endAt: sheet.endAt }, sheet.materialisedThrough ? from : sheet.startAt, horizon);
  let created = 0;
  if (times.length) {
    const result = await uow.tx.treatmentTask.createMany({ data: times.map((dueAt) => ({ sheetOrderId: sheet.id, stayId: sheet.stayId, patientId: sheet.patientId, dueAt, status: "scheduled" })), skipDuplicates: true });
    created = result.count;
  }
  if (!sheet.materialisedThrough || horizon > sheet.materialisedThrough) await uow.tx.treatmentSheetOrder.update({ where: { id: sheet.id }, data: { materialisedThrough: horizon } });
  return created;
}
async function runTreatmentSheetJob(uow) {
  const horizon = new Date(uow.now.getTime() + 24 * 36e5);
  const sheets = await uow.tx.treatmentSheetOrder.findMany({ where: { active: true, OR: [{ endAt: null }, { endAt: { gt: uow.now } }] }, select: { id: true, graceMinutes: true } });
  let created = 0;
  for (const s of sheets) created += await materialiseSheetOrder(uow, s.id, horizon);
  const open = await uow.tx.treatmentTask.findMany({ where: { status: { in: ["scheduled", "due", "overdue"] }, dueAt: { lte: new Date(uow.now.getTime() + 36e5) } }, select: { id: true, dueAt: true, status: true, patientId: true, sheetOrder: { select: { graceMinutes: true, frequency: true, order: { select: { ref: true } } } } } });
  let due = 0;
  let overdue = 0;
  let missed = 0;
  for (const t of open) {
    const next = taskStatusAt({ dueAt: t.dueAt, status: t.status, graceMinutes: t.sheetOrder?.graceMinutes ?? 30, frequency: t.sheetOrder?.frequency ?? null }, uow.now);
    if (next !== t.status) {
      const moved = await uow.tx.treatmentTask.updateMany({ where: { id: t.id, status: t.status }, data: { status: next, version: { increment: 1 } } });
      if (!moved.count) continue;
      if (next === "due") due++;
      if (next === "overdue") overdue++;
      if (next === "missed") {
        missed++;
        uow.audit({ eventType: "treatment.missed", entityType: "TreatmentTask", entityId: t.id, before: { status: t.status }, after: { status: "missed", dueAt: t.dueAt.toISOString(), orderRef: t.sheetOrder?.order?.ref ?? null, patientId: t.patientId }, metadata: { system: "treatment-sheets" } });
      }
    }
  }
  return { sheets: sheets.length, created, due, overdue, missed };
}
async function completeTreatmentTask(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "treatment.complete", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "treatment.complete", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const task = await lockRow(uow.tx, "TreatmentTask", args.taskId);
      if (task.version !== args.expectedVersion) throw new DomainError(Codes.STALE_STATE, "This task changed since you loaded it.", { currentVersion: task.version });
      if (task.status === "missed") throw new DomainError(Codes.INVALID_TRANSITION, "This dose was missed; it is not given late. A veterinarian can reschedule it.", { reason: "missed" });
      if (!["scheduled", "due", "overdue"].includes(task.status)) throw new DomainError(Codes.INVALID_TRANSITION, `This task is already ${task.status}.`);
      await lockRow(uow.tx, "TreatmentSheetOrder", task.sheetOrderId);
      const sheet = await uow.tx.treatmentSheetOrder.findUniqueOrThrow({ where: { id: task.sheetOrderId }, select: { frequency: true, order: { select: { id: true, kind: true, drugId: true, locationId: true } } } });
      const earlyReason = args.earlyReason?.trim() ?? "";
      if (earlyReason && staff.kind !== "dvm") throw new DomainError(Codes.NOT_AUTHORIZED, "Only a veterinarian can give a scheduled dose early.", { field: "earlyReason" });
      if (earlyReason && earlyReason.length < 8) throw new DomainError(Codes.INVALID_INPUT, "Say why the dose is given early.", { field: "earlyReason" });
      const lastDone = await uow.tx.treatmentTask.findFirst({ where: { sheetOrderId: task.sheetOrderId, status: "done", id: { not: task.id } }, orderBy: { doneAt: "desc" }, select: { doneAt: true } });
      const loc = sheet.order?.locationId ? await uow.tx.location.findUnique({ where: { id: sheet.order.locationId }, select: { timeZone: true } }) : null;
      const problem = taskWindowProblem({ frequency: sheet.frequency, dueAt: task.dueAt, now: uow.now, lastDoneAt: lastDone?.doneAt ?? null, earlyOverride: Boolean(earlyReason), timeZone: loc?.timeZone });
      if (problem) throw new DomainError(Codes.GUARD_FAILED, problem.message, { reason: problem.code });
      let administrationId = null;
      if (sheet.order?.kind === "medication" || sheet.order?.drugId) {
        administrationId = (await administer(uow, actor, staff, { orderId: sheet.order.id, qty: args.qty, lotId: args.lotId, csContainerId: args.csContainerId, witnessId: args.witnessId, wasteQty: args.wasteQty, treatmentTaskId: task.id, qtyOverrideReason: args.qtyOverrideReason })).id;
      }
      const note = args.observation ? text16(args.observation, "observation", 2e3) : "";
      const observation = note || earlyReason ? { ...note ? { note } : {}, ...earlyReason ? { earlyReason, earlyBy: staff.id } : {} } : void 0;
      await uow.tx.treatmentTask.update({ where: { id: task.id }, data: { status: "done", doneById: staff.id, doneAt: uow.now, administrationId, observation, version: { increment: 1 } } });
      auditCreate(uow, actor, "TreatmentTask", task.id, "treatment.done", { administrationId, early: Boolean(earlyReason) }, { reason: earlyReason || null });
      return { id: task.id, status: "done", administrationId };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function skipTreatmentTask(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "treatment.skip", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "treatment.skip", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const row = await transition(uow, { model: "TreatmentTask", id: args.taskId, from: ["scheduled", "due", "overdue"], to: "skipped", expectedVersion: args.expectedVersion, actor, eventType: "treatment.skipped", reason, data: { skipReason: reason, doneById: staff.id, doneAt: uow.now } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function rescheduleTreatmentTask(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "treatment.reschedule", humanOnly: true }, args, async (actor) => {
    const dueAt = new Date(args.dueAt);
    if (Number.isNaN(dueAt.getTime())) throw new DomainError(Codes.INVALID_INPUT, "Choose the new time.", { field: "dueAt" });
    const result = await command(context.prisma, { name: "treatment.reschedule", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const task = await lockRow(uow.tx, "TreatmentTask", args.taskId);
      const clash = await uow.tx.treatmentTask.findFirst({ where: { sheetOrderId: task.sheetOrderId, dueAt }, select: { id: true } });
      if (clash) throw new DomainError(Codes.GUARD_FAILED, "There is already a task for that time on this order.");
      const next = await uow.tx.treatmentTask.create({ data: { sheetOrderId: task.sheetOrderId, stayId: task.stayId, patientId: task.patientId, dueAt, status: "scheduled" } });
      const row = await transition(uow, { model: "TreatmentTask", id: task.id, from: ["scheduled", "due", "overdue", "missed"], to: "rescheduled", expectedVersion: args.expectedVersion, actor, eventType: "treatment.rescheduled", data: { rescheduledToId: next.id } });
      return { id: row.id, status: row.status, newTaskId: next.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function openAnaesthesia(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "anaesthesia.open", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "anaesthesia.open", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      await activePatient(uow, enc.patientId);
      if (!["I", "II", "III", "IV", "V", "IE", "IIE", "IIIE", "IVE", "VE"].includes(args.asaStatus)) throw new DomainError(Codes.INVALID_INPUT, "Choose the ASA status.", { field: "asaStatus" });
      const emergency = args.asaStatus.endsWith("E");
      if (!args.consentConfirmed) throw new DomainError(Codes.CONSENT_REQUIRED, "Confirm the client signed the anaesthesia consent.");
      if (!args.fastingConfirmed && !emergency) throw new DomainError(Codes.GUARD_FAILED, "Confirm fasting (or mark the ASA status as an emergency).");
      const settings = await practiceSettings(uow);
      const weight = await latestWeight(uow, enc.patientId);
      const maxAge = settings.weightMaxAgeHours.anaesthesia ?? 24;
      if (!weight || weight.ageHours > maxAge) throw new DomainError(Codes.GUARD_FAILED, `Weigh the patient: anaesthesia needs a weight from the last ${maxAge} hours.`, { reason: "weight_stale" });
      const anaesthetist = args.anaesthetistId ? await staffById(uow, args.anaesthetistId) : staff;
      const licence = await requireLicence(uow.tx, { staffMemberId: anaesthetist.id, locationId: enc.locationId, action: "induce_anaesthesia", at: uow.now });
      const ref = await nextReference(uow.tx, "ANE", uow.now);
      const row = await uow.tx.anaesthesiaRecord.create({
        data: {
          ref,
          encounterId: enc.id,
          patientId: enc.patientId,
          procedure: text16(args.procedure, "procedure", 200),
          asaStatus: args.asaStatus,
          fastingConfirmed: args.fastingConfirmed,
          consentConfirmed: true,
          preWeightId: weight.id,
          ivCatheter: toJsonValue(args.ivCatheter ?? null),
          protocol: toJsonValue(args.protocol ?? null),
          checklist: toJsonValue({ asa: args.asaStatus, fasting: args.fastingConfirmed, consent: true, weightAgeHours: weight.ageHours }),
          anaesthetistId: anaesthetist.id,
          dvmId: enc.attendingDvmId,
          licenseEvaluationId: licence.evaluationId,
          status: "open"
        }
      });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "AnaesthesiaRecord", row.id, "anaesthesia.opened", { ref, asa: args.asaStatus, encounterId: enc.id });
      return { id: row.id, ref };
    });
    return { replay: result.replay, ...result.value };
  });
}
var ANAESTHESIA_STEPS = {
  induce: { from: ["open"], to: "monitoring", field: "inductionAt" },
  intubate: { from: ["monitoring"], to: "monitoring", field: "intubatedAt", needs: "inductionAt" },
  extubate: { from: ["monitoring"], to: "recovery", field: "extubatedAt", needs: "intubatedAt" }
};
var STEP_LABEL = { inductionAt: "Induction", intubatedAt: "Intubation", extubatedAt: "Extubation" };
async function anaesthesiaEvent(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "anaesthesia.event", humanOnly: true }, args, async (actor) => {
    const step = ANAESTHESIA_STEPS[args.event];
    if (!step) throw new DomainError(Codes.INVALID_INPUT, "Unknown anaesthesia event.", { field: "event" });
    const result = await command(context.prisma, { name: "anaesthesia.event", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const rec = await lockRow(uow.tx, "AnaesthesiaRecord", args.recordId);
      if (rec[step.field]) throw new DomainError(Codes.INVALID_TRANSITION, `${STEP_LABEL[step.field]} was already recorded on ${rec.ref}; times are never overwritten.`, { reason: "already_recorded" });
      if (step.needs && !rec[step.needs]) throw new DomainError(Codes.INVALID_TRANSITION, `Record ${STEP_LABEL[step.needs].toLowerCase()} before ${STEP_LABEL[step.field].toLowerCase()}.`, { reason: "out_of_order" });
      const row = await transition(uow, { model: "AnaesthesiaRecord", id: args.recordId, from: step.from, to: step.to, expectedVersion: args.expectedVersion, actor, eventType: `anaesthesia.${args.event}`, data: { [step.field]: uow.now } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function recordMonitoring(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "anaesthesia.monitor", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "anaesthesia.monitor", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const rec = await uow.tx.anaesthesiaRecord.findUnique({ where: { id: args.recordId }, select: { id: true, status: true } });
      if (!rec) throw new DomainError(Codes.NOT_FOUND, "Anaesthesia record not found.");
      if (!["monitoring", "recovery"].includes(rec.status)) throw new DomainError(Codes.GUARD_FAILED, `Monitoring is recorded after induction; the record is ${rec.status}.`);
      const int = (v, f, max) => v === null || v === void 0 || v === "" ? null : Number.isInteger(Number(v)) && Number(v) >= 0 && Number(v) <= max ? Number(v) : (() => {
        throw new DomainError(Codes.INVALID_INPUT, `${f} is out of range.`, { field: f });
      })();
      const d = (v, f) => v === null || v === void 0 || v === "" ? null : decimalText(v, f);
      const tempC = (v) => {
        const t = d(v, "tempC");
        if (t !== null && (dec(t).lt(25) || dec(t).gt(45))) throw new DomainError(Codes.INVALID_INPUT, `Temperature ${t} \xB0C is out of range (25\u201345 \xB0C). Was it entered in \xB0F?`, { field: "tempC" });
        return t;
      };
      const row = await uow.tx.monitoringReading.create({
        data: { recordId: rec.id, at: uow.now, hr: int(args.hr, "hr", 500), rr: int(args.rr, "rr", 300), spo2: int(args.spo2, "spo2", 100), etco2: int(args.etco2, "etco2", 150), sbp: int(args.sbp, "sbp", 400), dbp: int(args.dbp, "dbp", 300), map: int(args.map, "map", 300), tempC: tempC(args.tempC), agentPct: d(args.agentPct, "agentPct"), o2FlowLpm: d(args.o2FlowLpm, "o2FlowLpm"), fluidsRateMlHr: d(args.fluidsRateMlHr, "fluidsRateMlHr"), notes: text16(args.notes ?? "", "notes", 500, false), byId: staff.id }
      });
      auditCreate(uow, actor, "MonitoringReading", row.id, "anaesthesia.reading", { recordId: rec.id });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function closeAnaesthesia(_root, args, context) {
  return gated(context, { permissions: ["canSignRecord"], tool: "anaesthesia.close", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "anaesthesia.close", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (staff.kind !== "dvm") throw new DomainError(Codes.LICENSE_INACTIVE, "A veterinarian closes the anaesthesia record.");
      const rec = await uow.tx.anaesthesiaRecord.findUnique({ where: { id: args.recordId }, select: { encounter: { select: { locationId: true } } } });
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: rec.encounter.locationId, action: "sign_record", at: uow.now });
      const row = await transition(uow, { model: "AnaesthesiaRecord", id: args.recordId, from: ["recovery"], to: "closed", expectedVersion: args.expectedVersion, actor, eventType: "anaesthesia.closed", data: { recoveryEndAt: uow.now, closedById: staff.id, complications: text16(args.complications ?? "", "complications", 2e3, false) } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function saveSurgeryReport(_root, args, context) {
  return gated(context, { permissions: ["canPerformSurgery"], tool: "surgery.report", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "surgery.report", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: enc.locationId, action: "perform_surgery", at: uow.now });
      const data = { procedure: text16(args.procedure, "procedure", 200), surgeonId: staff.id, assistantId: args.assistantId ?? null, technique: text16(args.technique ?? "", "technique", 5e3, false), findings: text16(args.findings ?? "", "findings", 5e3, false), closure: text16(args.closure ?? "", "closure", 2e3, false), sutures: text16(args.sutures ?? "", "sutures", 500, false), specimens: text16(args.specimens ?? "", "specimens", 500, false) };
      const existing = await uow.tx.surgeryReport.findFirst({ where: { encounterId: enc.id }, select: { id: true, status: true } });
      if (existing?.status === "signed") throw new DomainError(Codes.GUARD_FAILED, "The surgery report is signed; add an addendum.");
      const row = existing ? await uow.tx.surgeryReport.update({ where: { id: existing.id }, data: { ...data, version: { increment: 1 } } }) : await uow.tx.surgeryReport.create({ data: { encounterId: enc.id, status: "draft", ...data } });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "SurgeryReport", row.id, "surgery.report_saved", { encounterId: enc.id });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
var DENTAL_MAX_ITEMS = 50;
var DENTAL_MAX_LENGTH = 500;
async function saveDentalChart(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "dental.chart", humanOnly: true }, args, async (actor) => {
    const triadan = /^[1-8](0[1-9]|1[0-1])$/;
    if (!args.teeth || typeof args.teeth !== "object" || Array.isArray(args.teeth)) throw new DomainError(Codes.INVALID_INPUT, "Teeth must be an object keyed by Triadan tooth number.", { field: "teeth" });
    for (const [tooth, entry] of Object.entries(args.teeth)) {
      if (!triadan.test(tooth)) throw new DomainError(Codes.INVALID_INPUT, `${tooth} is not a Triadan tooth number.`, { field: "teeth" });
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new DomainError(Codes.INVALID_INPUT, `Tooth ${tooth} must have findings and procedures.`, { field: "teeth" });
      for (const key2 of ["findings", "procedures"]) {
        const list19 = entry[key2];
        if (list19 === void 0) continue;
        if (!Array.isArray(list19) || list19.length > DENTAL_MAX_ITEMS) throw new DomainError(Codes.INVALID_INPUT, `Tooth ${tooth}: ${key2} must be a list of at most ${DENTAL_MAX_ITEMS} entries.`, { field: "teeth" });
        if (list19.some((item) => typeof item !== "string" || item.length > DENTAL_MAX_LENGTH)) throw new DomainError(Codes.INVALID_INPUT, `Tooth ${tooth}: each of ${key2} must be text of at most ${DENTAL_MAX_LENGTH} characters.`, { field: "teeth" });
      }
    }
    const result = await command(context.prisma, { name: "dental.chart", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const enc = await chartableEncounter(uow, args.encounterId);
      const existing = await uow.tx.dentalChart.findFirst({ where: { encounterId: enc.id }, select: { id: true } });
      const teeth = toJsonValue(args.teeth);
      const row = existing ? await uow.tx.dentalChart.update({ where: { id: existing.id }, data: { teeth, version: { increment: 1 } } }) : await uow.tx.dentalChart.create({ data: { encounterId: enc.id, patientId: enc.patientId, teeth } });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "DentalChart", row.id, "dental.chart_saved", { encounterId: enc.id, teeth: Object.keys(args.teeth).length });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/mutations/vaccines.ts
async function activeRulesFor(uow, productId, speciesId) {
  return uow.tx.reminderRule.findMany({
    where: { triggerVaccines: { some: { id: productId } }, protocolVersion: { status: "published", protocol: speciesId ? { OR: [{ speciesId }, { speciesId: null }] } : {} } },
    select: { id: true, code: true, schedule: true, leadDays: true, graceDays: true, lapseDays: true, satisfiesId: true, protocolVersionId: true }
  }).then((rows) => rows.map((r) => ({ ...r, leadDays: r.leadDays ?? 30, graceDays: r.graceDays ?? 30, lapseDays: r.lapseDays ?? 180 })));
}
async function satisfyAndSchedule(uow, input) {
  const nextDue = /* @__PURE__ */ new Date(`${input.nextDueOn}T00:00:00Z`);
  const newer = await uow.tx.patientReminder.findFirst({ where: { patientId: input.patientId, typeId: input.typeId, status: { not: "suppressed" }, dueOn: { gt: nextDue } }, orderBy: { dueOn: "desc" }, select: { id: true, dueOn: true } });
  if (newer) return { satisfied: 0, nextReminderId: newer.id, nextDueOn: day2(newer.dueOn), superseded: true };
  const open = await uow.tx.patientReminder.findMany({ where: { patientId: input.patientId, typeId: input.typeId, status: { in: ["scheduled", "due", "overdue", "lapsed"] }, dueOn: { lte: nextDue } }, select: { id: true, status: true } });
  for (const r of open) {
    await uow.tx.reminderSatisfaction.create({ data: { reminderId: r.id, sourceKey: input.sourceKey, vaccineAdministrationId: input.vaccineAdministrationId ?? null, note: input.note ?? "", recordedById: input.staffId, at: uow.now } });
    await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status: "satisfied", version: { increment: 1 } } });
  }
  const rule2 = input.rule;
  const status = rule2 ? reminderStatusOn({ dueOn: input.nextDueOn, status: "scheduled" }, rule2, input.on) : "scheduled";
  const next = await uow.tx.patientReminder.upsert({
    where: { patientId_typeId_dueOn: { patientId: input.patientId, typeId: input.typeId, dueOn: /* @__PURE__ */ new Date(`${input.nextDueOn}T00:00:00Z`) } },
    create: { patientId: input.patientId, locationId: input.locationId, typeId: input.typeId, ruleId: rule2?.id ?? null, protocolVersionId: rule2?.protocolVersionId ?? null, dueOn: /* @__PURE__ */ new Date(`${input.nextDueOn}T00:00:00Z`), status, source: input.vaccineAdministrationId ? "vaccine" : "manual", sourceKey: input.sourceKey },
    update: {}
  });
  return { satisfied: open.length, nextReminderId: next.id, nextDueOn: input.nextDueOn, superseded: false };
}
var liveDose = { source: { not: "reversal" }, from_VaccineAdministration_reverses: { none: {} } };
var RABIES_BOOSTER_MIN_DAYS = 270;
var VACCINE_REPEAT_MIN_DAYS = 14;
async function administerVaccine(_root, args, context) {
  return gated(context, { permissions: ["canAdminister"], tool: "vaccine.administer", humanOnly: true }, args, async (actor) => {
    const site = text16(args.site, "site", 100);
    const result = await command(context.prisma, { name: "vaccine.administer", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const enc = await chartableEncounter(uow, args.encounterId);
      const patient = await activePatient(uow, enc.patientId);
      const { on } = await locationDay2(uow, enc.locationId, uow.now);
      const product = await uow.tx.vaccineProduct.findUnique({ where: { id: args.productId }, select: { id: true, name: true, manufacturer: true, isRabies: true, minAgeWeeks: true, licensedDoiMonths: true, active: true, defaultRoute: true, usdaProductCode: true, reminderTypeId: true, species: { select: { code: true } } } });
      if (!product) throw new DomainError(Codes.NOT_FOUND, "Vaccine not found.");
      const lot = await uow.tx.inventoryLot.findUnique({ where: { id: args.lotId }, select: { id: true, lotNumber: true, expiresOn: true, status: true, vaccineId: true, locationId: true } });
      if (lot && lot.vaccineId !== product.id) throw new DomainError(Codes.GUARD_FAILED, "That lot is a different vaccine.");
      if (lot && lot.locationId && lot.locationId !== enc.locationId) throw new DomainError(Codes.GUARD_FAILED, "That lot is stocked at another location.");
      const rabiesPack = product.isRabies ? await resolvePolicy(uow.tx, "rabies", { locationId: enc.locationId, on }).catch((error) => {
        if (error instanceof DomainError && error.code === Codes.POLICY_UNRESOLVED) return null;
        throw error;
      }) : null;
      let supervising = null;
      if (args.supervisingDvmId) {
        supervising = await staffById(uow, args.supervisingDvmId);
        if (supervising.kind !== "dvm") throw new DomainError(Codes.GUARD_FAILED, "The supervising person must be a veterinarian.");
      }
      const problems = vaccineProblems({
        product: { name: product.name, isRabies: product.isRabies, minAgeWeeks: product.minAgeWeeks, speciesCodes: product.species.map((s) => s.code), active: product.active },
        lot: lot ? { lotNumber: lot.lotNumber, expiresOn: day2(lot.expiresOn), status: lot.status } : null,
        patient: { speciesCode: patient.species?.code ?? null, dateOfBirth: day2(patient.dateOfBirth), status: patient.status },
        on,
        rabiesPolicy: rabiesPack ? { firstDoseMinAgeWeeks: rabiesPack.rules.firstDoseMinAgeWeeks } : null,
        giverKind: staff.kind,
        supervisingDvmPresent: Boolean(supervising)
      });
      if (problems.length) throw new DomainError(Codes.GUARD_FAILED, problems.join(" "), { problems });
      const licence = product.isRabies ? await requireLicence(uow.tx, { staffMemberId: (staff.kind === "dvm" ? staff : supervising).id, locationId: enc.locationId, action: "examine", at: uow.now }) : null;
      const recent = await uow.tx.vaccineAdministration.findFirst({ where: { patientId: patient.id, productId: product.id, ...liveDose, administeredOn: { gt: /* @__PURE__ */ new Date(`${addDays(on, -VACCINE_REPEAT_MIN_DAYS)}T00:00:00Z`) } }, orderBy: { administeredOn: "desc" }, select: { administeredOn: true } });
      if (recent && day2(recent.administeredOn) === on) throw new DomainError(Codes.GUARD_FAILED, `${patient.name ?? "This patient"} already had ${product.name} today. Reverse that dose first if it was recorded by mistake.`, { reason: "repeat_same_day" });
      const repeatReason = args.repeatReason?.trim() ?? "";
      if (recent) {
        if (staff.kind !== "dvm" && !(supervising && repeatReason)) throw new DomainError(Codes.GUARD_FAILED, `${product.name} was given on ${day2(recent.administeredOn)}; a repeat within ${VACCINE_REPEAT_MIN_DAYS} days needs a veterinarian and a reason.`, { reason: "repeat_too_soon" });
        if (repeatReason.length < 8) throw new DomainError(Codes.INVALID_INPUT, `${product.name} was given on ${day2(recent.administeredOn)}; give the reason for repeating it (at least 8 characters).`, { field: "repeatReason", reason: "repeat_too_soon" });
      }
      const priorDoses = await uow.tx.vaccineAdministration.count({ where: { patientId: patient.id, productId: product.id, ...liveDose } });
      const priorRabies = product.isRabies ? await uow.tx.vaccineAdministration.count({ where: { patientId: patient.id, product: { isRabies: true }, ...liveDose, administeredOn: { lte: /* @__PURE__ */ new Date(`${addDays(on, -RABIES_BOOSTER_MIN_DAYS)}T00:00:00Z`) } } }) : 0;
      const rules2 = await activeRulesFor(uow, product.id, patient.speciesId ?? null);
      const rule2 = rules2[0] ?? null;
      const series = inInitialSeries(rule2?.schedule, day2(patient.dateOfBirth), on);
      const seriesDose = series && priorDoses + 1 < series.doses ? series : null;
      const duration = vaccineDuration({ labelMonths: product.licensedDoiMonths, isRabies: product.isRabies, priorRabiesDoses: priorRabies, rabiesPolicy: rabiesPack ? rabiesPack.rules : null, seriesIntervalWeeks: seriesDose?.intervalWeeks ?? null });
      const dueNextOn = dueDate(on, duration);
      let certificate = null;
      if (product.isRabies && rabiesPack) certificate = await issueRabiesCertificate(uow, { patientId: patient.id, locationId: enc.locationId, vet: staff.kind === "dvm" ? staff : supervising, licenseNumber: licence ? (await uow.tx.professionalLicense.findUnique({ where: { id: licence.licenseId }, select: { licenseNumber: true } }))?.licenseNumber ?? null : null, product, lotNumber: lot.lotNumber, on, duration: duration.months, nextDueOn: dueNextOn, tagNumber: args.tagNumber ?? "", pack: rabiesPack });
      const va = await uow.tx.vaccineAdministration.create({
        data: {
          patientId: patient.id,
          encounterId: enc.id,
          productId: product.id,
          lotId: lot.id,
          lotNumber: lot.lotNumber,
          lotExpiresOn: lot.expiresOn,
          doseSeries: priorDoses + 1,
          isInitialSeries: Boolean(series),
          route: args.route ?? product.defaultRoute,
          site,
          administeredOn: /* @__PURE__ */ new Date(`${on}T00:00:00Z`),
          durationMonths: duration.months,
          dueNextOn: /* @__PURE__ */ new Date(`${dueNextOn}T00:00:00Z`),
          vaccinatedById: staff.id,
          supervisingDvmId: supervising?.id ?? null,
          certificateId: certificate?.id ?? null,
          policyVersions: toJsonValue(rabiesPack?.versions.map((v) => v.id) ?? []),
          source: "administered"
        }
      });
      let reminder = null;
      const typeId = rule2?.satisfiesId ?? product.reminderTypeId;
      if (typeId) reminder = await satisfyAndSchedule(uow, { patientId: patient.id, locationId: enc.locationId, typeId, sourceKey: `VA:${va.id}`, nextDueOn: dueNextOn, rule: rule2, vaccineAdministrationId: va.id, staffId: staff.id, on });
      await markInProgress(uow, enc);
      auditCreate(uow, actor, "VaccineAdministration", va.id, "vaccine.administered", { product: product.name, lotNumber: lot.lotNumber, dueNextOn, durationReason: duration.reason, certificate: certificate?.ref ?? null, reminder, repeatReason: recent ? repeatReason : null });
      return { id: va.id, dueNextOn, durationMonths: duration.months, durationReason: duration.reason, certificate, reminder, verified: rabiesPack?.verified ?? true };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function issueRabiesCertificate(uow, input) {
  const patient = await uow.tx.patient.findUniqueOrThrow({
    where: { id: input.patientId },
    select: {
      name: true,
      sex: true,
      reproductiveStatus: true,
      dateOfBirth: true,
      colourMarkings: true,
      species: { select: { name: true } },
      breed: { select: { name: true } },
      microchips: { select: { number: true }, take: 1 },
      ownerships: { where: { role: "primary", effectiveTo: null }, select: { client: { select: { displayName: true, addressLine1: true, city: true, stateCode: true, postalCode: true } } }, take: 1 }
    }
  });
  const owner = patient.ownerships[0]?.client;
  const location = await uow.tx.location.findUniqueOrThrow({ where: { id: input.locationId }, select: { name: true, addressLine1: true, city: true, stateCode: true, phone: true } });
  const snapshot = {
    owner_name_address: owner ? `${owner.displayName}, ${[owner.addressLine1, owner.city, owner.stateCode, owner.postalCode].filter(Boolean).join(", ")}` : null,
    animal_name_species_breed_sex_age_colour: [patient.name, patient.species?.name, patient.breed?.name ?? "mixed", `${patient.sex} ${patient.reproductiveStatus ?? ""}`.trim(), patient.dateOfBirth ? `born ${day2(patient.dateOfBirth)}` : null, patient.colourMarkings || null].every(Boolean) ? [patient.name, patient.species?.name, patient.breed?.name ?? "mixed", `${patient.sex} ${patient.reproductiveStatus ?? ""}`.trim(), `born ${calendarDayText(day2(patient.dateOfBirth))}`, patient.colourMarkings].join(", ") : null,
    microchip: patient.microchips[0]?.number ?? "none recorded",
    vaccine_manufacturer_product_lot: `${input.product.manufacturer}, ${input.product.name}${input.product.usdaProductCode ? ` (USDA ${input.product.usdaProductCode})` : ""}, lot ${input.lotNumber}`,
    date_given: input.on,
    duration: `${input.duration} months`,
    next_due: input.nextDueOn,
    tag_number: input.tagNumber || null,
    veterinarian_name_licence_signature: input.licenseNumber ? `${input.vet.displayName}, licence ${input.licenseNumber}, signed electronically` : null
  };
  const { fields, missing } = rabiesCertificateFields(input.pack.rules.certificateFields, snapshot);
  const ref = await nextReference(uow.tx, "RAB", uow.now);
  const cert = await uow.tx.rabiesCertificate.create({
    data: {
      ref,
      patientId: input.patientId,
      ownerSnapshot: toJsonValue(owner ?? null),
      patientSnapshot: toJsonValue({ ...patient, ownerships: void 0 }),
      vaccineSnapshot: toJsonValue({ ...input.product, lotNumber: input.lotNumber }),
      vetSnapshot: toJsonValue({ id: input.vet.id, name: input.vet.displayName, licenseNumber: input.licenseNumber, location }),
      vaccinatedOn: /* @__PURE__ */ new Date(`${input.on}T00:00:00Z`),
      durationMonths: input.duration,
      nextDueOn: /* @__PURE__ */ new Date(`${input.nextDueOn}T00:00:00Z`),
      tagNumber: input.tagNumber,
      tagJurisdiction: input.tagNumber ? location.stateCode : "",
      fields: toJsonValue(fields),
      missingFields: toJsonValue(missing),
      reportedTo: "none",
      policyVersions: toJsonValue(input.pack.versions.map((v) => v.id))
    }
  });
  await renderRabiesDocument(uow, cert.id, input.locationId);
  return { id: cert.id, ref, missing };
}
async function recordOutsideVaccine(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "vaccine.outside", humanOnly: true }, args, async (actor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.administeredOn)) throw new DomainError(Codes.INVALID_INPUT, "administeredOn is YYYY-MM-DD.", { field: "administeredOn" });
    const note = text16(args.evidenceNote, "evidenceNote", 500);
    const result = await command(context.prisma, { name: "vaccine.outside", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const patient = await activePatient(uow, args.patientId);
      const product = await uow.tx.vaccineProduct.findUnique({ where: { id: args.productId }, select: { id: true, name: true, licensedDoiMonths: true, isRabies: true, reminderTypeId: true } });
      if (!product) throw new DomainError(Codes.NOT_FOUND, "Vaccine not found.");
      const locationId = staff.homeLocationId ?? (await uow.tx.location.findFirst({ where: { active: true }, select: { id: true }, orderBy: { createdAt: "asc" } }))?.id;
      if (!locationId) throw new DomainError(Codes.GUARD_FAILED, "No location to file the reminder under.");
      const { on } = await locationDay2(uow, locationId, uow.now);
      if (args.administeredOn > on) throw new DomainError(Codes.INVALID_INPUT, "The date given cannot be in the future.", { field: "administeredOn" });
      const rules2 = await activeRulesFor(uow, product.id, patient.speciesId ?? null);
      const rule2 = rules2[0] ?? null;
      const nextDueOn = dueDate(args.administeredOn, { months: product.licensedDoiMonths, weeks: 0 });
      const latest = await uow.tx.vaccineAdministration.findFirst({ where: { patientId: patient.id, ...product.reminderTypeId ? { product: { reminderTypeId: product.reminderTypeId } } : { productId: product.id }, ...liveDose, administeredOn: { gte: /* @__PURE__ */ new Date(`${args.administeredOn}T00:00:00Z`) } }, orderBy: { administeredOn: "desc" }, select: { administeredOn: true } });
      const typeId = rule2?.satisfiesId ?? product.reminderTypeId;
      if (!typeId) throw new DomainError(Codes.GUARD_FAILED, `${product.name} has no reminder type to satisfy.`);
      const evidence = `Given elsewhere on ${args.administeredOn}${args.lotNumber ? `, lot ${args.lotNumber}` : ""}. ${note}`;
      const r = latest ? { satisfied: 0, nextReminderId: null, nextDueOn: null, superseded: true, newerDoseOn: day2(latest.administeredOn) } : await satisfyAndSchedule(uow, { patientId: patient.id, locationId, typeId, sourceKey: `OUT:${patient.id}:${product.id}:${args.administeredOn}`, nextDueOn, rule: rule2, staffId: staff.id, note: evidence, on });
      uow.audit({ eventType: "vaccine.outside_recorded", entityType: "Patient", entityId: patient.id, actorUserId: actorUserId(actor), after: { product: product.name, administeredOn: args.administeredOn, nextDueOn, evidence, superseded: r.superseded } });
      return r;
    });
    return { replay: result.replay, ...result.value };
  });
}
async function reverseVaccineAdministration(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord", "canOrder"], tool: "vaccine.reverse", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    if (reason.length < 8) throw new DomainError(Codes.INVALID_INPUT, "Give the reason for the reversal (at least 8 characters).", { field: "reason" });
    const result = await command(context.prisma, { name: "vaccine.reverse", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (staff.kind !== "dvm") throw new DomainError(Codes.NOT_AUTHORIZED, "Only a veterinarian can reverse a vaccine.");
      await advisoryLock(uow.tx, `vaccine-reverse:${args.vaccineAdministrationId}`);
      const va = await uow.tx.vaccineAdministration.findUnique({ where: { id: args.vaccineAdministrationId }, include: { product: { select: { name: true } }, certificate: { select: { id: true, ref: true } } } });
      if (!va) throw new DomainError(Codes.NOT_FOUND, "Vaccine administration not found.");
      if (va.source === "reversal") throw new DomainError(Codes.GUARD_FAILED, "That row is itself a reversal.");
      if (await uow.tx.vaccineAdministration.count({ where: { reversesId: va.id } })) throw new DomainError(Codes.GUARD_FAILED, `This ${va.product?.name ?? "vaccine"} dose was already reversed.`, { reason: "already_reversed" });
      const { id: _id, createdAt: _c, product: _p, certificate: _cert, certificateId: _ci, administrationId: _a, reason: _r, reversesId: _rv, ...copy } = va;
      const row = await uow.tx.vaccineAdministration.create({ data: { ...copy, policyVersions: va.policyVersions ?? [], source: "reversal", reversesId: va.id, reason, vaccinatedById: staff.id } });
      if (va.certificate) await uow.tx.rabiesCertificate.update({ where: { id: va.certificate.id }, data: { voidedAt: uow.now, voidReason: reason } });
      const scheduled = await uow.tx.patientReminder.updateMany({ where: { sourceKey: `VA:${va.id}`, status: { not: "suppressed" } }, data: { status: "suppressed", suppressedReason: `Vaccine reversed: ${reason}`.slice(0, 300), version: { increment: 1 } } });
      const satisfied = await uow.tx.reminderSatisfaction.findMany({ where: { OR: [{ vaccineAdministrationId: va.id }, { sourceKey: `VA:${va.id}` }] }, select: { reminderId: true } });
      let reopened = 0;
      for (const s of satisfied) {
        const r = await uow.tx.patientReminder.findUnique({ where: { id: s.reminderId }, select: { id: true, status: true, dueOn: true, sourceKey: true, rule: { select: { leadDays: true, graceDays: true, lapseDays: true } } } });
        if (!r || r.status !== "satisfied" || r.sourceKey === `VA:${va.id}`) continue;
        const { on } = await locationDay2(uow, (await uow.tx.patientReminder.findUnique({ where: { id: r.id }, select: { locationId: true } })).locationId, uow.now);
        const status = reminderStatusOn({ dueOn: day2(r.dueOn), status: "scheduled" }, { leadDays: r.rule?.leadDays ?? 30, graceDays: r.rule?.graceDays ?? 30, lapseDays: r.rule?.lapseDays ?? 180 }, on);
        await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status, version: { increment: 1 } } });
        reopened++;
      }
      auditCreate(uow, actor, "VaccineAdministration", row.id, "vaccine.reversed", { reverses: va.id, product: va.product?.name ?? null, certificate: va.certificate?.ref ?? null, reason, remindersSuppressed: scheduled.count, remindersReopened: reopened });
      return { id: row.id, reverses: va.id, certificateVoided: va.certificate?.ref ?? null, remindersSuppressed: scheduled.count, remindersReopened: reopened };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function suppressReminder(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "reminder.suppress", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "reminder.suppress", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "PatientReminder", id: args.reminderId, from: ["scheduled", "due", "overdue", "lapsed"], to: "suppressed", expectedVersion: args.expectedVersion, actor, eventType: "reminder.suppressed", reason, data: { suppressedReason: reason } });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addManualReminder(_root, args, context) {
  return gated(context, { permissions: ["canWriteRecord"], tool: "reminder.add", humanOnly: true }, args, async (actor) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.dueOn)) throw new DomainError(Codes.INVALID_INPUT, "dueOn is YYYY-MM-DD.", { field: "dueOn" });
    const result = await command(context.prisma, { name: "reminder.add", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const patient = await activePatient(uow, args.patientId);
      const type = await uow.tx.reminderType.findUnique({ where: { id: args.typeId }, select: { id: true, active: true } });
      if (!type?.active) throw new DomainError(Codes.NOT_FOUND, "Reminder type not found.");
      const locationId = staff.homeLocationId ?? (await uow.tx.location.findFirst({ where: { active: true }, select: { id: true }, orderBy: { createdAt: "asc" } })).id;
      const row = await uow.tx.patientReminder.upsert({
        where: { patientId_typeId_dueOn: { patientId: patient.id, typeId: type.id, dueOn: /* @__PURE__ */ new Date(`${args.dueOn}T00:00:00Z`) } },
        create: { patientId: patient.id, locationId, typeId: type.id, dueOn: /* @__PURE__ */ new Date(`${args.dueOn}T00:00:00Z`), status: "scheduled", source: "manual", sourceKey: `MAN:${args.idempotencyKey}` },
        update: {}
      });
      auditCreate(uow, actor, "PatientReminder", row.id, "reminder.added", { typeId: type.id, dueOn: args.dueOn });
      return { id: row.id };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function runReminderJob(uow, locationId) {
  const { on } = await locationDay2(uow, locationId, uow.now);
  const open = await uow.tx.patientReminder.findMany({
    where: { locationId, status: { in: ["scheduled", "due", "overdue"] }, dueOn: { lte: /* @__PURE__ */ new Date(`${addDays(on, 60)}T00:00:00Z`) } },
    select: { id: true, dueOn: true, status: true, lastNotifiedAt: true, patientId: true, rule: { select: { leadDays: true, graceDays: true, lapseDays: true } }, type: { select: { name: true } }, patient: { select: { name: true, status: true, ownerships: { where: { role: "primary", effectiveTo: null }, select: { clientId: true }, take: 1 } } } },
    take: 5e3
  });
  let changed = 0;
  for (const r of open) {
    if (r.patient?.status !== "active") {
      await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status: "suppressed", suppressedReason: `Patient ${r.patient?.status ?? "missing"}`, version: { increment: 1 } } });
      changed++;
      continue;
    }
    const rule2 = { leadDays: r.rule?.leadDays ?? 30, graceDays: r.rule?.graceDays ?? 30, lapseDays: r.rule?.lapseDays ?? 180 };
    const next = reminderStatusOn({ dueOn: day2(r.dueOn), status: r.status }, rule2, on);
    if (next !== r.status) {
      await uow.tx.patientReminder.update({ where: { id: r.id }, data: { status: next, version: { increment: 1 } } });
      changed++;
    }
  }
  return { on, checked: open.length, changed };
}

// features/keystone/mutations/imports.ts
var import_node_crypto8 = require("node:crypto");

// features/integrations/pims/index.ts
function parseCsv(input) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const text17 = input.replace(/^\uFEFF/, "");
  for (let i = 0; i < text17.length; i++) {
    const c = text17[i];
    if (quoted) {
      if (c === '"') {
        if (text17[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === "") quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text17[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      if (row.some((v) => v.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  if (quoted) throw new Error("The file ends inside a quoted field.");
  row.push(field);
  if (row.some((v) => v.trim() !== "")) rows.push(row);
  return rows;
}
var norm = (h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
var FIELD_ALIASES = {
  clients: {
    externalId: { required: true, aliases: { ezyvet: ["contact id", "contact code"], avimark: ["client number", "client id", "client"], any: ["id", "external id", "client id"] } },
    firstName: { required: true, aliases: { ezyvet: ["first name"], avimark: ["first name", "first"], any: ["first name", "firstname", "given name"] } },
    lastName: { required: true, aliases: { ezyvet: ["last name", "surname"], avimark: ["last name", "last"], any: ["last name", "lastname", "surname", "family name"] } },
    mobile: { aliases: { ezyvet: ["mobile", "mobile phone"], avimark: ["cell phone", "cell"], any: ["mobile", "cell", "cell phone", "mobile phone"] } },
    phone: { aliases: { ezyvet: ["phone", "home phone"], avimark: ["phone", "home phone", "phone 1"], any: ["phone", "home phone", "telephone"] } },
    email: { aliases: { ezyvet: ["email", "email address"], avimark: ["email", "e mail"], any: ["email", "email address"] } },
    address: { aliases: { ezyvet: ["street address", "address 1"], avimark: ["address", "address 1"], any: ["address", "address line 1", "street"] } },
    city: { aliases: { ezyvet: ["suburb", "city"], avimark: ["city"], any: ["city", "town"] } },
    postalCode: { aliases: { ezyvet: ["postcode", "zip"], avimark: ["zip", "zip code"], any: ["zip", "postal code", "postcode"] } },
    marketingConsent: { aliases: { any: ["marketing consent", "email marketing opt in", "marketing opt in"] } }
  },
  patients: {
    externalId: { required: true, aliases: { ezyvet: ["animal id", "animal code"], avimark: ["patient number", "patient id", "animal id"], any: ["id", "patient id", "animal id"] } },
    clientExternalId: { required: true, aliases: { ezyvet: ["contact id", "owner id"], avimark: ["client number", "client id"], any: ["client id", "owner id"] } },
    name: { required: true, aliases: { any: ["name", "animal name", "patient name", "pet name"] } },
    species: { required: true, aliases: { any: ["species"] } },
    breed: { aliases: { any: ["breed"] } },
    sex: { aliases: { any: ["sex", "gender"] } },
    dateOfBirth: { aliases: { any: ["date of birth", "dob", "birth date", "birthday"] } },
    microchip: { aliases: { any: ["microchip", "microchip number", "chip", "rfid"] } },
    deceased: { aliases: { any: ["deceased", "is deceased", "dead"] } }
  },
  weights: {
    patientExternalId: { required: true, aliases: { ezyvet: ["animal id"], avimark: ["patient number", "patient id"], any: ["patient id", "animal id"] } },
    date: { required: true, aliases: { any: ["date", "weight date", "recorded"] } },
    weight: { required: true, aliases: { any: ["weight", "value"] } },
    unit: { aliases: { any: ["unit", "units", "weight unit"] } }
  },
  vaccinations: {
    patientExternalId: { required: true, aliases: { ezyvet: ["animal id"], avimark: ["patient number", "patient id"], any: ["patient id", "animal id"] } },
    vaccine: { required: true, aliases: { any: ["vaccine", "vaccination", "product", "item", "description"] } },
    givenOn: { required: true, aliases: { any: ["date given", "given", "date", "administered"] } },
    dueOn: { aliases: { any: ["due", "due date", "next due", "expires"] } },
    lotNumber: { aliases: { any: ["lot", "lot number", "serial", "batch"] } },
    tagNumber: { aliases: { any: ["tag", "tag number", "rabies tag"] } }
  },
  reminders: {
    patientExternalId: { required: true, aliases: { ezyvet: ["animal id"], avimark: ["patient number", "patient id"], any: ["patient id", "animal id"] } },
    reminder: { required: true, aliases: { any: ["reminder", "reminder type", "description", "service"] } },
    dueOn: { required: true, aliases: { any: ["due", "due date", "date due"] } }
  },
  consults: {
    externalId: { required: true, aliases: { ezyvet: ["consult id"], avimark: ["medical history id", "entry id"], any: ["id", "visit id", "consult id"] } },
    patientExternalId: { required: true, aliases: { ezyvet: ["animal id"], avimark: ["patient number", "patient id"], any: ["patient id", "animal id"] } },
    date: { required: true, aliases: { any: ["date", "visit date", "consult date"] } },
    vet: { aliases: { any: ["vet", "veterinarian", "doctor", "clinician"] } },
    reason: { aliases: { any: ["reason", "presenting complaint", "complaint"] } },
    notes: { required: true, aliases: { any: ["notes", "history", "medical notes", "text", "soap"] } }
  }
};
function mapHeaders(system, entity, headers, explicit = {}) {
  const spec = FIELD_ALIASES[entity];
  const byNorm = new Map(headers.map((h) => [norm(h), h]));
  const mapping = {};
  for (const [header, field] of Object.entries(explicit)) if (field in spec && byNorm.has(norm(header))) mapping[field] = byNorm.get(norm(header));
  for (const [field, def] of Object.entries(spec)) {
    if (mapping[field]) continue;
    const candidates = [...def.aliases[system] ?? [], ...def.aliases.any ?? [], field];
    const hit = candidates.map(norm).find((c) => byNorm.has(c));
    if (hit) mapping[field] = byNorm.get(hit);
  }
  const missingRequired = Object.entries(spec).filter(([f, d]) => d.required && !mapping[f]).map(([f]) => f);
  return { mapping, missingRequired };
}
function parseExport(system, entity, csv, explicit = {}) {
  const table = parseCsv(csv);
  if (!table.length) throw new Error("The file is empty.");
  const headers = table[0].map((h) => h.trim());
  const { mapping, missingRequired } = mapHeaders(system, entity, headers, explicit);
  const index = new Map(headers.map((h, i) => [h, i]));
  const rows = table.slice(1).map((cells, i) => {
    const values = {};
    for (const [field, header] of Object.entries(mapping)) values[field] = (cells[index.get(header)] ?? "").trim();
    return { rowNumber: i + 2, values };
  });
  return { headers, mapping, rows, missingRequired };
}
function importDate(value) {
  const v = value.trim();
  if (!v) return null;
  const real = (iso) => {
    const d = /* @__PURE__ */ new Date(`${iso}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
  };
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
  if (m) return real(`${m[1]}-${m[2]}-${m[3]}`);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/.exec(v);
  if (m) {
    const year = m[3].length === 2 ? (Number(m[3]) > 50 ? 1900 : 2e3) + Number(m[3]) : Number(m[3]);
    return real(`${year}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`);
  }
  return null;
}
var SPECIES_ALIASES = {
  canine: "canine",
  dog: "canine",
  k9: "canine",
  "k-9": "canine",
  puppy: "canine",
  feline: "feline",
  cat: "feline",
  kitten: "feline",
  rabbit: "rabbit",
  lagomorph: "rabbit",
  bunny: "rabbit",
  ferret: "ferret",
  mustelid: "ferret",
  "bearded dragon": "bearded_dragon",
  "pogona vitticeps": "bearded_dragon",
  cockatiel: "cockatiel",
  equine: "equine",
  horse: "equine"
};
function importSpeciesCode(value, species) {
  const v = norm(value);
  if (!v) return null;
  const codes = new Set(species.map((s) => s.code));
  const alias = SPECIES_ALIASES[v];
  if (alias && codes.has(alias)) return alias;
  const hit = species.find((s) => s.code.toLowerCase() === v || s.code.toLowerCase().replace(/_/g, " ") === v || norm(s.name) === v);
  return hit?.code ?? null;
}
function importSex(value) {
  const v = norm(value);
  const map = {
    m: ["male", "intact"],
    male: ["male", "intact"],
    mi: ["male", "intact"],
    "male intact": ["male", "intact"],
    mn: ["male", "neutered"],
    "male neutered": ["male", "neutered"],
    "male castrated": ["male", "neutered"],
    cm: ["male", "neutered"],
    n: ["male", "neutered"],
    f: ["female", "intact"],
    female: ["female", "intact"],
    fi: ["female", "intact"],
    "female intact": ["female", "intact"],
    fs: ["female", "spayed"],
    "female spayed": ["female", "spayed"],
    s: ["female", "spayed"]
  };
  const hit = map[v];
  return hit ? { sex: hit[0], reproductiveStatus: hit[1] } : { sex: "unknown", reproductiveStatus: "unknown" };
}
var truthy = (v) => ["y", "yes", "true", "1", "x"].includes(v.trim().toLowerCase());
var manualCsvSource = {
  key: "manual-csv",
  channel: "csv",
  async rows({ system, entity, csv, mapping }) {
    if (!csv?.trim()) throw new Error("Paste or upload the exported CSV.");
    return parseExport(system, entity, csv, mapping);
  }
};
function ezyvetApiSource(config2) {
  const f = config2.fetchImpl ?? fetch;
  const resource = {
    clients: { path: "contact", map: (r) => ({ externalId: String(r.id ?? ""), firstName: String(r.first_name ?? ""), lastName: String(r.last_name ?? ""), email: "", mobile: "", phone: "" }) },
    patients: { path: "animal", map: (r) => ({ externalId: String(r.id ?? ""), clientExternalId: String(r.contact_id ?? ""), name: String(r.name ?? ""), species: String(r.species_id ?? ""), breed: String(r.breed_id ?? ""), sex: String(r.sex_id ?? ""), dateOfBirth: String(r.date_of_birth ?? ""), microchip: String(r.microchip_number ?? ""), deceased: r.is_dead ? "yes" : "" }) },
    weights: { path: "healthstatus", map: (r) => ({ patientExternalId: String(r.animal_id ?? ""), date: String(r.date ?? ""), weight: String(r.weight ?? ""), unit: "kg" }) },
    vaccinations: { path: "vaccination", map: (r) => ({ patientExternalId: String(r.animal_id ?? ""), vaccine: String(r.name ?? ""), givenOn: String(r.date_of_vaccination ?? ""), dueOn: String(r.date_of_next_due ?? ""), lotNumber: String(r.batch_number ?? "") }) },
    reminders: { path: "reminder", map: (r) => ({ patientExternalId: String(r.animal_id ?? ""), reminder: String(r.description ?? ""), dueOn: String(r.due_at ?? "") }) },
    consults: { path: "consult", map: (r) => ({ externalId: String(r.id ?? ""), patientExternalId: String(r.animal_id ?? ""), date: String(r.date ?? ""), vet: "", reason: String(r.presenting_problem ?? ""), notes: String(r.notes ?? "") }) }
  };
  async function token() {
    const res = await f(`${config2.baseUrl}/v1/oauth/access_token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ partner_id: config2.partnerId, client_id: config2.clientId, client_secret: config2.clientSecret, grant_type: "client_credentials", scope: "read-contact,read-animal,read-vaccination,read-reminder,read-consult,read-healthstatus" }) });
    if (!res.ok) throw new Error(`ezyVet sign-in failed (${res.status}).`);
    return (await res.json()).access_token;
  }
  return {
    key: "ezyvet-api",
    channel: "api",
    async rows({ entity, since }) {
      const spec = resource[entity];
      const bearer = await token();
      const rows = [];
      for (let page2 = 1; page2 <= 500; page2++) {
        const url = new URL(`${config2.baseUrl}/v1/${spec.path}`);
        url.searchParams.set("limit", "200");
        url.searchParams.set("page", String(page2));
        if (since) url.searchParams.set("modified_at", JSON.stringify({ ">": Math.floor(Date.parse(since) / 1e3) }));
        const res = await f(url, { headers: { authorization: `Bearer ${bearer}` } });
        if (!res.ok) throw new Error(`ezyVet ${spec.path} page ${page2} failed (${res.status}).`);
        const body = await res.json();
        for (const item of body.items ?? []) rows.push({ rowNumber: rows.length + 1, values: spec.map(Object.values(item)[0] ?? {}) });
        if (!body.items?.length || page2 >= (body.meta?.items_page_total ?? page2)) break;
      }
      return { headers: [], mapping: {}, rows, missingRequired: [] };
    }
  };
}
var override = {};
function pimsSource(key2 = "manual-csv") {
  if (override[key2]) return override[key2];
  if (key2 === "ezyvet-api") {
    const env = process.env;
    if (!env.EZYVET_CLIENT_ID || !env.EZYVET_CLIENT_SECRET || !env.EZYVET_PARTNER_ID || !env.EZYVET_SITE_UID) throw new Error("The ezyVet API is not connected. Add the ezyVet partner credentials, or upload a CSV export.");
    return ezyvetApiSource({ baseUrl: env.EZYVET_API_URL || "https://api.ezyvet.com", partnerId: env.EZYVET_PARTNER_ID, clientId: env.EZYVET_CLIENT_ID, clientSecret: env.EZYVET_CLIENT_SECRET, siteUid: env.EZYVET_SITE_UID });
  }
  return manualCsvSource;
}

// features/keystone/mutations/imports.ts
var ENTITIES = ["clients", "patients", "weights", "vaccinations", "reminders", "consults"];
var SYSTEMS = ["ezyvet", "avimark", "csv"];
var CHUNK = 100;
var MAX_ROWS = 5e4;
function rowKey(entity, row) {
  switch (entity) {
    case "clients":
    case "patients":
    case "consults":
      return row.externalId ?? "";
    case "weights":
      return `${row.patientExternalId}|${row.date}|${row.weight}${row.unit ?? ""}`;
    case "vaccinations":
      return `${row.patientExternalId}|${row.vaccine}|${row.givenOn}`;
    case "reminders":
      return `${row.patientExternalId}|${row.reminder}|${row.dueOn}`;
  }
}
var RECORD_TYPE = { clients: "Client", patients: "Patient", weights: "WeightMeasurement", vaccinations: "PatientReminder", reminders: "PatientReminder", consults: "Encounter" };
var speciesList = (tx) => tx.species.findMany({ select: { code: true, name: true } });
function validateRow(entity, row, species) {
  const errors = [];
  const need = (f, label) => {
    if (!row[f]?.trim()) errors.push(`${label} is empty.`);
  };
  if (entity === "clients") {
    need("externalId", "Client id");
    need("lastName", "Last name");
    if (!row.mobile && !row.phone && !row.email) errors.push("No phone or email.");
    if (row.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(row.email)) errors.push("Email is not valid.");
  }
  if (entity === "patients") {
    need("externalId", "Patient id");
    need("clientExternalId", "Client id");
    need("name", "Name");
    if (!importSpeciesCode(row.species ?? "", species)) errors.push(`Species "${row.species ?? ""}" is not set up here (${species.map((s) => s.name).join(", ") || "no species yet"}).`);
    if (row.dateOfBirth && !importDate(row.dateOfBirth)) errors.push(`Date of birth "${row.dateOfBirth}" is not a date.`);
  }
  if (entity === "weights") {
    if (!importDate(row.date ?? "")) errors.push("Weight date is not a date.");
    if (!/^\d+(\.\d+)?$/.test(row.weight ?? "") || dec(row.weight).lte(0)) errors.push("Weight is not a positive number.");
    if (row.unit && !["kg", "lb", "lbs", "g"].includes(row.unit.toLowerCase())) errors.push(`Unit "${row.unit}" is not kg, lb or g.`);
  }
  if (entity === "vaccinations") {
    need("vaccine", "Vaccine");
    const given = importDate(row.givenOn ?? "");
    if (!given) errors.push("Date given is not a date.");
    else if (given > new Date(Date.now() + 864e5).toISOString().slice(0, 10)) errors.push(`Date given "${row.givenOn}" is in the future.`);
    if (row.dueOn && !importDate(row.dueOn)) errors.push("Due date is not a date.");
  }
  if (entity === "reminders") {
    need("reminder", "Reminder");
    if (!importDate(row.dueOn ?? "")) errors.push("Due date is not a date.");
  }
  if (entity === "consults") {
    need("externalId", "Consult id");
    need("notes", "Notes");
    if (!importDate(row.date ?? "")) errors.push("Visit date is not a date.");
  }
  return errors;
}
async function previewImport(_root, args, context) {
  return gated(context, { permissions: ["canManageOnboarding"], tool: "import.preview", humanOnly: true }, args, async (actor) => {
    if (!SYSTEMS.includes(args.system)) throw new DomainError(Codes.INVALID_INPUT, "Choose the system the file came from.", { field: "system" });
    if (!ENTITIES.includes(args.entity)) throw new DomainError(Codes.INVALID_INPUT, "Choose what the file contains.", { field: "entity" });
    let parsed;
    try {
      parsed = await pimsSource(args.source ?? "manual-csv").rows({ system: args.system, entity: args.entity, csv: args.csv, mapping: args.mapping ?? {} });
    } catch (error) {
      throw new DomainError(Codes.INVALID_INPUT, error.message, { field: "csv" });
    }
    if (parsed.missingRequired.length) throw new DomainError(Codes.INVALID_INPUT, `The file has no column for: ${parsed.missingRequired.join(", ")}. Map those columns and try again.`, { field: "mapping", problems: parsed.missingRequired });
    if (parsed.rows.length > MAX_ROWS) throw new DomainError(Codes.INVALID_INPUT, `Split the file: at most ${MAX_ROWS} rows per batch.`);
    const species = await speciesList(context.prisma);
    const fileHash = (0, import_node_crypto8.createHash)("sha256").update(args.csv ?? JSON.stringify(parsed.rows)).digest("hex");
    const seen = /* @__PURE__ */ new Set();
    const results = parsed.rows.map((r) => {
      const errors = validateRow(args.entity, r.values, species);
      const key2 = rowKey(args.entity, r.values);
      if (key2 && seen.has(key2)) errors.push("Duplicate of an earlier row in this file.");
      seen.add(key2);
      return { rowNumber: r.rowNumber, externalId: key2 || `row-${r.rowNumber}`, errors, values: r.values };
    });
    const result = await command(context.prisma, { name: "import.preview", actor, idempotencyKey: args.idempotencyKey, params: { system: args.system, entity: args.entity, locationId: args.locationId, fileHash, mapping: parsed.mapping } }, async (uow) => {
      const location = await uow.tx.location.findUnique({ where: { id: args.locationId }, select: { id: true } });
      if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
      const ref = await nextReference(uow.tx, "IMP", uow.now);
      const failed = results.filter((r) => r.errors.length).length;
      const batch = await uow.tx.importBatch.create({
        data: { ref, system: args.system, channel: args.source === "ezyvet-api" ? "api" : "csv", entity: args.entity, locationId: location.id, fileName: args.fileName ?? "", fileHash, status: "validated", rowsTotal: results.length, rowsFailed: 0, mapping: toJsonValue({ mapping: parsed.mapping, rows: results.map((r) => r.values) }), startedById: actorUserId(actor) }
      });
      auditCreate(uow, actor, "ImportBatch", batch.id, "import.previewed", { ref, system: args.system, entity: args.entity, rows: results.length, invalid: failed, fileHash });
      return { id: batch.id, ref, rows: results.length, invalid: failed, mapping: parsed.mapping, sample: results.slice(0, 20).map((r) => ({ rowNumber: r.rowNumber, externalId: r.externalId, errors: r.errors, values: r.values })) };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function findMapped(uow, system, recordType, value) {
  return uow.tx.externalId.findFirst({ where: { system, recordType, value }, select: { recordId: true } });
}
async function mapExternal(uow, system, recordType, recordId, value) {
  await uow.tx.externalId.create({ data: { system, recordType, recordId, value } });
}
async function applyRow(uow, actor, batch, row, rowNumber) {
  const sys2 = `${batch.system}:${batch.entity}`;
  const key2 = rowKey(batch.entity, row);
  const base = { rowNumber, externalId: key2, errors: [] };
  const species = await speciesList(uow.tx);
  const errors = validateRow(batch.entity, row, species);
  if (errors.length) return { ...base, result: "failed", errors };
  const existing = await findMapped(uow, sys2, RECORD_TYPE[batch.entity], key2);
  if (existing) return { ...base, result: "skipped_existing", recordType: RECORD_TYPE[batch.entity], recordId: existing.recordId };
  const patientFor = async (ext) => {
    const m = await findMapped(uow, `${batch.system}:patients`, "Patient", ext);
    if (!m) throw new DomainError(Codes.NOT_FOUND, `Patient ${ext} has not been imported yet; import patients first.`);
    return m.recordId;
  };
  switch (batch.entity) {
    case "clients": {
      const contacts = [];
      if (row.mobile) contacts.push({ kind: "mobile", value: row.mobile });
      if (row.phone) contacts.push({ kind: "landline", value: row.phone });
      if (row.email) contacts.push({ kind: "email", value: row.email });
      const normalised = contacts.map((c) => {
        try {
          return { ...c, value: normaliseContact(c.kind, c.value) };
        } catch {
          return null;
        }
      }).filter(Boolean);
      if (!normalised.length) return { ...base, result: "failed", errors: ["No valid phone or email."] };
      const dupe = await uow.tx.contactPoint.findFirst({ where: { valueHash: { in: normalised.map((c) => contactHash(c.value)) }, status: "active" }, select: { person: { select: { client: { select: { id: true, ref: true } } } } } });
      if (dupe?.person?.client) {
        await mapExternal(uow, sys2, "Client", dupe.person.client.id, key2);
        return { ...base, result: "skipped_existing", recordType: "Client", recordId: dupe.person.client.id, errors: [`Matched existing client ${dupe.person.client.ref} by contact.`] };
      }
      const ref = await nextSerial(uow.tx, "C");
      const location = await uow.tx.location.findUniqueOrThrow({ where: { id: batch.locationId }, select: { stateCode: true } });
      const client = await uow.tx.client.create({ data: { ref, publicCode: publicCode("CL"), displayName: `${row.lastName.trim()} household`, kind: "household", status: "active", primaryLocationId: batch.locationId, addressLine1: row.address ?? "", city: row.city ?? "", stateCode: location.stateCode, postalCode: row.postalCode ?? "", source: "import", accountFlags: {} } });
      const person = await uow.tx.clientPerson.create({ data: { clientId: client.id, firstName: (row.firstName || "").trim() || "(unknown)", lastName: row.lastName.trim(), relationship: "owner", isPrimary: true, canBook: true, canApproveTreatment: true, canReceiveRecords: true, canPay: true, canAuthoriseEuthanasia: true } });
      const seen = /* @__PURE__ */ new Set();
      for (const c of normalised) {
        const cp = await uow.tx.contactPoint.create({ data: { personId: person.id, kind: c.kind, value: c.value, valueHash: contactHash(c.value), isPrimary: !seen.has(c.kind), canText: false, status: "active" } });
        seen.add(c.kind);
        await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: "transactional", action: "grant", method: "import", capturedByUserId: actorUserId(actor), at: uow.now } });
        if (row.marketingConsent && truthy(row.marketingConsent)) await uow.tx.consentRecord.create({ data: { contactPointId: cp.id, purpose: "marketing", action: "grant", method: "import", capturedByUserId: actorUserId(actor), at: uow.now } });
      }
      await mapExternal(uow, sys2, "Client", client.id, key2);
      auditCreate(uow, actor, "Client", client.id, "client.imported", { ref, batch: batch.ref, rowNumber });
      return { ...base, result: "created", recordType: "Client", recordId: client.id };
    }
    case "patients": {
      const owner = await findMapped(uow, `${batch.system}:clients`, "Client", row.clientExternalId);
      if (!owner) return { ...base, result: "failed", errors: [`Client ${row.clientExternalId} has not been imported yet; import clients first.`] };
      const code = importSpeciesCode(row.species, species);
      const speciesRow = code ? await uow.tx.species.findUnique({ where: { code }, select: { id: true } }) : null;
      if (!speciesRow) return { ...base, result: "failed", errors: [`Species "${row.species}" is not set up.`] };
      const breed = row.breed ? await uow.tx.breed.findFirst({ where: { speciesId: speciesRow.id, name: { equals: row.breed.trim(), mode: "insensitive" } }, select: { id: true } }) : null;
      const { sex, reproductiveStatus } = importSex(row.sex ?? "");
      const dob = row.dateOfBirth ? importDate(row.dateOfBirth) : null;
      const deceased = row.deceased ? truthy(row.deceased) : false;
      let chip = null;
      if (row.microchip) {
        chip = row.microchip.replace(/[\s-]/g, "").toUpperCase();
        const clash = await uow.tx.microchip.findFirst({ where: { number: chip, active: true }, select: { patient: { select: { ref: true } } } });
        if (clash) return { ...base, result: "failed", errors: [`Microchip ${chip} is already on ${clash.patient?.ref ?? "another patient"}.`] };
      }
      const ref = await nextSerial(uow.tx, "P");
      const patient = await uow.tx.patient.create({ data: { ref, name: row.name.trim(), kind: "individual", speciesId: speciesRow.id, breedId: breed?.id ?? null, sex, reproductiveStatus, dateOfBirth: dob ? /* @__PURE__ */ new Date(`${dob}T00:00:00Z`) : null, dobEstimated: false, status: deceased ? "deceased" : "active", deceasedAt: deceased ? uow.now : null, codeStatus: "unspecified" } });
      await uow.tx.patientOwnership.create({ data: { patientId: patient.id, clientId: owner.recordId, role: "primary", effectiveFrom: uow.now, basis: "import", recordedById: actorUserId(actor) } });
      if (chip) await uow.tx.microchip.create({ data: { patientId: patient.id, number: chip, standard: microchipStandard(chip), active: true } });
      await mapExternal(uow, sys2, "Patient", patient.id, key2);
      auditCreate(uow, actor, "Patient", patient.id, "patient.imported", { ref, batch: batch.ref, rowNumber, deceased });
      return { ...base, result: "created", recordType: "Patient", recordId: patient.id };
    }
    case "weights": {
      const patientId = await patientFor(row.patientExternalId);
      const unit2 = (row.unit || "kg").toLowerCase().replace("lbs", "lb");
      const on = importDate(row.date);
      const w = await uow.tx.weightMeasurement.create({ data: { patientId, value: toScale(row.weight, "wt"), unit: unit2, valueKg: toScale(toKg(dec(row.weight), unit2), "wt"), method: "carried_over", measuredAt: /* @__PURE__ */ new Date(`${on}T12:00:00Z`) } });
      await mapExternal(uow, sys2, "WeightMeasurement", w.id, key2);
      return { ...base, result: "created", recordType: "WeightMeasurement", recordId: w.id };
    }
    case "vaccinations":
    case "reminders": {
      const patientId = await patientFor(row.patientExternalId);
      const label = (batch.entity === "vaccinations" ? row.vaccine : row.reminder).trim();
      const product = await uow.tx.vaccineProduct.findFirst({ where: { name: { equals: label, mode: "insensitive" } }, select: { id: true, licensedDoiMonths: true, reminderTypeId: true } });
      const type = product?.reminderTypeId ? { id: product.reminderTypeId } : await uow.tx.reminderType.findFirst({ where: { OR: [{ name: { equals: label, mode: "insensitive" } }, { code: label.toUpperCase().replace(/[^A-Z0-9]+/g, "_") }] }, select: { id: true } });
      if (!type) return { ...base, result: "failed", errors: [`"${label}" does not match a vaccine or reminder type. Add it under Reminders, or map it.`] };
      const dueOn = batch.entity === "reminders" ? importDate(row.dueOn) : row.dueOn ? importDate(row.dueOn) : addMonths(importDate(row.givenOn), product?.licensedDoiMonths ?? 12);
      const reminder = await uow.tx.patientReminder.upsert({
        where: { patientId_typeId_dueOn: { patientId, typeId: type.id, dueOn: /* @__PURE__ */ new Date(`${dueOn}T00:00:00Z`) } },
        create: { patientId, locationId: batch.locationId, typeId: type.id, dueOn: /* @__PURE__ */ new Date(`${dueOn}T00:00:00Z`), status: "scheduled", source: "import", sourceKey: `${sys2}:${key2}` },
        update: {}
      });
      if (batch.entity === "vaccinations") {
        const givenOn = importDate(row.givenOn);
        const note = `Imported from ${batch.system}: ${label} given ${givenOn}${row.lotNumber ? `, lot ${row.lotNumber}` : ""}${row.tagNumber ? `, tag ${row.tagNumber}` : ""}.`;
        const older = await uow.tx.patientReminder.findMany({ where: { patientId, typeId: type.id, status: { in: ["scheduled", "due", "overdue", "lapsed"] }, dueOn: { lte: /* @__PURE__ */ new Date(`${givenOn}T00:00:00Z`) }, id: { not: reminder.id } }, select: { id: true } });
        for (const o of older) {
          await uow.tx.reminderSatisfaction.create({ data: { reminderId: o.id, sourceKey: `${sys2}:${key2}`, note, at: uow.now } });
          await uow.tx.patientReminder.update({ where: { id: o.id }, data: { status: "satisfied", version: { increment: 1 } } });
        }
      }
      await mapExternal(uow, sys2, "PatientReminder", reminder.id, key2);
      return { ...base, result: "created", recordType: "PatientReminder", recordId: reminder.id };
    }
    case "consults": {
      const patientId = await patientFor(row.patientExternalId);
      const on = importDate(row.date);
      const ref = await nextReference(uow.tx, "ENC", uow.now);
      const startedAt = /* @__PURE__ */ new Date(`${on}T12:00:00Z`);
      const body = row.notes.trim();
      const content = { importedFrom: batch.system, externalId: key2, date: on, vet: row.vet ?? "", reason: row.reason ?? "", notes: body, batch: batch.ref };
      const hash2 = signedContentHash(toJsonValue(content));
      const enc = await uow.tx.encounter.create({ data: { ref, patientId, locationId: batch.locationId, kind: "records_import", vcprQualifying: false, status: "open", reason: (row.reason ?? "").slice(0, 300), startedAt, importedFrom: `${batch.system}:${key2}` } });
      const section = await uow.tx.soapSection.create({ data: { encounterId: enc.id, kind: "history", ordinal: 1, body, source: "import" } });
      await uow.tx.soapSectionRevision.create({ data: { sectionId: section.id, revisionNumber: 1, body, source: "import", authorUserId: actorUserId(actor), at: uow.now, contentHash: revisionHash({ kind: "history", ordinal: 1, body, structured: null, source: "import", author: `import:${batch.system}` }) } });
      await uow.tx.soapSection.update({ where: { id: section.id }, data: { lockedAt: uow.now } });
      await uow.tx.$executeRawUnsafe(`UPDATE "Encounter" SET status = 'signed', "signedAt" = $2, "contentHash" = $3, "signedContent" = $4::jsonb, "submittedAt" = $2, version = version + 1 WHERE id = $1`, enc.id, uow.now, hash2, JSON.stringify({ ...content, signer: { source: batch.system, name: row.vet ?? "" } }));
      await mapExternal(uow, sys2, "Encounter", enc.id, key2);
      auditCreate(uow, actor, "Encounter", enc.id, "encounter.imported", { ref, batch: batch.ref, rowNumber, contentHash: hash2 });
      return { ...base, result: "created", recordType: "Encounter", recordId: enc.id };
    }
  }
}
async function applyImport(_root, args, context) {
  return gated(context, { permissions: ["canManageOnboarding"], tool: "import.apply", humanOnly: true }, args, async (actor) => {
    const prisma = context.prisma;
    const claim = await command(prisma, { name: "import.apply", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const rows = await uow.tx.$queryRawUnsafe(`SELECT id, status FROM "ImportBatch" WHERE id = $1 FOR UPDATE`, args.batchId);
      if (!rows.length) throw new DomainError(Codes.NOT_FOUND, "Import batch not found.");
      if (!["validated", "applying"].includes(rows[0].status)) throw new DomainError(Codes.INVALID_TRANSITION, `The batch is ${rows[0].status}.`, { currentStatus: rows[0].status });
      const resumed = rows[0].status === "applying";
      await uow.tx.importBatch.update({ where: { id: args.batchId }, data: { status: "applying", version: { increment: 1 } } });
      uow.audit({ eventType: resumed ? "import.apply_resumed" : "import.apply_started", entityType: "ImportBatch", entityId: args.batchId, actorUserId: actorUserId(actor) });
      return { started: true, resumed };
    });
    if (claim.replay) {
      const b = await prisma.importBatch.findUnique({ where: { id: args.batchId }, select: { ref: true, status: true, rowsCreated: true, rowsSkipped: true, rowsFailed: true, rowsTotal: true } });
      return { replay: true, ...b };
    }
    const batch = await prisma.importBatch.findUniqueOrThrow({ where: { id: args.batchId }, select: { id: true, ref: true, system: true, entity: true, locationId: true, mapping: true, rowsTotal: true } });
    const stored = batch.mapping.rows;
    const totals = { created: 0, skipped: 0, failed: 0 };
    for (let start = 0; start < stored.length; start += CHUNK) {
      const chunk = stored.slice(start, start + CHUNK);
      const results = [];
      for (const [i, values] of chunk.entries()) {
        const rowNumber = start + i + 2;
        const done = await prisma.importRow.findUnique({ where: { batchId_rowNumber: { batchId: batch.id, rowNumber } }, select: { id: true } });
        if (done) continue;
        try {
          const r = await runInTransaction(prisma, (uow) => applyRow(uow, actor, batch, values, rowNumber).then(async (res) => {
            await uow.tx.importRow.create({ data: { batchId: batch.id, rowNumber, externalId: res.externalId || `row-${rowNumber}`, result: res.result, recordType: res.recordType ?? "", recordId: res.recordId ?? "", errors: toJsonValue(res.errors) } });
            return res;
          }));
          results.push(r);
        } catch (error) {
          const message = error instanceof DomainError ? error.message : invariantError(error)?.message ?? "The row could not be saved.";
          await prisma.importRow.create({ data: { batchId: batch.id, rowNumber, externalId: rowKey(batch.entity, values) || `row-${rowNumber}`, result: "failed", errors: [message] } });
          results.push({ rowNumber, externalId: "", result: "failed", errors: [message] });
        }
      }
      for (const r of results) totals[r.result === "created" ? "created" : r.result === "skipped_existing" ? "skipped" : "failed"]++;
      await prisma.importBatch.update({ where: { id: batch.id }, data: { rowsCreated: { increment: results.filter((r) => r.result === "created").length }, rowsSkipped: { increment: results.filter((r) => r.result === "skipped_existing").length }, rowsFailed: { increment: results.filter((r) => r.result === "failed").length } } });
    }
    const final = await runInTransaction(prisma, async (uow) => {
      const row = await uow.tx.importBatch.update({ where: { id: batch.id }, data: { status: "applied", finishedAt: uow.now, version: { increment: 1 } }, select: { ref: true, status: true, rowsCreated: true, rowsSkipped: true, rowsFailed: true, rowsTotal: true } });
      uow.audit({ eventType: "import.applied", entityType: "ImportBatch", entityId: batch.id, actorUserId: actorUserId(actor), after: { ...row, run: totals } });
      return row;
    });
    return { replay: false, ...final };
  });
}

// features/keystone/mutations/clocks.ts
async function refreshClinicalClocks(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canAdminister", "canSignRecord", "canBook", "canManagePractice");
  const result = await command(context.prisma, { name: "clocks.refresh", actor, idempotencyKey: args.idempotencyKey, params: {} }, async (uow) => {
    const treatment = await runTreatmentSheetJob(uow);
    const records = await runUnsignedRecordClock(uow);
    const locations = await uow.tx.location.findMany({ where: { active: true }, orderBy: { code: "asc" }, select: { id: true } });
    const reminders = [];
    for (const loc of locations) reminders.push(await runReminderJob(uow, loc.id));
    return { treatment, records, reminders };
  });
  return { replay: result.replay, ...result.value };
}

// features/keystone/mutations/pharmacy.ts
var CS_UNITS = /* @__PURE__ */ new Set(["mg", "mcg", "g", "mL", "L", "tablet", "capsule", "unit", "each"]);
var isCs = (s) => !!s && s !== "none";
var addMonthsTo = (d, months) => {
  const out = new Date(d.getTime());
  out.setUTCMonth(out.getUTCMonth() + months);
  return out;
};
var dateOnly = (value, field) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field });
  return /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
};
var positiveQty = (value, field) => {
  const t = decimalText(value, field);
  if (!dec(t).gt(0)) throw new DomainError(Codes.INVALID_INPUT, `${field} must be more than zero.`, { field });
  return t;
};
async function calendarFor(uow, locationId) {
  const location = await uow.tx.location.findUnique({ where: { id: locationId }, select: { code: true, timeZone: true, calendar: { select: { regularOpen: true, regularClose: true, exceptions: { select: { date: true } } } } } });
  if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
  return locationCalendar({ code: location.code, timeZone: location.timeZone, regularOpen: location.calendar?.regularOpen, regularClose: location.calendar?.regularClose, closures: (location.calendar?.exceptions ?? []).map((e) => day2(e.date)) });
}
async function lockedContainer(uow, id2) {
  const c = await lockRow(uow.tx, "CsContainer", id2);
  const product = await uow.tx.drugProduct.findUnique({ where: { id: c.productId }, select: { id: true, displayName: true, csSchedule: true, multiDoseBudDays: true } });
  return { ...c, product };
}
async function writePrescription(_root, args, context) {
  return gated(context, { permissions: ["canPrescribe"], tool: "prescription.write", humanOnly: true }, args, async (actor) => {
    if (!Array.isArray(args.lines) || !args.lines.length || args.lines.length > 10) throw new DomainError(Codes.INVALID_INPUT, "A prescription needs between one and ten lines.", { field: "lines" });
    const result = await command(context.prisma, { name: "prescription.write", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (staff.kind !== "dvm") throw new DomainError(Codes.NOT_AUTHORIZED, "Only a veterinarian can write a prescription.");
      const patient = await activePatient(uow, args.patientId);
      const { on, location } = await locationDay2(uow, args.locationId, uow.now);
      const licence = await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: location.id, action: "prescribe", at: uow.now });
      const vcprPolicy = await resolvePolicy(uow.tx, "vcpr", { locationId: location.id, on });
      const vcpr = await uow.tx.vcprRecord.findFirst({
        where: { patientId: patient.id, status: "active", expiresAt: { gt: uow.now }, establishedAt: { lte: uow.now }, ...vcprPolicy.rules.level === "dvm" ? { dvmId: staff.id } : {} },
        orderBy: { expiresAt: "desc" },
        select: { id: true }
      });
      if (!vcpr) throw new DomainError(Codes.VCPR_REQUIRED, vcprPolicy.rules.level === "dvm" ? "You have no current veterinarian-client-patient relationship with this patient." : "This patient has no current veterinarian-client-patient relationship.");
      const rx = await resolvePolicy(uow.tx, "prescription", { locationId: location.id, on });
      const owner = await uow.tx.patientOwnership.findFirst({ where: { patientId: patient.id, effectiveTo: null, role: "primary" }, select: { clientId: true } });
      const products = await uow.tx.drugProduct.findMany({ where: { id: { in: args.lines.map((l) => l.productId) } }, select: { id: true, displayName: true, csSchedule: true, active: true, approvalStatus: true, isHumanLabel: true } });
      const byId = new Map(products.map((p) => [p.id, p]));
      let dea = null;
      const lines = [];
      for (const input of args.lines) {
        const product = byId.get(input.productId);
        if (!product || !product.active) throw new DomainError(Codes.NOT_FOUND, "That drug is not in the formulary.", { field: "productId" });
        text16(input.directions, "directions", 500);
        positiveQty(input.quantity, "quantity");
        const refills = Number(input.refillsAuthorised ?? 0);
        if (!Number.isInteger(refills) || refills < 0) throw new DomainError(Codes.INVALID_INPUT, "Refills must be a whole number, zero or more.", { field: "refillsAuthorised" });
        const limit = rx.rules.refillLimits[product.csSchedule];
        if (isCs(product.csSchedule)) {
          if (!limit) throw new DomainError(Codes.POLICY_UNRESOLVED, `The prescription policy has no refill limit for ${product.csSchedule}.`);
          if (refills > limit.maxRefills) throw new DomainError(Codes.GUARD_FAILED, limit.maxRefills === 0 ? `${product.displayName} is a Schedule II drug: no refills.` : `${product.displayName} allows at most ${limit.maxRefills} refills.`, { field: "refillsAuthorised" });
          dea ??= await requireDeaRegistration(uow.tx, { locationId: location.id, schedule: product.csSchedule, at: uow.now, action: "prescribe_controlled", registrantStaffMemberId: staff.id, actorStaffMemberId: staff.id });
        }
        const months = Math.min(rx.rules.defaultExpiryMonths, isCs(product.csSchedule) && limit?.maxMonths ? limit.maxMonths : rx.rules.defaultExpiryMonths);
        lines.push({ product, input, refills, expiresAt: addMonthsTo(uow.now, months), extralabel: product.approvalStatus === "human_label" || product.isHumanLabel || input.extralabel === true });
      }
      const ref = await nextReference(uow.tx, "RX", uow.now);
      const row = await uow.tx.prescription.create({
        data: {
          ref,
          patientId: patient.id,
          clientId: owner?.clientId ?? null,
          locationId: location.id,
          prescriberId: staff.id,
          deaRegistrationId: dea?.deaRegistrationId ?? null,
          vcprId: vcpr.id,
          issuedAt: uow.now,
          status: "active",
          signedAt: uow.now,
          licenseEvaluationId: licence.evaluationId,
          policyVersionId: rx.versions[rx.versions.length - 1]?.id ?? null,
          lines: {
            create: lines.map((l) => ({
              productId: l.product.id,
              csSchedule: l.product.csSchedule,
              directions: text16(l.input.directions, "directions", 500),
              route: String(l.input.route ?? "").slice(0, 60),
              frequency: String(l.input.frequency ?? "").slice(0, 100),
              quantity: toScale(dec(decimalText(l.input.quantity, "quantity")), "qty"),
              quantityUnit: l.input.quantityUnit ?? null,
              refillsAuthorised: l.refills,
              expiresAt: l.expiresAt,
              extralabel: l.extralabel,
              substitutionAllowed: l.input.substitutionAllowed ?? true
            }))
          }
        }
      });
      auditCreate(uow, actor, "Prescription", row.id, "prescription.signed", { ref, patientId: patient.id, lines: lines.map((l) => ({ productId: l.product.id, refills: l.refills })) });
      return { id: row.id, ref, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
var DECISIONS = { fulfil_existing: "fulfilled_under_existing_rx", approve_new: "approved_new_rx", deny: "denied", needs_exam: "needs_exam" };
async function decideRefill(_root, args, context) {
  return gated(context, { permissions: ["canManageRefills"], tool: "refill.decide", humanOnly: true }, args, async (actor) => {
    const to = DECISIONS[args.decision];
    if (!to) throw new DomainError(Codes.INVALID_INPUT, "Choose a decision.", { field: "decision" });
    const reason = String(args.reason ?? "").trim().slice(0, 300);
    if ((args.decision === "deny" || args.decision === "needs_exam") && reason.length < 5) throw new DomainError(Codes.INVALID_INPUT, "Give the reason for the client (at least 5 characters).", { field: "reason" });
    const result = await command(context.prisma, { name: "refill.decide", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (staff.kind !== "dvm") throw new DomainError(Codes.NOT_AUTHORIZED, "Only a veterinarian decides a refill.");
      const request = await uow.tx.refillRequest.findUnique({ where: { id: args.requestId }, select: { id: true, ref: true, patientId: true } });
      if (!request) throw new DomainError(Codes.NOT_FOUND, "Refill request not found.");
      const { on, location } = await locationDay2(uow, staff.homeLocationId ?? (await uow.tx.location.findFirstOrThrow({ where: { active: true }, select: { id: true } })).id, uow.now);
      await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: location.id, action: "approve_refill", at: uow.now });
      if (args.decision !== "deny") {
        const vcprPolicy = await resolvePolicy(uow.tx, "vcpr", { locationId: location.id, on });
        const vcpr = await uow.tx.vcprRecord.findFirst({ where: { patientId: request.patientId, status: "active", expiresAt: { gt: uow.now }, ...vcprPolicy.rules.level === "dvm" ? { dvmId: staff.id } : {} }, select: { id: true } });
        if (!vcpr && args.decision !== "needs_exam") throw new DomainError(Codes.VCPR_REQUIRED, "There is no current veterinarian-client-patient relationship; ask for an exam instead.");
      }
      if (args.decision === "fulfil_existing") {
        const lines = await uow.tx.prescriptionLine.findMany({ where: { prescription: { patientId: request.patientId, status: "active" }, expiresAt: { gt: uow.now } }, select: { id: true, refillsAuthorised: true } });
        const used = await Promise.all(lines.map(async (l) => await uow.tx.dispense.count({ where: { lineId: l.id } }) <= l.refillsAuthorised));
        if (!used.some(Boolean)) throw new DomainError(Codes.GUARD_FAILED, "No active prescription has a fill left. Write a new prescription or ask for an exam.");
      }
      const row = await transition(uow, {
        model: "RefillRequest",
        id: args.requestId,
        from: ["received", "in_review"],
        to,
        expectedVersion: args.expectedVersion,
        actor,
        eventType: "refill.decided",
        reason: reason || null,
        data: { decidedById: staff.id, decidedAt: uow.now, denialReason: args.decision === "deny" ? reason : "", pharmacyNote: args.decision === "needs_exam" ? reason : void 0 }
      });
      await uow.tx.task.updateMany({ where: { subjectType: "RefillRequest", subjectId: request.id, kind: "refill_review", status: { in: ["open", "in_progress"] } }, data: { status: "done", completedAt: uow.now, version: { increment: 1 } } });
      return { id: row.id, ref: request.ref, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function dispenseFill(_root, args, context) {
  return gated(context, { permissions: ["canDispense", "canFulfilRefill"], tool: "dispense.fill", humanOnly: true }, args, async (actor) => {
    const qty2 = positiveQty(args.quantity, "quantity");
    const result = await command(context.prisma, { name: "dispense.fill", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const line0 = await uow.tx.prescriptionLine.findUnique({ where: { id: args.lineId }, select: { prescriptionId: true } });
      if (!line0?.prescriptionId) throw new DomainError(Codes.NOT_FOUND, "Prescription line not found.");
      const rxRow = await lockRow(uow.tx, "Prescription", line0.prescriptionId);
      const rx = await uow.tx.prescription.findUniqueOrThrow({ where: { id: rxRow.id }, include: { prescriber: { select: { displayName: true } }, location: { select: { id: true, name: true, addressLine1: true, city: true, stateCode: true, phone: true } }, patient: { select: { id: true, name: true, species: { select: { name: true } } } }, client: { select: { id: true, displayName: true } }, lines: { select: { id: true } } } });
      if (rx.status !== "active") throw new DomainError(Codes.GUARD_FAILED, `This prescription is ${rx.status}.`);
      const line = await uow.tx.prescriptionLine.findUniqueOrThrow({ where: { id: args.lineId }, include: { product: true } });
      if (line.expiresAt < uow.now) throw new DomainError(Codes.GUARD_FAILED, "This prescription line has expired.");
      if (!rx.location || !rx.patient) throw new DomainError(Codes.GUARD_FAILED, "The prescription is missing its location or patient.");
      await activePatient(uow, rx.patient.id);
      const { on } = await locationDay2(uow, rx.location.id, uow.now);
      const fills = await uow.tx.dispense.count({ where: { lineId: line.id } });
      if (fills > line.refillsAuthorised) throw new DomainError(Codes.GUARD_FAILED, "Every fill of this prescription has been used.");
      if (dec(qty2).gt(dec(line.quantity.toString()))) throw new DomainError(Codes.GUARD_FAILED, `A fill is at most ${line.quantity.toString()} ${line.quantityUnit ?? ""} (the quantity written).`.replace(/ +\./, "."));
      if (fills > 0 || args.refillRequestId) {
        const vcprPolicy = await resolvePolicy(uow.tx, "vcpr", { locationId: rx.location.id, on });
        if (vcprPolicy.rules.requiredFor.includes("refill")) {
          const vcpr = await uow.tx.vcprRecord.findFirst({ where: { patientId: rx.patient.id, status: "active", expiresAt: { gt: uow.now } }, select: { id: true } });
          if (!vcpr) throw new DomainError(Codes.VCPR_REQUIRED, "There is no current veterinarian-client-patient relationship; this refill needs an exam first.");
        }
      }
      if (args.refillRequestId) {
        const req = await uow.tx.refillRequest.findUnique({ where: { id: args.refillRequestId }, select: { status: true, patientId: true } });
        if (!req || req.patientId !== rx.patient.id) throw new DomainError(Codes.GUARD_FAILED, "That refill request is for another patient.");
        if (req.status !== "fulfilled_under_existing_rx") throw new DomainError(Codes.GUARD_FAILED, "A veterinarian has not approved that refill request.");
      }
      const controlled = isCs(line.csSchedule);
      let lotId = null;
      let lotNumber = "";
      let expiryOn = null;
      let containerId = null;
      let csEntryId = null;
      if (controlled) {
        if (!can(actor, "canAdministerControlled")) throw new DomainError(Codes.NOT_AUTHORIZED, "Dispensing a controlled drug needs the controlled-substance permission.");
        await requireLicence(uow.tx, { staffMemberId: staff.id, locationId: rx.location.id, action: "administer_controlled", at: uow.now });
        await requireDeaRegistration(uow.tx, { locationId: rx.location.id, schedule: line.csSchedule, at: uow.now, action: "dispense_controlled", actorStaffMemberId: staff.id });
        if (!args.csContainerId) throw new DomainError(Codes.INVALID_INPUT, "Choose the container the drug comes from.", { field: "csContainerId" });
        const c = await lockedContainer(uow, args.csContainerId);
        if (c.productId !== line.productId) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} holds a different drug.`);
        if (c.locationId !== rx.location.id) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} belongs to another location.`);
        if (c.status !== "open") throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is ${c.status}.`);
        if (c.lotExpiresOn && day2(c.lotExpiresOn) < on) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} expired on ${day2(c.lotExpiresOn)}.`);
        if (line.quantityUnit && line.quantityUnit !== c.labelUnit) throw new DomainError(Codes.GUARD_FAILED, `The prescription is in ${line.quantityUnit} but ${c.ref} is counted in ${c.labelUnit}.`);
        const balance = await containerBalance(uow.tx, c.id);
        if (balance.lt(dec(qty2))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${plain(balance)} ${c.labelUnit} left; that is not enough.`);
        const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: "dispense", qtySigned: dec(qty2).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, patientId: rx.patient.id, clientId: rx.client?.id ?? null, reason: rx.ref }, uow.now);
        containerId = c.id;
        csEntryId = entry.id;
        lotNumber = c.lotNumber;
        expiryOn = c.lotExpiresOn;
      } else {
        const lots = await uow.tx.inventoryLot.findMany({ where: { drugId: line.productId, locationId: rx.location.id, status: "available", expiresOn: { gte: /* @__PURE__ */ new Date(`${on}T00:00:00Z`) } }, orderBy: { expiresOn: "asc" }, select: { id: true, lotNumber: true, expiresOn: true } });
        const pick = args.lotId ? lots.find((l) => l.id === args.lotId) : lots[0];
        if (args.lotId && !pick) throw new DomainError(Codes.GUARD_FAILED, "That lot is not available here (expired, quarantined or another drug).");
        if (pick) {
          lotId = pick.id;
          lotNumber = pick.lotNumber;
          expiryOn = pick.expiresOn;
        }
      }
      const ref = await nextReference(uow.tx, "DSP", uow.now);
      const policy = await resolvePolicy(uow.tx, "prescription", { locationId: rx.location.id, on });
      const p = line.product;
      if (!p) throw new DomainError(Codes.GUARD_FAILED, "The prescription line has no drug.");
      const labelValues = {
        patient_name: rx.patient.name,
        species: rx.patient.species?.name ?? "",
        client_name: rx.client?.displayName ?? "",
        drug_name: p.displayName,
        strength: [p.strength?.toString(), p.strengthUnit].filter(Boolean).join(" "),
        quantity: `${qty2} ${line.quantityUnit ?? ""}`.trim(),
        directions: line.directions,
        prescriber_name: rx.prescriber?.displayName ?? "",
        practice_name_address_phone: [rx.location.name, rx.location.addressLine1, rx.location.city, rx.location.stateCode, rx.location.phone].filter(Boolean).join(", "),
        date_dispensed: on,
        expiry_date: expiryOn ? day2(expiryOn) : "",
        cautionary_statements: line.extralabel ? "Used in a way not on the drug label. Keep out of reach of children." : "Keep out of reach of children.",
        rx_number: rx.ref,
        lot_number: lotNumber,
        refills_remaining: String(Math.max(line.refillsAuthorised - fills, 0))
      };
      const labelJson = Object.fromEntries([...policy.rules.labelFields, "lot_number", "refills_remaining"].map((f) => [f, labelValues[f] ?? ""]));
      const row = await uow.tx.dispense.create({
        data: { ref, prescriptionId: rx.id, lineId: line.id, patientId: rx.patient.id, clientId: rx.client?.id ?? null, locationId: rx.location.id, productId: line.productId, lotId, containerId, csLogEntryId: csEntryId, refillRequestId: args.refillRequestId ?? null, quantity: toScale(dec(qty2), "qty"), quantityUnit: line.quantityUnit, refillNumber: fills, dispensedById: staff.id, dispensedAt: uow.now, label: labelJson }
      });
      auditCreate(uow, actor, "Dispense", row.id, "dispense.filled", { ref, rx: rx.ref, lineId: line.id, refillNumber: fills, quantity: qty2, containerId, lotId });
      if (controlled) {
        const cs = await resolvePolicy(uow.tx, "controlled_substances", { locationId: rx.location.id, on });
        if (cs.rules.pdmp.required && cs.rules.pdmp.schedules.includes(line.csSchedule)) {
          const prefix = await nextReference(uow.tx, "PDM", uow.now);
          await uow.tx.pdmpReport.create({ data: { ref: prefix, locationId: rx.location.id, dispenseId: row.id, program: cs.rules.pdmp.program, format: cs.rules.pdmp.format, dueOn: dateOnly(addDays(on, cs.rules.pdmp.maxDays), "dueOn"), status: "pending" } });
        }
      }
      const filled = fills + 1;
      const all = await uow.tx.prescriptionLine.findMany({ where: { prescriptionId: rx.id }, select: { id: true, refillsAuthorised: true } });
      const counts = await Promise.all(all.map(async (l) => ({ l, n: l.id === line.id ? filled : await uow.tx.dispense.count({ where: { lineId: l.id } }) })));
      if (counts.every((c) => c.n > c.l.refillsAuthorised)) await transition(uow, { model: "Prescription", id: rx.id, from: ["active"], to: "exhausted", actor, eventType: "prescription.exhausted" });
      return { id: row.id, ref, status: "dispensed", refillNumber: fills, registerEntryId: csEntryId };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function receiveStockLot(_root, args, context) {
  return gated(context, { permissions: ["canReceiveStock", "canManageInventory"], tool: "stock.receive", humanOnly: true }, args, async (actor) => {
    const lotNumber = text16(args.lotNumber, "lotNumber", 60);
    const expiresOn = dateOnly(args.expiresOn, "Expires");
    if (!args.drugId === !args.vaccineId) throw new DomainError(Codes.INVALID_INPUT, "Choose a drug or a vaccine.");
    const result = await command(context.prisma, { name: "stock.receive", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const { on } = await locationDay2(uow, args.locationId, uow.now);
      if (day2(expiresOn) <= on) throw new DomainError(Codes.GUARD_FAILED, "That lot is already expired.");
      if (args.drugId) {
        const drug = await uow.tx.drugProduct.findUnique({ where: { id: args.drugId }, select: { csSchedule: true, active: true } });
        if (!drug?.active) throw new DomainError(Codes.NOT_FOUND, "Drug not found.");
        if (isCs(drug.csSchedule)) throw new DomainError(Codes.GUARD_FAILED, "Controlled drugs are received through the controlled-substance register.");
      } else if (!await uow.tx.vaccineProduct.findUnique({ where: { id: args.vaccineId }, select: { id: true } })) throw new DomainError(Codes.NOT_FOUND, "Vaccine not found.");
      const existing = await uow.tx.inventoryLot.findFirst({ where: { locationId: args.locationId, lotNumber, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null }, select: { id: true } });
      if (existing) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is already in stock here.`);
      const row = await uow.tx.inventoryLot.create({ data: { drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null, locationId: args.locationId, lotNumber, expiresOn, status: "available" } });
      auditCreate(uow, actor, "InventoryLot", row.id, "stock.received", { lotNumber, expiresOn: args.expiresOn, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null });
      return { id: row.id, status: row.status };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function setLotQuarantine(_root, args, context) {
  return gated(context, { permissions: args.quarantine ? ["canManageInventory", "canReceiveStock"] : ["canReleaseQuarantine"], tool: "stock.quarantine", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 300);
    if (reason.length < 5) throw new DomainError(Codes.INVALID_INPUT, "Say why (at least 5 characters).", { field: "reason" });
    const result = await command(context.prisma, { name: "stock.quarantine", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, {
        model: "InventoryLot",
        id: args.lotId,
        from: args.quarantine ? ["available"] : ["quarantined"],
        to: args.quarantine ? "quarantined" : "available",
        expectedVersion: args.expectedVersion,
        actor,
        eventType: args.quarantine ? "stock.quarantined" : "stock.released",
        reason,
        data: { quarantineReason: args.quarantine ? reason : "" }
      });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function receiveControlled(_root, args, context) {
  return gated(context, { permissions: ["canReceiveControlled"], tool: "cs.receive", humanOnly: true }, args, async (actor) => {
    const lotNumber = text16(args.lotNumber, "lotNumber", 60);
    const lotExpiresOn = dateOnly(args.lotExpiresOn, "Expires");
    const labelQty = positiveQty(args.labelQty, "labelQty");
    if (!CS_UNITS.has(args.labelUnit)) throw new DomainError(Codes.INVALID_INPUT, "Choose a unit.", { field: "labelUnit" });
    const result = await command(context.prisma, { name: "cs.receive", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const product = await uow.tx.drugProduct.findUnique({ where: { id: args.productId }, select: { id: true, displayName: true, csSchedule: true, active: true } });
      if (!product?.active || !isCs(product.csSchedule)) throw new DomainError(Codes.NOT_FOUND, "That is not a controlled drug in the formulary.", { field: "productId" });
      const { on } = await locationDay2(uow, args.locationId, uow.now);
      if (day2(lotExpiresOn) <= on) throw new DomainError(Codes.GUARD_FAILED, "That bottle is already expired.");
      const reg = await requireDeaRegistration(uow.tx, { locationId: args.locationId, schedule: product.csSchedule, at: uow.now, action: "receive_controlled", actorStaffMemberId: staff.id });
      const scheduleII = product.csSchedule === "CII" || product.csSchedule === "CIIN";
      const form = String(args.orderFormReference ?? "").trim().slice(0, 40);
      if (scheduleII && !form) throw new DomainError(Codes.INVALID_INPUT, "A Schedule II drug is received against a DEA Form 222 or CSOS order: enter its number.", { field: "orderFormReference" });
      const ref = `CSC-${(await uow.tx.location.findUniqueOrThrow({ where: { id: args.locationId }, select: { code: true } })).code.toUpperCase()}-${(await nextReference(uow.tx, "CSB", uow.now)).slice(-6)}`;
      const container = await uow.tx.csContainer.create({ data: { ref, productId: product.id, locationId: args.locationId, deaRegistrationId: reg.deaRegistrationId, lotNumber, lotExpiresOn, status: "sealed", labelQty, labelUnit: args.labelUnit } });
      const entry = await appendCsEntry(uow.tx, { containerId: container.id, type: "receive", qtySigned: labelQty, unit: args.labelUnit, occurredAt: uow.now, actorId: staff.id, reason: form ? `Received on order ${form}` : "Received" }, uow.now);
      auditCreate(uow, actor, "CsContainer", container.id, "cs.received", { ref, product: product.displayName, qty: labelQty, unit: args.labelUnit, orderForm: form || null, entry: entry.ref });
      return { id: container.id, ref, status: "sealed" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function openControlled(_root, args, context) {
  return gated(context, { permissions: ["canReceiveControlled", "canAdministerControlled"], tool: "cs.open", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "cs.open", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const c = await lockedContainer(uow, args.containerId);
      const bud = new Date(uow.now.getTime() + (c.product.multiDoseBudDays ?? 28) * 864e5);
      const row = await transition(uow, { model: "CsContainer", id: c.id, from: ["sealed"], to: "open", expectedVersion: args.expectedVersion, actor, eventType: "cs.opened", data: { openedAt: uow.now, openedById: staff.id, budAt: bud } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function wasteControlled(_root, args, context) {
  return gated(context, { permissions: ["canAdministerControlled"], tool: "cs.waste", humanOnly: true }, args, async (actor) => {
    const qty2 = positiveQty(args.qty, "qty");
    const reason = text16(args.reason, "reason", 300);
    const result = await command(context.prisma, { name: "cs.waste", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const witness = await witnessFor(uow, args.witnessId, staff.id);
      const c = await lockedContainer(uow, args.containerId);
      if (c.status !== "open") throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is ${c.status}.`);
      const balance = await containerBalance(uow.tx, c.id);
      if (balance.lt(dec(qty2))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${plain(balance)} ${c.labelUnit} left; that is not enough.`);
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: "waste", qtySigned: dec(qty2).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason }, uow.now);
      auditCreate(uow, actor, "CsLogEntry", entry.id, "cs.wasted", { ref: entry.ref, container: c.ref, qty: qty2, witness: witness.displayName }, { reason });
      return { id: entry.id, ref: entry.ref, status: "recorded" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function openCase(uow, input) {
  const { on } = await locationDay2(uow, input.locationId, uow.now);
  const policy = await resolvePolicy(uow.tx, "controlled_substances", { locationId: input.locationId, on });
  const calendar = await calendarFor(uow, input.locationId);
  const ref = await nextReference(uow.tx, "CSD", uow.now);
  return uow.tx.csDiscrepancyCase.create({
    data: {
      ref,
      locationId: input.locationId,
      containerId: input.containerId,
      kind: input.kind,
      qty: input.qty,
      unit: input.unit,
      discoveredAt: uow.now,
      discoveredById: input.staffId,
      description: input.description.slice(0, 500),
      status: "open",
      noticeDueOn: dateOnly(addBusinessDays(calendar, on, policy.rules.theftLossNoticeBusinessDays), "noticeDueOn"),
      form106DueOn: dateOnly(addDays(on, policy.rules.form106Days), "form106DueOn")
    }
  });
}
async function countControlled(_root, args, context) {
  return gated(context, { permissions: ["canCountControlled"], tool: "cs.count", humanOnly: true }, args, async (actor) => {
    if (!["initial", "biennial", "periodic", "spot"].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, "Choose the kind of count.", { field: "kind" });
    if (!Array.isArray(args.counts) || !args.counts.length || args.counts.length > 200) throw new DomainError(Codes.INVALID_INPUT, "Enter the counted amount for each container.", { field: "counts" });
    const result = await command(context.prisma, { name: "cs.count", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const witness = await witnessFor(uow, args.witnessId, staff.id);
      await locationDay2(uow, args.locationId, uow.now);
      const open = await uow.tx.csContainer.findMany({ where: { locationId: args.locationId, status: "open" }, orderBy: { ref: "asc" }, select: { id: true, ref: true } });
      const given = new Map(args.counts.map((c) => [c.containerId, c.countedQty]));
      if (given.size !== args.counts.length) throw new DomainError(Codes.INVALID_INPUT, "A container is counted twice.");
      const missing = open.filter((c) => !given.has(c.id));
      if (missing.length) throw new DomainError(Codes.GUARD_FAILED, `Count every open container. Missing: ${missing.map((m) => m.ref).join(", ")}.`);
      const stray = [...given.keys()].filter((id2) => !open.some((o) => o.id === id2));
      if (stray.length) throw new DomainError(Codes.GUARD_FAILED, "One of those containers is not open at this location.");
      const ref = await nextReference(uow.tx, "CSN", uow.now);
      const count = await uow.tx.csCount.create({ data: { ref, locationId: args.locationId, kind: args.kind, countedById: staff.id, witnessId: witness.id, countedAt: uow.now, status: "closed" } });
      const lines = [];
      for (const o of open) {
        const c = await lockedContainer(uow, o.id);
        const counted = dec(decimalText(given.get(o.id), `count of ${o.ref}`));
        const expected = await containerBalance(uow.tx, o.id);
        const variance = counted.minus(expected);
        let caseId = null;
        if (!variance.isZero()) {
          await appendCsEntry(uow.tx, { containerId: o.id, type: "count_variance", qtySigned: variance, unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason: `Count ${ref}: counted ${plain(counted)}, book ${plain(expected)}` }, uow.now);
          const dc = await openCase(uow, { locationId: args.locationId, containerId: o.id, kind: "count_variance", qty: plain(variance.abs()), unit: c.labelUnit, staffId: staff.id, description: `Count ${ref} found ${plain(counted)} ${c.labelUnit}; the register said ${plain(expected)}.` });
          caseId = dc.id;
        }
        await uow.tx.csCountLine.create({ data: { countId: count.id, containerId: o.id, expectedQty: toScale(expected, "qty"), countedQty: toScale(counted, "qty"), variance: toScale(variance, "qty"), unit: c.labelUnit, discrepancyCaseId: caseId } });
        lines.push({ container: o.ref, expected: plain(expected), counted: plain(counted), variance: plain(variance), ...caseId ? { case: caseId } : {} });
      }
      auditCreate(uow, actor, "CsCount", count.id, "cs.counted", { ref, kind: args.kind, lines });
      return { id: count.id, ref, status: "closed", variances: lines.filter((l) => l.case).length };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function reportCsLoss(_root, args, context) {
  return gated(context, { permissions: ["canCountControlled", "canManageControlled"], tool: "cs.report_loss", humanOnly: true }, args, async (actor) => {
    if (args.kind !== "theft" && args.kind !== "loss") throw new DomainError(Codes.INVALID_INPUT, "Choose theft or loss.", { field: "kind" });
    const qty2 = positiveQty(args.qty, "qty");
    const description = text16(args.description, "description", 500);
    const result = await command(context.prisma, { name: "cs.report_loss", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const witness = await witnessFor(uow, args.witnessId, staff.id);
      const c = await lockedContainer(uow, args.containerId);
      const balance = await containerBalance(uow.tx, c.id);
      if (balance.lt(dec(qty2))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has only ${plain(balance)} ${c.labelUnit} on the register; record the count first.`);
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: "theft_loss", qtySigned: dec(qty2).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason: `${args.kind}: ${description}`.slice(0, 300) }, uow.now);
      const dc = await openCase(uow, { locationId: c.locationId, containerId: c.id, kind: args.kind, qty: qty2, unit: c.labelUnit, staffId: staff.id, description });
      auditCreate(uow, actor, "CsDiscrepancyCase", dc.id, "cs.loss_reported", { ref: dc.ref, kind: args.kind, container: c.ref, qty: qty2, entry: entry.ref, noticeDueOn: day2(dc.noticeDueOn), form106DueOn: day2(dc.form106DueOn) });
      return { id: dc.id, ref: dc.ref, status: "open" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function advanceDiscrepancy(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled"], tool: "cs.advance_case", humanOnly: true }, args, async (actor) => {
    if (!["notice", "form106", "close"].includes(args.step)) throw new DomainError(Codes.INVALID_INPUT, "Choose a step.", { field: "step" });
    const reference = String(args.reference ?? "").trim().slice(0, 80);
    const resolution = String(args.resolution ?? "").trim().slice(0, 500);
    if (args.step !== "close" && !reference) throw new DomainError(Codes.INVALID_INPUT, args.step === "notice" ? "Enter the confirmation or case number from the DEA notice." : "Enter the Form 106 confirmation number.", { field: "reference" });
    if (args.step === "close" && resolution.length < 5) throw new DomainError(Codes.INVALID_INPUT, "Say how this was resolved (at least 5 characters).", { field: "resolution" });
    const result = await command(context.prisma, { name: "cs.advance_case", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const current = await uow.tx.csDiscrepancyCase.findUnique({ where: { id: args.caseId }, select: { kind: true } });
      if (!current) throw new DomainError(Codes.NOT_FOUND, "Case not found.");
      const spec = args.step === "notice" ? { from: ["open"], to: "notified", event: "cs.case_notified", data: { noticeGivenAt: uow.now, noticeReference: reference } } : args.step === "form106" ? { from: ["notified"], to: "form_filed", event: "cs.case_form106", data: { form106FiledAt: uow.now, form106Reference: reference } } : { from: current.kind === "count_variance" ? ["open", "notified", "form_filed"] : ["form_filed"], to: "closed", event: "cs.case_closed", data: { closedAt: uow.now, resolution } };
      if (args.step === "close" && current.kind !== "count_variance") {
        const c = await uow.tx.csDiscrepancyCase.findUniqueOrThrow({ where: { id: args.caseId }, select: { status: true } });
        if (c.status !== "form_filed") throw new DomainError(Codes.GUARD_FAILED, "A theft or loss closes only after the DEA notice and Form 106 are recorded.");
      }
      const row = await transition(uow, { model: "CsDiscrepancyCase", id: args.caseId, from: spec.from, to: spec.to, expectedVersion: args.expectedVersion, actor, eventType: spec.event, reason: reference || resolution || null, data: spec.data, metadata: { by: staff.id } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function destroyControlled(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled"], tool: "cs.destroy", humanOnly: true }, args, async (actor) => {
    const method = text16(args.method, "method", 200);
    const result = await command(context.prisma, { name: "cs.destroy", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      if (args.witnessAId === args.witnessBId) throw new DomainError(Codes.GUARD_FAILED, "Destruction needs two different witnesses.");
      const a = await witnessFor(uow, args.witnessAId, staff.id);
      const b = await witnessFor(uow, args.witnessBId, staff.id);
      const c = await lockedContainer(uow, args.containerId);
      if (["disposed", "retired"].includes(c.status)) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is already ${c.status}.`);
      const balance = await containerBalance(uow.tx, c.id);
      const qty2 = args.qty ? dec(positiveQty(args.qty, "qty")) : balance;
      if (qty2.lte(0)) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has nothing left to destroy.`);
      if (qty2.gt(balance)) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${plain(balance)} ${c.labelUnit} left; that is not enough.`);
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: "destroy", qtySigned: qty2.neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: a.id, reason: `Destroyed by ${method}` }, uow.now);
      const ref = await nextReference(uow.tx, "CSX", uow.now);
      const rec = await uow.tx.csDestructionRecord.create({ data: { ref, containerId: c.id, locationId: c.locationId, csLogEntryId: entry.id, qty: toScale(qty2, "qty"), unit: c.labelUnit, method, form41Reference: String(args.form41Reference ?? "").trim().slice(0, 60), recordedById: staff.id, witnessAId: a.id, witnessBId: b.id, destroyedAt: uow.now } });
      const remaining = balance.minus(qty2);
      if (remaining.isZero()) await transition(uow, { model: "CsContainer", id: c.id, from: ["sealed", "open", "emptied", "quarantined"], to: "disposed", actor, eventType: "cs.container_disposed" });
      auditCreate(uow, actor, "CsDestructionRecord", rec.id, "cs.destroyed", { ref, container: c.ref, qty: plain(qty2), witnesses: [a.displayName, b.displayName] });
      return { id: rec.id, ref, status: remaining.isZero() ? "disposed" : "recorded" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function submitPdmp(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled", "canCountControlled"], tool: "cs.pdmp_submit", humanOnly: true }, args, async (actor) => {
    const confirmation = text16(args.confirmation, "confirmation", 100);
    const result = await command(context.prisma, { name: "cs.pdmp_submit", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const row = await transition(uow, { model: "PdmpReport", id: args.reportId, from: ["pending"], to: "submitted", expectedVersion: args.expectedVersion, actor, eventType: "cs.pdmp_submitted", reason: confirmation, data: { submittedAt: uow.now, submittedById: staff.id, confirmation } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/mutations/inventory.ts
var dateOnly2 = (value, field) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field });
  return /* @__PURE__ */ new Date(`${value}T00:00:00Z`);
};
var positive = (value, field) => {
  const t = decimalText(value, field);
  if (!dec(t).gt(0)) throw new DomainError(Codes.INVALID_INPUT, `${field} must be more than zero.`, { field });
  return t;
};
async function moveStock(uow, m) {
  return uow.tx.stockMovement.create({
    data: { itemId: m.itemId, lotId: m.lotId ?? null, stockLocationId: m.stockLocationId, kind: m.kind, qtySigned: toScale(dec(m.qtySigned), "qty"), unit: m.unit ?? null, sourceType: m.sourceType, sourceId: m.sourceId, reason: m.reason ?? "", actorId: m.actorId, occurredAt: uow.now }
  });
}
async function ensureItem(uow, input) {
  const found = await uow.tx.item.findFirst({ where: input.drugId ? { drugId: input.drugId } : { vaccineId: input.vaccineId }, select: { id: true } });
  if (found) return found.id;
  if (input.drugId) {
    const d = await uow.tx.drugProduct.findUniqueOrThrow({ where: { id: input.drugId }, select: { displayName: true, csSchedule: true, form: true } });
    if (d.csSchedule !== "none") throw new DomainError(Codes.GUARD_FAILED, "Controlled drugs are stocked through the controlled-substance register.");
    return (await uow.tx.item.create({ data: { ref: await nextReference(uow.tx, "ITM", uow.now), name: d.displayName, kind: "drug", drugId: input.drugId, baseUnit: "unit" } })).id;
  }
  const v = await uow.tx.vaccineProduct.findUniqueOrThrow({ where: { id: input.vaccineId }, select: { name: true } });
  return (await uow.tx.item.create({ data: { ref: await nextReference(uow.tx, "ITM", uow.now), name: v.name, kind: "vaccine", vaccineId: input.vaccineId, baseUnit: "dose", coldChain: true } })).id;
}
async function addStockLocation(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory"], tool: "stock.add_place", humanOnly: true }, args, async (actor) => {
    const name = text16(args.name, "name", 80);
    if (!["shelf", "fridge", "freezer", "cabinet", "controlled_cabinet", "vehicle"].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, "Choose the kind of place.", { field: "kind" });
    const cold = args.kind === "fridge" || args.kind === "freezer";
    if (cold && (!args.minTempC || !args.maxTempC)) throw new DomainError(Codes.INVALID_INPUT, "A fridge or freezer needs its allowed temperature range.", { field: "minTempC" });
    if (cold && !dec(args.minTempC).lt(dec(args.maxTempC))) throw new DomainError(Codes.INVALID_INPUT, "The lowest allowed temperature must be below the highest.", { field: "minTempC" });
    const result = await command(context.prisma, { name: "stock.add_place", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      await locationDay2(uow, args.locationId, uow.now);
      const row = await uow.tx.stockLocation.create({ data: { name, locationId: args.locationId, kind: args.kind, minTempC: cold ? toScale(dec(args.minTempC), "qty") : null, maxTempC: cold ? toScale(dec(args.maxTempC), "qty") : null } });
      auditCreate(uow, actor, "StockLocation", row.id, "stock.place_added", { name, kind: args.kind });
      return { id: row.id, status: "active" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function receiveStock(_root, args, context) {
  return gated(context, { permissions: ["canReceiveStock", "canManageInventory"], tool: "stock.receive_lot", humanOnly: true }, args, async (actor) => {
    const lotNumber = text16(args.lotNumber, "lotNumber", 60);
    const expiresOn = dateOnly2(args.expiresOn, "Expires");
    const quantity = positive(args.quantity, "quantity");
    if (!args.drugId === !args.vaccineId) throw new DomainError(Codes.INVALID_INPUT, "Choose a drug or a vaccine.");
    const result = await command(context.prisma, { name: "stock.receive_lot", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const place = await uow.tx.stockLocation.findUnique({ where: { id: args.stockLocationId }, select: { id: true, locationId: true, kind: true, active: true } });
      if (!place?.active || !place.locationId) throw new DomainError(Codes.NOT_FOUND, "That storage place is not available.");
      if (place.kind === "controlled_cabinet") throw new DomainError(Codes.GUARD_FAILED, "Controlled drugs are received through the controlled-substance register.");
      const { on } = await locationDay2(uow, place.locationId, uow.now);
      if (day3(expiresOn) <= on) throw new DomainError(Codes.GUARD_FAILED, "That lot is already expired.");
      const itemId = await ensureItem(uow, args);
      let lot = await uow.tx.inventoryLot.findFirst({ where: { locationId: place.locationId, lotNumber, drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null }, select: { id: true, expiresOn: true, status: true } });
      if (lot && lot.status !== "available") throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is ${lot.status} and cannot take more stock.`);
      if (lot && day3(lot.expiresOn) !== day3(expiresOn)) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is already here with a different expiry date.`);
      lot ??= await uow.tx.inventoryLot.create({ data: { drugId: args.drugId ?? null, vaccineId: args.vaccineId ?? null, locationId: place.locationId, lotNumber, expiresOn, status: "available" }, select: { id: true, expiresOn: true, status: true } });
      const mv = await moveStock(uow, { itemId, lotId: lot.id, stockLocationId: place.id, kind: "receive", qtySigned: quantity, unit: args.unit, sourceType: "receive", sourceId: lot.id, actorId: staff.id });
      auditCreate(uow, actor, "InventoryLot", lot.id, "stock.received", { lotNumber, quantity, stockLocationId: place.id, movementId: mv.id });
      return { id: lot.id, movementId: mv.id, status: "available" };
    });
    return { replay: result.replay, ...result.value };
  });
}
var day3 = (d) => d.toISOString().slice(0, 10);
async function adjustStock(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory", "canReceiveStock"], tool: "stock.adjust", humanOnly: true }, args, async (actor) => {
    const quantity = positive(args.quantity, "quantity");
    const reason = text16(args.reason, "reason", 200);
    if (reason.length < 4) throw new DomainError(Codes.INVALID_INPUT, "Say why (at least 4 characters).", { field: "reason" });
    if (args.kind !== "dispose" && args.kind !== "use") throw new DomainError(Codes.INVALID_INPUT, "Choose dispose or use.", { field: "kind" });
    const result = await command(context.prisma, { name: "stock.adjust", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const mv = await moveStock(uow, { itemId: args.itemId, lotId: args.lotId, stockLocationId: args.stockLocationId, kind: args.kind, qtySigned: `-${quantity}`, sourceType: "adjustment", sourceId: args.lotId ?? args.itemId, reason, actorId: staff.id });
      auditCreate(uow, actor, "StockMovement", mv.id, "stock.adjusted", { kind: args.kind, quantity, reason }, { reason });
      return { id: mv.id, status: "recorded" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function addSupplier(_root, args, context) {
  return gated(context, { permissions: ["canOrderStock", "canManageInventory"], tool: "supplier.create", humanOnly: true }, args, async (actor) => {
    const name = text16(args.name, "name", 100);
    const result = await command(context.prisma, { name: "supplier.create", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      if (await uow.tx.supplier.findFirst({ where: { name: { equals: name, mode: "insensitive" } }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, `${name} is already a supplier.`);
      const row = await uow.tx.supplier.create({ data: { name, accountNumber: String(args.accountNumber ?? "").trim().slice(0, 60), phone: String(args.phone ?? "").trim().slice(0, 40), email: String(args.email ?? "").trim().slice(0, 120), deaNumber: String(args.deaNumber ?? "").trim().slice(0, 20) } });
      auditCreate(uow, actor, "Supplier", row.id, "supplier.created", { name });
      return { id: row.id, status: "active" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function draftPurchaseOrder(_root, args, context) {
  return gated(context, { permissions: ["canOrderStock"], tool: "po.draft", humanOnly: true }, args, async (actor) => {
    if (!Array.isArray(args.lines) || !args.lines.length || args.lines.length > 60) throw new DomainError(Codes.INVALID_INPUT, "An order needs between one and sixty lines.", { field: "lines" });
    const result = await command(context.prisma, { name: "po.draft", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      await locationDay2(uow, args.locationId, uow.now);
      if (!await uow.tx.supplier.findFirst({ where: { id: args.supplierId, active: true }, select: { id: true } })) throw new DomainError(Codes.NOT_FOUND, "Supplier not found.");
      for (const l of args.lines) {
        positive(l.quantity, "quantity");
        if (!/^\d{1,9}$/.test(String(l.unitCostMinor))) throw new DomainError(Codes.INVALID_INPUT, "Cost is in whole cents.", { field: "unitCostMinor" });
        if (!await uow.tx.item.findFirst({ where: { id: l.itemId, active: true }, select: { id: true } })) throw new DomainError(Codes.NOT_FOUND, "An item on the order is not in the catalogue.");
      }
      const ref = await nextReference(uow.tx, "PO", uow.now);
      const row = await uow.tx.purchaseOrder.create({
        data: { ref, supplierId: args.supplierId, locationId: args.locationId, status: "draft", orderedById: staff.id, note: String(args.note ?? "").slice(0, 300), lines: { create: args.lines.map((l) => ({ itemId: l.itemId, qtyOrdered: toScale(dec(l.quantity), "qty"), qtyReceived: "0", unit: l.unit ?? null, unitCostMinor: BigInt(l.unitCostMinor) })) } }
      });
      auditCreate(uow, actor, "PurchaseOrder", row.id, "po.drafted", { ref, lines: args.lines.length });
      return { id: row.id, ref, status: "draft", version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function submitPurchaseOrder(_root, args, context) {
  return gated(context, { permissions: ["canOrderStock", "canApprovePurchase"], tool: "po.submit", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "po.submit", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const lines = await uow.tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: args.orderId }, select: { qtyOrdered: true, unitCostMinor: true } });
      if (!lines.length) throw new DomainError(Codes.GUARD_FAILED, "The order has no lines.");
      const row = await transition(uow, { model: "PurchaseOrder", id: args.orderId, from: ["draft"], to: "submitted", expectedVersion: args.expectedVersion, actor, eventType: "po.submitted", data: { orderedAt: uow.now, approvedById: staff.id } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function cancelPurchaseOrder(_root, args, context) {
  return gated(context, { permissions: ["canOrderStock", "canApprovePurchase"], tool: "po.cancel", humanOnly: true }, args, async (actor) => {
    const reason = text16(args.reason, "reason", 200);
    const result = await command(context.prisma, { name: "po.cancel", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "PurchaseOrder", id: args.orderId, from: ["draft", "submitted"], to: "cancelled", expectedVersion: args.expectedVersion, actor, eventType: "po.cancelled", reason });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function receivePurchaseOrder(_root, args, context) {
  return gated(context, { permissions: ["canReceiveStock"], tool: "po.receive", humanOnly: true }, args, async (actor) => {
    if (!Array.isArray(args.lines) || !args.lines.length) throw new DomainError(Codes.INVALID_INPUT, "Enter what arrived.", { field: "lines" });
    const result = await command(context.prisma, { name: "po.receive", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const po = await lockRow(uow.tx, "PurchaseOrder", args.orderId);
      if (!["submitted", "partially_received"].includes(po.status)) throw new DomainError(Codes.INVALID_TRANSITION, `${po.ref} is ${po.status.replaceAll("_", " ")}; it cannot be received.`);
      const place = await uow.tx.stockLocation.findUnique({ where: { id: args.stockLocationId }, select: { id: true, locationId: true, kind: true, active: true } });
      if (!place?.active || place.locationId !== po.locationId) throw new DomainError(Codes.GUARD_FAILED, "Choose a storage place at the ordering location.");
      const { on } = await locationDay2(uow, po.locationId, uow.now);
      const receiptRef = await nextReference(uow.tx, "GRN", uow.now);
      const receipt = await uow.tx.goodsReceipt.create({ data: { ref: receiptRef, purchaseOrderId: po.id, locationId: po.locationId, receivedById: staff.id, receivedAt: uow.now, packingSlip: String(args.packingSlip ?? "").trim().slice(0, 60) } });
      for (const l of args.lines) {
        const qty2 = positive(l.quantity, "quantity");
        const line = await lockRow(uow.tx, "PurchaseOrderLine", l.lineId);
        if (line.purchaseOrderId !== po.id) throw new DomainError(Codes.GUARD_FAILED, "A line does not belong to this order.");
        const remaining = dec(String(line.qtyOrdered)).minus(dec(String(line.qtyReceived)));
        if (dec(qty2).gt(remaining)) throw new DomainError(Codes.GUARD_FAILED, `Only ${plain(remaining)} more of that line is expected.`);
        const expiresOn = dateOnly2(l.expiresOn, "Expires");
        if (day3(expiresOn) <= on) throw new DomainError(Codes.GUARD_FAILED, `Lot ${l.lotNumber} is already expired; refuse it at the door.`);
        const item = await uow.tx.item.findUniqueOrThrow({ where: { id: line.itemId }, select: { drugId: true, vaccineId: true } });
        const lotNumber = text16(l.lotNumber, "lotNumber", 60);
        let lot = await uow.tx.inventoryLot.findFirst({ where: { locationId: po.locationId, lotNumber, drugId: item.drugId, vaccineId: item.vaccineId }, select: { id: true, expiresOn: true } });
        if (lot && day3(lot.expiresOn) !== day3(expiresOn)) throw new DomainError(Codes.GUARD_FAILED, `Lot ${lotNumber} is already here with a different expiry date.`);
        lot ??= await uow.tx.inventoryLot.create({ data: { drugId: item.drugId, vaccineId: item.vaccineId, locationId: po.locationId, lotNumber, expiresOn, status: "available" }, select: { id: true, expiresOn: true } });
        await moveStock(uow, { itemId: line.itemId, lotId: lot.id, stockLocationId: place.id, kind: "receive", qtySigned: qty2, unit: line.unit, sourceType: "goods_receipt", sourceId: receipt.id, actorId: staff.id });
        await uow.tx.goodsReceiptLine.create({ data: { receiptId: receipt.id, purchaseOrderLineId: line.id, itemId: line.itemId, lotId: lot.id, qty: toScale(dec(qty2), "qty"), unit: line.unit ?? null } });
        await uow.tx.purchaseOrderLine.update({ where: { id: line.id }, data: { qtyReceived: toScale(dec(String(line.qtyReceived)).plus(dec(qty2)), "qty") } });
      }
      const all = await uow.tx.purchaseOrderLine.findMany({ where: { purchaseOrderId: po.id }, select: { qtyOrdered: true, qtyReceived: true } });
      const done = all.every((l) => dec(l.qtyReceived.toString()).gte(dec(l.qtyOrdered.toString())));
      await transition(uow, { model: "PurchaseOrder", id: po.id, from: ["submitted", "partially_received"], to: done ? "received" : "partially_received", actor, eventType: "po.received" });
      auditCreate(uow, actor, "GoodsReceipt", receipt.id, "po.goods_received", { ref: receiptRef, order: po.ref, lines: args.lines.length });
      return { id: receipt.id, ref: receiptRef, status: done ? "received" : "partially_received" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function setReorderRule(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory"], tool: "stock.reorder_rule", humanOnly: true }, args, async (actor) => {
    const minQty = decimalText(args.minQty, "minQty");
    const targetQty = positive(args.targetQty, "targetQty");
    if (!dec(targetQty).gt(dec(minQty))) throw new DomainError(Codes.INVALID_INPUT, "The target must be above the re-order point.", { field: "targetQty" });
    const result = await command(context.prisma, { name: "stock.reorder_rule", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      await locationDay2(uow, args.locationId, uow.now);
      const existing = await uow.tx.reorderRule.findFirst({ where: { itemId: args.itemId, locationId: args.locationId }, select: { id: true } });
      const data = { minQty: toScale(dec(minQty), "qty"), targetQty: toScale(dec(targetQty), "qty") };
      const row = existing ? await uow.tx.reorderRule.update({ where: { id: existing.id }, data }) : await uow.tx.reorderRule.create({ data: { itemId: args.itemId, locationId: args.locationId, ...data } });
      auditCreate(uow, actor, "ReorderRule", row.id, "stock.reorder_rule_set", { minQty, targetQty });
      return { id: row.id, status: "active" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function countStock(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory", "canReceiveStock"], tool: "stock.count", humanOnly: true }, args, async (actor) => {
    if (!Array.isArray(args.counts) || !args.counts.length || args.counts.length > 300) throw new DomainError(Codes.INVALID_INPUT, "Enter at least one counted amount.", { field: "counts" });
    const result = await command(context.prisma, { name: "stock.count", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const place = await uow.tx.stockLocation.findUnique({ where: { id: args.stockLocationId }, select: { id: true, locationId: true } });
      if (!place) throw new DomainError(Codes.NOT_FOUND, "Storage place not found.");
      const ref = await nextReference(uow.tx, "SCN", uow.now);
      const count = await uow.tx.stockCount.create({ data: { ref, locationId: place.locationId, stockLocationId: place.id, status: "closed", countedById: staff.id, countedAt: uow.now } });
      let variances = 0;
      for (const c of args.counts) {
        const counted = dec(decimalText(c.countedQty, "countedQty"));
        const level = await uow.tx.stockLevel.findFirst({ where: { itemId: c.itemId, lotId: c.lotId ?? null, stockLocationId: place.id }, select: { onHand: true } });
        const expected = dec(level?.onHand?.toString() ?? "0");
        const variance = counted.minus(expected);
        await uow.tx.stockCountLine.create({ data: { countId: count.id, itemId: c.itemId, lotId: c.lotId ?? null, expectedQty: toScale(expected, "qty"), countedQty: toScale(counted, "qty"), variance: toScale(variance, "qty") } });
        if (!variance.isZero()) {
          variances += 1;
          await moveStock(uow, { itemId: c.itemId, lotId: c.lotId, stockLocationId: place.id, kind: "count", qtySigned: plain(variance), sourceType: "stock_count", sourceId: count.id, reason: `Count ${ref}`, actorId: staff.id });
        }
      }
      auditCreate(uow, actor, "StockCount", count.id, "stock.counted", { ref, lines: args.counts.length, variances });
      return { id: count.id, ref, status: "closed", variances };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function openRecall(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory"], tool: "recall.open", humanOnly: true }, args, async (actor) => {
    const lotNumber = text16(args.lotNumber, "lotNumber", 60);
    const title = text16(args.title, "title", 160);
    const result = await command(context.prisma, { name: "recall.open", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const item = await uow.tx.item.findUnique({ where: { id: args.itemId }, select: { id: true, drugId: true, vaccineId: true } });
      if (!item) throw new DomainError(Codes.NOT_FOUND, "Item not found.");
      if (await uow.tx.recallCase.findFirst({ where: { itemId: item.id, lotNumber, status: "open" }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, "A recall for that lot is already open.");
      const ref = await nextReference(uow.tx, "RCL", uow.now);
      const recall = await uow.tx.recallCase.create({ data: { ref, title, source: String(args.source ?? "").slice(0, 120), itemId: item.id, lotNumber, status: "open", openedAt: uow.now } });
      const lots = await uow.tx.inventoryLot.findMany({ where: { lotNumber, drugId: item.drugId, vaccineId: item.vaccineId }, select: { id: true, status: true } });
      const lotIds = lots.map((l) => l.id);
      let quarantined = 0;
      for (const l of lots.filter((x) => x.status === "available")) {
        await transition(uow, { model: "InventoryLot", id: l.id, from: ["available"], to: "quarantined", actor, eventType: "stock.quarantined", reason: `Recall ${ref}`, data: { quarantineReason: `Recall ${ref}: ${title}` } });
        quarantined += 1;
      }
      const exposures = [];
      for (const d of await uow.tx.dispense.findMany({ where: { lotId: { in: lotIds } }, select: { id: true, patientId: true, clientId: true, dispensedAt: true } })) exposures.push({ patientId: d.patientId, clientId: d.clientId, sourceType: "dispense", sourceId: d.id, givenOn: d.dispensedAt });
      for (const a of await uow.tx.administration.findMany({ where: { lotId: { in: lotIds }, reversesId: null }, select: { id: true, patientId: true, givenAt: true } })) exposures.push({ patientId: a.patientId, clientId: null, sourceType: "administration", sourceId: a.id, givenOn: a.givenAt });
      for (const v of await uow.tx.vaccineAdministration.findMany({ where: { lotId: { in: lotIds }, reversesId: null }, select: { id: true, patientId: true, administeredOn: true } })) exposures.push({ patientId: v.patientId, clientId: null, sourceType: "vaccine", sourceId: v.id, givenOn: v.administeredOn });
      for (const e of exposures) {
        const clientId = e.clientId ?? (e.patientId ? (await uow.tx.patientOwnership.findFirst({ where: { patientId: e.patientId, effectiveTo: null, role: "primary" }, select: { clientId: true } }))?.clientId ?? null : null);
        await uow.tx.recallExposure.create({ data: { recallId: recall.id, patientId: e.patientId, clientId, sourceType: e.sourceType, sourceId: e.sourceId, givenOn: e.givenOn, status: "to_contact" } });
      }
      auditCreate(uow, actor, "RecallCase", recall.id, "recall.opened", { ref, lotNumber, quarantined, exposures: exposures.length });
      return { id: recall.id, ref, status: "open", quarantinedLots: quarantined, exposures: exposures.length };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function markRecallExposure(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory"], tool: "recall.exposure", humanOnly: true }, args, async (actor) => {
    if (args.status !== "contacted" && args.status !== "resolved") throw new DomainError(Codes.INVALID_INPUT, "Choose contacted or resolved.", { field: "status" });
    const result = await command(context.prisma, { name: "recall.exposure", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "RecallExposure", id: args.exposureId, from: args.status === "contacted" ? ["to_contact"] : ["to_contact", "contacted"], to: args.status, expectedVersion: args.expectedVersion, actor, eventType: "recall.exposure_updated", data: { note: String(args.note ?? "").slice(0, 300) } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function closeRecall(_root, args, context) {
  return gated(context, { permissions: ["canManageInventory"], tool: "recall.close", humanOnly: true }, args, async (actor) => {
    const resolution = text16(args.resolution, "resolution", 300);
    const result = await command(context.prisma, { name: "recall.close", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const open = await uow.tx.recallExposure.count({ where: { recallId: args.recallId, status: { not: "resolved" } } });
      if (open) throw new DomainError(Codes.GUARD_FAILED, `${open} ${open === 1 ? "patient has" : "patients have"} not been marked resolved.`);
      const row = await transition(uow, { model: "RecallCase", id: args.recallId, from: ["open"], to: "closed", expectedVersion: args.expectedVersion, actor, eventType: "recall.closed", reason: resolution, data: { closedAt: uow.now, resolution } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function logTemperature(_root, args, context) {
  return gated(context, { permissions: ["canReceiveStock", "canManageInventory", "canAdminister"], tool: "temperature.log", humanOnly: true }, args, async (actor) => {
    if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(String(args.readingC ?? "").trim())) throw new DomainError(Codes.INVALID_INPUT, "Temperature: a number like 4.2", { field: "readingC" });
    const result = await command(context.prisma, { name: "temperature.log", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const place = await lockRow(uow.tx, "StockLocation", args.stockLocationId);
      if (!["fridge", "freezer"].includes(place.kind) || place.minTempC === null || place.maxTempC === null) throw new DomainError(Codes.GUARD_FAILED, `${place.name} is not a fridge or freezer.`);
      const reading = dec(args.readingC.trim());
      const inRange = reading.gte(dec(String(place.minTempC))) && reading.lte(dec(String(place.maxTempC)));
      const log = await uow.tx.temperatureLog.create({ data: { stockLocationId: place.id, readingC: toScale(reading, "qty"), inRange, recordedById: staff.id, recordedAt: uow.now } });
      let excursionId = null;
      let quarantined = 0;
      if (!inRange) {
        const openOne = await uow.tx.temperatureExcursion.findFirst({ where: { stockLocationId: place.id, status: "open" }, select: { id: true } });
        if (openOne) excursionId = openOne.id;
        else {
          const ref = await nextReference(uow.tx, "TEX", uow.now);
          const ex = await uow.tx.temperatureExcursion.create({ data: { ref, stockLocationId: place.id, logId: log.id, status: "open", openedAt: uow.now } });
          excursionId = ex.id;
        }
        const levels = await uow.tx.stockLevel.findMany({ where: { stockLocationId: place.id, onHand: { gt: 0 }, lotId: { not: null }, lot: { status: "available" }, item: { coldChain: true } }, select: { lotId: true } });
        for (const lotId of [...new Set(levels.map((l) => l.lotId))]) {
          await transition(uow, { model: "InventoryLot", id: lotId, from: ["available"], to: "quarantined", actor, eventType: "stock.quarantined", reason: `Fridge out of range (${plain(reading)} \xB0C)`, data: { quarantineReason: `${place.name} read ${plain(reading)} \xB0C, outside ${plain(dec(String(place.minTempC)))} to ${plain(dec(String(place.maxTempC)))} \xB0C` } });
          quarantined += 1;
        }
        await uow.tx.temperatureExcursion.update({ where: { id: excursionId }, data: { quarantinedLots: { increment: quarantined } } });
        auditCreate(uow, actor, "TemperatureExcursion", excursionId, "temperature.excursion", { place: place.name, readingC: plain(reading), quarantined });
      }
      return { id: log.id, status: inRange ? "in_range" : "excursion", excursionId, quarantinedLots: quarantined };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function resolveExcursion(_root, args, context) {
  return gated(context, { permissions: ["canReleaseQuarantine", "canManageInventory"], tool: "temperature.resolve", humanOnly: true }, args, async (actor) => {
    const resolution = text16(args.resolution, "resolution", 300);
    const result = await command(context.prisma, { name: "temperature.resolve", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "TemperatureExcursion", id: args.excursionId, from: ["open"], to: "resolved", expectedVersion: args.expectedVersion, actor, eventType: "temperature.resolved", reason: resolution, data: { resolvedAt: uow.now, resolution } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/lib/asap.ts
var SPECIES2 = { canine: "02", feline: "03", equine: "04", other: "99" };
var asapSpeciesCode = (species) => SPECIES2[species.toLowerCase()] ?? "99";
var clean = (value) => String(value).replace(/[*~\r\n]/g, " ").trim();
var ymd = (iso) => iso.slice(0, 10).replaceAll("-", "");
var segment = (name, ...fields) => `${name}*${fields.map(clean).join("*")}~`;
function buildAsapFile(file) {
  const out = [];
  out.push(segment("TH", "4.2", file.controlNumber, "01", "", file.createdDate, file.createdTime, "P", "~"));
  out.push(segment("IS", file.senderDea, file.senderName, `${file.pharmacyName} controlled-substance dispensing report`));
  out.push(segment("PHA", "", file.pharmacyDea, "", file.pharmacyName, file.pharmacyAddress, "", file.pharmacyCity, file.pharmacyState, file.pharmacyPostal));
  for (const d of file.dispenses) {
    out.push(segment("PAT", "", "", "", d.ownerLastName, d.ownerFirstName, "", "", "", d.ownerAddress, "", d.ownerCity, d.ownerState, d.ownerPostal, "", "", "", "", "", asapSpeciesCode(d.species), d.animalName));
    out.push(segment("DSP", "00", d.rxNumber, ymd(d.dateWritten), d.refillsAuthorised, ymd(d.dateFilled), d.refillNumber, "01", d.ndc, d.quantity, d.daysSupply, "", "", "", "", d.schedule));
    out.push(segment("PRE", "", d.prescriberDea, "", d.prescriberLastName, d.prescriberFirstName));
  }
  const count = out.length + 1;
  out.push(segment("TT", file.controlNumber, count));
  return out.join("\n") + "\n";
}

// features/keystone/domain/discrepancy.ts
var ORDER_FORM_VALID_DAYS = 60;
var orderFormExpiry = (issuedOn) => addDays(issuedOn, ORDER_FORM_VALID_DAYS);

// features/keystone/mutations/register.ts
var ymd2 = (value, field) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw new DomainError(Codes.INVALID_INPUT, `${field}: use YYYY-MM-DD.`, { field });
  return value;
};
var asDate = (v) => /* @__PURE__ */ new Date(`${v}T00:00:00Z`);
async function issueOrderForm(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled", "canReceiveControlled"], tool: "cs.order_form", humanOnly: true }, args, async (actor) => {
    const formNumber = text16(args.formNumber, "formNumber", 40);
    const issuedOn = ymd2(args.issuedOn, "Issued");
    if (!["form_222", "csos"].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, "Choose Form 222 or CSOS.", { field: "kind" });
    if (!Array.isArray(args.lines) || !args.lines.length || args.lines.length > 20) throw new DomainError(Codes.INVALID_INPUT, "A form lists between one and twenty drugs.", { field: "lines" });
    const result = await command(context.prisma, { name: "cs.order_form", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const { on } = await locationDay2(uow, args.locationId, uow.now);
      if (issuedOn > on) throw new DomainError(Codes.GUARD_FAILED, "A form cannot be issued in the future.");
      const supplier = await uow.tx.supplier.findFirst({ where: { id: args.supplierId, active: true }, select: { id: true } });
      if (!supplier) throw new DomainError(Codes.NOT_FOUND, "Supplier not found.");
      for (const l of args.lines) {
        if (!Number.isInteger(l.packages) || l.packages < 1 || l.packages > 1e3) throw new DomainError(Codes.INVALID_INPUT, "Packages: a whole number from 1 to 1000.", { field: "packages" });
        const p = await uow.tx.drugProduct.findUnique({ where: { id: l.productId }, select: { csSchedule: true } });
        if (!p || p.csSchedule !== "CII" && p.csSchedule !== "CIIN") throw new DomainError(Codes.GUARD_FAILED, "Only Schedule II drugs are ordered on a Form 222 or CSOS.");
        await requireDeaRegistration(uow.tx, { locationId: args.locationId, schedule: p.csSchedule, at: uow.now, action: "order_controlled", actorStaffMemberId: staff.id });
      }
      if (await uow.tx.csOrderForm.findFirst({ where: { supplierId: args.supplierId, formNumber }, select: { id: true } })) throw new DomainError(Codes.GUARD_FAILED, `Form ${formNumber} has already been recorded for that supplier.`);
      const ref = await nextReference(uow.tx, "OF", uow.now);
      const row = await uow.tx.csOrderForm.create({
        data: { ref, formNumber, kind: args.kind, locationId: args.locationId, supplierId: args.supplierId, issuedOn: asDate(issuedOn), expiresOn: asDate(orderFormExpiry(issuedOn)), status: "open", signedById: staff.id, lines: { create: args.lines.map((l) => ({ productId: l.productId, packages: l.packages, packagesReceived: 0 })) } }
      });
      auditCreate(uow, actor, "CsOrderForm", row.id, "cs.order_form_issued", { ref, formNumber, expiresOn: orderFormExpiry(issuedOn) });
      return { id: row.id, ref, status: "open", version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function receiveOnOrderForm(_root, args, context) {
  return gated(context, { permissions: ["canReceiveControlled"], tool: "cs.receive_on_form", humanOnly: true }, args, async (actor) => {
    const lotNumber = text16(args.lotNumber, "lotNumber", 60);
    const lotExpiresOn = ymd2(args.lotExpiresOn, "Expires");
    const labelQty = decimalText(args.labelQty, "labelQty");
    if (!dec(labelQty).gt(0)) throw new DomainError(Codes.INVALID_INPUT, "Quantity must be more than zero.", { field: "labelQty" });
    const result = await command(context.prisma, { name: "cs.receive_on_form", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const line = await lockRow(uow.tx, "CsOrderFormLine", args.lineId);
      const form = await uow.tx.csOrderForm.findUnique({ where: { id: line.orderFormId }, select: { id: true, ref: true, formNumber: true, status: true, locationId: true, expiresOn: true, version: true } });
      if (!form || !["open", "partially_filled"].includes(form.status)) throw new DomainError(Codes.GUARD_FAILED, `That order form is ${form?.status.replaceAll("_", " ") ?? "missing"}.`);
      const { on } = await locationDay2(uow, form.locationId, uow.now);
      if (form.expiresOn.toISOString().slice(0, 10) < on) throw new DomainError(Codes.GUARD_FAILED, `Form ${form.formNumber} expired on ${form.expiresOn.toISOString().slice(0, 10)}; it is valid for 60 days.`);
      if (line.packagesReceived >= line.packages) throw new DomainError(Codes.GUARD_FAILED, "Every package on that line has arrived.");
      const product = await uow.tx.drugProduct.findUniqueOrThrow({ where: { id: line.productId }, select: { id: true, csSchedule: true } });
      const reg = await requireDeaRegistration(uow.tx, { locationId: form.locationId, schedule: product.csSchedule, at: uow.now, action: "receive_controlled", actorStaffMemberId: staff.id });
      const loc = await uow.tx.location.findUniqueOrThrow({ where: { id: form.locationId }, select: { code: true } });
      const ref = `CSC-${loc.code.toUpperCase()}-${(await nextReference(uow.tx, "CSB", uow.now)).slice(-6)}`;
      const container = await uow.tx.csContainer.create({ data: { ref, productId: product.id, locationId: form.locationId, deaRegistrationId: reg.deaRegistrationId, lotNumber, lotExpiresOn: asDate(lotExpiresOn), status: "sealed", labelQty: toScale(dec(labelQty), "qty"), labelUnit: args.labelUnit } });
      const entry = await appendCsEntry(uow.tx, { containerId: container.id, type: "receive", qtySigned: labelQty, unit: args.labelUnit, occurredAt: uow.now, actorId: staff.id, reason: `Received on order ${form.formNumber}` }, uow.now);
      await uow.tx.csOrderFormLine.update({ where: { id: line.id }, data: { packagesReceived: { increment: 1 } } });
      const lines = await uow.tx.csOrderFormLine.findMany({ where: { orderFormId: form.id }, select: { packages: true, packagesReceived: true } });
      const done = lines.every((l) => l.packagesReceived >= l.packages);
      await transition(uow, { model: "CsOrderForm", id: form.id, from: ["open", "partially_filled"], to: done ? "filled" : "partially_filled", actor, eventType: "cs.order_form_received" });
      auditCreate(uow, actor, "CsContainer", container.id, "cs.received", { ref, form: form.formNumber, entry: entry.ref });
      return { id: container.id, ref, status: done ? "filled" : "partially_filled" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function transferControlled(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled", "canReceiveControlled"], tool: "cs.transfer", humanOnly: true }, args, async (actor) => {
    const qty2 = decimalText(args.qty, "qty");
    if (!dec(qty2).gt(0)) throw new DomainError(Codes.INVALID_INPUT, "Quantity must be more than zero.", { field: "qty" });
    const result = await command(context.prisma, { name: "cs.transfer", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const witness = await witnessFor(uow, args.witnessId, staff.id);
      const c = await lockRow(uow.tx, "CsContainer", args.containerId);
      if (c.status !== "open" && c.status !== "sealed") throw new DomainError(Codes.GUARD_FAILED, `${c.ref} is ${c.status}.`);
      if (args.toRegistrationId === c.deaRegistrationId) throw new DomainError(Codes.GUARD_FAILED, "Choose a different registrant to send it to.");
      const to = await uow.tx.deaRegistration.findUnique({ where: { id: args.toRegistrationId }, select: { id: true, status: true, registrantName: true, expiresOn: true } });
      if (!to || to.status !== "active" || to.expiresOn < uow.now) throw new DomainError(Codes.GUARD_FAILED, "The receiving registration is not current.");
      const balance = await containerBalance(uow.tx, c.id);
      if (balance.lt(dec(qty2))) throw new DomainError(Codes.GUARD_FAILED, `${c.ref} has ${balance.toString()} ${c.labelUnit} left; that is not enough.`);
      const entry = await appendCsEntry(uow.tx, { containerId: c.id, type: "transfer_out", qtySigned: dec(qty2).neg(), unit: c.labelUnit, occurredAt: uow.now, actorId: staff.id, witnessId: witness.id, reason: `Sent to ${to.registrantName}` }, uow.now);
      await uow.tx.csWitness.create({ data: { entryId: entry.id, witnessId: witness.id, attestedAt: uow.now } });
      const ref = await nextReference(uow.tx, "CST", uow.now);
      const row = await uow.tx.csTransfer.create({ data: { ref, fromContainerId: c.id, toRegistrationId: to.id, qty: toScale(dec(qty2), "qty"), unit: c.labelUnit, status: "sent", outEntryId: entry.id, sentById: staff.id, witnessId: witness.id, sentAt: uow.now } });
      auditCreate(uow, actor, "CsTransfer", row.id, "cs.transferred", { ref, container: c.ref, qty: qty2, to: to.registrantName, witness: witness.displayName });
      return { id: row.id, ref, status: "sent", version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function confirmTransfer(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled"], tool: "cs.transfer_confirm", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "cs.transfer_confirm", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const row = await transition(uow, { model: "CsTransfer", id: args.transferId, from: ["sent"], to: "received", expectedVersion: args.expectedVersion, actor, eventType: "cs.transfer_received", data: { receivedAt: uow.now } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function logCabinetAccess(_root, args, context) {
  return gated(context, { permissions: ["canAdministerControlled", "canManageControlled", "canCountControlled"], tool: "cs.cabinet", humanOnly: true }, args, async (actor) => {
    if (!["opened", "closed", "failed_attempt"].includes(args.kind)) throw new DomainError(Codes.INVALID_INPUT, "Choose opened, closed or failed attempt.", { field: "kind" });
    const result = await command(context.prisma, { name: "cs.cabinet", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      await locationDay2(uow, args.locationId, uow.now);
      const row = await uow.tx.cabinetAccessEvent.create({ data: { locationId: args.locationId, staffId: staff.id, kind: args.kind, note: String(args.note ?? "").slice(0, 200), occurredAt: uow.now } });
      return { id: row.id, status: args.kind };
    });
    return { replay: result.replay, ...result.value };
  });
}
var lastName = (full) => full.trim().split(/\s+/).slice(-1)[0] ?? "";
var firstName = (full) => full.trim().split(/\s+/).slice(0, -1).join(" ");
async function generatePdmpFile(_root, args, context) {
  return gated(context, { permissions: ["canManageControlled", "canCountControlled"], tool: "cs.pdmp_file", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "cs.pdmp_file", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const location = await uow.tx.location.findUnique({ where: { id: args.locationId }, select: { id: true, name: true, addressLine1: true, city: true, stateCode: true, postalCode: true } });
      if (!location) throw new DomainError(Codes.NOT_FOUND, "Location not found.");
      const reports = await uow.tx.pdmpReport.findMany({ where: { locationId: location.id, status: "pending", submissionId: null }, orderBy: { createdAt: "asc" }, take: 500, select: { id: true, ref: true, dispenseId: true } });
      if (!reports.length) throw new DomainError(Codes.GUARD_FAILED, "Nothing is waiting to be reported.");
      const reg = await uow.tx.deaRegistration.findFirst({ where: { locationId: location.id, status: "active" }, select: { registrationNumber: true } });
      const rows = [];
      for (const r of reports) {
        const d = await uow.tx.dispense.findUnique({
          where: { id: r.dispenseId },
          select: { ref: true, quantity: true, refillNumber: true, dispensedAt: true, product: { select: { ndc: true, csSchedule: true } }, client: { select: { displayName: true, addressLine1: true, city: true, stateCode: true, postalCode: true } }, patient: { select: { name: true, species: { select: { code: true } } } }, prescription: { select: { ref: true, issuedAt: true, prescriber: { select: { displayName: true } }, deaRegistration: { select: { registrationNumber: true } } } }, line: { select: { refillsAuthorised: true } } }
        });
        if (!d) continue;
        rows.push({
          rxNumber: d.prescription?.ref ?? d.ref,
          dateWritten: d.prescription?.issuedAt.toISOString() ?? d.dispensedAt.toISOString(),
          refillsAuthorised: d.line?.refillsAuthorised ?? 0,
          dateFilled: d.dispensedAt.toISOString(),
          refillNumber: d.refillNumber,
          ndc: d.product?.ndc ?? "",
          quantity: d.quantity.toString(),
          daysSupply: 0,
          schedule: d.product?.csSchedule ?? "",
          ownerLastName: lastName(d.client?.displayName ?? ""),
          ownerFirstName: firstName(d.client?.displayName ?? ""),
          ownerAddress: d.client?.addressLine1 ?? "",
          ownerCity: d.client?.city ?? "",
          ownerState: d.client?.stateCode ?? "",
          ownerPostal: d.client?.postalCode ?? "",
          species: d.patient?.species?.code ?? "other",
          animalName: d.patient?.name ?? "",
          prescriberDea: d.prescription?.deaRegistration?.registrationNumber ?? "",
          prescriberLastName: lastName(d.prescription?.prescriber?.displayName ?? ""),
          prescriberFirstName: firstName(d.prescription?.prescriber?.displayName ?? "")
        });
      }
      const ref = await nextReference(uow.tx, "PDS", uow.now);
      const iso = uow.now.toISOString();
      const body = buildAsapFile({ controlNumber: ref, createdDate: iso.slice(0, 10).replaceAll("-", ""), createdTime: iso.slice(11, 19).replaceAll(":", ""), senderDea: reg?.registrationNumber ?? "", senderName: location.name, pharmacyDea: reg?.registrationNumber ?? "", pharmacyName: location.name, pharmacyAddress: location.addressLine1, pharmacyCity: location.city, pharmacyState: location.stateCode, pharmacyPostal: location.postalCode, dispenses: rows });
      const sub = await uow.tx.pdmpSubmission.create({ data: { ref, locationId: location.id, format: "ASAP 4.2B", reportCount: reports.length, fileSha256: sha256(body), fileBody: { text: body }, generatedById: staff.id, generatedAt: uow.now } });
      await uow.tx.pdmpReport.updateMany({ where: { id: { in: reports.map((r) => r.id) } }, data: { submissionId: sub.id } });
      auditCreate(uow, actor, "PdmpSubmission", sub.id, "cs.pdmp_file_generated", { ref, reports: reports.length, sha256: sha256(body) });
      return { id: sub.id, ref, status: "generated", reports: reports.length };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function printDispenseLabel(_root, args, context) {
  return gated(context, { permissions: ["canDispense", "canFulfilRefill"], tool: "rx.print_label", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "rx.print_label", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const d = await uow.tx.dispense.findUnique({ where: { id: args.dispenseId }, select: { id: true, ref: true, label: true } });
      if (!d) throw new DomainError(Codes.NOT_FOUND, "Dispense not found.");
      const row = await uow.tx.dispenseLabel.create({ data: { dispenseId: d.id, fields: d.label ?? {}, printedById: staff.id, printedAt: uow.now } });
      return { id: row.id, status: "printed" };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function requestExternalFill(_root, args, context) {
  return gated(context, { permissions: ["canFulfilRefill", "canDispense"], tool: "rx.external_request", humanOnly: true }, args, async (actor) => {
    const pharmacyName = text16(args.pharmacyName, "pharmacyName", 100);
    const result = await command(context.prisma, { name: "rx.external_request", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const rx = await uow.tx.prescription.findUnique({ where: { id: args.prescriptionId }, select: { id: true, status: true, patientId: true, lines: { select: { csSchedule: true } } } });
      if (!rx || rx.status === "void") throw new DomainError(Codes.NOT_FOUND, "Prescription not found.");
      if (rx.lines.some((l) => l.csSchedule !== "none")) throw new DomainError(Codes.GUARD_FAILED, "A controlled prescription is not sent to an outside pharmacy from here.");
      const ref = await nextReference(uow.tx, "EXT", uow.now);
      const row = await uow.tx.externalDispense.create({ data: { ref, prescriptionId: rx.id, patientId: rx.patientId, pharmacyName, orderReference: String(args.orderReference ?? "").slice(0, 60), status: "requested" } });
      auditCreate(uow, actor, "ExternalDispense", row.id, "rx.external_requested", { ref, pharmacyName });
      return { id: row.id, ref, status: "requested", version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function decideExternalFill(_root, args, context) {
  return gated(context, { permissions: ["canManageRefills", "canFulfilRefill"], tool: "rx.external_decide", humanOnly: true }, args, async (actor) => {
    if (!["approved", "declined", "filled"].includes(args.status)) throw new DomainError(Codes.INVALID_INPUT, "Choose approved, declined or filled.", { field: "status" });
    const result = await command(context.prisma, { name: "rx.external_decide", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const from = args.status === "filled" ? ["approved"] : ["requested"];
      const row = await transition(uow, { model: "ExternalDispense", id: args.externalId, from, to: args.status, expectedVersion: args.expectedVersion, actor, eventType: "rx.external_decided", reason: String(args.note ?? "").slice(0, 200) || null, data: { decidedById: staff.id, decidedAt: uow.now, note: String(args.note ?? "").slice(0, 200) } });
      return { id: row.id, status: row.status, version: row.version };
    });
    return { replay: result.replay, ...result.value };
  });
}
async function exportWrittenRx(_root, args, context) {
  return gated(context, { permissions: ["canPrescribe", "canDispense"], tool: "rx.export_written", humanOnly: true }, args, async (actor) => {
    const result = await command(context.prisma, { name: "rx.export_written", actor, idempotencyKey: args.idempotencyKey, params: args }, async (uow) => {
      const staff = await staffOf(uow, actor);
      const rx = await uow.tx.prescription.findUnique({ where: { id: args.prescriptionId }, select: { id: true, ref: true, status: true, issuedAt: true, patient: { select: { name: true } }, prescriber: { select: { displayName: true } }, lines: { select: { directions: true, quantity: true, refillsAuthorised: true, product: { select: { displayName: true, csSchedule: true } } } } } });
      if (!rx || rx.status === "void") throw new DomainError(Codes.NOT_FOUND, "Prescription not found.");
      if (rx.lines.some((l) => l.product?.csSchedule && l.product.csSchedule !== "none")) throw new DomainError(Codes.GUARD_FAILED, "A controlled prescription cannot be handed over on paper from here.");
      const hash2 = sha256(canonicalJson({ ref: rx.ref, lines: rx.lines.map((l) => [l.product?.displayName, l.directions, l.quantity.toString(), l.refillsAuthorised]) }));
      const existing = await uow.tx.writtenRxExport.findFirst({ where: { prescriptionId: rx.id, contentSha256: hash2 }, select: { id: true, ref: true } });
      if (existing) return { id: existing.id, ref: existing.ref, status: "exported" };
      const ref = await nextReference(uow.tx, "WRX", uow.now);
      const row = await uow.tx.writtenRxExport.create({ data: { ref, prescriptionId: rx.id, exportedById: staff.id, exportedAt: uow.now, contentSha256: hash2 } });
      auditCreate(uow, actor, "WrittenRxExport", row.id, "rx.written_exported", { ref, prescription: rx.ref });
      return { id: row.id, ref, status: "exported" };
    });
    return { replay: result.replay, ...result.value };
  });
}

// features/keystone/security/breadthLimit.ts
var import_graphql3 = require("graphql");
var API_NESTED_DEFAULT = 50;
var NESTED_LIST_BOUNDS = {
  "Patient.ownerships": 10,
  "Patient.microchips": 10,
  "Patient.vcprs": 10,
  "Patient.insurancePolicies": 10,
  "Client.people": 10,
  "ClientPerson.contactPoints": 10,
  // Holidays and closures accumulate every year (33 live after two years); keep the whole list.
  "BusinessCalendar.exceptions": 500
};
function limitNestedLists(schema) {
  const roots = /* @__PURE__ */ new Set([schema.getQueryType()?.name, schema.getMutationType()?.name, schema.getSubscriptionType()?.name]);
  for (const type of Object.values(schema.getTypeMap())) {
    if (type.name.startsWith("__") || roots.has(type.name) || !("getFields" in type && "getInterfaces" in type)) continue;
    for (const field of Object.values(type.getFields())) {
      if (!/^\[/.test(String(field.type))) continue;
      const take = field.args.find((a) => a.name === "take");
      if (!take || typeof take.defaultValue !== "number") continue;
      take.defaultValue = Math.min(take.defaultValue, NESTED_LIST_BOUNDS[`${type.name}.${field.name}`] ?? API_NESTED_DEFAULT);
    }
  }
  return schema;
}

// features/keystone/security/signInLimit.ts
var import_node_crypto10 = require("node:crypto");

// features/keystone/security/internalIdentity.ts
var import_node_crypto9 = require("node:crypto");
var INTERNAL_IDENTITY_MAX_AGE_MS = 9e4;
function safeEqual(left, right) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && (0, import_node_crypto9.timingSafeEqual)(leftBuffer, rightBuffer);
}
function verifiedInternalIdentity(headers, socketAddress, secret2, now) {
  const loopback = /^(?:127\.|::1$|::ffff:127\.)/.test(String(socketAddress || ""));
  if (!loopback || secret2.length < 32) return null;
  const identity = String(headers["x-openfront-client-identity"] || "");
  const timestamp17 = String(headers["x-openfront-client-timestamp"] || "");
  const signature = String(headers["x-openfront-client-signature"] || "");
  if (!/^[a-f0-9]{64}$/.test(identity) || !/^\d{10}$/.test(timestamp17) || !/^[a-f0-9]{64}$/.test(signature)) return null;
  const age = Math.abs(now - Number(timestamp17) * 1e3);
  if (!Number.isFinite(age) || age > INTERNAL_IDENTITY_MAX_AGE_MS) return null;
  const expected = (0, import_node_crypto9.createHmac)("sha256", secret2).update(`${timestamp17}:${identity}`).digest("hex");
  return safeEqual(signature, expected) ? `forwarded:${identity}` : null;
}

// features/keystone/lib/internal-origin.ts
function normalizeAddress(address) {
  let value = address.trim().toLowerCase().replace(/^\[|\](?::\d+)?$/g, "").replace(/%.*$/, "");
  const mapped = value.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return mapped[1];
  if (!value.includes(":")) return value;
  const [head, tail = ""] = value.split("::");
  const left = head ? head.split(":") : [];
  const right = value.includes("::") ? tail ? tail.split(":") : [] : [];
  const groups = value.includes("::") ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return value;
  value = groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":");
  return `${value}::/64`;
}

// features/keystone/security/signInLimit.ts
var SIGN_IN_WINDOW_MINUTES = 15;
var SIGN_IN_MAX_PER_ADDRESS = 20;
var SIGN_IN_MAX_PER_EMAIL = 5;
var SIGN_IN_ACCOUNT_SLOW_AFTER = 10;
var SIGN_IN_KNOWN_DAYS = 90;
var SIGN_IN_SWEEP_PER_ATTEMPT = 50;
var SIGN_IN_LOCKED_MESSAGE = "Too many sign-in attempts. Try again later.";
var hash = (value) => (0, import_node_crypto10.createHash)("sha256").update(value).digest("hex");
var normalEmail = (email) => email.trim().toLowerCase();
var UNKNOWN_ADDRESS = "unknown-address";
var where = (address) => hash(address);
var addressBucketKey = (address) => `signin:addr:${hash(address)}`;
var accountBucketKey = (userId) => `signin:acct:${hash(userId)}`;
var pairBucketKey = (userId, address) => `signin:pair:${hash(userId)}:${where(address)}`;
var knownAddressKey = (userId, address) => `signin:known:${hash(userId)}:${where(address)}`;
var unknownEmailBucketKey = (email, address) => `signin:void:${hash(normalEmail(email))}:${where(address)}`;
function clientAddress(req) {
  const headers = req?.headers ?? {};
  const socket = req?.socket?.remoteAddress ?? null;
  const forwarded = verifiedInternalIdentity(headers, socket, String(process.env.SESSION_SECRET || ""), Date.now());
  if (forwarded) return forwarded.replace(/^forwarded:/, "");
  const first = (v) => String(Array.isArray(v) ? v[0] : v ?? "").split(",")[0]?.trim();
  const header = first(headers["x-real-ip"]) || first(headers["x-forwarded-for"]);
  if (header) return hash(normalizeAddress(header));
  return socket && !/^(?:127\.|::1$|::ffff:127\.)/.test(socket) ? hash(normalizeAddress(socket)) : UNKNOWN_ADDRESS;
}
async function countAttempt(prisma, key2) {
  const rows = await prisma.$queryRaw`
    INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") VALUES (${(0, import_node_crypto10.randomUUID)()}, ${key2}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES}::int) THEN 1 ELSE COALESCE("RateLimitBucket"."count", 0) + 1 END,
      "windowStart" = CASE WHEN "RateLimitBucket"."windowStart" < now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES}::int) THEN now() ELSE "RateLimitBucket"."windowStart" END
    RETURNING "count"`;
  return Number(rows[0]?.count ?? 0);
}
async function sweepExpired(prisma, limit = SIGN_IN_SWEEP_PER_ATTEMPT) {
  await prisma.$executeRaw`
    DELETE FROM "RateLimitBucket" WHERE "id" IN (
      SELECT "id" FROM "RateLimitBucket"
      WHERE "windowStart" < now() - make_interval(mins => ${SIGN_IN_WINDOW_MINUTES}::int) AND "key" LIKE 'signin:%'
        AND ("key" NOT LIKE 'signin:known:%' OR "windowStart" < now() - make_interval(days => ${SIGN_IN_KNOWN_DAYS}::int))
      LIMIT ${limit}::int FOR UPDATE SKIP LOCKED)`;
}
async function accountId(prisma, email) {
  const value = email.trim();
  if (!value) return null;
  const rows = await prisma.$queryRaw`SELECT "id" FROM "User" WHERE lower("email") = lower(${value}) ORDER BY ("email" = ${value}) DESC LIMIT 1`;
  return rows[0]?.id ?? null;
}
async function isKnownAddress(prisma, userId, address) {
  if (address === UNKNOWN_ADDRESS) return false;
  const rows = await prisma.$queryRaw`SELECT 1 AS "ok" FROM "RateLimitBucket" WHERE "key" = ${knownAddressKey(userId, address)} AND "windowStart" > now() - make_interval(days => ${SIGN_IN_KNOWN_DAYS}::int)`;
  return rows.length > 0;
}
async function signInAttempt(prisma, email, address, sessionUserId = null) {
  await sweepExpired(prisma);
  const userId = await accountId(prisma, email);
  if (userId && sessionUserId === userId) return { locked: false, userId };
  const known = userId ? await isKnownAddress(prisma, userId, address) : false;
  if (!known && await countAttempt(prisma, addressBucketKey(address)) > SIGN_IN_MAX_PER_ADDRESS) return { locked: true, userId };
  if (!userId) return { locked: await countAttempt(prisma, unknownEmailBucketKey(email, address)) > SIGN_IN_MAX_PER_EMAIL, userId: null };
  const pair = await countAttempt(prisma, pairBucketKey(userId, address));
  if (pair > SIGN_IN_MAX_PER_EMAIL) return { locked: true, userId };
  if (known) return { locked: false, userId };
  const account = await countAttempt(prisma, accountBucketKey(userId));
  return { locked: account > SIGN_IN_ACCOUNT_SLOW_AFTER && pair > 1, userId };
}
async function rememberAddress(prisma, userId, address) {
  if (address === UNKNOWN_ADDRESS) return;
  await prisma.$executeRaw`
    INSERT INTO "RateLimitBucket" ("id", "key", "windowStart", "count") VALUES (${(0, import_node_crypto10.randomUUID)()}, ${knownAddressKey(userId, address)}, now(), 1)
    ON CONFLICT ("key") DO UPDATE SET "windowStart" = now(), "count" = 1`;
}
async function signInSucceeded(prisma, userId, address) {
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" IN (${accountBucketKey(userId)}, ${pairBucketKey(userId, address)})`;
  await rememberAddress(prisma, userId, address);
  await prisma.$executeRaw`UPDATE "RateLimitBucket" SET "count" = GREATEST(COALESCE("count", 0) - 1, 0) WHERE "key" = ${addressBucketKey(address)}`;
}
async function passwordResetRedeemed(prisma, userId, address) {
  const prefix = `signin:pair:${hash(userId)}:%`;
  await prisma.$executeRaw`DELETE FROM "RateLimitBucket" WHERE "key" = ${accountBucketKey(userId)} OR "key" LIKE ${prefix}`;
  await rememberAddress(prisma, userId, address);
}
function limitSignIn(schema, field = "authenticateUserWithPassword", identityArg = "email", resetField = "redeemUserPasswordResetToken") {
  const fields = schema.getMutationType()?.getFields() ?? {};
  const def = fields[field];
  if (def?.resolve) {
    const resolve = def.resolve;
    def.resolve = async (root, args, context, info) => {
      const email = String(args[identityArg] ?? "");
      const address = clientAddress(context?.req);
      const prisma = context.sudo().prisma;
      const sessionUserId = typeof context?.session?.itemId === "string" ? context.session.itemId : null;
      const attempt = await signInAttempt(prisma, email, address, sessionUserId);
      if (attempt.locked) return { code: "FAILURE", message: SIGN_IN_LOCKED_MESSAGE };
      const result = await resolve(root, args, context, info);
      if (result && typeof result === "object" && "sessionToken" in result) {
        const userId = String(result.item?.id ?? attempt.userId ?? "");
        if (userId) await signInSucceeded(prisma, userId, address);
      }
      return result;
    };
  }
  const reset = fields[resetField];
  if (reset?.resolve) {
    const resolve = reset.resolve;
    reset.resolve = async (root, args, context, info) => {
      const result = await resolve(root, args, context, info);
      if (result == null) {
        const prisma = context.sudo().prisma;
        const userId = await accountId(prisma, String(args[identityArg] ?? ""));
        if (userId) await passwordResetRedeemed(prisma, userId, clientAddress(context?.req));
      }
      return result;
    };
  }
  return schema;
}

// features/keystone/mutations/index.ts
var graphql2 = String.raw;
function extendGraphqlSchema(baseSchema) {
  return limitSignIn(limitNestedLists((0, import_schema.mergeSchemas)({
    schemas: [baseSchema],
    typeDefs: graphql2`
      scalar JSON
      type Query {
        redirectToInit: Boolean
        verifyAuditChain: JSON
        policyInForce(kind: String!, locationId: ID!, on: String): JSON
        policyMatrix: JSON
        searchAvailability(locationId: ID!, appointmentTypeId: ID!, from: String, days: Int, providerId: ID, limit: Int): JSON
        triageQuestions: JSON
        lookupKnowledge(question: String!, locationId: ID): JSON
        receptionContext(callRecordId: ID, clientId: ID): JSON
        previewDose(patientId: ID!, drugId: ID!, doseAmount: String!, doseUnit: String!, dosePer: String!, weightId: ID, context: String, manualOverrideQty: String, overrideReason: String): JSON
      }
      input UserUpdateProfileInput { name: String, email: String, password: String, onboardingStatus: String }
      type Mutation {
        updateActiveUser(data: UserUpdateProfileInput!): User
        loadPracticeSetup(idempotencyKey: String!): JSON
        loadClinicSetup(idempotencyKey: String!): JSON
        decideApprovalRequest(requestId: ID!, decision: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelApprovalRequest(requestId: ID!, expectedVersion: Int!, reason: String, idempotencyKey: String!): JSON
        requestPracticeControls(changes: JSON!, reason: String!, idempotencyKey: String!): JSON
        registerClient(input: JSON!, idempotencyKey: String!): JSON
        registerPendingClient(input: JSON!, idempotencyKey: String!): JSON
        confirmRegistration(clientId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addPatient(clientId: ID!, input: JSON!, idempotencyKey: String!): JSON
        recordWeight(patientId: ID!, value: String!, unit: String!, method: String, bodyConditionScore: Int, appointmentId: ID, idempotencyKey: String!): JSON
        addPatientAlert(patientId: ID!, kind: String!, severity: String!, text: String!, idempotencyKey: String!): JSON
        recordConsent(contactPointId: ID!, purpose: String!, action: String!, method: String!, callRecordId: ID, keyword: String, idempotencyKey: String!): JSON
        recordPatientDeath(patientId: ID!, diedAt: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        bookAppointment(input: JSON!, idempotencyKey: String!): JSON
        cancelAppointment(appointmentId: ID!, reason: String!, expectedVersion: Int!, callRecordId: ID, idempotencyKey: String!): JSON
        rescheduleAppointment(appointmentId: ID!, slotToken: String!, expectedVersion: Int!, callRecordId: ID, idempotencyKey: String!): JSON
        confirmAppointment(appointmentId: ID!, expectedVersion: Int, idempotencyKey: String!): JSON
        acceptAppointmentRequest(appointmentId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        checkInAppointment(appointmentId: ID!, acknowledgedAlertIds: [ID!], expectedVersion: Int!, idempotencyKey: String!): JSON
        markNoShow(appointmentId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        moveWhiteboardEntry(entryId: ID!, to: String!, roomId: ID, assignedDvmId: ID, assignedTechId: ID, expectedVersion: Int!, idempotencyKey: String!): JSON
        addToWaitlist(input: JSON!, idempotencyKey: String!): JSON
        startCall(input: JSON!, idempotencyKey: String!): JSON
        recordCallDisclosure(callRecordId: ID!, recordingConsent: String!, idempotencyKey: String!): JSON
        verifyCaller(callRecordId: ID!, method: String!, petName: String!, petDateOfBirth: String!, idempotencyKey: String!): JSON
        appendCallTranscript(callRecordId: ID!, turns: JSON!, idempotencyKey: String!): JSON
        endCall(callRecordId: ID!, disposition: String!, summary: String, transferTo: String, idempotencyKey: String!): JSON
        runTriage(input: JSON!, idempotencyKey: String!): JSON
        referToEmergency(triageId: ID!, referralHospitalId: ID!, idempotencyKey: String!): JSON
        requestRefill(input: JSON!, idempotencyKey: String!): JSON
        requestRecords(input: JSON!, idempotencyKey: String!): JSON
        setAgentKillSwitch(agentId: ID!, killSwitch: Boolean!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        bindAgentApp(agentId: ID!, oauthAppId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        unbindAgentApp(agentId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        openEncounter(patientId: ID!, locationId: ID!, kind: String!, appointmentId: ID, reason: String, attendingDvmId: ID, idempotencyKey: String!): JSON
        saveSoapSection(encounterId: ID!, kind: String!, ordinal: Int, body: String!, structured: JSON, templateId: ID, expectedVersion: Int, idempotencyKey: String!): JSON
        recordVitals(encounterId: ID!, temperature: String, temperatureUnit: String, heartRate: Int, respRate: Int, mucousMembranes: String, crtSeconds: String, painScore: Int, bodyConditionScore: Int, mentation: String, hydrationPct: String, idempotencyKey: String!): JSON
        setExamFinding(encounterId: ID!, system: String!, status: String!, text: String, idempotencyKey: String!): JSON
        addDiagnosis(encounterId: ID!, term: String, codeId: ID, certainty: String!, addToProblems: Boolean, chronic: Boolean, idempotencyKey: String!): JSON
        resolveProblem(problemId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        submitEncounter(encounterId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        returnEncounter(encounterId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        signEncounter(encounterId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addAddendum(encounterId: ID!, sectionKind: String!, reason: String!, body: String!, idempotencyKey: String!): JSON
        requestVoidEncounter(encounterId: ID!, reason: String!, idempotencyKey: String!): JSON
        startScribeSession(encounterId: ID!, clientConsent: Boolean!, consentMethod: String, staffAcknowledged: Boolean!, idempotencyKey: String!): JSON
        draftScribeSession(sessionId: ID!, pastedTranscript: String, idempotencyKey: String!): JSON
        acceptScribeDraft(draftId: ID!, blocks: JSON!, idempotencyKey: String!): JSON
        rejectScribeDraft(draftId: ID!, reason: String!, idempotencyKey: String!): JSON
        placeOrder(encounterId: ID!, kind: String!, description: String, drugId: ID, route: String, frequency: String, quantity: String, quantityUnit: String, dose: JSON, extralabel: Boolean, sheet: JSON, idempotencyKey: String!): JSON
        cancelOrder(orderId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        reverseAdministration(administrationId: ID!, reason: String!, witnessId: ID, idempotencyKey: String!): JSON
        completeOrder(orderId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordAdministration(orderId: ID!, qty: String, route: String, site: String, lotId: ID, csContainerId: ID, wasteQty: String, witnessId: ID, supervisingDvmId: ID, treatmentTaskId: ID, qtyOverrideReason: String, idempotencyKey: String!): JSON
        admitPatient(encounterId: ID!, cageId: ID!, codeStatus: String!, reason: String, idempotencyKey: String!): JSON
        moveCage(stayId: ID!, cageId: ID!, idempotencyKey: String!): JSON
        dischargePatient(stayId: ID!, expectedVersion: Int!, instructions: String!, recheckOn: String, idempotencyKey: String!): JSON
        completeTreatmentTask(taskId: ID!, expectedVersion: Int!, observation: String, qty: String, lotId: ID, csContainerId: ID, witnessId: ID, wasteQty: String, earlyReason: String, qtyOverrideReason: String, idempotencyKey: String!): JSON
        skipTreatmentTask(taskId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        rescheduleTreatmentTask(taskId: ID!, expectedVersion: Int!, dueAt: String!, idempotencyKey: String!): JSON
        openAnaesthesia(encounterId: ID!, procedure: String!, asaStatus: String!, fastingConfirmed: Boolean!, consentConfirmed: Boolean!, ivCatheter: JSON, protocol: JSON, anaesthetistId: ID, idempotencyKey: String!): JSON
        anaesthesiaEvent(recordId: ID!, event: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        recordMonitoring(recordId: ID!, hr: Int, rr: Int, spo2: Int, etco2: Int, sbp: Int, dbp: Int, map: Int, tempC: String, agentPct: String, o2FlowLpm: String, fluidsRateMlHr: String, notes: String, idempotencyKey: String!): JSON
        closeAnaesthesia(recordId: ID!, expectedVersion: Int!, complications: String, idempotencyKey: String!): JSON
        saveSurgeryReport(encounterId: ID!, procedure: String!, technique: String, findings: String, closure: String, sutures: String, specimens: String, assistantId: ID, idempotencyKey: String!): JSON
        saveDentalChart(encounterId: ID!, teeth: JSON!, idempotencyKey: String!): JSON
        administerVaccine(encounterId: ID!, productId: ID!, lotId: ID!, route: String, site: String!, supervisingDvmId: ID, tagNumber: String, repeatReason: String, idempotencyKey: String!): JSON
        reverseVaccineAdministration(vaccineAdministrationId: ID!, reason: String!, idempotencyKey: String!): JSON
        recordOutsideVaccine(patientId: ID!, productId: ID!, administeredOn: String!, lotNumber: String, evidenceNote: String!, idempotencyKey: String!): JSON
        refreshClinicalClocks(idempotencyKey: String!): JSON
        suppressReminder(reminderId: ID!, expectedVersion: Int!, reason: String!, idempotencyKey: String!): JSON
        addManualReminder(patientId: ID!, typeId: ID!, dueOn: String!, idempotencyKey: String!): JSON
        previewImport(system: String!, entity: String!, locationId: ID!, fileName: String, csv: String, mapping: JSON, source: String, idempotencyKey: String!): JSON
        applyImport(batchId: ID!, idempotencyKey: String!): JSON
        writePrescription(patientId: ID!, locationId: ID!, lines: JSON!, idempotencyKey: String!): JSON
        decideRefill(requestId: ID!, decision: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        dispenseFill(lineId: ID!, quantity: String!, lotId: ID, csContainerId: ID, refillRequestId: ID, idempotencyKey: String!): JSON
        receiveStockLot(drugId: ID, vaccineId: ID, locationId: ID!, lotNumber: String!, expiresOn: String!, idempotencyKey: String!): JSON
        setLotQuarantine(lotId: ID!, quarantine: Boolean!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        receiveControlled(productId: ID!, locationId: ID!, lotNumber: String!, lotExpiresOn: String!, labelQty: String!, labelUnit: String!, orderFormReference: String, idempotencyKey: String!): JSON
        openControlled(containerId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        wasteControlled(containerId: ID!, qty: String!, reason: String!, witnessId: ID!, idempotencyKey: String!): JSON
        countControlled(locationId: ID!, kind: String!, witnessId: ID!, counts: JSON!, idempotencyKey: String!): JSON
        reportCsLoss(containerId: ID!, kind: String!, qty: String!, description: String!, witnessId: ID!, idempotencyKey: String!): JSON
        advanceDiscrepancy(caseId: ID!, step: String!, reference: String, resolution: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        destroyControlled(containerId: ID!, qty: String, method: String!, form41Reference: String, witnessAId: ID!, witnessBId: ID!, idempotencyKey: String!): JSON
        submitPdmp(reportId: ID!, confirmation: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        addStockLocation(locationId: ID!, name: String!, kind: String!, minTempC: String, maxTempC: String, idempotencyKey: String!): JSON
        receiveStock(drugId: ID, vaccineId: ID, stockLocationId: ID!, lotNumber: String!, expiresOn: String!, quantity: String!, unit: String, idempotencyKey: String!): JSON
        adjustStock(itemId: ID!, lotId: ID, stockLocationId: ID!, kind: String!, quantity: String!, reason: String!, idempotencyKey: String!): JSON
        addSupplier(name: String!, accountNumber: String, phone: String, email: String, deaNumber: String, idempotencyKey: String!): JSON
        draftPurchaseOrder(supplierId: ID!, locationId: ID!, lines: JSON!, note: String, idempotencyKey: String!): JSON
        submitPurchaseOrder(orderId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelPurchaseOrder(orderId: ID!, reason: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        receivePurchaseOrder(orderId: ID!, stockLocationId: ID!, packingSlip: String, lines: JSON!, idempotencyKey: String!): JSON
        setReorderRule(itemId: ID!, locationId: ID!, minQty: String!, targetQty: String!, idempotencyKey: String!): JSON
        countStock(stockLocationId: ID!, counts: JSON!, idempotencyKey: String!): JSON
        openRecall(itemId: ID!, lotNumber: String!, title: String!, source: String, idempotencyKey: String!): JSON
        markRecallExposure(exposureId: ID!, status: String!, note: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        closeRecall(recallId: ID!, resolution: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        logTemperature(stockLocationId: ID!, readingC: String!, idempotencyKey: String!): JSON
        resolveExcursion(excursionId: ID!, resolution: String!, expectedVersion: Int!, idempotencyKey: String!): JSON
        issueOrderForm(supplierId: ID!, locationId: ID!, formNumber: String!, kind: String!, issuedOn: String!, lines: JSON!, idempotencyKey: String!): JSON
        receiveOnOrderForm(lineId: ID!, lotNumber: String!, lotExpiresOn: String!, labelQty: String!, labelUnit: String!, idempotencyKey: String!): JSON
        transferControlled(containerId: ID!, qty: String!, toRegistrationId: ID!, witnessId: ID!, idempotencyKey: String!): JSON
        confirmTransfer(transferId: ID!, expectedVersion: Int!, idempotencyKey: String!): JSON
        logCabinetAccess(locationId: ID!, kind: String!, note: String, idempotencyKey: String!): JSON
        generatePdmpFile(locationId: ID!, idempotencyKey: String!): JSON
        printDispenseLabel(dispenseId: ID!, idempotencyKey: String!): JSON
        requestExternalFill(prescriptionId: ID!, pharmacyName: String!, orderReference: String, idempotencyKey: String!): JSON
        decideExternalFill(externalId: ID!, status: String!, note: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        exportWrittenRx(prescriptionId: ID!, idempotencyKey: String!): JSON
      }
    `,
    resolvers: {
      Query: {
        redirectToInit: redirectToInit_default,
        verifyAuditChain: op(verifyAuditChain2),
        policyInForce: op(policyInForce),
        policyMatrix: op(policyMatrix),
        searchAvailability: op(searchAvailability),
        triageQuestions: op(triageQuestions),
        lookupKnowledge: op(lookupKnowledge),
        receptionContext: op(receptionContext),
        previewDose: op(previewDose)
      },
      Mutation: {
        updateActiveUser: updateActiveUser_default,
        loadPracticeSetup: op(loadPracticeSetup),
        loadClinicSetup: op(loadClinicSetup),
        decideApprovalRequest: op(decideApprovalRequest),
        cancelApprovalRequest: op(cancelApprovalRequest),
        requestPracticeControls: op(requestPracticeControls),
        registerClient: op(registerClient),
        registerPendingClient: op(registerPendingClient),
        confirmRegistration: op(confirmRegistration),
        addPatient: op(addPatient),
        recordWeight: op(recordWeight),
        addPatientAlert: op(addPatientAlert),
        recordConsent: op(recordConsent),
        recordPatientDeath: op(recordPatientDeath),
        bookAppointment: op(bookAppointment),
        cancelAppointment: op(cancelAppointment),
        rescheduleAppointment: op(rescheduleAppointment),
        confirmAppointment: op(confirmAppointment),
        acceptAppointmentRequest: op(acceptAppointmentRequest),
        checkInAppointment: op(checkInAppointment),
        markNoShow: op(markNoShow),
        moveWhiteboardEntry: op(moveWhiteboardEntry),
        addToWaitlist: op(addToWaitlist),
        startCall: op(startCall),
        recordCallDisclosure: op(recordCallDisclosure),
        verifyCaller: op(verifyCaller),
        appendCallTranscript: op(appendCallTranscript),
        endCall: op(endCall),
        runTriage: op(runTriage),
        referToEmergency: op(referToEmergency),
        requestRefill: op(requestRefill),
        requestRecords: op(requestRecords),
        setAgentKillSwitch: op(setAgentKillSwitch),
        bindAgentApp: op(bindAgentApp),
        unbindAgentApp: op(unbindAgentApp),
        openEncounter: op(openEncounter),
        saveSoapSection: op(saveSoapSection),
        recordVitals: op(recordVitals),
        setExamFinding: op(setExamFinding),
        addDiagnosis: op(addDiagnosis),
        resolveProblem: op(resolveProblem),
        submitEncounter: op(submitEncounter),
        returnEncounter: op(returnEncounter),
        signEncounter: op(signEncounter),
        addAddendum: op(addAddendum),
        requestVoidEncounter: op(requestVoidEncounter),
        startScribeSession: op(startScribeSession),
        draftScribeSession: op(draftScribeSession),
        acceptScribeDraft: op(acceptScribeDraft),
        rejectScribeDraft: op(rejectScribeDraft),
        placeOrder: op(placeOrder),
        cancelOrder: op(cancelOrder),
        reverseAdministration: op(reverseAdministration),
        completeOrder: op(completeOrder),
        recordAdministration: op(recordAdministration),
        admitPatient: op(admitPatient),
        moveCage: op(moveCage),
        dischargePatient: op(dischargePatient),
        completeTreatmentTask: op(completeTreatmentTask),
        skipTreatmentTask: op(skipTreatmentTask),
        rescheduleTreatmentTask: op(rescheduleTreatmentTask),
        openAnaesthesia: op(openAnaesthesia),
        anaesthesiaEvent: op(anaesthesiaEvent),
        recordMonitoring: op(recordMonitoring),
        closeAnaesthesia: op(closeAnaesthesia),
        saveSurgeryReport: op(saveSurgeryReport),
        saveDentalChart: op(saveDentalChart),
        administerVaccine: op(administerVaccine),
        reverseVaccineAdministration: op(reverseVaccineAdministration),
        recordOutsideVaccine: op(recordOutsideVaccine),
        refreshClinicalClocks: op(refreshClinicalClocks),
        suppressReminder: op(suppressReminder),
        addManualReminder: op(addManualReminder),
        previewImport: op(previewImport),
        applyImport: op(applyImport),
        writePrescription: op(writePrescription),
        decideRefill: op(decideRefill),
        dispenseFill: op(dispenseFill),
        receiveStockLot: op(receiveStockLot),
        setLotQuarantine: op(setLotQuarantine),
        receiveControlled: op(receiveControlled),
        openControlled: op(openControlled),
        wasteControlled: op(wasteControlled),
        countControlled: op(countControlled),
        reportCsLoss: op(reportCsLoss),
        advanceDiscrepancy: op(advanceDiscrepancy),
        destroyControlled: op(destroyControlled),
        submitPdmp: op(submitPdmp),
        addStockLocation: op(addStockLocation),
        receiveStock: op(receiveStock),
        adjustStock: op(adjustStock),
        addSupplier: op(addSupplier),
        draftPurchaseOrder: op(draftPurchaseOrder),
        submitPurchaseOrder: op(submitPurchaseOrder),
        cancelPurchaseOrder: op(cancelPurchaseOrder),
        receivePurchaseOrder: op(receivePurchaseOrder),
        setReorderRule: op(setReorderRule),
        countStock: op(countStock),
        openRecall: op(openRecall),
        markRecallExposure: op(markRecallExposure),
        closeRecall: op(closeRecall),
        logTemperature: op(logTemperature),
        resolveExcursion: op(resolveExcursion),
        issueOrderForm: op(issueOrderForm),
        receiveOnOrderForm: op(receiveOnOrderForm),
        transferControlled: op(transferControlled),
        confirmTransfer: op(confirmTransfer),
        logCabinetAccess: op(logCabinetAccess),
        generatePdmpFile: op(generatePdmpFile),
        printDispenseLabel: op(printDispenseLabel),
        requestExternalFill: op(requestExternalFill),
        decideExternalFill: op(decideExternalFill),
        exportWrittenRx: op(exportWrittenRx)
      }
    }
  })));
}

// features/keystone/lib/mail.ts
var import_nodemailer = require("nodemailer");
function getBaseUrlForEmails() {
  if (process.env.SMTP_STORE_LINK) {
    return process.env.SMTP_STORE_LINK;
  }
  console.warn("SMTP_STORE_LINK not set. Please add SMTP_STORE_LINK to your environment variables for email links to work properly.");
  return "";
}
var transport = (0, import_nodemailer.createTransport)({
  // @ts-ignore
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD
  }
});
function passwordResetEmail({ url }) {
  const backgroundColor = "#f9f9f9";
  const textColor = "#444444";
  const mainBackgroundColor = "#ffffff";
  const buttonBackgroundColor = "#346df1";
  const buttonBorderColor = "#346df1";
  const buttonTextColor = "#ffffff";
  return `
    <body style="background: ${backgroundColor};">
      <table width="100%" border="0" cellspacing="20" cellpadding="0" style="background: ${mainBackgroundColor}; max-width: 600px; margin: auto; border-radius: 10px;">
        <tr>
          <td align="center" style="padding: 10px 0px 0px 0px; font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${textColor};">
            Please click below to reset your password
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 20px 0;">
            <table border="0" cellspacing="0" cellpadding="0">
              <tr>
                <td align="center" style="border-radius: 5px;" bgcolor="${buttonBackgroundColor}"><a href="${url}" target="_blank" style="font-size: 18px; font-family: Helvetica, Arial, sans-serif; color: ${buttonTextColor}; text-decoration: none; border-radius: 5px; padding: 10px 20px; border: 1px solid ${buttonBorderColor}; display: inline-block; font-weight: bold;">Reset Password</a></td>
              </tr>
            </table>
          </td>
        </tr>
        <tr>
          <td align="center" style="padding: 0px 0px 10px 0px; font-size: 16px; line-height: 22px; font-family: Helvetica, Arial, sans-serif; color: ${textColor};">
            If you did not request this email you can safely ignore it.
          </td>
        </tr>
      </table>
    </body>
  `;
}
async function sendPasswordResetEmail(resetToken, to, baseUrl) {
  const frontendUrl = baseUrl || getBaseUrlForEmails();
  const info = await transport.sendMail({
    to,
    from: process.env.SMTP_FROM,
    subject: "Your password reset token!",
    html: passwordResetEmail({
      url: `${frontendUrl}/dashboard/reset?token=${resetToken}`
    })
  });
  if (process.env.MAIL_USER?.includes("ethereal.email")) {
    console.log(`\u{1F4E7} Message Sent!  Preview it at ${(0, import_nodemailer.getTestMessageUrl)(info)}`);
  }
}

// features/keystone/prismaConstraints.ts
var COMPOUND_UNIQUES = {
  CalendarException: ['@@unique([calendarId, date], map: "CalendarException_calendar_date_key")'],
  ProviderObservation: [
    '@@unique([source, connectionId, externalId], map: "ProviderObservation_source_external_key")',
    '@@unique([source, contentHash], map: "ProviderObservation_source_hash_key")'
  ],
  ExternalId: [
    '@@unique([system, value], map: "ExternalId_system_value_key")',
    '@@unique([system, recordType, recordId], map: "ExternalId_system_record_key")'
  ],
  PolicyVersion: ['@@unique([packId, versionNumber], map: "PolicyVersion_pack_number_key")'],
  PolicyBinding: ['@@unique([packId, scope, locationId], map: "PolicyBinding_pack_scope_location_key")'],
  ProfessionalLicense: ['@@unique([stateCode, kind, licenseNumber], map: "ProfessionalLicense_state_kind_number_key")'],
  // Phase 1
  ContactPoint: ['@@unique([personId, valueHash], map: "ContactPoint_person_value_key")'],
  AppointmentPatient: ['@@unique([appointmentId, patientId], map: "AppointmentPatient_appointment_patient_key")'],
  TriageProtocolVersion: ['@@unique([protocolId, versionNumber], map: "TriageProtocolVersion_protocol_number_key")'],
  MessageTemplate: ['@@unique([code, channel, locale, templateVersion], map: "MessageTemplate_code_channel_locale_version_key")'],
  Breed: ['@@unique([speciesId, name], map: "Breed_species_name_key")'],
  // Phase 2
  SoapSection: ['@@unique([encounterId, kind, ordinal], map: "SoapSection_encounter_kind_ordinal_key")'],
  SoapSectionRevision: ['@@unique([sectionId, revisionNumber], map: "SoapSectionRevision_section_number_key")'],
  DiagnosisCode: ['@@unique([codeSystem, code], map: "DiagnosisCode_system_code_key")'],
  TreatmentTask: ['@@unique([sheetOrderId, dueAt], map: "TreatmentTask_sheet_due_key")'],
  PatientReminder: ['@@unique([patientId, typeId, dueOn], map: "PatientReminder_patient_type_due_key")'],
  ReminderSatisfaction: ['@@unique([reminderId, sourceKey], map: "ReminderSatisfaction_reminder_source_key")'],
  ReminderProtocolVersion: ['@@unique([protocolId, versionNumber], map: "ReminderProtocolVersion_protocol_number_key")'],
  ImportRow: ['@@unique([batchId, rowNumber], map: "ImportRow_batch_row_key")']
};
function addDatabaseConstraints(schema) {
  for (const [modelName, directives] of Object.entries(COMPOUND_UNIQUES)) {
    const pattern = new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`);
    const model = schema.match(pattern)?.[0];
    if (!model) throw new Error(`Generated Prisma schema is missing ${modelName}`);
    const missing = directives.filter((directive) => !model.includes(directive));
    if (!missing.length) continue;
    schema = schema.replace(model, model.replace(/\n\}$/, `
${missing.map((directive) => `  ${directive}`).join("\n")}
}`));
  }
  return schema;
}

// features/keystone/lib/keystonePrismaErrors.ts
var RAW_METHOD = /^\$(queryRaw|executeRaw|queryRawUnsafe|executeRawUnsafe|queryRawTyped|runCommandRaw)$/;
var clients = /* @__PURE__ */ new WeakMap();
var delegates = /* @__PURE__ */ new WeakMap();
function isKeystonePrismaError(value) {
  return value instanceof Error && value.extensions?.code === "KS_PRISMA_ERROR";
}
function rethrowKeystonePrismaError(value) {
  if (!isKeystonePrismaError(value)) return value;
  const prisma = value.extensions.prisma ?? {};
  throw Object.assign(value, { code: prisma.code, meta: prisma.meta, clientVersion: prisma.clientVersion });
}
function throwing(result) {
  if (!result || typeof result.then !== "function") return rethrowKeystonePrismaError(result);
  const settled = () => result.then(rethrowKeystonePrismaError);
  return new Proxy(result, {
    get(target, key2) {
      if (key2 === "then") return (ok, fail) => settled().then(ok, fail);
      if (key2 === "catch") return (fail) => settled().catch(fail);
      if (key2 === "finally") return (done) => settled().finally(done);
      const value = Reflect.get(target, key2, target);
      return typeof value === "function" ? value.bind(target) : value;
    }
  });
}
function throwingDelegate(delegate) {
  const cached = delegates.get(delegate);
  if (cached) return cached;
  const wrapped = new Proxy(delegate, {
    get(target, key2) {
      const value = Reflect.get(target, key2, target);
      return typeof value === "function" ? (...args) => throwing(value.apply(target, args)) : value;
    }
  });
  delegates.set(delegate, wrapped);
  return wrapped;
}
function throwKeystonePrismaErrors(client) {
  const cached = clients.get(client);
  if (cached) return cached;
  const wrapped = new Proxy(client, {
    get(target, key2) {
      const value = Reflect.get(target, key2, target);
      if (key2 === "$transaction" && typeof value === "function") {
        return (work, ...options) => {
          if (typeof work === "function") return value.call(target, (tx) => work(throwKeystonePrismaErrors(tx)), ...options);
          return Promise.resolve(value.call(target, work, ...options)).then((results) => Array.isArray(results) ? results.map(rethrowKeystonePrismaError) : results);
        };
      }
      if (key2 === "$extends" && typeof value === "function") return (...args) => throwKeystonePrismaErrors(value.apply(target, args));
      if (typeof key2 === "string" && RAW_METHOD.test(key2) && typeof value === "function") return (...args) => throwing(value.apply(target, args));
      if (typeof value === "function") return value.bind(target);
      if (typeof key2 === "string" && !key2.startsWith("$") && value && typeof value === "object" && typeof value.findFirst === "function") return throwingDelegate(value);
      return value;
    }
  });
  clients.set(client, wrapped);
  return wrapped;
}

// features/keystone/index.ts
var databaseURL = process.env.DATABASE_URL || "file:./keystone.db";
var sessionConfig = {
  maxAge: 60 * 60 * 24 * 360,
  // How long they stay signed in?
  secret: process.env.SESSION_SECRET || "this secret should only be used in testing"
};
var {
  S3_BUCKET_NAME: bucketName = "keystone-test",
  S3_REGION: region = "ap-southeast-2",
  S3_ACCESS_KEY_ID: accessKeyId = "keystone",
  S3_SECRET_ACCESS_KEY: secretAccessKey = "keystone",
  S3_ENDPOINT: endpoint = "https://sfo3.digitaloceanspaces.com"
} = process.env;
var { withAuth } = (0, import_auth.createAuth)({
  listKey: "User",
  identityField: "email",
  secretField: "password",
  initFirstItem: {
    fields: ["name", "email", "password"],
    itemData: {
      role: {
        create: {
          name: "Owner / Admin",
          // Every permission except break-glass, which is never granted by default.
          ...Object.fromEntries(permissionNames.filter((name) => name !== "canBreakGlass").map((name) => [name, true]))
        }
      }
    }
  },
  passwordResetLink: {
    async sendToken(args) {
      await sendPasswordResetEmail(args.token, args.identity);
    }
  },
  sessionData: `
    name
    email
    kind
    accessExpiresAt
    role {
      id
      name
      ${permissionNames.join("\n      ")}
    }
  `
});
var keystone_default = withAuth(
  (0, import_core21.config)({
    db: {
      provider: "postgresql",
      url: databaseURL,
      extendPrismaSchema: addDatabaseConstraints,
      extendPrismaClient: throwKeystonePrismaErrors
    },
    lists: models,
    storage: {
      my_images: {
        kind: "s3",
        type: "image",
        bucketName,
        region,
        accessKeyId,
        secretAccessKey,
        endpoint,
        signed: { expiry: 5e3 },
        forcePathStyle: true
      }
    },
    ui: {
      isAccessAllowed: ({ session }) => isSignedIn({ session }) && session?.data.role?.canAccessDashboard === true
    },
    // MCP OAuth bearer tokens resolve to the approving user; everything else is unchanged.
    session: withMcpBearerSessions((0, import_session2.statelessSessions)(sessionConfig)),
    graphql: {
      extendGraphqlSchema
    }
  })
);

// keystone.ts
var keystone_default2 = keystone_default;
//# sourceMappingURL=config.js.map
