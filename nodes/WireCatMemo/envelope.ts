export type Outcome = "open" | "won" | "lost"

export interface Stage {
  id: string
  name: string
  outcome: Outcome
}

export interface Relation {
  role: string
  type: string
  external_id: string
}

export interface EnvelopeRecord {
  key: string
  type: string
  external_id: string
  operation: "upsert" | "delete"
  fields?: Record<string, unknown>
  relations?: Relation[]
}

export interface Envelope {
  schema_version: 1
  source: { provider: string; account: string; batch_id: string }
  records: EnvelopeRecord[]
}

export interface Contact {
  name?: string
  email?: string
  phone?: string
  company?: string
}

export interface DealFields extends Contact {
  id: string
  title: string
  pipelineId: string
  pipelineName: string
  stages: Stage[]
  stage: string
  amount?: string
  currency?: string
  closeDate?: string
  url?: string
}

export type Kind = "lead" | "deal"

export const DEFAULT_STAGES: Record<Kind, Stage[]> = {
  lead: [{ id: "new", name: "New", outcome: "open" }],
  deal: [
    { id: "new", name: "New", outcome: "open" },
    { id: "proposal", name: "Proposal", outcome: "open" },
    { id: "won", name: "Won", outcome: "won" },
    { id: "lost", name: "Lost", outcome: "lost" },
  ],
}

export class EnvelopeError extends Error {}

const ACCOUNT = /^([a-z0-9][a-z0-9_-]{0,62}):(.+)$/

const clean = (value: string | undefined) => {
  const trimmed = value?.trim()
  return trimmed ? trimmed : undefined
}

export const splitAccount = (account: string) => {
  const match = ACCOUNT.exec(account.trim())
  if (!match) throw new EnvelopeError(`account "${account}" must look like <provider>:<name>, for example n8n:site`)
  return { provider: match[1], account: match[2] }
}

export const accountOf = (envelope: Envelope) => `${envelope.source.provider}:${envelope.source.account}`

export const envelopeOf = (account: string, batchId: string, records: EnvelopeRecord[]): Envelope => ({
  schema_version: 1,
  source: { ...splitAccount(account), batch_id: batchId },
  records,
})

const personKey = (contact: Contact) => clean(contact.email)?.toLowerCase() ?? clean(contact.phone)
const organizationKey = (name: string) => name.toLowerCase()

const personRecord = (contact: Contact, id: string, company?: string): EnvelopeRecord => {
  const name = clean(contact.name)
  const email = clean(contact.email)?.toLowerCase()
  const phone = clean(contact.phone)
  return {
    key: "person",
    type: "person",
    external_id: id,
    operation: "upsert",
    fields: { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) },
    ...(company
      ? { relations: [{ role: "member-of", type: "organization", external_id: organizationKey(company) }] }
      : {}),
  }
}

const organizationRecord = (name: string, id = organizationKey(name), domain?: string): EnvelopeRecord => ({
  key: "organization",
  type: "organization",
  external_id: id,
  operation: "upsert",
  fields: { name, ...(domain ? { identifiers: [{ scheme: "domain", value: domain.toLowerCase() }] } : {}) },
})

/**
 * A lead or a deal names its pipeline and stage, so memo refuses one without them. The pipeline goes in every
 * envelope: it is unchanged when nothing changed, and a new stage added in n8n reaches memo with the next item.
 */
export const dealRecords = (kind: Kind, input: DealFields): EnvelopeRecord[] => {
  const id = clean(input.id)
  const title = clean(input.title)
  if (!id) throw new EnvelopeError(`a ${kind} needs its ID, so sending it again updates it instead of adding another`)
  if (!title) throw new EnvelopeError(`a ${kind} needs a title`)
  const stages = input.stages.length ? input.stages : DEFAULT_STAGES[kind]
  const stage = stages.find((one) => one.id === clean(input.stage)?.toLowerCase())
  if (!stage) throw new EnvelopeError(`stage "${input.stage}" is not one of ${stages.map((one) => one.id).join(", ")}`)
  const amount = clean(input.amount)?.replace(/\s/g, "").replace(",", ".")
  const currency = clean(input.currency)?.toUpperCase()
  if (amount && !currency) throw new EnvelopeError("an amount needs its currency, such as EUR")
  const closeDate = clean(input.closeDate)
  const url = clean(input.url)
  const company = clean(input.company)
  const person = personKey(input)

  const records: EnvelopeRecord[] = [
    {
      key: "pipeline",
      type: "pipeline",
      external_id: input.pipelineId,
      operation: "upsert",
      fields: {
        kind,
        name: input.pipelineName,
        stages: stages.map((one, index) => ({
          external_id: one.id,
          name: one.name,
          position: index + 1,
          outcome: one.outcome,
        })),
      },
    },
  ]
  if (company) records.push(organizationRecord(company))
  if (person) records.push(personRecord(input, person, company))
  records.push({
    key: kind,
    type: kind,
    external_id: id,
    operation: "upsert",
    fields: {
      title: title.slice(0, 200),
      pipeline: input.pipelineId,
      stage: stage.id,
      ...(kind === "deal" ? { status: stage.outcome } : {}),
      ...(amount ? { amount, currency } : {}),
      ...(closeDate ? { close_date: closeDate } : {}),
      ...(url ? { url } : {}),
    },
    relations: [
      ...(person ? [{ role: "person", type: "person", external_id: person }] : []),
      ...(company ? [{ role: "organization", type: "organization", external_id: organizationKey(company) }] : []),
    ],
  })
  return records
}

export const deleteRecords = (kind: Kind, id: string): EnvelopeRecord[] => {
  const external = clean(id)
  if (!external) throw new EnvelopeError(`a ${kind} to delete needs its ID`)
  return [{ key: kind, type: kind, external_id: external, operation: "delete" }]
}

export const personRecords = (contact: Contact & { id?: string; position?: string }): EnvelopeRecord[] => {
  const id = clean(contact.id) ?? personKey(contact)
  if (!id) throw new EnvelopeError("a person needs an ID, an e-mail or a phone, so the next send finds the same one")
  const company = clean(contact.company)
  const record = personRecord(contact, id, company)
  const position = clean(contact.position)
  if (position) record.fields = { ...record.fields, position }
  return [...(company ? [organizationRecord(company)] : []), record]
}

export const organizationRecords = (input: { name: string; id?: string; domain?: string }): EnvelopeRecord[] => {
  const name = clean(input.name)
  if (!name) throw new EnvelopeError("an organization needs a name")
  return [organizationRecord(name, clean(input.id), clean(input.domain))]
}

export const parseEnvelope = (value: unknown): Envelope => {
  const parsed = typeof value === "string" ? (JSON.parse(value) as unknown) : value
  const envelope = parsed as Partial<Envelope> | null
  if (!envelope || typeof envelope !== "object" || envelope.schema_version !== 1)
    throw new EnvelopeError("the envelope needs schema_version 1")
  if (!envelope.source?.provider || !envelope.source.account || !envelope.source.batch_id)
    throw new EnvelopeError("the envelope needs source.provider, source.account and source.batch_id")
  if (!Array.isArray(envelope.records)) throw new EnvelopeError("the envelope needs a records list")
  return envelope as Envelope
}
