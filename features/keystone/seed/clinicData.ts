import { dec, toScale } from '../lib/decimal'
/**
 * Phase 1 seed data for Cedar Creek Animal Hospital. Everything here is fictional: households,
 * pets, numbers (+1 916-555-01xx) and addresses (common consumer mail domains). Clinical content (the phone triage
 * protocol, knowledge-base answers) is a conservative starting point the practice owner reviews and
 * re-publishes as their own version; nothing in it diagnoses or reassures.
 */

export const SPECIES = [
  { id: 'seed_sp_canine', code: 'canine', name: 'Dog', module: 'companion', defaultWeightUnit: 'lb', breeds: ['Labrador Retriever', 'Golden Retriever', 'German Shepherd', 'French Bulldog', 'Border Collie', 'Rough Collie', 'Australian Shepherd', 'Dachshund', 'Beagle', 'Boxer', 'Chihuahua', 'Pit Bull Terrier', 'Siberian Husky', 'Poodle (Standard)', 'Poodle (Miniature)', 'Shih Tzu', 'Yorkshire Terrier', 'Cavalier King Charles Spaniel', 'Great Dane', 'Mixed Breed'] },
  { id: 'seed_sp_feline', code: 'feline', name: 'Cat', module: 'companion', defaultWeightUnit: 'lb', breeds: ['Domestic Shorthair', 'Domestic Longhair', 'Maine Coon', 'Siamese', 'Ragdoll', 'Bengal', 'Persian', 'British Shorthair', 'Sphynx'] },
  { id: 'seed_sp_rabbit', code: 'rabbit', name: 'Rabbit', module: 'companion', defaultWeightUnit: 'kg', breeds: ['Holland Lop', 'Netherland Dwarf', 'Mini Rex', 'Mixed'] },
  { id: 'seed_sp_ferret', code: 'ferret', name: 'Ferret', module: 'companion', defaultWeightUnit: 'g', breeds: ['Standard'] },
  { id: 'seed_sp_reptile', code: 'bearded_dragon', name: 'Bearded dragon', module: 'companion', defaultWeightUnit: 'g', breeds: ['Central Bearded Dragon'] },
  { id: 'seed_sp_avian', code: 'cockatiel', name: 'Cockatiel', module: 'companion', defaultWeightUnit: 'g', breeds: ['Normal Grey', 'Lutino'] },
] as const

export const COLOURS: Record<string, string[]> = {
  canine: ['Black', 'Yellow', 'Chocolate', 'Brindle', 'Tricolour', 'Sable', 'White', 'Merle', 'Red'],
  feline: ['Black', 'Grey tabby', 'Orange tabby', 'Calico', 'Tortoiseshell', 'Tuxedo', 'Seal point', 'White'],
}

export const REFERRAL_HOSPITALS = [
  { id: 'seed_er_river', name: 'River City Veterinary Emergency (24 h)', kind: 'emergency', phone: '+19165550190', email: 'er@rivercityvetemergency.com', addressLine1: '2200 Riverside Blvd', city: 'Sacramento', stateCode: 'US-CA', lat: '38.553100', lng: '-121.507800', open24h: true },
  { id: 'seed_er_south', name: 'South Valley Animal Emergency (24 h)', kind: 'emergency', phone: '+19165550191', email: 'triage@southvalleyanimaler.com', addressLine1: '8800 Calvine Rd', city: 'Elk Grove', stateCode: 'US-CA', lat: '38.464000', lng: '-121.390500', open24h: true },
  { id: 'seed_ref_specialty', name: 'Capitol Veterinary Specialists', kind: 'specialty', phone: '+19165550192', email: 'referrals@capitolvetspecialists.com', addressLine1: '1500 Expo Pkwy', city: 'Sacramento', stateCode: 'US-CA', lat: '38.594400', lng: '-121.433900', open24h: false },
]

export const RESOURCES = [
  ...[1, 2, 3, 4].map(n => ({ id: `seed_res_main_exam${n}`, locationId: 'seed_loc_main', kind: 'exam_room', name: `Exam ${n}`, sortOrder: n })),
  { id: 'seed_res_main_surgery', locationId: 'seed_loc_main', kind: 'surgery_suite', name: 'Surgery suite', sortOrder: 10 },
  { id: 'seed_res_main_dental', locationId: 'seed_loc_main', kind: 'dental_table', name: 'Dental table', sortOrder: 11 },
  { id: 'seed_res_main_treat', locationId: 'seed_loc_main', kind: 'treatment_table', name: 'Treatment table', sortOrder: 12 },
  { id: 'seed_res_main_xray', locationId: 'seed_loc_main', kind: 'radiography', name: 'Digital radiography', sortOrder: 13 },
  { id: 'seed_res_main_us', locationId: 'seed_loc_main', kind: 'ultrasound', name: 'Ultrasound', sortOrder: 14 },
  { id: 'seed_res_main_groom', locationId: 'seed_loc_main', kind: 'grooming_table', name: 'Grooming table', sortOrder: 20 },
  { id: 'seed_res_eg_examA', locationId: 'seed_loc_elkgrove', kind: 'exam_room', name: 'Exam A', sortOrder: 1 },
  { id: 'seed_res_eg_examB', locationId: 'seed_loc_elkgrove', kind: 'exam_room', name: 'Exam B', sortOrder: 2 },
]

