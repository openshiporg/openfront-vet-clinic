import { User } from './User'
import { Role } from './Role'
import { OAuthApp } from './OAuthApp'
import { OAuthToken } from './OAuthToken'
import * as platform from './platform'
import * as practice from './practice'
import * as compliance from './compliance'
import * as clients from './clients'
import * as schedule from './schedule'
import * as comms from './comms'
import * as pharmacy from './pharmacy'
import { AgentToolGrant, AgentRun, AgentAction, Proposal } from './agents'

export const models = {
  User,
  Role,
  OAuthApp,
  OAuthToken,
  ...platform,
  ...practice,
  ...compliance,
  ...clients,
  ...schedule,
  ...comms,
  DrugProduct: pharmacy.DrugProduct,
  Prescription: pharmacy.Prescription,
  PrescriptionLine: pharmacy.PrescriptionLine,
  CsContainer: pharmacy.CsContainer,
  CsLogEntry: pharmacy.CsLogEntry,
  AgentToolGrant,
  AgentRun,
  AgentAction,
  Proposal,
}

export default models
