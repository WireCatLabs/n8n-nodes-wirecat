import Ajv2020 from "ajv/dist/2020"
import { describe, expect, it } from "vitest"
import schema from "./fixtures/records-envelope.v1.schema.json"
import { builtEnvelopes } from "./envelopes.mjs"
import {
  amountOf,
  dealRecords,
  organizationRecords,
  EnvelopeError,
  envelopeOf,
  parseEnvelope,
  personRecords,
  splitAccount,
} from "../nodes/WireCatMemo/envelope"

const validate = new Ajv2020({ strict: false }).compile(schema)

describe("the envelopes the node builds", () => {
  it.each(Object.entries(builtEnvelopes))("match memo's records envelope schema: %s", (_name, envelope) => {
    expect(validate(envelope), JSON.stringify(validate.errors)).toBe(true)
  })

  it("send a new lead with its pipeline and its contact in a person record of its own", () => {
    expect(builtEnvelopes.lead).toEqual({
      schema_version: 1,
      source: { provider: "n8n", account: "test", batch_id: "t-lead" },
      records: [
        {
          key: "pipeline",
          type: "pipeline",
          external_id: "web",
          operation: "upsert",
          fields: {
            kind: "lead",
            name: "Web",
            stages: [{ external_id: "new", name: "New", position: 1, outcome: "open" }],
          },
        },
        {
          key: "person",
          type: "person",
          external_id: "lead:form-17",
          operation: "upsert",
          fields: { name: "Anna Example", email: "anna@example.com" },
        },
        {
          key: "lead",
          type: "lead",
          external_id: "form-17",
          operation: "upsert",
          fields: { title: "Anna Example: call back about the clinic site", pipeline: "web", stage: "new" },
          relations: [{ role: "person", type: "person", external_id: "lead:form-17" }],
        },
      ],
    })
  })

  it("give a deal its stage's outcome as status, a decimal amount and the company", () => {
    const deal = builtEnvelopes.deal.records[builtEnvelopes.deal.records.length - 1]
    expect(deal?.fields).toEqual({
      title: "Clinic site redesign",
      pipeline: "sales",
      stage: "proposal",
      status: "open",
      amount: "1500.00",
      currency: "EUR",
      close_date: "2026-12-31",
    })
    expect(deal?.relations).toEqual([
      { role: "person", type: "person", external_id: "deal:D-1001" },
      { role: "organization", type: "organization", external_id: "example clinic" },
    ])
  })
})

describe("what the node refuses before calling memo", () => {
  const base = {
    id: "D-1",
    title: "A deal",
    pipelineId: "sales",
    pipelineName: "Sales",
    stages: [],
    stage: "new",
  }

  it.each([
    ["no ID", { ...base, id: " " }, /needs its ID/],
    ["no title", { ...base, title: "" }, /needs a title/],
    ["an unknown stage", { ...base, stage: "signed" }, /not one of new, proposal, won, lost/],
    ["an amount without currency", { ...base, amount: "10" }, /needs its currency/],
  ])("a deal with %s", (_name, input, message) => {
    expect(() => dealRecords("deal", input)).toThrow(message)
  })

  it("a person with no ID, e-mail or phone", () => {
    expect(() => personRecords({ name: "Nobody" })).toThrow(EnvelopeError)
  })

  it("an account without its provider", () => {
    expect(() => splitAccount("site")).toThrow(/<provider>:<name>/)
    expect(() => envelopeOf("N8N:site", "b", [])).toThrow(EnvelopeError)
  })

  it("a raw envelope without source or records", () => {
    expect(() => parseEnvelope("{}")).toThrow(/schema_version 1/)
    expect(() => parseEnvelope({ schema_version: 1, source: { provider: "n8n" }, records: [] })).toThrow(/source/)
    expect(parseEnvelope(JSON.stringify(builtEnvelopes.lead))).toEqual(builtEnvelopes.lead)
  })
})

describe("amounts", () => {
  it.each([
    [1500, "1500"],
    [12.5, "12.5"],
    ["1500.00", "1500.00"],
    ["1 500.00", "1500.00"],
    ["1_500", "1500"],
    ["1,500.00", "1500.00"],
    ["1,234,567.8", "1234567.8"],
    ["1500,5", "1500.5"],
    ["-20,75", "-20.75"],
    ["", undefined],
  ])("reads %j as %j", (given, read) => {
    expect(amountOf(given)).toBe(read)
  })

  it.each(["1,500", "1.500,00", "1,500,000", "1.5.0", "12abc", "1,5000"])(
    "refuses %j, which reads two ways",
    (given) => {
      expect(() => amountOf(given)).toThrow(/send a number/)
    },
  )
})

describe("what memo already keeps", () => {
  const lead = {
    id: "L-1",
    title: "Call back",
    pipelineId: "web",
    pipelineName: "Web",
    stages: [],
    stage: "call",
    name: "Anna E.",
    email: "anna@example.com",
    company: "EXAMPLE  CLINIC",
  }
  const pipeline = {
    fields: {
      kind: "lead",
      name: "Web",
      stages: [
        { external_id: "new", name: "New", position: 1, outcome: "open" },
        { external_id: "call", name: "Call", position: 2, outcome: "open" },
      ],
    },
  }

  it("sends neither the stored pipeline nor a company memo keeps, and the contact in the lead's own record", () => {
    const records = dealRecords("lead", lead, { pipeline, organization: true })
    expect(records.map((one) => `${one.type}:${one.external_id}`)).toEqual(["person:lead:L-1", "lead:L-1"])
    expect(records[1].relations).toEqual([
      { role: "person", type: "person", external_id: "lead:L-1" },
      { role: "organization", type: "organization", external_id: "example clinic" },
    ])
  })

  it("sends a company memo does not keep, and only links one it could not check", () => {
    expect(dealRecords("lead", lead, { pipeline, organization: false })[0]).toMatchObject({
      type: "organization",
      external_id: "example clinic",
      fields: { name: "EXAMPLE CLINIC" },
    })
    expect(dealRecords("lead", lead, { pipeline }).map((one) => one.type)).toEqual(["person", "lead"])
  })

  it("sends the pipeline when the user gives stages, even if memo has one", () => {
    const records = dealRecords(
      "lead",
      { ...lead, stage: "new", stages: [{ id: "new", name: "New", outcome: "open" }] },
      { pipeline },
    )
    expect(records[0]).toMatchObject({ type: "pipeline", fields: { stages: [{ external_id: "new" }] } })
  })

  it("refuses a stage the stored pipeline does not have", () => {
    expect(() => dealRecords("lead", { ...lead, stage: "won" }, { pipeline })).toThrow(/not one of new, call/)
  })

  it("keys a person on the phone's digits and the company on its name, as the Organization node does", () => {
    const [organization, person] = personRecords(
      { phone: "+34 (600) 000-001", company: " Example  Clinic " },
      { organization: false },
    )
    expect(person.external_id).toBe("+34600000001")
    expect(organization.external_id).toBe("example clinic")
    expect(organizationRecords({ name: "EXAMPLE CLINIC" })[0].external_id).toBe("example clinic")
  })
})
