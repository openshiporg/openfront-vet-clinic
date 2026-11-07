"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
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

// keystone.ts
var keystone_exports = {};
__export(keystone_exports, {
  default: () => keystone_default2
});
module.exports = __toCommonJS(keystone_exports);

// features/keystone/index.ts
var import_auth = require("@keystone-6/auth");
var import_core12 = require("@keystone-6/core");
var import_config = require("dotenv/config");

// features/keystone/models/User.ts
var import_core = require("@keystone-6/core");
var import_access = require("@keystone-6/core/access");
var import_fields2 = require("@keystone-6/core/fields");

// features/keystone/models/trackingFields.ts
var import_fields = require("@keystone-6/core/fields");
var trackingFields = {
  createdAt: (0, import_fields.timestamp)({
    access: { read: () => true, create: () => false, update: () => false },
    validation: { isRequired: true },
    defaultValue: { kind: "now" },
    ui: {
      createView: { fieldMode: "hidden" },
      itemView: { fieldMode: "read" }
    }
  }),
  updatedAt: (0, import_fields.timestamp)({
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
    name: (0, import_fields2.text)({
      validation: {
        isRequired: true
      }
    }),
    email: (0, import_fields2.text)({
      isFilterable: false,
      isOrderable: false,
      isIndexed: "unique",
      validation: {
        isRequired: true
      }
    }),
    password: (0, import_fields2.password)({
      access: {
        read: import_access.denyAll,
        update: ({ session, item }) => permissions.canManagePeople({ session }) || session?.itemId === item.id
      },
      validation: { isRequired: true }
    }),
    role: (0, import_fields2.relationship)({
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
    kind: (0, import_fields2.select)({
      type: "enum",
      options: ["staff", "relief", "auditor", "administrator"].map((value) => ({ label: value, value })),
      defaultValue: "staff",
      access: { create: permissions.canManagePeople, update: permissions.canManagePeople }
    }),
    title: (0, import_fields2.text)(),
    staffMember: (0, import_fields2.relationship)({ ref: "StaffMember.user", ui: { description: "The clinical staff record (licences, schedules, DEA)." } }),
    mfaEnrolled: (0, import_fields2.checkbox)({ defaultValue: false, access: { create: () => false, update: () => false } }),
    accessExpiresAt: (0, import_fields2.timestamp)({
      access: { create: permissions.canManagePeople, update: permissions.canManagePeople },
      ui: { description: "Time-boxed access for relief vets, auditors and temporary administrators." }
    }),
    onboardingStatus: (0, import_fields2.select)({
      options: ["not_started", "in_progress", "completed", "dismissed"].map((value) => ({ label: value.replaceAll("_", " "), value })),
      defaultValue: "not_started"
    }),
    ...trackingFields
  }
});

// features/keystone/models/Role.ts
var import_core2 = require("@keystone-6/core");
var import_access3 = require("@keystone-6/core/access");
var import_fields3 = require("@keystone-6/core/fields");
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
    name: (0, import_fields3.text)({ validation: { isRequired: true } }),
    description: (0, import_fields3.text)({ ui: { displayMode: "textarea" } }),
    ...Object.fromEntries(permissionNames.map((name) => [name, (0, import_fields3.checkbox)({ defaultValue: false })])),
    ...trackingFields,
    assignedTo: (0, import_fields3.relationship)({
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
var import_fields4 = require("@keystone-6/core/fields");

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
    name: (0, import_fields4.text)({
      validation: {
        isRequired: true
      }
    }),
    clientId: (0, import_fields4.text)({
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
    clientSecret: (0, import_fields4.text)({
      access: {
        read: () => false
      },
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
    tokenEndpointAuthMethod: (0, import_fields4.select)({
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
    redirectUris: (0, import_fields4.json)({
      defaultValue: [],
      ui: {
        description: "Array of allowed redirect URIs for OAuth callbacks"
      }
    }),
    scopes: (0, import_fields4.json)({
      defaultValue: [...MCP_SCOPES],
      ui: {
        description: "Array of allowed OAuth scopes. MCP scopes only narrow the signed-in user's own access."
      }
    }),
    webhookUrl: (0, import_fields4.text)({
      ui: {
        description: "URL to receive webhook notifications"
      }
    }),
    status: (0, import_fields4.select)({
      options: [
        { label: "Active", value: "active" },
        { label: "Suspended", value: "suspended" },
        { label: "Pending", value: "pending" }
      ],
      defaultValue: "active"
    }),
    installUrl: (0, import_fields4.text)({
      ui: {
        description: "URL where users can install this app"
      }
    }),
    uninstallUrl: (0, import_fields4.text)({
      ui: {
        description: "URL to handle app uninstallation"
      }
    }),
    description: (0, import_fields4.text)({
      ui: {
        displayMode: "textarea"
      }
    }),
    metadata: (0, import_fields4.json)({
      defaultValue: {},
      ui: {
        description: "Additional app-specific configuration and settings"
      }
    }),
    developerEmail: (0, import_fields4.text)(),
    privacyPolicyUrl: (0, import_fields4.text)(),
    termsOfServiceUrl: (0, import_fields4.text)(),
    supportUrl: (0, import_fields4.text)(),
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
var import_fields5 = require("@keystone-6/core/fields");
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
    tokenType: (0, import_fields5.select)({
      options: [
        { label: "Authorization Code", value: "authorization_code" },
        { label: "Access Token", value: "access_token" },
        { label: "Refresh Token", value: "refresh_token" }
      ],
      validation: {
        isRequired: true
      }
    }),
    token: (0, import_fields5.text)({
      access: { read: () => false },
      validation: {
        isRequired: true
      },
      isIndexed: "unique",
      hooks: digestTokenInput
    }),
    clientId: (0, import_fields5.text)({
      validation: {
        isRequired: true
      },
      isIndexed: true
    }),
    user: (0, import_fields5.relationship)({
      ref: "User",
      ui: {
        description: "The user who authorized this token"
      }
    }),
    scopes: (0, import_fields5.json)({
      defaultValue: [],
      ui: {
        description: "Array of granted scopes"
      }
    }),
    redirectUri: (0, import_fields5.text)({
      ui: {
        description: "The redirect URI used during authorization"
      }
    }),
    resource: (0, import_fields5.text)({
      ui: {
        description: "The MCP endpoint (RFC 8707 resource) this grant is for"
      }
    }),
    expiresAt: (0, import_fields5.timestamp)({
      ui: {
        description: "When this token expires"
      }
    }),
    isRevoked: (0, import_fields5.select)({
      options: [
        { label: "Active", value: "false" },
        { label: "Revoked", value: "true" }
      ],
      defaultValue: "false"
    }),
    authorizationCode: (0, import_fields5.text)({
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "The authorization code that was exchanged for this token (for access tokens)"
      }
    }),
    refreshToken: (0, import_fields5.text)({
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "Associated refresh token (for access tokens)"
      }
    }),
    accessToken: (0, import_fields5.text)({
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "Associated access token (for refresh tokens)"
      }
    }),
    state: (0, import_fields5.text)({
      ui: {
        description: "OAuth state parameter for CSRF protection"
      }
    }),
    codeChallenge: (0, import_fields5.text)({
      ui: {
        description: "PKCE code challenge"
      }
    }),
    codeChallengeMethod: (0, import_fields5.select)({
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
  Lease: () => Lease,
  Notification: () => Notification,
  OutboxEvent: () => OutboxEvent,
  ProviderObservation: () => ProviderObservation,
  ReadAudit: () => ReadAudit,
  ScheduledJob: () => ScheduledJob,
  SecretBox: () => SecretBox,
  Sequence: () => Sequence
});
var import_core7 = require("@keystone-6/core");
var import_fields7 = require("@keystone-6/core/fields");

// features/keystone/models/domainFields.ts
var import_fields6 = require("@keystone-6/core/fields");
var minor = (options = {}) => (0, import_fields6.bigInt)({
  ...options.defaultValue !== void 0 ? { defaultValue: options.defaultValue } : {},
  validation: { isRequired: options.required ?? options.defaultValue !== void 0 },
  ...options.description ? { ui: { description: options.description } } : {}
});
var exact = (precision, scale) => (options = {}) => (0, import_fields6.decimal)({
  precision,
  scale,
  validation: { isRequired: options.required ?? false },
  ...options.description ? { ui: { description: options.description } } : {}
});
var qty = exact(18, 6);
var rate = exact(12, 6);
var wt = exact(10, 4);
var geo = exact(9, 6);
var option = (value) => ({ label: value.replaceAll("_", " ").replaceAll(".", " \xB7 "), value });
var lifecycle = (values, initial = values[0]) => (0, import_fields6.select)({
  type: "string",
  options: values.map(option),
  defaultValue: initial,
  validation: { isRequired: true },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});
var choice = (values, initial = values[0]) => (0, import_fields6.select)({
  type: "string",
  options: values.map(option),
  ...initial !== null ? { defaultValue: initial } : {},
  validation: { isRequired: initial !== null }
});
var versionField = () => (0, import_fields6.integer)({
  defaultValue: 0,
  validation: { isRequired: true },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});
var systemText = (options = {}) => (0, import_fields6.text)({
  ...options.indexed ? { isIndexed: options.indexed } : {},
  validation: { isRequired: options.required ?? false },
  access: { create: () => false, update: () => false },
  ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } }
});
var readOnly = { access: { create: () => false, update: () => false }, ui: { createView: { fieldMode: "hidden" }, itemView: { fieldMode: "read" } } };
var fixedChoice = (values) => (0, import_fields6.select)({
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
    name: (0, import_fields7.text)({ validation: { isRequired: true }, isIndexed: "unique" }),
    kind: choice(["voice_receptionist", "sms_receptionist", "scribe", "charge_capture", "insights", "external_mcp_client"], "voice_receptionist"),
    model: (0, import_fields7.text)(),
    provider: (0, import_fields7.text)(),
    owner: (0, import_fields7.relationship)({ ref: "User" }),
    status: lifecycle(["active", "paused", "revoked"]),
    killSwitch: (0, import_fields7.checkbox)({ ...readOnly, defaultValue: false, ui: { ...readOnly.ui, description: "On: every tool call is refused at once (setAgentKillSwitch)." } }),
    limits: (0, import_fields7.json)({ ...readOnly, defaultValue: { toolCallsPerRun: 40 } }),
    oauthApp: (0, import_fields7.relationship)({ ref: "OAuthApp" }),
    grants: (0, import_fields7.relationship)({ ref: "AgentToolGrant.agent", many: true, ...readOnly }),
    runs: (0, import_fields7.relationship)({ ref: "AgentRun.agent", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AuditEvent = (0, import_core7.list)({
  access: immutable("canReadAudit"),
  ui: { labelField: "eventType", listView: { initialColumns: ["seq", "at", "eventType", "entityType", "entityId", "actorUser"], initialSort: { field: "seq", direction: "DESC" } } },
  fields: {
    seq: (0, import_fields7.integer)({ isIndexed: "unique", validation: { isRequired: true }, ...readOnly }),
    eventKey: systemText({ indexed: "unique", required: true }),
    eventType: systemText({ indexed: true, required: true }),
    entityType: systemText({ indexed: true, required: true }),
    entityId: systemText({ indexed: true, required: true }),
    actorUser: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    actorAgent: (0, import_fields7.relationship)({ ref: "AgentIdentity", ...readOnly }),
    approver: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    reason: systemText(),
    before: (0, import_fields7.json)({ ...readOnly }),
    after: (0, import_fields7.json)({ ...readOnly }),
    metadata: (0, import_fields7.json)({ ...readOnly }),
    requestId: systemText(),
    prevHash: systemText({ required: true }),
    hash: systemText({ indexed: "unique", required: true }),
    at: (0, import_fields7.timestamp)({ validation: { isRequired: true }, defaultValue: { kind: "now" }, ...readOnly })
  }
});
var CommandReceipt = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    idempotencyKey: (0, import_fields7.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    command: (0, import_fields7.text)({ validation: { isRequired: true } }),
    principalKey: (0, import_fields7.text)({ validation: { isRequired: true } }),
    requestHash: (0, import_fields7.text)({ validation: { isRequired: true } }),
    requestParams: (0, import_fields7.json)(),
    responseCode: (0, import_fields7.text)(),
    responseBody: (0, import_fields7.json)(),
    recoveryPoint: (0, import_fields7.text)({ defaultValue: "completed" }),
    completedAt: (0, import_fields7.timestamp)({ defaultValue: { kind: "now" } }),
    ...trackingFields
  }
});
var OutboxEvent = (0, import_core7.list)({
  access: governed("canManagePractice"),
  ui: { listView: { initialColumns: ["topic", "status", "attempts", "nextAttemptAt", "aggregateType", "aggregateId"] } },
  fields: {
    topic: systemText({ indexed: true, required: true }),
    aggregateType: systemText({ required: true }),
    aggregateId: systemText({ indexed: true, required: true }),
    dedupeKey: systemText({ indexed: "unique", required: true }),
    payload: (0, import_fields7.json)({ ...readOnly }),
    status: lifecycle(["pending", "leased", "delivered", "failed", "dead"]),
    attempts: (0, import_fields7.integer)({ defaultValue: 0, ...readOnly }),
    nextAttemptAt: (0, import_fields7.timestamp)({ defaultValue: { kind: "now" }, ...readOnly }),
    leaseOwner: systemText(),
    leaseExpiresAt: (0, import_fields7.timestamp)({ ...readOnly }),
    fencingToken: (0, import_fields7.integer)({ defaultValue: 0, ...readOnly }),
    lastError: systemText(),
    deliveredAt: (0, import_fields7.timestamp)({ ...readOnly }),
    ...trackingFields
  }
});
var Lease = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    key: (0, import_fields7.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    owner: (0, import_fields7.text)({ validation: { isRequired: true } }),
    fencingToken: (0, import_fields7.integer)({ defaultValue: 0, validation: { isRequired: true } }),
    expiresAt: (0, import_fields7.timestamp)({ validation: { isRequired: true } }),
    ...trackingFields
  }
});
var ScheduledJob = (0, import_core7.list)({
  access: governed("canManagePractice"),
  fields: {
    kind: systemText({ indexed: "unique", required: true }),
    intervalSeconds: (0, import_fields7.integer)({ ...readOnly }),
    nextRunAt: (0, import_fields7.timestamp)({ ...readOnly }),
    lastRunAt: (0, import_fields7.timestamp)({ ...readOnly }),
    status: lifecycle(["idle", "running", "failed", "disabled"], "idle"),
    leaseKey: systemText(),
    lastError: systemText(),
    ...trackingFields
  }
});
var Sequence = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    key: (0, import_fields7.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    nextValue: (0, import_fields7.integer)({ defaultValue: 1, validation: { isRequired: true } })
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
    recipient: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    channel: choice(["in_app", "email"], "in_app"),
    template: systemText({ required: true }),
    payload: (0, import_fields7.json)({ ...readOnly }),
    status: lifecycle(["pending", "sent", "failed"]),
    sentAt: (0, import_fields7.timestamp)({ ...readOnly }),
    readAt: (0, import_fields7.timestamp)(),
    ...trackingFields
  }
});
var BusinessCalendar = (0, import_core7.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "code" },
  fields: {
    code: (0, import_fields7.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    name: (0, import_fields7.text)(),
    timeZone: (0, import_fields7.text)({ validation: { isRequired: true }, defaultValue: "America/Los_Angeles" }),
    kind: choice(["federal", "state", "location"], "location"),
    weekendDays: (0, import_fields7.json)({ defaultValue: [0, 6] }),
    regularOpen: (0, import_fields7.text)({ defaultValue: "08:00", ui: { description: "HH:mm local" } }),
    regularClose: (0, import_fields7.text)({ defaultValue: "18:00", ui: { description: "HH:mm local" } }),
    composedOf: (0, import_fields7.relationship)({ ref: "BusinessCalendar", many: true, ui: { description: "Holidays of these calendars also apply (a location calendar composes the federal one)." } }),
    exceptions: (0, import_fields7.relationship)({ ref: "CalendarException.calendar", many: true }),
    coverageThrough: (0, import_fields7.calendarDay)({ ui: { description: "Scheduling past this date is blocked." } }),
    source: (0, import_fields7.text)({ ui: { description: "Where the holiday table came from and when it was checked." } }),
    ...trackingFields
  }
});
var CalendarException = (0, import_core7.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "date", listView: { initialColumns: ["calendar", "date", "kind", "closeAt", "note"] } },
  fields: {
    calendar: (0, import_fields7.relationship)({ ref: "BusinessCalendar.exceptions" }),
    date: (0, import_fields7.calendarDay)({ validation: { isRequired: true } }),
    kind: choice(["holiday", "early_close", "special_open", "closed"], "holiday"),
    openAt: (0, import_fields7.text)(),
    closeAt: (0, import_fields7.text)(),
    note: (0, import_fields7.text)(),
    ...trackingFields
  }
});
var ApprovalPolicy = (0, import_core7.list)({
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManagePractice, update: () => false, delete: () => false } },
  ui: { labelField: "action" },
  fields: {
    action: (0, import_fields7.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    description: (0, import_fields7.text)(),
    requiredPermission: (0, import_fields7.text)({ validation: { isRequired: true } }),
    minApprovals: (0, import_fields7.integer)({ defaultValue: 1, validation: { min: 1 } }),
    thresholdMinor: minor(),
    expiresAfterMinutes: (0, import_fields7.integer)({ defaultValue: 1440 }),
    ...trackingFields
  }
});
var ApprovalRequest = (0, import_core7.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "action", listView: { initialColumns: ["action", "status", "targetList", "requestedBy", "createdAt", "expiresAt"] } },
  fields: {
    action: systemText({ indexed: true, required: true }),
    summary: systemText(),
    targetList: systemText({ required: true }),
    targetId: systemText({ indexed: true, required: true }),
    payload: (0, import_fields7.json)({ ...readOnly }),
    payloadHash: systemText({ required: true }),
    requiredPermission: systemText({ required: true }),
    requestedBy: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    requestedByAgent: (0, import_fields7.relationship)({ ref: "AgentIdentity", ...readOnly }),
    status: lifecycle(["pending", "approved", "rejected", "expired", "cancelled"]),
    expiresAt: (0, import_fields7.timestamp)({ ...readOnly }),
    consumedAt: (0, import_fields7.timestamp)({ ...readOnly, ui: { ...readOnly.ui, description: "When the approved action was carried out. An approval is used once." } }),
    decisions: (0, import_fields7.relationship)({ ref: "ApprovalDecision.request", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var ApprovalDecision = (0, import_core7.list)({
  access: immutable("canAccessDashboard"),
  fields: {
    request: (0, import_fields7.relationship)({ ref: "ApprovalRequest.decisions", ...readOnly }),
    decidedBy: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    decision: (0, import_fields7.select)({ type: "string", options: ["approve", "reject"].map((value) => ({ label: value, value })), validation: { isRequired: true }, ...readOnly }),
    reason: systemText(),
    at: (0, import_fields7.timestamp)({ defaultValue: { kind: "now" }, ...readOnly })
  }
});
var Document = (0, import_core7.list)({
  access: governed("canAccessDashboard"),
  fields: {
    title: (0, import_fields7.text)({ validation: { isRequired: true } }),
    kind: choice(["dea_form", "licence", "policy", "consent", "certificate", "records_packet", "invoice", "statement", "report", "import", "other"], "other"),
    storageKey: systemText(),
    sha256: systemText(),
    mimeType: systemText(),
    sizeBytes: (0, import_fields7.integer)({ ...readOnly }),
    documentVersion: (0, import_fields7.integer)({ defaultValue: 1, ...readOnly }),
    supersedes: (0, import_fields7.relationship)({ ref: "Document", ...readOnly }),
    visibility: choice(["internal", "client", "public"], "internal"),
    retentionUntil: (0, import_fields7.calendarDay)(),
    signedAt: (0, import_fields7.timestamp)({ ...readOnly }),
    esignEnvelopeId: systemText(),
    ...trackingFields
  }
});
var SecretBox = (0, import_core7.list)({
  access: serverOnly,
  graphql: { omit: true },
  ui: { isHidden: true },
  fields: {
    purpose: (0, import_fields7.text)({ validation: { isRequired: true } }),
    ciphertext: (0, import_fields7.text)({ validation: { isRequired: true } }),
    iv: (0, import_fields7.text)({ validation: { isRequired: true } }),
    authTag: (0, import_fields7.text)({ validation: { isRequired: true } }),
    keyVersion: (0, import_fields7.integer)({ defaultValue: 1 }),
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
    fields: (0, import_fields7.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Field names returned (never values)." } }),
    requestId: systemText(),
    at: (0, import_fields7.timestamp)({ defaultValue: { kind: "now" }, ...readOnly })
  }
});
var BreakGlassEvent = (0, import_core7.list)({
  access: governed("canReadAudit"),
  fields: {
    user: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    resourceType: systemText({ required: true }),
    resourceId: systemText({ required: true }),
    reason: systemText({ required: true }),
    status: lifecycle(["open", "reviewed", "escalated"]),
    reviewedBy: (0, import_fields7.relationship)({ ref: "User", ...readOnly }),
    reviewedAt: (0, import_fields7.timestamp)({ ...readOnly }),
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
    contentHash: systemText({ required: true }),
    payload: (0, import_fields7.json)({ ...readOnly }),
    receivedAt: (0, import_fields7.timestamp)({ defaultValue: { kind: "now" }, ...readOnly }),
    processedAt: (0, import_fields7.timestamp)({ ...readOnly }),
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
    location: (0, import_fields7.relationship)({ ref: "Location", ...readOnly }),
    /** Name of the SecretBox entry holding the credential; the secret itself never leaves the server. */
    secretRef: systemText(),
    capabilityProfile: (0, import_fields7.json)({ ...readOnly }),
    status: lifecycle(["active", "paused", "error", "retired"]),
    lastHealthAt: (0, import_fields7.timestamp)({ ...readOnly }),
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
var import_fields8 = require("@keystone-6/core/fields");
var PracticeSettings = (0, import_core8.list)({
  isSingleton: true,
  graphql: { plural: "PracticeSettingsItems" },
  access: { operation: { query: permissions.canAccessDashboard, create: permissions.canManagePractice, update: permissions.canManagePractice, delete: () => false } },
  fields: {
    legalName: (0, import_fields8.text)({ validation: { isRequired: true }, defaultValue: "Openfront Vet Clinic" }),
    displayName: (0, import_fields8.text)({ validation: { isRequired: true }, defaultValue: "Openfront Vet Clinic" }),
    homeTimeZone: (0, import_fields8.text)({ defaultValue: "America/Los_Angeles", validation: { isRequired: true } }),
    currencyCode: (0, import_fields8.text)({ defaultValue: "USD", validation: { isRequired: true, match: { regex: /^[A-Z]{3}$/ } } }),
    medicalDirector: (0, import_fields8.relationship)({ ref: "StaffMember", ui: { description: "Registrant contact for controlled substances." } }),
    estimateValidityDays: (0, import_fields8.integer)({ defaultValue: 30, validation: { min: 1, max: 365 } }),
    estimateOverageToleranceBps: (0, import_fields8.integer)({ defaultValue: 0, validation: { min: 0, max: 1e4 } }),
    electiveDepositPct: rate({ description: "Fraction of the estimate low end taken as a deposit for elective work (0.5 = 50%)." }),
    depositBasis: choice(["low", "high"], "low"),
    noShowGraceMinutes: (0, import_fields8.integer)({ defaultValue: 15, validation: { min: 0, max: 240 } }),
    unsignedRecordTaskHours: (0, import_fields8.integer)({ defaultValue: 24 }),
    unsignedRecordEscalateHours: (0, import_fields8.integer)({ defaultValue: 72 }),
    refundApprovalThresholdMinor: minor({ defaultValue: 25000n }),
    discountApprovalThresholdBps: (0, import_fields8.integer)({ defaultValue: 1e3 }),
    writeOffRequiresApproval: (0, import_fields8.checkbox)({ defaultValue: true }),
    weightMaxAgeHours: (0, import_fields8.json)({ defaultValue: { anaesthesia: 24, inpatient: 72, outpatient: 720 } }),
    features: (0, import_fields8.json)({ defaultValue: { boarding: true, grooming: true, wellnessPlans: true, insurance: true, aiVoice: false, scribe: false, multiLocation: true, pdmp: true, csos: false, drugCabinet: false } }),
    // Agents' owner can never be the checker of what the agent proposed (separation of duties).
    strictAgentOwnerSoD: (0, import_fields8.checkbox)({ ...readOnly, defaultValue: true }),
    onboardingStatus: choice(["not_started", "in_progress", "completed", "dismissed"], "not_started"),
    version: versionField(),
    ...trackingFields
  }
});
var Location = (0, import_core8.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name", listView: { initialColumns: ["name", "code", "kind", "stateCode", "timeZone", "active"] } },
  fields: {
    name: (0, import_fields8.text)({ validation: { isRequired: true } }),
    code: (0, import_fields8.text)({ isIndexed: "unique", validation: { isRequired: true, match: { regex: /^[A-Z0-9-]{3,24}$/, explanation: "Capital letters, digits and dashes." } } }),
    kind: choice(["general_practice", "emergency", "specialty", "wellness", "mobile"], "general_practice"),
    addressLine1: (0, import_fields8.text)(),
    addressLine2: (0, import_fields8.text)(),
    city: (0, import_fields8.text)(),
    postalCode: (0, import_fields8.text)(),
    stateCode: (0, import_fields8.text)({ validation: { isRequired: true, match: { regex: /^US-[A-Z]{2}$/, explanation: "ISO 3166-2, e.g. US-CA." } } }),
    lat: geo(),
    lng: geo(),
    timeZone: (0, import_fields8.text)({ validation: { isRequired: true }, defaultValue: "America/Los_Angeles" }),
    phone: (0, import_fields8.text)(),
    email: (0, import_fields8.text)(),
    calendar: (0, import_fields8.relationship)({ ref: "BusinessCalendar" }),
    openHours: (0, import_fields8.json)({ ui: { description: 'Per weekday open/close "HH:mm" in the location time zone.' } }),
    emergencyCoverage: choice(["none", "in_house", "referral"], "referral"),
    deaRegistrations: (0, import_fields8.relationship)({ ref: "DeaRegistration.location", many: true, ...readOnly }),
    active: (0, import_fields8.checkbox)({ defaultValue: true }),
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
    staffMember: (0, import_fields8.relationship)({ ref: "StaffMember", ...readOnly }),
    location: (0, import_fields8.relationship)({ ref: "Location.deaRegistrations", ...readOnly }),
    schedules: (0, import_fields8.json)({ ...readOnly, ui: { ...readOnly.ui, description: 'Schedules covered, e.g. ["2","2N","3","3N","4","5"].' } }),
    issuedOn: (0, import_fields8.calendarDay)({ ...readOnly }),
    expiresOn: (0, import_fields8.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    stateCsRegistration: systemText(),
    csosCertificateRef: systemText(),
    powersOfAttorney: (0, import_fields8.relationship)({ ref: "DeaPowerOfAttorney.registration", many: true, ...readOnly }),
    status: lifecycle(["active", "expired", "surrendered", "revoked"]),
    version: versionField(),
    ...trackingFields
  }
});
var DeaPowerOfAttorney = (0, import_core8.list)({
  access: governed("canViewControlled"),
  fields: {
    registration: (0, import_fields8.relationship)({ ref: "DeaRegistration.powersOfAttorney", ...readOnly }),
    grantee: (0, import_fields8.relationship)({ ref: "StaffMember", ...readOnly }),
    signedOn: (0, import_fields8.calendarDay)({ ...readOnly }),
    revokedOn: (0, import_fields8.calendarDay)({ ...readOnly }),
    document: (0, import_fields8.relationship)({ ref: "Document", ...readOnly }),
    ...trackingFields
  }
});
var StaffMember = (0, import_core8.list)({
  access: managed("canAccessDashboard", "canManagePeople"),
  ui: { labelField: "displayName", listView: { initialColumns: ["displayName", "kind", "credentials", "homeLocation", "employment", "active"] } },
  fields: {
    user: (0, import_fields8.relationship)({ ref: "User.staffMember" }),
    displayName: (0, import_fields8.text)({ validation: { isRequired: true } }),
    kind: choice(["dvm", "rvt", "assistant", "csr", "groomer", "manager", "inventory", "bookkeeper", "kennel"]),
    credentials: (0, import_fields8.text)({ ui: { description: 'e.g. "DVM, DACVS".' } }),
    employment: choice(["employee", "relief", "contractor"], "employee"),
    homeLocation: (0, import_fields8.relationship)({ ref: "Location" }),
    locations: (0, import_fields8.relationship)({ ref: "Location", many: true }),
    colour: (0, import_fields8.text)(),
    licenses: (0, import_fields8.relationship)({ ref: "ProfessionalLicense.staffMember", many: true, ...readOnly }),
    active: (0, import_fields8.checkbox)({ defaultValue: true }),
    ...trackingFields
  }
});
var ProfessionalLicense = (0, import_core8.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "licenseNumber", listView: { initialColumns: ["staffMember", "kind", "stateCode", "licenseNumber", "status", "expiresOn"] } },
  fields: {
    staffMember: (0, import_fields8.relationship)({ ref: "StaffMember.licenses", ...readOnly }),
    kind: fixedChoice(["veterinarian", "registered_veterinary_technician", "veterinary_assistant_cs_permit", "groomer_cert"]),
    stateCode: systemText({ required: true }),
    licenseNumber: systemText({ required: true }),
    issuedOn: (0, import_fields8.calendarDay)({ ...readOnly }),
    expiresOn: (0, import_fields8.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    status: lifecycle(["active", "expired", "suspended", "revoked"]),
    verifiedAt: (0, import_fields8.timestamp)({ ...readOnly }),
    verifiedBy: (0, import_fields8.relationship)({ ref: "User", ...readOnly }),
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
    staffMember: (0, import_fields8.relationship)({ ref: "StaffMember", ...readOnly }),
    location: (0, import_fields8.relationship)({ ref: "Location", ...readOnly }),
    at: (0, import_fields8.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    onDate: (0, import_fields8.calendarDay)({ ...readOnly }),
    license: (0, import_fields8.relationship)({ ref: "ProfessionalLicense", ...readOnly }),
    deaRegistration: (0, import_fields8.relationship)({ ref: "DeaRegistration", ...readOnly }),
    policyVersions: (0, import_fields8.json)({ ...readOnly }),
    result: fixedChoice(["allowed", "blocked"]),
    findings: (0, import_fields8.json)({ ...readOnly })
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
var import_fields9 = require("@keystone-6/core/fields");
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
    versions: (0, import_fields9.relationship)({ ref: "PolicyVersion.pack", many: true, ...readOnly }),
    ...trackingFields
  }
});
var PolicyVersion = (0, import_core9.list)({
  access: immutable("canAccessDashboard"),
  ui: { labelField: "label", listView: { initialColumns: ["pack", "label", "status", "effectiveFrom", "effectiveTo", "verified"] } },
  fields: {
    pack: (0, import_fields9.relationship)({ ref: "PolicyPack.versions", ...readOnly }),
    label: systemText({ required: true }),
    versionNumber: (0, import_fields9.integer)({ ...readOnly, validation: { isRequired: true } }),
    rules: (0, import_fields9.json)({ ...readOnly }),
    rulesHash: systemText({ required: true }),
    sourceRefs: (0, import_fields9.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Citations: [{ ref, title, url, section }]." } }),
    verified: (0, import_fields9.checkbox)({ ...readOnly, defaultValue: false }),
    unverifiedRules: (0, import_fields9.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Rule paths still marked (verify)." } }),
    verifiedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    effectiveFrom: (0, import_fields9.calendarDay)({ ...readOnly, validation: { isRequired: true } }),
    effectiveTo: (0, import_fields9.calendarDay)({ ...readOnly }),
    status: lifecycle(["draft", "published", "superseded"]),
    approval: (0, import_fields9.relationship)({ ref: "ApprovalRequest", ...readOnly }),
    publishedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    publishedBy: (0, import_fields9.relationship)({ ref: "User", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var PolicyBinding = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  fields: {
    pack: (0, import_fields9.relationship)({ ref: "PolicyPack", ...readOnly }),
    scope: fixedChoice(["practice", "location"]),
    location: (0, import_fields9.relationship)({ ref: "Location", ...readOnly }),
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
    location: (0, import_fields9.relationship)({ ref: "Location", ...readOnly }),
    startedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    dueAt: (0, import_fields9.timestamp)({ ...readOnly, validation: { isRequired: true } }),
    dedupeKey: systemText({ indexed: "unique" }),
    escalations: (0, import_fields9.json)({ ...readOnly }),
    status: lifecycle(["open", "done", "overdue", "waived"]),
    evidence: (0, import_fields9.json)({ ...readOnly }),
    policyVersion: (0, import_fields9.relationship)({ ref: "PolicyVersion", ...readOnly }),
    completedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    completedBy: (0, import_fields9.relationship)({ ref: "User", ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Task = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "title", listView: { initialColumns: ["title", "kind", "priority", "assignee", "dueAt", "status"], initialSort: { field: "dueAt", direction: "ASC" } } },
  fields: {
    ref: systemText({ indexed: "unique" }),
    kind: fixedChoice(["call_back", "refill_review", "result_review", "record_unsigned", "records_request", "registration_review", "follow_up", "agent_handoff", "general"]),
    title: systemText({ required: true }),
    detail: (0, import_fields9.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    subjectType: systemText(),
    subjectId: systemText({ indexed: true }),
    location: (0, import_fields9.relationship)({ ref: "Location", ...readOnly }),
    assignee: (0, import_fields9.relationship)({ ref: "StaffMember", ...readOnly }),
    roleName: systemText(),
    priority: fixedChoice(["urgent", "high", "normal", "low"]),
    dueAt: (0, import_fields9.timestamp)({ ...readOnly }),
    status: lifecycle(["open", "in_progress", "done", "cancelled"]),
    createdByAgent: (0, import_fields9.relationship)({ ref: "AgentIdentity", ...readOnly }),
    createdByUser: (0, import_fields9.relationship)({ ref: "User", ...readOnly }),
    completedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Note = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  fields: {
    subjectType: systemText({ required: true }),
    subjectId: systemText({ indexed: true, required: true }),
    body: (0, import_fields9.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    visibility: fixedChoice(["staff", "clinical"]),
    author: (0, import_fields9.relationship)({ ref: "User", ...readOnly }),
    authorAgent: (0, import_fields9.relationship)({ ref: "AgentIdentity", ...readOnly }),
    ...trackingFields
  }
});
var Tag = (0, import_core9.list)({
  access: managed("signedIn", "canManagePractice"),
  ui: { labelField: "name" },
  fields: {
    name: (0, import_fields9.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    colour: (0, import_fields9.text)(),
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
    placedBy: (0, import_fields9.relationship)({ ref: "User", ...readOnly }),
    placedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    releasedBy: (0, import_fields9.relationship)({ ref: "User", ...readOnly }),
    releasedAt: (0, import_fields9.timestamp)({ ...readOnly }),
    status: lifecycle(["active", "released"]),
    version: versionField(),
    ...trackingFields
  }
});
var RetentionPolicy = (0, import_core9.list)({
  access: governed("canAccessDashboard"),
  fields: {
    recordClass: systemText({ indexed: "unique", required: true }),
    retainYears: (0, import_fields9.integer)({ ...readOnly, validation: { isRequired: true, min: 1 } }),
    from: fixedChoice(["last_visit", "record_date", "death", "account_closed"]),
    policyVersion: (0, import_fields9.relationship)({ ref: "PolicyVersion", ...readOnly }),
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
    detail: (0, import_fields9.text)({ ...readOnly, ui: { ...readOnly.ui, displayMode: "textarea" } }),
    location: (0, import_fields9.relationship)({ ref: "Location", ...readOnly }),
    discoveredAt: (0, import_fields9.timestamp)({ ...readOnly }),
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
    name: (0, import_fields9.text)({ isIndexed: "unique", validation: { isRequired: true } }),
    purpose: (0, import_fields9.text)({ validation: { isRequired: true } }),
    secretHash: (0, import_fields9.text)({ validation: { isRequired: true } }),
    lastUsedAt: (0, import_fields9.timestamp)(),
    revokedAt: (0, import_fields9.timestamp)(),
    ...trackingFields
  }
});

// features/keystone/models/agents.ts
var import_core10 = require("@keystone-6/core");
var import_fields10 = require("@keystone-6/core/fields");
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
var AgentToolGrant = (0, import_core10.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "scope", listView: { initialColumns: ["agent", "scope", "status", "createdAt"] } },
  fields: {
    agent: (0, import_fields10.relationship)({ ref: "AgentIdentity.grants", ...readOnly }),
    scope: fixedChoice(AGENT_SCOPES),
    constraints: (0, import_fields10.json)({ ...readOnly, ui: { ...readOnly.ui, description: 'Limits, e.g. {"locations":["\u2026"],"maxBookingsPerCall":3}.' } }),
    status: lifecycle(["requested", "active", "revoked"]),
    approval: (0, import_fields10.relationship)({ ref: "ApprovalRequest", ...readOnly }),
    revokedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var AgentRun = (0, import_core10.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "promptHash", listView: { initialColumns: ["agent", "status", "startedAt", "endedAt"] } },
  fields: {
    agent: (0, import_fields10.relationship)({ ref: "AgentIdentity.runs", ...readOnly }),
    startedAt: (0, import_fields10.timestamp)({ defaultValue: { kind: "now" }, ...readOnly }),
    endedAt: (0, import_fields10.timestamp)({ ...readOnly }),
    status: lifecycle(["started", "completed", "failed", "aborted"]),
    promptHash: systemText(),
    toolCalls: (0, import_fields10.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Tool names and argument hashes, never raw arguments." } }),
    costMeta: (0, import_fields10.json)({ ...readOnly }),
    callRecordId: systemText({ indexed: true }),
    proposals: (0, import_fields10.relationship)({ ref: "Proposal.agentRun", many: true, ...readOnly }),
    version: versionField(),
    ...trackingFields
  }
});
var Proposal = (0, import_core10.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "kind", listView: { initialColumns: ["kind", "status", "proposedByAgent", "proposedByUser", "createdAt"] } },
  fields: {
    kind: fixedChoice(PROPOSAL_KINDS),
    payload: (0, import_fields10.json)({ ...readOnly }),
    payloadHash: systemText({ required: true }),
    status: lifecycle(["proposed", "validated", "approved", "rejected", "expired", "applied"]),
    agentRun: (0, import_fields10.relationship)({ ref: "AgentRun.proposals", ...readOnly }),
    proposedByAgent: (0, import_fields10.relationship)({ ref: "AgentIdentity", ...readOnly }),
    proposedByUser: (0, import_fields10.relationship)({ ref: "User", ...readOnly }),
    targetList: systemText(),
    targetId: systemText({ indexed: true }),
    approval: (0, import_fields10.relationship)({ ref: "ApprovalRequest", ...readOnly }),
    validation: (0, import_fields10.json)({ ...readOnly, ui: { ...readOnly.ui, description: "Check results recorded when the proposal was validated." } }),
    version: versionField(),
    ...trackingFields
  }
});
var AgentAction = (0, import_core10.list)({
  access: governed("canAccessDashboard"),
  ui: { labelField: "tool", listView: { initialColumns: ["tool", "outcome", "agent", "at"] } },
  fields: {
    agent: (0, import_fields10.relationship)({ ref: "AgentIdentity", ...readOnly }),
    run: (0, import_fields10.relationship)({ ref: "AgentRun", ...readOnly }),
    tool: systemText({ indexed: true, required: true }),
    argsHash: systemText(),
    outcome: fixedChoice(["ok", "scope_denied", "never_allowed", "guard_failed", "error", "killed"]),
    errorCode: systemText(),
    auditEventId: systemText(),
    at: (0, import_fields10.timestamp)({ defaultValue: { kind: "now" }, ...readOnly })
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
  AgentToolGrant,
  AgentRun,
  AgentAction,
  Proposal
};

// features/keystone/index.ts
var import_session = require("@keystone-6/core/session");

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
  if (Object.keys(data || {}).some((key) => !allowed.has(key))) throw new Error("Unsupported profile field");
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

// features/keystone/mutations/op.ts
var UNSAFE = /prisma|invocation|\bat\s+\S+\s*\(|node_modules|postgres(ql)?:\/\/|\bSQL\b|ECONN|query engine|\.ts:\d+|\.js:\d+/i;
var SAFE_DETAIL_KEYS = /* @__PURE__ */ new Set(["currentStatus", "currentVersion", "to", "reason", "field", "problems", "replay"]);
var op = (fn) => async (root, args, context) => {
  try {
    return await fn(root, args, context);
  } catch (error) {
    if (error instanceof import_graphql.GraphQLError) throw error;
    if (isDomainError(error)) {
      const details = Object.fromEntries(Object.entries(error.details).filter(([key]) => SAFE_DETAIL_KEYS.has(key)));
      throw new import_graphql.GraphQLError(error.message, { extensions: { code: error.code, ...details } });
    }
    const message = typeof error?.message === "string" ? error.message : "";
    console.error("Operation failed:", message.slice(0, 300).replace(/postgres(ql)?:\/\/\S+/g, "<url>"));
    const safe = message && message.length <= 300 && !UNSAFE.test(message) && !error?.code;
    throw new import_graphql.GraphQLError(safe ? message : "Unable to complete the request. Please try again.", { extensions: { code: "KS_USER_INPUT_ERROR" } });
  }
};

// features/keystone/lib/actor.ts
function actorFromSession(session) {
  if (!session || !isSignedIn({ session })) throw new DomainError(Codes.NOT_AUTHORIZED, "Sign in to continue.");
  const role = session.data.role;
  const granted = new Set(role ? permissionNames.filter((name) => role[name] === true) : []);
  return { kind: "user", userId: session.itemId, name: session.data.name, permissions: granted };
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
var DECIMAL_TEXT = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
function dec(value) {
  if (value instanceof Decimal) return value;
  if (typeof value === "bigint") return new Decimal(value.toString());
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error(`Refusing float ${value}: pass the exact decimal as a string`);
    return new Decimal(value);
  }
  const text9 = String(value).trim();
  if (!DECIMAL_TEXT.test(text9)) throw new Error(`Not a decimal number: ${JSON.stringify(text9).slice(0, 40)}`);
  return new Decimal(text9);
}
var plain = (value) => dec(value).toFixed();
var ZERO = new Decimal(0);
var ONE = new Decimal(1);
var BPS = new Decimal(1e4);
var KG_PER_LB = new Decimal("0.45359237");

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
      Object.entries(value).filter(([, entry]) => entry !== void 0).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  throw new Error(`Canonical JSON cannot hold a ${typeof value}`);
}
var canonicalJson = (value) => JSON.stringify(canonicalize(value));
var sha256 = (text9) => (0, import_node_crypto2.createHash)("sha256").update(text9).digest("hex");
var payloadHash = (value) => sha256(canonicalJson(value));
var toJsonValue = (value) => canonicalize(value);

// features/keystone/lib/db.ts
async function advisoryLock(tx, key) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
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
var TRANSACTION_OPTIONS = { maxWait: 15e3, timeout: 6e4 };

// features/keystone/lib/idempotency.ts
var IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,200}$/;
function assertIdempotencyKey(key) {
  if (typeof key !== "string" || !key.trim()) throw new DomainError(Codes.IDEMPOTENCY_KEY_REQUIRED, "An idempotency key is required.");
  if (!IDEMPOTENCY_KEY.test(key)) throw new DomainError(Codes.INVALID_INPUT, "The idempotency key must be 8 to 200 letters, digits or . _ : -");
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
var import_node_crypto3 = require("node:crypto");
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
      eventKey: event.eventKey ?? (0, import_node_crypto3.randomUUID)(),
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
    const hash = auditHash(prevHash, row);
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
      hash,
      at: row.at
    });
    written.push({ seq, hash });
    prevHash = hash;
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
      const hash = auditHash(prevHash, {
        ...row,
        reason: row.reason || null,
        requestId: row.requestId || null,
        actorUserId: row.actorUserId ?? null,
        actorAgentId: row.actorAgentId ?? null,
        approverId: row.approverId ?? null
      });
      if (hash !== row.hash) return { ok: false, count, lastSeq: row.seq - 1, lastHash: prevHash, brokenAtSeq: row.seq, problem: "content does not match its hash" };
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
    this.outbox = [];
  }
  audit(event) {
    this.audits.push({ requestId: this.requestId, ...event });
  }
  emit(message) {
    this.outbox.push(message);
  }
};
async function flushOutbox(tx, messages, now) {
  for (const message of messages) {
    const payload = toJsonValue(message.payload);
    const dedupeKey = message.dedupeKey ?? `${message.topic}:${message.aggregateType}:${message.aggregateId}:${sha256(canonicalJson(payload))}`;
    await tx.outboxEvent.upsert({
      where: { dedupeKey },
      create: {
        topic: message.topic,
        aggregateType: message.aggregateType,
        aggregateId: message.aggregateId,
        dedupeKey,
        payload,
        status: "pending",
        nextAttemptAt: message.availableAt ?? now
      },
      update: {}
    });
  }
}
async function runInTransaction(db, work, options = {}) {
  return db.$transaction(async (tx) => {
    const uow = new UnitOfWork(tx, options.now ?? /* @__PURE__ */ new Date(), options.requestId ?? null);
    const result = await work(uow);
    await flushOutbox(tx, uow.outbox, uow.now);
    await appendAuditEvents(tx, uow.audits, uow.now);
    return result;
  }, TRANSACTION_OPTIONS);
}

// features/keystone/lib/command.ts
var RETRYABLE = /deadlock detected|could not serialize|P2034|40P01|40001/i;
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
      throw error;
    }
  }
}

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
var zoneParts = (timeZone, at) => Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
function localDate(calendar, at) {
  const p = zoneParts(calendar.timeZone, typeof at === "number" ? at : at.getTime());
  return `${p.year}-${p.month}-${p.day}`;
}

// features/keystone/lib/cas.ts
var COLUMN = /^[a-z][A-Za-z0-9]*$/;
async function lockRow(tx, model, id) {
  const rows = await tx.$queryRawUnsafe(`SELECT id FROM ${tableName(model)} WHERE id = $1 FOR UPDATE`, id);
  if (!rows.length) throw new DomainError(Codes.NOT_FOUND, `${model} not found.`, { model, id });
  const row = await delegateOf(tx, model).findUnique({ where: { id } });
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
function auditCreate(uow, actor, model, id, eventType, after, extra = {}) {
  uow.audit({
    eventType,
    entityType: model,
    entityId: id,
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
async function resolvePolicy(tx, kind, input) {
  const bindings = await tx.policyBinding.findMany({
    where: { pack: { kind }, OR: [{ scope: "practice" }, { scope: "location", locationId: input.locationId }] },
    select: { layer: true, pack: { select: { id: true, code: true } } }
  });
  const packs = bindings.filter((b) => b.pack).map((b) => ({ id: b.pack.id, code: b.pack.code, layer: b.layer }));
  const unique = [...new Map(packs.map((p) => [p.code, p])).values()];
  const versions = unique.length ? await tx.policyVersion.findMany({ where: { packId: { in: unique.map((p) => p.id) } }, select: { id: true, packId: true, status: true, effectiveFrom: true, effectiveTo: true, rules: true, verified: true, unverifiedRules: true } }) : [];
  const candidates = versions.map((v) => {
    const pack = unique.find((p) => p.id === v.packId);
    return {
      id: v.id,
      packCode: pack.code,
      layer: pack.layer,
      status: String(v.status),
      effectiveFrom: isoDay(v.effectiveFrom),
      effectiveTo: isoDay(v.effectiveTo),
      rules: v.rules,
      verified: v.verified === true,
      unverifiedRules: Array.isArray(v.unverifiedRules) ? v.unverifiedRules : []
    };
  });
  return selectAndMerge(kind, input.on, unique.map((p) => p.code), candidates);
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
    email: "frontdesk@cedarcreek.example.com",
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
    email: "elkgrove@cedarcreek.example.com",
    regularOpen: "09:00",
    regularClose: "17:00",
    closures: ["2026-12-24", "2026-12-31", "2027-12-24"],
    openHours: WEEKDAYS("09:00", "17:00", null),
    emergencyCoverage: "referral"
  }
];
var DASH = ["canAccessDashboard", "canSeeOtherPeople"];
var FRONT = ["canManageClients", "canManagePatients", "canReadClientPII", "canBook", "canCheckIn", "canMessageClients", "canTakePayments"];
var CLINICAL_READ = ["canReadClinical", "canReadClientPII"];
var ROLES = [
  {
    id: "seed_role_owner",
    name: "Owner / Medical Director",
    description: "Everything clinical and operational, incl. policies, fees, integrations, CS registrant duties and approvals. Break-glass is never seeded.",
    permissions: [
      ...DASH,
      ...FRONT,
      ...CLINICAL_READ,
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
      ...CLINICAL_READ,
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
      ...CLINICAL_READ,
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
    permissions: [...DASH, ...FRONT, ...CLINICAL_READ, "canWriteRecord", "canOrder", "canAdminister", "canDispense", "canFulfilRefill", "canAdministerControlled", "canWitnessControlled", "canCountControlled", "canReceiveControlled", "canViewControlled", "canManageBoarding"]
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
  { id: "seed_role_agent_owner", name: "Agent Owner", description: "Owns AI agent identities and requests their grants; a second person approves.", permissions: [...DASH, "canManageAgents"] }
];
var BOTH = ["seed_loc_main", "seed_loc_elkgrove"];
var MAIN = ["seed_loc_main"];
var STAFF = [
  { id: "seed_staff_marsh", userId: "seed_user_marsh", name: "Dr. Elena Marsh", email: "elena.marsh@cedarcreek.example.com", title: "Owner & Medical Director", roleId: "seed_role_owner", kind: "dvm", credentials: "DVM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff", licence: { kind: "veterinarian", number: "VET 14862", issuedOn: "2009-07-01", expiresOn: "2027-06-30" } },
  { id: "seed_staff_okafor", userId: "seed_user_okafor", name: "Dr. Samuel Okafor", email: "samuel.okafor@cedarcreek.example.com", title: "Associate Veterinarian", roleId: "seed_role_dvm", kind: "dvm", credentials: "DVM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "veterinarian", number: "VET 19214", issuedOn: "2015-08-01", expiresOn: "2027-01-31" } },
  { id: "seed_staff_desai", userId: "seed_user_desai", name: "Dr. Priya Desai", email: "priya.desai@cedarcreek.example.com", title: "Associate Veterinarian", roleId: "seed_role_dvm", kind: "dvm", credentials: "DVM, DABVP", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: BOTH, userKind: "staff", licence: { kind: "veterinarian", number: "VET 21577", issuedOn: "2018-06-15", expiresOn: "2028-05-31" } },
  { id: "seed_staff_bennett", userId: "seed_user_bennett", name: "Dr. Lucas Bennett", email: "lucas.bennett@cedarcreek.example.com", title: "Associate Veterinarian", roleId: "seed_role_dvm", kind: "dvm", credentials: "DVM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "veterinarian", number: "VET 23940", issuedOn: "2021-07-01", expiresOn: "2026-10-31" } },
  { id: "seed_staff_cole", userId: "seed_user_cole", name: "Dr. Hannah Cole", email: "hannah.cole@cedarcreek.example.com", title: "Relief Veterinarian", roleId: "seed_role_relief_dvm", kind: "dvm", credentials: "DVM", employment: "relief", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "relief", accessDays: 90, licence: { kind: "veterinarian", number: "VET 20488", issuedOn: "2017-01-10", expiresOn: "2027-12-31" } },
  { id: "seed_staff_lopez", userId: "seed_user_lopez", name: "Maria Lopez", email: "maria.lopez@cedarcreek.example.com", title: "Lead RVT (controlled substances)", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 11873", issuedOn: "2012-03-01", expiresOn: "2027-02-28" } },
  { id: "seed_staff_price", userId: "seed_user_price", name: "Jordan Price", email: "jordan.price@cedarcreek.example.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 15302", issuedOn: "2016-09-01", expiresOn: "2027-08-31" } },
  { id: "seed_staff_rahman", userId: "seed_user_rahman", name: "Aisha Rahman", email: "aisha.rahman@cedarcreek.example.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: BOTH, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 16944", issuedOn: "2018-02-01", expiresOn: "2028-01-31" } },
  { id: "seed_staff_tran", userId: "seed_user_tran", name: "Kevin Tran", email: "kevin.tran@cedarcreek.example.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 17411", issuedOn: "2019-05-01", expiresOn: "2027-04-30" } },
  { id: "seed_staff_nguyen", userId: "seed_user_nguyen", name: "Beth Nguyen", email: "beth.nguyen@cedarcreek.example.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 18066", issuedOn: "2020-06-01", expiresOn: "2028-05-31" } },
  { id: "seed_staff_vega", userId: "seed_user_vega", name: "Carlos Vega", email: "carlos.vega@cedarcreek.example.com", title: "RVT", roleId: "seed_role_rvt", kind: "rvt", credentials: "RVT", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff", licence: { kind: "registered_veterinary_technician", number: "RVT 18523", issuedOn: "2021-01-15", expiresOn: "2027-01-14" } },
  { id: "seed_staff_ellis", userId: "seed_user_ellis", name: "Noah Ellis", email: "noah.ellis@cedarcreek.example.com", title: "Veterinary Assistant", roleId: "seed_role_assistant", kind: "assistant", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_ito", userId: "seed_user_ito", name: "Mika Ito", email: "mika.ito@cedarcreek.example.com", title: "Veterinary Assistant", roleId: "seed_role_assistant", kind: "assistant", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_brooks", userId: "seed_user_brooks", name: "Dana Brooks", email: "dana.brooks@cedarcreek.example.com", title: "Kennel Attendant", roleId: "seed_role_assistant", kind: "kennel", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_ochoa", userId: "seed_user_ochoa", name: "Luis Ochoa", email: "luis.ochoa@cedarcreek.example.com", title: "Veterinary Assistant", roleId: "seed_role_assistant", kind: "assistant", credentials: "", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: ["seed_loc_elkgrove"], userKind: "staff" },
  { id: "seed_staff_reed", userId: "seed_user_reed", name: "Grace Reed", email: "grace.reed@cedarcreek.example.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_patel", userId: "seed_user_patel", name: "Ravi Patel", email: "ravi.patel@cedarcreek.example.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_kim", userId: "seed_user_kim", name: "Sun Kim", email: "sun.kim@cedarcreek.example.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_elkgrove", locationIds: ["seed_loc_elkgrove"], userKind: "staff" },
  { id: "seed_staff_fox", userId: "seed_user_fox", name: "Amelia Fox", email: "amelia.fox@cedarcreek.example.com", title: "Client Service Representative", roleId: "seed_role_csr", kind: "csr", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_morgan", userId: "seed_user_morgan", name: "Tess Morgan", email: "tess.morgan@cedarcreek.example.com", title: "Groomer", roleId: "seed_role_groomer", kind: "groomer", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: MAIN, userKind: "staff" },
  { id: "seed_staff_park", userId: "seed_user_park", name: "Linda Park", email: "linda.park@cedarcreek.example.com", title: "Practice Manager", roleId: "seed_role_manager", kind: "manager", credentials: "CVPM", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff" },
  { id: "seed_staff_shah", userId: "seed_user_shah", name: "Omar Shah", email: "omar.shah@cedarcreek.example.com", title: "Inventory Lead", roleId: "seed_role_inventory", kind: "inventory", credentials: "", employment: "employee", homeLocationId: "seed_loc_main", locationIds: BOTH, userKind: "staff" }
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
      const { id, code: locCode, name, kind, addressLine1, city, postalCode, stateCode, lat, lng, timeZone, phone, email, openHours, emergencyCoverage } = loc;
      await tx.location.create({ data: { id, code: locCode, name, kind, addressLine1, city, postalCode, stateCode, lat, lng, timeZone, phone, email, openHours, emergencyCoverage, calendarId: cal.id } });
      auditCreate(uow, actor, "Location", id, "location.created", { code: locCode, name, stateCode, timeZone }, meta);
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
  for (const person of STAFF) {
    if (await tx.staffMember.findUnique({ where: { id: person.id } })) continue;
    const user = await tx.user.findFirst({ where: { OR: [{ id: person.userId }, { email: person.email }] }, select: { id: true } });
    await tx.staffMember.create({
      data: {
        id: person.id,
        displayName: person.name,
        kind: person.kind,
        credentials: person.credentials,
        employment: person.employment,
        homeLocationId: person.homeLocationId,
        locations: { connect: person.locationIds.map((id) => ({ id })) },
        ...user ? { userId: user.id } : {}
      }
    });
    auditCreate(uow, actor, "StaffMember", person.id, "staff.created", { name: person.name, kind: person.kind, employment: person.employment }, meta);
    created.staff += 1;
    if (person.licence) {
      const id = `${person.id.replace("seed_staff_", "seed_lic_")}`;
      await tx.professionalLicense.create({
        data: { id, staffMemberId: person.id, kind: person.licence.kind, stateCode: "US-CA", licenseNumber: person.licence.number, issuedOn: DAY(person.licence.issuedOn), expiresOn: DAY(person.licence.expiresOn), status: "active", verifiedAt: now, verificationSource: "Seed (fictional licence; verify against the board in production)" }
      });
      auditCreate(uow, actor, "ProfessionalLicense", id, "licence.recorded", { staffMemberId: person.id, kind: person.licence.kind, number: person.licence.number, expiresOn: person.licence.expiresOn }, meta);
      created.licences += 1;
    }
  }
  for (const reg of DEA_REGISTRATIONS) {
    if (await tx.deaRegistration.findUnique({ where: { id: reg.id } })) continue;
    const expired = reg.expiresOn < now.toISOString().slice(0, 10);
    await tx.deaRegistration.create({
      data: { id: reg.id, registrationNumber: reg.registrationNumber, registrantName: reg.registrantName, registrantKind: reg.registrantKind, staffMemberId: reg.staffMemberId, locationId: reg.locationId, schedules: reg.schedules, issuedOn: DAY(reg.issuedOn), expiresOn: DAY(reg.expiresOn), status: expired ? "expired" : "active" }
    });
    auditCreate(uow, actor, "DeaRegistration", reg.id, "dea_registration.recorded", { registrationNumber: reg.registrationNumber, locationId: reg.locationId, schedules: reg.schedules, expiresOn: reg.expiresOn }, meta);
    created.deaRegistrations += 1;
  }
  if (!await tx.practiceSettings.findFirst({ where: { id: 1, medicalDirectorId: { not: null } } })) {
    await tx.practiceSettings.update({ where: { id: 1 }, data: { medicalDirectorId: "seed_staff_marsh" } });
  }
  for (const pack of POLICY_PACKS) {
    let row = await tx.policyPack.findUnique({ where: { code: pack.code } });
    if (!row) {
      row = await tx.policyPack.create({ data: { id: `seed_pp_${pack.code.replace(/[^A-Za-z0-9]+/g, "_").toLowerCase()}`, code: pack.code, name: pack.name, kind: pack.kind, jurisdiction: pack.jurisdiction } });
      auditCreate(uow, actor, "PolicyPack", row.id, "policy_pack.created", { code: pack.code, kind: pack.kind, jurisdiction: pack.jurisdiction }, meta);
      created.policyPacks += 1;
    }
    if (!await tx.policyVersion.findFirst({ where: { packId: row.id } })) {
      const rules2 = validateLayer(pack.kind, pack.rules);
      const version = await tx.policyVersion.create({
        data: {
          id: `${row.id}_v1`,
          packId: row.id,
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
          publishedAt: now
        }
      });
      auditCreate(uow, actor, "PolicyVersion", version.id, "policy.published", { pack: pack.code, rulesHash: version.rulesHash, verified: version.verified, unverified: pack.unverified }, meta);
      created.policyVersions += 1;
    }
    const targets = pack.bind === "practice" ? [{ scope: "practice", locationId: null }] : LOCATIONS.filter((l) => l.stateCode === pack.jurisdiction).map((l) => ({ scope: "location", locationId: l.id }));
    for (const t of targets) {
      const exists = await tx.policyBinding.findFirst({ where: { packId: row.id, scope: t.scope, locationId: t.locationId } });
      if (exists) continue;
      const binding = await tx.policyBinding.create({ data: { packId: row.id, scope: t.scope, locationId: t.locationId, layer: pack.layer } });
      auditCreate(uow, actor, "PolicyBinding", binding.id, "policy.bound", { pack: pack.code, scope: t.scope, locationId: t.locationId }, meta);
      created.policyBindings += 1;
    }
  }
  const havePolicies = new Set((await tx.approvalPolicy.findMany({ select: { action: true } })).map((p) => p.action));
  for (const policy of APPROVAL_POLICIES.filter((p) => !havePolicies.has(p.action))) {
    const row = await tx.approvalPolicy.create({ data: { action: policy.action, description: policy.description, requiredPermission: policy.requiredPermission, minApprovals: 1, expiresAfterMinutes: policy.expiresAfterMinutes, thresholdMinor: policy.thresholdMinor ?? null } });
    auditCreate(uow, actor, "ApprovalPolicy", row.id, "approval_policy.created", { action: policy.action, requiredPermission: policy.requiredPermission }, meta);
    created.approvalPolicies += 1;
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

// features/keystone/mutations/setup.ts
async function loadPracticeSetup(_root, args, context) {
  const actor = actorFromSession(context.session);
  requirePermission(actor, "canManageOnboarding");
  const result = await command(context.prisma, { name: "setup.load_practice", actor, idempotencyKey: args.idempotencyKey, params: {} }, (uow) => seedPractice(uow, actor));
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
  uow.emit({ topic: "notify.approval", aggregateType: "ApprovalRequest", aggregateId: created.id, payload: { action: input.action, requiredPermission }, dedupeKey: `notify.approval:${created.id}` });
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
  for (const key of keys) if (!CONTROL_KEYS.includes(key)) throw new DomainError(Codes.INVALID_INPUT, `${key} is not a practice control.`, { field: key });
  if (input.refundApprovalThresholdMinor !== void 0) {
    const text9 = String(input.refundApprovalThresholdMinor);
    if (!/^\d{1,12}$/.test(text9)) throw new DomainError(Codes.INVALID_INPUT, "refundApprovalThresholdMinor must be whole cents, as text.", { field: "refundApprovalThresholdMinor" });
    out.refundApprovalThresholdMinor = text9;
  }
  if (input.discountApprovalThresholdBps !== void 0) {
    intIn(input.discountApprovalThresholdBps, 0, 1e4, "discountApprovalThresholdBps");
    out.discountApprovalThresholdBps = input.discountApprovalThresholdBps;
  }
  if (input.writeOffRequiresApproval !== void 0) out.writeOffRequiresApproval = bool(input.writeOffRequiresApproval, "writeOffRequiresApproval");
  if (input.electiveDepositPct !== void 0) {
    const pct = dec(String(input.electiveDepositPct));
    if (pct.isNegative() || pct.greaterThan(1) || pct.decimalPlaces() > 6) throw new DomainError(Codes.INVALID_INPUT, "electiveDepositPct is a fraction from 0 to 1 (0.5 = 50%).", { field: "electiveDepositPct" });
    out.electiveDepositPct = pct.toFixed();
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
  const rows = [];
  for (const loc of locations) {
    const on = localDate({ timeZone: loc.timeZone }, /* @__PURE__ */ new Date());
    for (const kind of POLICY_KIND_NAMES) {
      try {
        const p = await resolvePolicy(context.prisma, kind, { locationId: loc.id, on });
        rows.push({ location: loc.code, locationName: loc.name, kind, on, ok: true, verified: p.verified, versions: p.versions, unverifiedRules: p.unverifiedRules });
      } catch (error) {
        rows.push({ location: loc.code, locationName: loc.name, kind, on, ok: false, code: error.code ?? "ERROR", message: error.message });
      }
    }
  }
  return rows;
}

// features/keystone/mutations/index.ts
var graphql = String.raw;
function extendGraphqlSchema(baseSchema) {
  return (0, import_schema.mergeSchemas)({
    schemas: [baseSchema],
    typeDefs: graphql`
      scalar JSON
      type Query {
        redirectToInit: Boolean
        verifyAuditChain: JSON
        policyInForce(kind: String!, locationId: ID!, on: String): JSON
        policyMatrix: JSON
      }
      input UserUpdateProfileInput { name: String, email: String, password: String, onboardingStatus: String }
      type Mutation {
        updateActiveUser(data: UserUpdateProfileInput!): User
        loadPracticeSetup(idempotencyKey: String!): JSON
        decideApprovalRequest(requestId: ID!, decision: String!, reason: String, expectedVersion: Int!, idempotencyKey: String!): JSON
        cancelApprovalRequest(requestId: ID!, expectedVersion: Int!, reason: String, idempotencyKey: String!): JSON
        requestPracticeControls(changes: JSON!, reason: String!, idempotencyKey: String!): JSON
      }
    `,
    resolvers: {
      Query: {
        redirectToInit: redirectToInit_default,
        verifyAuditChain: op(verifyAuditChain2),
        policyInForce: op(policyInForce),
        policyMatrix: op(policyMatrix)
      },
      Mutation: {
        updateActiveUser: updateActiveUser_default,
        loadPracticeSetup: op(loadPracticeSetup),
        decideApprovalRequest: op(decideApprovalRequest),
        cancelApprovalRequest: op(cancelApprovalRequest),
        requestPracticeControls: op(requestPracticeControls)
      }
    }
  });
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
  ProfessionalLicense: ['@@unique([stateCode, kind, licenseNumber], map: "ProfessionalLicense_state_kind_number_key")']
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
  (0, import_core12.config)({
    db: {
      provider: "postgresql",
      url: databaseURL,
      extendPrismaSchema: addDatabaseConstraints
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
    session: withMcpBearerSessions((0, import_session.statelessSessions)(sessionConfig)),
    graphql: {
      extendGraphqlSchema
    }
  })
);

// keystone.ts
var keystone_default2 = keystone_default;
//# sourceMappingURL=config.js.map
