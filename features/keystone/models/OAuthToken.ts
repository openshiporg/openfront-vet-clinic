import { list } from "@keystone-6/core";
import { text, timestamp, select, json } from "@keystone-6/core/fields"
import { relationship } from "./guardedRelationship"
import { permissions } from "../access";
import { trackingFields } from "./trackingFields";
import { digestToken } from "../mcp-oauth/core";

const digestTokenInput = {
  resolveInput: ({ resolvedData, fieldKey }: any) =>
    resolvedData[fieldKey] ? digestToken(resolvedData[fieldKey]) : resolvedData[fieldKey],
};

// Same list as Openfront E-commerce. Codes, access and refresh tokens are
// stored only as digests; see features/keystone/mcp-oauth.
export const OAuthToken = list({
  access: {
    operation: {
      query: permissions.canManagePeople,
      create: permissions.canManagePeople,
      update: permissions.canManagePeople,
      delete: permissions.canManagePeople,
    },
  },
  fields: {
    tokenType: select({
      options: [
        { label: "Authorization Code", value: "authorization_code" },
        { label: "Access Token", value: "access_token" },
        { label: "Refresh Token", value: "refresh_token" },
      ],
      validation: {
        isRequired: true,
      },
    }),
    token: text({
      isFilterable: false,
      isOrderable: false,
      access: { read: () => false },
      validation: {
        isRequired: true,
      },
      isIndexed: "unique",
      hooks: digestTokenInput,
    }),
    clientId: text({
      validation: {
        isRequired: true,
      },
      isIndexed: true,
    }),
    user: relationship({
      ref: "User",
      ui: {
        description: "The user who authorized this token",
      },
    }),
    scopes: json({
      defaultValue: [],
      ui: {
        description: "Array of granted scopes",
      },
    }),
    redirectUri: text({
      ui: {
        description: "The redirect URI used during authorization",
      },
    }),
    agentId: text({
      access: { create: () => false, update: () => false },
      ui: {
        createView: { fieldMode: "hidden" },
        itemView: { fieldMode: "read" },
        description: "The AI agent this token acts as (set when issued to an app bound to an agent; empty for a person's own connection). A token with an agent never acts as the person who approved it.",
      },
    }),
    resource: text({
      ui: {
        description: "The MCP endpoint (RFC 8707 resource) this grant is for",
      },
    }),
    expiresAt: timestamp({
      ui: {
        description: "When this token expires",
      },
    }),
    isRevoked: select({
      options: [
        { label: "Active", value: "false" },
        { label: "Revoked", value: "true" },
      ],
      defaultValue: "false",
    }),
    authorizationCode: text({
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "The authorization code that was exchanged for this token (for access tokens)",
      },
    }),
    refreshToken: text({
      isFilterable: false,
      isOrderable: false,
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "Associated refresh token (for access tokens)",
      },
    }),
    accessToken: text({
      isFilterable: false,
      isOrderable: false,
      access: { read: () => false },
      hooks: digestTokenInput,
      ui: {
        description: "Associated access token (for refresh tokens)",
      },
    }),
    state: text({
      ui: {
        description: "OAuth state parameter for CSRF protection",
      },
    }),
    codeChallenge: text({
      ui: {
        description: "PKCE code challenge",
      },
    }),
    codeChallengeMethod: select({
      options: [
        { label: "Plain", value: "plain" },
        { label: "SHA256", value: "S256" },
      ],
      ui: {
        description: "PKCE code challenge method",
      },
    }),
    ...trackingFields,
  },
  ui: {
    labelField: "clientId",
    listView: {
      initialColumns: ["tokenType", "clientId", "user", "scopes", "expiresAt", "isRevoked"],
    },
  },
});
