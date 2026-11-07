/**
 * Compound uniques Keystone can't express on a field (SCHEMA G9; openfront-convenience pattern).
 * Partial uniques, CHECK constraints and triggers live in raw-SQL migrations instead.
 */
export const COMPOUND_UNIQUES: Record<string, string[]> = {
  CalendarException: ['@@unique([calendarId, date], map: "CalendarException_calendar_date_key")'],
  ProviderObservation: [
    '@@unique([source, connectionId, externalId], map: "ProviderObservation_source_external_key")',
    '@@unique([source, contentHash], map: "ProviderObservation_source_hash_key")',
  ],
  ExternalId: [
    '@@unique([system, value], map: "ExternalId_system_value_key")',
    '@@unique([system, recordType, recordId], map: "ExternalId_system_record_key")',
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
}

export function addDatabaseConstraints(schema: string): string {
  for (const [modelName, directives] of Object.entries(COMPOUND_UNIQUES)) {
    const pattern = new RegExp(`model ${modelName} \\{[\\s\\S]*?\\n\\}`)
    const model = schema.match(pattern)?.[0]
    if (!model) throw new Error(`Generated Prisma schema is missing ${modelName}`)
    const missing = directives.filter(directive => !model.includes(directive))
    if (!missing.length) continue
    schema = schema.replace(model, model.replace(/\n\}$/, `\n${missing.map(directive => `  ${directive}`).join('\n')}\n}`))
  }
  return schema
}