type TypeSeed = {
  id: string; code: string; name: string; category: string; durationMinutes: number; aiBookable: boolean; portalBookable: boolean; requestOnly: boolean
  newClientAllowed: boolean; vcprQualifying: boolean; colour: string; providerKinds: string[]; requiredResourceKinds: string[]
  segments?: { kind: string; offset: number; minutes: number; resourceKind?: string }[]; depositRequired?: string; depositMinor?: bigint; species?: string[]
}

export const APPOINTMENT_TYPES: TypeSeed[] = [
  { id: 'seed_at_wellness', code: 'wellness_exam', name: 'Wellness exam', category: 'wellness', durationMinutes: 30, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: true, colour: '#16a34a', providerKinds: ['dvm'], requiredResourceKinds: ['exam_room'] },
  { id: 'seed_at_new_client', code: 'new_client_exam', name: 'New client exam', category: 'wellness', durationMinutes: 40, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: true, vcprQualifying: true, colour: '#0d9488', providerKinds: ['dvm'], requiredResourceKinds: ['exam_room'] },
  { id: 'seed_at_vaccine', code: 'vaccine_visit', name: 'Vaccine visit (exam within 12 months)', category: 'vaccine_only', durationMinutes: 20, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: '#2563eb', providerKinds: ['dvm'], requiredResourceKinds: ['exam_room'] },
  { id: 'seed_at_sick', code: 'sick_exam', name: 'Sick pet exam', category: 'sick', durationMinutes: 30, aiBookable: true, portalBookable: false, requestOnly: false, newClientAllowed: true, vcprQualifying: true, colour: '#dc2626', providerKinds: ['dvm'], requiredResourceKinds: ['exam_room'] },
  { id: 'seed_at_recheck', code: 'recheck', name: 'Recheck', category: 'recheck', durationMinutes: 20, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: true, colour: '#f59e0b', providerKinds: ['dvm'], requiredResourceKinds: ['exam_room'] },
  { id: 'seed_at_tech', code: 'tech_appointment', name: 'Technician appointment (nails, anal glands, injections)', category: 'tech', durationMinutes: 15, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: '#7c3aed', providerKinds: ['rvt'], requiredResourceKinds: ['treatment_table'] },
  {
    id: 'seed_at_dental', code: 'dental_cleaning', name: 'Dental cleaning under anaesthesia (COHAT)', category: 'dental', durationMinutes: 540, aiBookable: false, portalBookable: false, requestOnly: true, newClientAllowed: false, vcprQualifying: true, colour: '#0891b2',
    providerKinds: ['dvm'], requiredResourceKinds: ['dental_table'], depositRequired: 'estimate',
    segments: [{ kind: 'drop_off', offset: 0, minutes: 30 }, { kind: 'anaesthesia', offset: 60, minutes: 120, resourceKind: 'dental_table' }, { kind: 'recovery', offset: 180, minutes: 180 }, { kind: 'pickup', offset: 510, minutes: 30 }],
  },
  {
    id: 'seed_at_spay', code: 'spay_neuter', name: 'Spay / neuter', category: 'surgery', durationMinutes: 540, aiBookable: false, portalBookable: false, requestOnly: true, newClientAllowed: false, vcprQualifying: true, colour: '#be123c',
    providerKinds: ['dvm'], requiredResourceKinds: ['surgery_suite'], depositRequired: 'fixed', depositMinor: 10000n,
    segments: [{ kind: 'drop_off', offset: 0, minutes: 30 }, { kind: 'procedure', offset: 60, minutes: 90, resourceKind: 'surgery_suite' }, { kind: 'recovery', offset: 150, minutes: 210 }, { kind: 'pickup', offset: 510, minutes: 30 }],
  },
  { id: 'seed_at_euthanasia', code: 'euthanasia', name: 'Euthanasia (quiet room)', category: 'euthanasia', durationMinutes: 60, aiBookable: false, portalBookable: false, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: '#475569', providerKinds: ['dvm'], requiredResourceKinds: ['exam_room'] },
  { id: 'seed_at_groom', code: 'groom_full', name: 'Full groom', category: 'grooming', durationMinutes: 120, aiBookable: true, portalBookable: true, requestOnly: false, newClientAllowed: false, vcprQualifying: false, colour: '#db2777', providerKinds: ['groomer'], requiredResourceKinds: ['grooming_table'], species: ['canine'] },
]

