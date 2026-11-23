import Ajv2020 from "ajv/dist/2020"
import { describe, expect, it } from "vitest"
import schema from "./fixtures/records-envelope.v1.schema.json"
import { builtEnvelopes } from "./envelopes.mjs"
import {
  dealRecords,
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

  it("send a lead with its pipeline and the person keyed on the e-mail, as the live workflow does", () => {
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
          external_id: "anna@example.com",
          operation: "upsert",
          fields: { name: "Anna Example", email: "anna@example.com" },
        },
        {
          key: "lead",
          type: "lead",
          external_id: "form-17",
          operation: "upsert",
          fields: { title: "Anna Example: call back about the clinic site", pipeline: "web", stage: "new" },
          relations: [{ role: "person", type: "person", external_id: "anna@example.com" }],
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
      { role: "person", type: "person", external_id: "+34 600 000 001" },
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
