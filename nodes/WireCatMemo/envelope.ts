export type Outcome = "open" | "won" | "lost"

export interface Stage {
  id: string
  name: string
  outcome: Outcome
}

export interface Relation {
  role: string
  type?: string
  external_id?: string
  ref?: string
  as?: string
  amount?: string
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

/** A record memo already keeps for this account, as `records list` returns it. */
export interface Stored {
  fields: Record<string, unknown>
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
  amount?: unknown
  currency?: string
  closeDate?: string
  url?: string
}

/**
 * What the node learned from memo before sending. `organization` is true when memo keeps that organization's record,
 * false when it does not, and undefined when the node could not tell.
 */
export interface Known {
  pipeline?: Stored
  organization?: boolean
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

export const clean = (value: unknown) => {
  const trimmed = value === undefined || value === null ? "" : String(value).trim()
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

/**
 * Only a form the amount cannot be misread in: "1,500" is one and a half thousand in one country and one and a half in
 * another, and memo would keep whichever the node guessed.
 */
export const amountOf = (value: unknown): string | undefined => {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new EnvelopeError(`amount ${value} is not a number`)
    return String(value)
  }
  const given = clean(value)?.replace(/[\s_\u00a0\u202f]/g, "")
  if (!given) return undefined
  if (/^-?\d+(\.\d+)?$/.test(given)) return given
  if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(given)) return given.replace(/,/g, "")
  if (/^-?\d+,\d{1,2}$/.test(given)) return given.replace(",", ".")
  throw new EnvelopeError(
    `amount "${String(value)}" could be read two ways; send a number with a dot for decimals, such as 1500.00`,
  )
}

export const personKey = (contact: Contact) => {
  const email = clean(contact.email)?.toLowerCase()
  if (email) return email
  const phone = clean(contact.phone)
  if (!phone) return undefined
  const digits = phone.replace(/\D/g, "")
  return digits ? `${phone.startsWith("+") ? "+" : ""}${digits}` : undefined
}

export const organizationKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase()

const contactFields = (contact: Contact) => {
  const name = clean(contact.name)
  const email = clean(contact.email)?.toLowerCase()
  const phone = clean(contact.phone)
  return { ...(name ? { name } : {}), ...(email ? { email } : {}), ...(phone ? { phone } : {}) }
}

const record = (type: string, externalId: string, fields: Record<string, unknown>, relations: Relation[] = []) => ({
  key: type,
  type,
  external_id: externalId,
  operation: "upsert" as const,
  fields,
  ...(relations.length ? { relations } : {}),
})

/**
 * memo replaces a record's fields whole, so a company named on a lead only becomes a record when memo has none: an
 * Organization node's domain is never wiped by a lead that knows the name alone. Unknown means link, don't send.
 */
const companyRecords = (company: string | undefined, exists: boolean | undefined): EnvelopeRecord[] =>
  company && exists === false ? [record("organization", organizationKey(company), { name: company })] : []

const companyRelation = (role: string, company: string | undefined): Relation[] =>
  company ? [{ role, type: "organization", external_id: organizationKey(company) }] : []

const storedStages = (pipeline: Stored): Stage[] =>
  (Array.isArray(pipeline.fields.stages) ? (pipeline.fields.stages as Array<Record<string, unknown>>) : []).map(
    (one) => ({ id: String(one.external_id), name: String(one.name), outcome: (one.outcome as Outcome) ?? "open" }),
  )

/**
 * A lead or a deal needs its pipeline record in memo, or it waits for one. The node sends the pipeline when the user
 * gave stages, or when memo has none yet; otherwise it leaves the stored stages alone.
 *
 * The contact goes in a record of the lead's own (`lead:<id>`), never in the record a Person node keeps for that
 * e-mail: memo links both to the same person by the e-mail or phone, and neither send wipes the other's fields.
 */
export const dealRecords = (kind: Kind, input: DealFields, known: Known = {}): EnvelopeRecord[] => {
  const id = clean(input.id)
  const title = clean(input.title)
  if (!id) throw new EnvelopeError(`a ${kind} needs its ID, so sending it again updates it instead of adding another`)
  if (!title) throw new EnvelopeError(`a ${kind} needs a title`)
  const given = input.stages.length > 0
  const stages = given ? input.stages : known.pipeline ? storedStages(known.pipeline) : DEFAULT_STAGES[kind]
  const stage = stages.find((one) => one.id === clean(input.stage)?.toLowerCase())
  if (!stage) throw new EnvelopeError(`stage "${input.stage}" is not one of ${stages.map((one) => one.id).join(", ")}`)
  const amount = amountOf(input.amount)
  const currency = clean(input.currency)?.toUpperCase()
  if (amount && !currency) throw new EnvelopeError("an amount needs its currency, such as EUR")
  const closeDate = clean(input.closeDate)
  const url = clean(input.url)
  const company = clean(input.company)?.replace(/\s+/g, " ")
  const person = personKey(input)

  const records: EnvelopeRecord[] = []
  if (given || !known.pipeline)
    records.push({
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
    })
  records.push(...companyRecords(company, known.organization))
  const contact = person ? `${kind}:${id}` : undefined
  if (contact) records.push(record("person", contact, contactFields(input)))
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
      ...(contact ? [{ role: "person", type: "person", external_id: contact }] : []),
      ...companyRelation("organization", company),
    ],
  })
  return records
}

export const deleteRecords = (kind: Kind, id: string): EnvelopeRecord[] => {
  const external = clean(id)
  if (!external) throw new EnvelopeError(`a ${kind} to delete needs its ID`)
  return [{ key: kind, type: kind, external_id: external, operation: "delete" }]
}

export const personId = (contact: Contact & { id?: string }) => {
  const id = clean(contact.id) ?? personKey(contact)
  if (!id) throw new EnvelopeError("a person needs an ID, an e-mail or a phone, so the next send finds the same one")
  return id
}

/** A Person node's send is what the source says of that person now: the fields it leaves empty are dropped. */
export const personRecords = (
  contact: Contact & { id?: string; position?: string },
  known: Known = {},
): EnvelopeRecord[] => {
  const company = clean(contact.company)?.replace(/\s+/g, " ")
  const position = clean(contact.position)
  return [
    ...companyRecords(company, known.organization),
    record(
      "person",
      personId(contact),
      { ...contactFields(contact), ...(position ? { position } : {}) },
      companyRelation("member-of", company),
    ),
  ]
}

export const organizationId = (input: { name: string; id?: string }) => {
  const name = clean(input.name)
  if (!name) throw new EnvelopeError("an organization needs a name")
  return clean(input.id) ?? organizationKey(name)
}

export const organizationRecords = (input: { name: string; id?: string; domain?: string }): EnvelopeRecord[] => {
  const domain = clean(input.domain)?.toLowerCase()
  return [
    record("organization", organizationId(input), {
      name: clean(input.name),
      ...(domain ? { identifiers: [{ scheme: "domain", value: domain }] } : {}),
    }),
  ]
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