/** Weekly working blocks (weekday 0 = Sunday), all America/Los_Angeles local time. */
export const SCHEDULES: { staffId: string; locationId: string; days: number[]; start: string; end: string; categories?: string[] }[] = [
  { staffId: 'seed_staff_marsh', locationId: 'seed_loc_main', days: [1, 2, 3, 4], start: '08:00', end: '17:30' },
  { staffId: 'seed_staff_marsh', locationId: 'seed_loc_main', days: [6], start: '08:00', end: '13:30' },
  { staffId: 'seed_staff_marsh', locationId: 'seed_loc_elkgrove', days: [5], start: '09:00', end: '16:30' },
  { staffId: 'seed_staff_okafor', locationId: 'seed_loc_main', days: [1, 2, 3, 4, 5], start: '08:00', end: '17:30' },
  { staffId: 'seed_staff_desai', locationId: 'seed_loc_elkgrove', days: [1, 2, 3, 4], start: '09:00', end: '16:30' },
  { staffId: 'seed_staff_desai', locationId: 'seed_loc_main', days: [5], start: '08:00', end: '17:30' },
  { staffId: 'seed_staff_cole', locationId: 'seed_loc_main', days: [2, 4, 6], start: '08:00', end: '17:30' },
  // Dr. Bennett's licence lapsed on 2026-10-31: he has no bookable hours until it is renewed.
  { staffId: 'seed_staff_lopez', locationId: 'seed_loc_main', days: [1, 2, 3, 4, 5], start: '07:30', end: '16:00' },
  { staffId: 'seed_staff_price', locationId: 'seed_loc_main', days: [1, 2, 3, 4, 5], start: '09:30', end: '18:00' },
  { staffId: 'seed_staff_rahman', locationId: 'seed_loc_elkgrove', days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' },
  { staffId: 'seed_staff_morgan', locationId: 'seed_loc_main', days: [2, 3, 4, 5, 6], start: '08:00', end: '16:00', categories: ['grooming'] },
]

export const TRIAGE_PROTOCOL = {
  questions: [
    { id: 'breathing', text: 'Is your pet having any trouble breathing, breathing with the mouth open (cats), or are the gums blue, grey or very pale?', required: true },
    { id: 'collapse', text: 'Has your pet collapsed or fainted, or are they unable to stand or walk?', required: true },
    { id: 'toxin', text: 'Could your pet have eaten or touched anything poisonous: rat or mouse bait, antifreeze, human medicines, chocolate, grapes or raisins, sugar-free gum, or lilies (cats)?', required: true },
    { id: 'bloat', text: 'Is your dog\'s belly swollen or tight, or are they trying to vomit without bringing anything up?', required: true },
    { id: 'bleeding', text: 'Is there bleeding that will not stop, or a deep wound?', required: true },
    { id: 'seizure', text: 'Is your pet having a seizure now, or have they had more than one seizure today?', required: true },
    { id: 'urinary_block', text: 'Is your cat straining in the litter box with little or no urine coming out?', required: true },
    { id: 'trauma', text: 'In the last few hours, was your pet hit by a car, did they fall from a height, or were they attacked by another animal?', required: true },
    { id: 'labour', text: 'Is your pet giving birth and has been pushing for more than 30 minutes without delivering?', required: true },
    { id: 'heat', text: 'Has your pet been in the heat and is now panting very hard, drooling heavily or weak?', required: true },
    { id: 'vomiting_repeated', text: 'Has your pet vomited or had diarrhoea more than three times today, or is there blood in it?', required: false },
    { id: 'not_eating', text: 'Has your pet stopped eating or drinking for more than a day?', required: false },
    { id: 'eye', text: 'Is there an injury to an eye, or is an eye suddenly cloudy, bulging or held shut?', required: false },
    { id: 'pain', text: 'Is your pet crying out in pain or unable to settle?', required: false },
    { id: 'limping', text: 'Is your pet limping but still putting some weight on the leg?', required: false },
  ],
  redFlags: [
    { id: 'rf_breathing', label: 'Breathing difficulty or abnormal gum colour', whenYes: ['breathing'], keywords: ['cant breathe', 'can not breathe', 'not breathing', 'struggling to breathe', 'choking', 'blue gums'] },
    { id: 'rf_collapse', label: 'Collapse or unable to stand', whenYes: ['collapse'], keywords: ['collapsed', 'unconscious', 'unresponsive', 'fainted', 'cant stand'] },
    { id: 'rf_toxin', label: 'Possible poisoning', whenYes: ['toxin'], keywords: ['rat poison', 'mouse poison', 'rat bait', 'mouse bait', 'antifreeze', 'ate chocolate', 'xylitol', 'sugar free gum', 'grapes', 'raisins', 'lily', 'lilies', 'ibuprofen', 'advil', 'tylenol', 'acetaminophen', 'marijuana', 'edible'] },
    { id: 'rf_bloat', label: 'Possible bloat (GDV)', whenYes: ['bloat'], keywords: ['bloated', 'swollen belly', 'retching'] },
    { id: 'rf_bleeding', label: 'Uncontrolled bleeding or deep wound', whenYes: ['bleeding'], keywords: ['bleeding a lot', 'wont stop bleeding', 'deep cut', 'bleeding heavily'] },
    { id: 'rf_seizure', label: 'Active or cluster seizures', whenYes: ['seizure'], keywords: ['seizure', 'seizing', 'convulsing', 'fitting'] },
    { id: 'rf_urinary', label: 'Possible urinary blockage', whenYes: ['urinary_block'], keywords: ['cant pee', 'straining to pee', 'blocked cat'] },
    { id: 'rf_trauma', label: 'Recent major trauma', whenYes: ['trauma'], keywords: ['hit by a car', 'hit by car', 'run over', 'fell off', 'dog attack', 'attacked by'] },
    { id: 'rf_labour', label: 'Difficult birth', whenYes: ['labour'], keywords: ['stuck puppy', 'stuck kitten'] },
    { id: 'rf_heat', label: 'Possible heatstroke', whenYes: ['heat'], keywords: ['heatstroke', 'heat stroke', 'overheated'] },
  ],
  levelRules: [
    { level: 'urgent_today', whenYes: ['vomiting_repeated', 'not_eating', 'eye', 'pain'], keywords: ['vomiting blood', 'blood in stool', 'swollen face', 'hives', 'bee sting', 'snake'] },
    { level: 'soon', whenYes: ['limping'], keywords: ['limping', 'ear infection', 'scratching', 'diarrhea', 'diarrhoea', 'lump', 'cough'] },
  ],
  scripts: {
    emergency_now: 'What you are describing can be an emergency. Please take your pet to an emergency hospital now; I am connecting you to our team straight away, and I will text you the address of the nearest open emergency hospital.',
    urgent_today: 'Your pet should be seen today. I will look for the first available time today; if there is none, our team will call you back within 30 minutes to arrange care.',
    soon: 'Your pet should be seen in the next day or two. Let me find the first available appointment. If anything gets worse before then, call us right away.',
    routine: 'Let me find a time that works for you.',
  },
}

export const MESSAGE_TEMPLATES = [
  { code: 'appointment_booked', purpose: 'transactional', body: '{{practice}}: {{pet}} is booked for {{when}} with {{provider}}. Reply C to confirm, STOP to opt out.' },
  { code: 'appointment_requested', purpose: 'transactional', body: '{{practice}}: we have your request for {{pet}} on {{when}}. Our team will confirm shortly. Reply STOP to opt out.' },
  { code: 'appointment_reminder', purpose: 'transactional', body: '{{practice}}: reminder, {{pet}} is due {{when}} with {{provider}}. Reply C to confirm or call {{phone}} to change.' },
  { code: 'stop_confirmation', purpose: 'transactional', body: '{{practice}}: you will no longer receive texts from us. Reply START to opt back in.' },
  { code: 'help_reply', purpose: 'transactional', body: '{{practice}}: for help call {{phone}}. Reply STOP to opt out. Msg & data rates may apply.' },
  { code: 'refill_received', purpose: 'care', body: '{{practice}}: we have your refill request for {{pet}}. A veterinarian reviews requests within one business day.' },
  { code: 'records_received', purpose: 'transactional', body: '{{practice}}: we have your records request for {{pet}}. We will send them to the address on file.' },
]

export const KNOWLEDGE_BASE = [
  { topic: 'Hours', keywords: ['hours', 'open', 'close', 'saturday', 'sunday'], visibility: 'public', locationId: 'seed_loc_main', content: 'Cedar Creek Animal Hospital is open Monday to Friday 7:30 am to 6:00 pm and Saturday 8:00 am to 2:00 pm. We are closed on Sundays and federal holidays. For emergencies after hours, go to River City Veterinary Emergency (open 24 hours).' },
  { topic: 'Hours', keywords: ['hours', 'open', 'close', 'elk grove'], visibility: 'public', locationId: 'seed_loc_elkgrove', content: 'Elk Grove Wellness Clinic is open Monday to Friday 9:00 am to 5:00 pm. It offers wellness, vaccine and sick-pet visits; surgery and dentistry are done at the main hospital.' },
  { topic: 'Address and parking', keywords: ['address', 'where', 'parking', 'directions'], visibility: 'public', locationId: null, content: 'The main hospital is at 4120 Cedar Creek Road, Sacramento, with free parking at the front. The Elk Grove clinic is at 9175 Laguna Springs Way, Elk Grove.' },
  { topic: 'New clients', keywords: ['new client', 'new patient', 'first visit', 'records'], visibility: 'public', locationId: null, content: 'New clients are welcome. Please bring any previous vaccine records, and arrive 10 minutes early to complete check-in. A first visit is a new client exam.' },
  { topic: 'Payment', keywords: ['pay', 'payment', 'credit card', 'insurance', 'cost', 'price'], visibility: 'public', locationId: null, content: 'We accept cash, all major cards and pay-by-link. Payment is due at the time of service. We will give you a written estimate before any procedure. We can submit claims to pet insurers for you. Exact prices come from our published fee list; the front desk can give you an estimate.' },
  { topic: 'Prescription refills', keywords: ['refill', 'medication', 'prescription', 'pharmacy'], visibility: 'public', locationId: null, content: 'Refill requests are reviewed by a veterinarian within one business day. Some medications need a recent exam before they can be refilled. We will text you when the refill is ready or if the doctor needs to see your pet.' },
  { topic: 'Records requests', keywords: ['records', 'copy', 'history', 'transfer'], visibility: 'public', locationId: null, content: 'Clients of record can request a copy of their pet\'s records. We send them to the email address on file. Requests from other clinics need your authorisation.' },
  { topic: 'Vaccines for boarding and grooming', keywords: ['boarding', 'grooming', 'vaccines required', 'bordetella', 'kennel cough'], visibility: 'public', locationId: null, content: 'Dogs boarding or grooming with us need current rabies, DAPP and Bordetella vaccines. Cats need current rabies and FVRCP.' },
  { topic: 'Emergencies', keywords: ['emergency', 'urgent', 'after hours', 'night'], visibility: 'public', locationId: null, content: 'If your pet has trouble breathing, has collapsed, may have eaten something poisonous, or is bleeding heavily, go to an emergency hospital now. River City Veterinary Emergency (2200 Riverside Blvd, Sacramento) and South Valley Animal Emergency (8800 Calvine Rd, Elk Grove) are open 24 hours.' },
  { topic: 'Front-desk note: dental estimates', keywords: ['dental', 'estimate'], visibility: 'staff', locationId: null, content: 'Dental cleanings are booked as requests: the DVM reviews pre-anaesthetic bloodwork and the estimate range before confirming. Never quote a fixed price on the phone.' },
]

export const DRUG_PRODUCTS = [
  { id: 'seed_drug_ketamine', displayName: 'Ketamine 100 mg/mL injection', genericName: 'ketamine', brandName: 'Ketaset', form: 'injectable', strength: '100', strengthUnit: 'mg', per: 'mL', concentration: '100', concentrationUnit: 'mg/mL', packageQty: '10', packageUnit: 'mL', csSchedule: 'CIII', approvalStatus: 'fda_approved', multiDoseBudDays: 28, ndc: '54771-2016-1', requiresWitnessOnAdminister: true },
  { id: 'seed_drug_butorphanol', displayName: 'Butorphanol 10 mg/mL injection', genericName: 'butorphanol', brandName: 'Torbugesic', form: 'injectable', strength: '10', strengthUnit: 'mg', per: 'mL', concentration: '10', concentrationUnit: 'mg/mL', packageQty: '10', packageUnit: 'mL', csSchedule: 'CIV', approvalStatus: 'fda_approved', multiDoseBudDays: 28, ndc: '54771-5521-1', requiresWitnessOnAdminister: false },
  { id: 'seed_drug_buprenorphine', displayName: 'Buprenorphine 0.3 mg/mL injection', genericName: 'buprenorphine', brandName: 'Buprenex', form: 'injectable', strength: '0.3', strengthUnit: 'mg', per: 'mL', concentration: '0.3', concentrationUnit: 'mg/mL', packageQty: '1', packageUnit: 'mL', csSchedule: 'CIII', approvalStatus: 'human_label', multiDoseBudDays: null, ndc: '12496-0757-1', requiresWitnessOnAdminister: false },
  { id: 'seed_drug_hydromorphone', displayName: 'Hydromorphone 2 mg/mL injection', genericName: 'hydromorphone', brandName: '', form: 'injectable', strength: '2', strengthUnit: 'mg', per: 'mL', concentration: '2', concentrationUnit: 'mg/mL', packageQty: '1', packageUnit: 'mL', csSchedule: 'CII', approvalStatus: 'human_label', multiDoseBudDays: null, ndc: '0409-2634-01', requiresWitnessOnAdminister: true },
  { id: 'seed_drug_midazolam', displayName: 'Midazolam 5 mg/mL injection', genericName: 'midazolam', brandName: '', form: 'injectable', strength: '5', strengthUnit: 'mg', per: 'mL', concentration: '5', concentrationUnit: 'mg/mL', packageQty: '10', packageUnit: 'mL', csSchedule: 'CIV', approvalStatus: 'human_label', multiDoseBudDays: 28, ndc: '0641-6060-10', requiresWitnessOnAdminister: false },
  { id: 'seed_drug_pentobarbital', displayName: 'Pentobarbital sodium 390 mg/mL euthanasia solution', genericName: 'pentobarbital', brandName: 'Euthasol', form: 'injectable', strength: '390', strengthUnit: 'mg', per: 'mL', concentration: '390', concentrationUnit: 'mg/mL', packageQty: '100', packageUnit: 'mL', csSchedule: 'CIIIN', approvalStatus: 'fda_approved', multiDoseBudDays: 28, ndc: '051311-050-01', requiresWitnessOnAdminister: true },
  { id: 'seed_drug_phenobarbital', displayName: 'Phenobarbital 64.8 mg tablet', genericName: 'phenobarbital', brandName: '', form: 'tablet', strength: '64.8', strengthUnit: 'mg', per: 'tablet', concentration: null, concentrationUnit: '', packageQty: '100', packageUnit: 'tablet', csSchedule: 'CIV', approvalStatus: 'human_label', multiDoseBudDays: null, ndc: '0603-5168-21', requiresWitnessOnAdminister: false },
  { id: 'seed_drug_gabapentin', displayName: 'Gabapentin 100 mg capsule', genericName: 'gabapentin', brandName: '', form: 'capsule', strength: '100', strengthUnit: 'mg', per: 'capsule', concentration: null, concentrationUnit: '', packageQty: '100', packageUnit: 'capsule', csSchedule: 'none', approvalStatus: 'human_label', multiDoseBudDays: null, ndc: '0228-2665-11', requiresWitnessOnAdminister: false, stateCsSchedule: { 'US-CA': { schedule: 'none', reportable: false, note: 'verify: some states schedule gabapentin as CV or require PDMP reporting' } } },
  { id: 'seed_drug_carprofen', displayName: 'Carprofen 75 mg chewable', genericName: 'carprofen', brandName: 'Rimadyl', form: 'chewable', strength: '75', strengthUnit: 'mg', per: 'tablet', concentration: null, concentrationUnit: '', packageQty: '60', packageUnit: 'tablet', csSchedule: 'none', approvalStatus: 'fda_approved', multiDoseBudDays: null, ndc: '0069-0127-01', requiresWitnessOnAdminister: false },
]

const FIRST = ['Olivia', 'Liam', 'Emma', 'Noah', 'Ava', 'Mateo', 'Sophia', 'Ethan', 'Isabella', 'Lucas', 'Mia', 'Elijah', 'Amara', 'James', 'Harper', 'Benjamin', 'Camila', 'Daniel', 'Aria', 'Henry', 'Zoe', 'Jack', 'Layla', 'Owen', 'Nora', 'Wyatt', 'Leah', 'Caleb', 'Hazel', 'Isaac', 'Ivy', 'Julian']
/** Realistic consumer mail domains. Messaging adapters are manual or recording in the seed, so nothing is ever sent to these. */
const MAIL_DOMAINS = ['gmail.com', 'yahoo.com', 'outlook.com', 'icloud.com', 'comcast.net', 'sbcglobal.net', 'hotmail.com', 'aol.com']
const LAST = ['Alvarez', 'Bishop', 'Castillo', 'Dalton', 'Espinoza', 'Fairbanks', 'Gallagher', 'Hayward', 'Ingram', 'Jaramillo', 'Kowalski', 'Lindqvist', 'Mendoza', 'Nakamura', 'Oyelaran', 'Pemberton', 'Quintero', 'Rasmussen', 'Sorensen', 'Takahashi', 'Underwood', 'Valdivia', 'Whitfield', 'Xiong', 'Yamamoto', 'Zielinski', 'Abernathy', 'Bergstrom', 'Chaudhry', 'Delacroix', 'Eriksen', 'Fontaine']
const DOGS = ['Biscuit', 'Maple', 'Juniper', 'Moose', 'Pepper', 'Rosie', 'Bear', 'Winnie', 'Scout', 'Hazel', 'Tucker', 'Olive', 'Ranger', 'Daisy', 'Koda', 'Penny', 'Murphy', 'Luna', 'Gus', 'Ruby', 'Finn', 'Willow', 'Otis', 'Ginger']
const CATS = ['Miso', 'Clementine', 'Toast', 'Mochi', 'Jasper', 'Pumpkin', 'Nimbus', 'Sage', 'Felix', 'Poppy', 'Ziggy', 'Mabel', 'Tofu', 'Cleo', 'Basil', 'Pickles']

export type HouseholdSeed = {
  id: string; displayName: string; kind: string; locationId: string; city: string; postalCode: string; addressLine1: string
  people: { id: string; firstName: string; lastName: string; relationship: string; dob: string; phone: string | null; email: string }[]
  pets: PetSeed[]; status?: string; source?: string
}
/** Typical adult weight range by breed (kg), so a seeded Chihuahua weighs like one: doses are calculated from it. */
const BREED_KG: Record<string, [number, number]> = {
  'Labrador Retriever': [25, 36], 'Golden Retriever': [25, 34], 'German Shepherd': [24, 40], 'French Bulldog': [8, 13], 'Border Collie': [13, 20], 'Rough Collie': [18, 29],
  'Australian Shepherd': [16, 30], Dachshund: [7, 14], Beagle: [9, 14], Boxer: [25, 32], Chihuahua: [1.5, 3], 'Pit Bull Terrier': [14, 30], 'Siberian Husky': [16, 27],
  'Poodle (Standard)': [18, 30], 'Poodle (Miniature)': [4, 8], 'Shih Tzu': [4, 7.5], 'Yorkshire Terrier': [2, 3.5], 'Cavalier King Charles Spaniel': [5.5, 8.5], 'Great Dane': [50, 80], 'Mixed Breed': [8, 30],
  'Domestic Shorthair': [3.5, 6], 'Domestic Longhair': [3.5, 6], 'Maine Coon': [5.5, 9], Siamese: [3, 5], Ragdoll: [4.5, 8], Bengal: [3.5, 6.5], Persian: [3.5, 5.5], 'British Shorthair': [4, 7.5], Sphynx: [3, 5],
}

export type PetSeed = {
  id: string; name: string; species: string; breed: string; sex: string; repro: string; dob: string; colour: string; weightsKg: string[]; microchip: string | null; status?: string
  alerts?: { kind: string; severity: string; text: string }[]; diedOn?: string
}

/** A small deterministic generator, so the seed is the same every time it runs. */
function rng(seed: number) {
  let x = seed >>> 0
  return () => {
    x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0
    return x / 4294967296
  }
}

export const HOUSEHOLD_COUNT = 400

export function households(): HouseholdSeed[] {
  const r = rng(20261107)
  const pick = <T,>(items: readonly T[]) => items[Math.floor(r() * items.length)]
  const out: HouseholdSeed[] = []
  const dogBreeds = SPECIES[0].breeds
  const catBreeds = SPECIES[1].breeds
  for (let i = 0; i < HOUSEHOLD_COUNT; i++) {
    const n = String(i + 1).padStart(3, '0')
    const last = LAST[i % LAST.length]
    const first = FIRST[(i * 7) % FIRST.length]
    const eg = i % 4 === 3
    // 916-555-0102 … 0189 is the fictional range left after the hospital lines (0100/0101) and the
    // referral hospitals (0190-0192); later households are reachable by email only.
    const phone = i + 2 < 90 ? `+1916555${String(100 + i + 2).padStart(4, '0')}` : null
    const people: HouseholdSeed['people'] = [{ id: `seed_cp_${n}_1`, firstName: first, lastName: last, relationship: 'owner', dob: `19${60 + (i % 38)}-${String((i % 12) + 1).padStart(2, '0')}-${String((i % 27) + 1).padStart(2, '0')}`, phone, email: `${first}.${last}${n}@${MAIL_DOMAINS[i % MAIL_DOMAINS.length]}`.toLowerCase() }]
    if (i % 3 === 0) people.push({ id: `seed_cp_${n}_2`, firstName: FIRST[(i * 7 + 5) % FIRST.length], lastName: last, relationship: 'co_owner', dob: `19${62 + (i % 35)}-0${(i % 9) + 1}-1${i % 9}`, phone: null, email: `${FIRST[(i * 7 + 5) % FIRST.length]}.${last}${n}@${MAIL_DOMAINS[(i + 2) % MAIL_DOMAINS.length]}`.toLowerCase() })
    const petCount = i % 7 === 0 ? 3 : i % 3 === 0 ? 2 : 1
    const pets: PetSeed[] = []
    for (let p = 0; p < petCount; p++) {
      const roll = r()
      const species = roll < 0.58 ? 'canine' : roll < 0.93 ? 'feline' : pick(['rabbit', 'ferret', 'bearded_dragon', 'cockatiel'] as const)
      const name = species === 'canine' ? DOGS[(i + p * 5) % DOGS.length] : species === 'feline' ? CATS[(i + p * 3) % CATS.length] : pick(['Clover', 'Bandit', 'Spike', 'Kiwi'])
      const breed = species === 'canine' ? pick(dogBreeds) : species === 'feline' ? pick(catBreeds) : SPECIES.find(s => s.code === species)!.breeds[0]
      const year = 2012 + Math.floor(r() * 14)
      const [lo, hi] = BREED_KG[breed] ?? (species === 'canine' ? [8, 30] : [3, 6])
      const base = species === 'canine' || species === 'feline' ? lo + r() * (hi - lo) : species === 'rabbit' ? 1.2 + r() : species === 'ferret' ? 0.7 + r() * 0.6 : species === 'bearded_dragon' ? 0.35 + r() * 0.15 : 0.08 + r() * 0.02
      // Integer grams (3 places of kg) or tens of grams (2 places), then an exact decimal string.
      const weights = [94, 98, 100].map(pct => {
        const places = base < 1 ? 3 : 2
        const units = Math.round((base * pct) / 100 * 10 ** places)
        return toScale(dec(units).div(10 ** places), places)
      })
      const sex = r() < 0.5 ? 'male' : 'female'
      pets.push({
        id: `seed_pet_${n}_${p + 1}`, name, species, breed, sex, repro: species === 'canine' || species === 'feline' ? (sex === 'male' ? 'neutered' : 'spayed') : 'unknown',
        dob: `${year}-${String(1 + Math.floor(r() * 12)).padStart(2, '0')}-${String(1 + Math.floor(r() * 27)).padStart(2, '0')}`,
        colour: COLOURS[species]?.[Math.floor(r() * (COLOURS[species]?.length ?? 1))] ?? '',
        weightsKg: weights, microchip: species === 'canine' || species === 'feline' ? `985112${String(4000000 + i * 37 + p).padStart(9, '0')}` : null,
      })
    }
    out.push({ id: `seed_cl_${n}`, displayName: `${last} household`, kind: 'household', locationId: eg ? 'seed_loc_elkgrove' : 'seed_loc_main', city: eg ? 'Elk Grove' : 'Sacramento', postalCode: eg ? '95758' : '95823', addressLine1: `${100 + i * 13} ${pick(['Oak', 'Willow', 'Riverside', 'Laguna', 'Florin', 'Freeport', 'Elm'])} ${pick(['St', 'Ave', 'Way', 'Ct'])}`, people, pets })
  }
  // Clinical alerts on every header they apply to.
  const collie = out[4].pets[0]
  Object.assign(collie, { name: 'Laddie', species: 'canine', breed: 'Rough Collie', alerts: [{ kind: 'genetic', severity: 'warn', text: 'MDR1 (ABCB1) mutant/mutant: avoid ivermectin at high doses, loperamide, acepromazine at full dose; check every drug.' }] })
  out[7].pets[0].alerts = [{ kind: 'behaviour_caution', severity: 'warn', text: 'Bites when restrained: muzzle on arrival, two-person handling.' }]
  const nsaidCat = out[9].pets.find(p => p.species === 'feline') ?? out[9].pets[0]
  Object.assign(nsaidCat, { species: 'feline', breed: 'Domestic Shorthair', name: 'Saffron', alerts: [{ kind: 'drug_sensitivity', severity: 'block', text: 'NSAID intolerance (acute kidney injury after meloxicam, 2025). No NSAIDs.' }] })
  // An override changes the species or breed, so give those pets that breed's weights too.
  for (const pet of [collie, nsaidCat]) {
    const [lo, hi] = BREED_KG[pet.breed] ?? [3, 6]
    const mid = (lo + hi) / 2
    pet.weightsKg = [94, 98, 100].map(pct => toScale(dec(Math.round(mid * pct)).div(100), 2))
  }
  out[12].pets[0].alerts = [{ kind: 'allergy', severity: 'warn', text: 'Vaccine reaction (facial swelling) after leptospirosis vaccine: pre-medicate and split vaccines.' }]
  // A pet that died: its owner is never sent "due" messages again.
  Object.assign(out[15].pets[0], { status: 'deceased', diedOn: '2026-09-18' })
  // A rescue group with twelve cats.
  out[20] = {
    ...out[20], displayName: 'Second Chance Cat Rescue', kind: 'rescue',
    pets: Array.from({ length: 12 }, (_, k) => ({ id: `seed_pet_021_${k + 1}`, name: ['Ash', 'Birch', 'Cedar', 'Dune', 'Ember', 'Fern', 'Glade', 'Heath', 'Iris', 'Jade', 'Kestrel', 'Linden'][k], species: 'feline', breed: 'Domestic Shorthair', sex: k % 2 ? 'female' : 'male', repro: k % 2 ? 'spayed' : 'neutered', dob: `2025-0${(k % 9) + 1}-15`, colour: COLOURS.feline[k % COLOURS.feline.length], weightsKg: ['2.10', '2.60', '3.05'], microchip: `985112${String(5100000 + k).padStart(9, '0')}` })),
  }
  // A caller the AI receptionist registered last night: pending until the front desk confirms.
  out[HOUSEHOLD_COUNT - 1] = { ...out[HOUSEHOLD_COUNT - 1], status: 'prospect', source: 'ai_voice', people: [{ ...out[HOUSEHOLD_COUNT - 1].people[0], phone: '+19165550193' }], pets: out[HOUSEHOLD_COUNT - 1].pets.slice(0, 1).map(p => ({ ...p, status: 'pending', microchip: null, weightsKg: [] })) }
  return out
}
