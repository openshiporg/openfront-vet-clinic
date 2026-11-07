import { User } from './User'
import { Role } from './Role'
import { OAuthApp } from './OAuthApp'
import { OAuthToken } from './OAuthToken'
import * as platform from './platform'
import * as practice from './practice'
import * as compliance from './compliance'
import { AgentToolGrant, AgentRun, AgentAction, Proposal } from './agents'

export const models = {
  User,
  Role,
  OAuthApp,
  OAuthToken,
  ...platform,
  ...practice,
  ...compliance,
  AgentToolGrant,
  AgentRun,
  AgentAction,
  Proposal,
}

export default models
