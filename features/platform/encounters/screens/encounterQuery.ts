/** The medical record page's single query. Every list has an explicit take so the breadth limit counts its real size (review r5). */
export const ENCOUNTER_QUERY = `      query E($id: ID!) {
        encounter(where: { id: $id }) {
          id ref kind status reason version startedAt submittedAt signedAt contentHash completeness voidReason
          patient { id ref name status dateOfBirth sex reproductiveStatus species { code name } breed { name }
            alerts(where: { active: { equals: true } }, take: 20) { id severity kind text }
            weights(orderBy: { measuredAt: desc }, take: 1) { id value unit valueKg measuredAt } }
          location { id name } attendingDvm { id displayName } signedBy { id displayName } stay { id ref status }
          sections(orderBy: [{ kind: asc }, { ordinal: asc }], take: 60) { id kind ordinal body source version lockedAt lastAuthor { id displayName } revisionsCount }
          addenda(orderBy: { signedAt: asc }, take: 100) { id sectionKind reason body signedAt authorIsDvm author { id displayName } }
          vitals(orderBy: { at: desc }, take: 100) { id at temperature temperatureUnit heartRate respRate mucousMembranes crtSeconds painScore by { id displayName } }
          findings(take: 40) { id system status text }
          diagnoses(take: 50) { id term certainty code { code } }
          orders(orderBy: { createdAt: asc }, take: 60) { id ref kind description status route frequency version warnings overrideReason drug { id csSchedule } orderedBy { id displayName }
            administrations(orderBy: { givenAt: asc }, take: 20) { id qty unit givenAt givenBy { id displayName } witness { id displayName } lotNumber reason qtyOverrideReason reverses { id } } }
        }
        drugProducts(where: { active: { equals: true } }, orderBy: { displayName: asc }, take: 300) { id displayName csSchedule }
        diagnosisCodes(where: { active: { equals: true } }, orderBy: { term: asc }, take: 300) { id code term }
        witnesses: staffMembers(where: { active: { equals: true }, kind: { in: ["dvm", "rvt"] } }, orderBy: { displayName: asc }, take: 100) { id displayName }
        staffMembers(where: { active: { equals: true }, kind: { in: ["dvm", "rvt", "assistant"] } }, orderBy: { displayName: asc }, take: 100) { id displayName kind }
        vaccineProducts(where: { active: { equals: true } }, orderBy: { name: asc }, take: 100) { id name isRabies }
        vaccineLots: inventoryLots(where: { status: { equals: "available" }, NOT: { vaccine: null } }, orderBy: { expiresOn: asc }, take: 200) { id lotNumber expiresOn vaccine { id } location { id } }
        csContainers(where: { status: { equals: "open" } }, orderBy: { ref: asc }, take: 100) { id ref product { id } location { id } }
        inventoryLots(where: { status: { equals: "available" }, NOT: { drug: null } }, orderBy: { expiresOn: asc }, take: 300) { id lotNumber expiresOn drug { id } location { id } }
        scribeSessions(where: { encounter: { id: { equals: $id } } }, orderBy: { createdAt: desc }, take: 5) { id status clientConsent { id } drafts(orderBy: { createdAt: desc }, take: 5) { id status sections acceptedBlocks version } }
        anaesthesiaRecords(where: { encounter: { id: { equals: $id } } }, orderBy: { createdAt: desc }, take: 20) { id ref status asaStatus procedure }
        practiceSettings { features }
        vaccineAdministrations(where: { encounter: { id: { equals: $id } } }, orderBy: { administeredOn: asc }, take: 50) { id source reason lotNumber site doseSeries dueNextOn product { name } vaccinatedBy { id displayName } reverses { id } certificate { id ref tagNumber voidedAt } }
      }
`
