import { NodeApiError, NodeOperationError } from "n8n-workflow"
import { describe, expect, it } from "vitest"
import { WireCatMemo } from "../nodes/WireCatMemo/WireCatMemo.node"
import { executeContext, fakeMemo } from "./fake-memo.mjs"

const node = new WireCatMemo()

const lead = {
  resource: "lead",
  operation: "upsert",
  account: "n8n:test",
  id: "web-17",
  title: "Call back",
  pipelineId: "web",
  pipelineName: "Web",
  stage: "new",
  contactName: "Anna",
  email: "anna@example.com",
}

const person = {
  resource: "person",
  operation: "upsert",
  account: "n8n:test",
  contactName: "Anna Example",
  email: "Anna@Example.com",
  additionalFields: { position: "CTO" },
}

describe("WireCatMemo.execute", () => {
  it("turns each item's parameters into one import, paired with its item", async () => {
    const memo = fakeMemo()
    const [out] = await node.execute.call(executeContext(memo, [lead, { ...lead, id: "web-18" }]))
    expect(out.map((one) => one.pairedItem)).toEqual([{ item: 0 }, { item: 1 }])
    expect(out[0].json).toMatchObject({ created: 3, refused: 0 })
    expect(out[1].json).toMatchObject({ created: 2 })
    const imported = memo.calls.find((one) => one.command === "records import")?.args.arguments as {
      account: string
      input: { source: object; records: Array<{ type: string }> }
    }
    expect(imported.account).toBe("n8n:test")
    expect(imported.input.source).toEqual({ provider: "n8n", account: "test", batch_id: "7-0" })
    expect(imported.input.records.map((one) => one.type)).toEqual(["pipeline", "person", "lead"])
    expect(memo.calls.filter((one) => one.command === "records list")).toHaveLength(1)
    expect(memo.sessions()).toBe(1)
  })

  it("takes numbers from expressions without failing", async () => {
    const memo = fakeMemo()
    const deal = {
      ...lead,
      resource: "deal",
      id: 1001,
      title: 42,
      phone: 34600000001,
      email: "",
      additionalFields: { amount: 1500, currency: "eur" },
    }
    const [out] = await node.execute.call(executeContext(memo, [deal]))
    expect(out[0].json).toMatchObject({ refused: 0 })
    expect(memo.store.get("n8n:test|deal:1001")?.fields).toMatchObject({ title: "42", amount: "1500", currency: "EUR" })
    expect(memo.store.get("n8n:test|person:deal:1001")?.fields).toEqual({ name: "Anna", phone: "34600000001" })
  })

  it("never wipes what a Person or Organization node stored, and a repeat changes nothing", async () => {
    const memo = fakeMemo()
    const organization = {
      resource: "organization",
      operation: "upsert",
      account: "n8n:test",
      name: "Example Clinic",
      additionalFields: { domain: "clinic.example" },
    }
    await node.execute.call(executeContext(memo, [organization, { ...person, company: "Example Clinic" }]))
    const leadOfAnna = { ...lead, contactName: "A.", company: "EXAMPLE  CLINIC" }
    const [first] = await node.execute.call(executeContext(memo, [leadOfAnna]))
    expect(memo.store.get("n8n:test|person:anna@example.com")?.fields).toEqual({
      name: "Anna Example",
      email: "anna@example.com",
      position: "CTO",
    })
    expect(memo.store.get("n8n:test|organization:example clinic")?.fields).toEqual({
      name: "Example Clinic",
      identifiers: [{ scheme: "domain", value: "clinic.example" }],
    })
    expect(memo.store.get("n8n:test|person:lead:web-17")?.fields).toEqual({ name: "A.", email: "anna@example.com" })
    expect(memo.store.get("n8n:test|lead:web-17")?.relations).toEqual([
      { role: "person", type: "person", external_id: "lead:web-17" },
      { role: "organization", type: "organization", external_id: "example clinic" },
    ])
    expect(first[0].json).toMatchObject({ created: 3, updated: 0 })
    const [again] = await node.execute.call(executeContext(memo, [leadOfAnna]))
    expect(again[0].json).toMatchObject({ created: 0, updated: 0, unchanged: 2 })
  })

  it("leaves a stored pipeline's stages alone, and sends its own when given", async () => {
    const memo = fakeMemo()
    const stages = {
      stage: [
        { id: "new", name: "New", outcome: "open" },
        { id: "call", name: "Call", outcome: "open" },
      ],
    }
    await node.execute.call(executeContext(memo, [{ ...lead, stages }]))
    await node.execute.call(executeContext(memo, [{ ...lead, id: "web-18", stage: "call" }]))
    const pipeline = memo.store.get("n8n:test|pipeline:web")?.fields as { stages: Array<{ external_id: string }> }
    expect(pipeline.stages.map((one) => one.external_id)).toEqual(["new", "call"])
  })

  it("links a company it cannot see among memo's newest 500 instead of sending it", async () => {
    const memo = fakeMemo()
    await node.execute.call(
      executeContext(memo, [
        { resource: "organization", operation: "upsert", account: "n8n:test", name: "Other" },
        {
          resource: "organization",
          operation: "upsert",
          account: "n8n:test",
          name: "Example Clinic",
          additionalFields: { domain: "clinic.example" },
        },
      ]),
    )
    memo.limitLists(1)
    await node.execute.call(executeContext(memo, [{ ...lead, company: "Example Clinic" }]))
    expect(memo.store.get("n8n:test|organization:example clinic")?.fields).toMatchObject({
      identifiers: [{ value: "clinic.example" }],
    })
    expect(memo.store.get("n8n:test|lead:web-17")?.relations).toContainEqual({
      role: "organization",
      type: "organization",
      external_id: "example clinic",
    })
  })

  it("answers not_found for a delete of a record memo never had", async () => {
    const memo = fakeMemo()
    const [out] = await node.execute.call(
      executeContext(memo, [{ resource: "deal", operation: "delete", account: "n8n:test", id: "D-9" }]),
    )
    expect(out[0].json).toEqual({ status: "not_found", type: "deal", external_id: "D-9", account: "n8n:test" })
  })

  it("opens a new session when memo dropped the old one, and repeats the call once", async () => {
    const memo = fakeMemo()
    const context = executeContext(memo, [lead, { ...lead, id: "web-18" }])
    const original = memo.handle
    let seen = 0
    memo.handle = (request) => {
      if (request.body?.includes('"tools/call"') && ++seen === 2) memo.dropSession()
      return original(request)
    }
    const [out] = await node.execute.call(context)
    expect(out).toHaveLength(2)
    expect(memo.sessions()).toBe(2)
  })

  it("stops on a refusal with memo's reason, as an operation error on that item", async () => {
    const memo = fakeMemo()
    const bad = { ...lead, stage: "won" }
    await expect(node.execute.call(executeContext(memo, [lead, bad]))).rejects.toThrow(
      expect.objectContaining({
        message: 'stage "won" is not one of new',
        context: expect.objectContaining({ itemIndex: 1 }),
      }),
    )
    await expect(node.execute.call(executeContext(memo, [lead, bad]))).rejects.toBeInstanceOf(NodeOperationError)
    const read = { resource: "memory", operation: "read", command: "records delete", arguments: "{}" }
    await expect(node.execute.call(executeContext(memo, [read]))).rejects.toThrow(/writes: call it with wcat_write/)
    const amount = { ...lead, resource: "deal", additionalFields: { amount: "1,500", currency: "EUR" } }
    await expect(node.execute.call(executeContext(memo, [amount]))).rejects.toThrow(/send a number/)
  })

  it("gives the error as the item's output when the node continues on fail", async () => {
    const memo = fakeMemo()
    const [out] = await node.execute.call(executeContext(memo, [{ ...lead, id: "" }, lead], { continueOnFail: true }))
    expect(out[0]).toEqual({ json: { error: expect.stringMatching(/needs its ID/) }, pairedItem: { item: 0 } })
    expect(out[1].json).toMatchObject({ created: 3 })
  })

  it("returns one item for each search hit", async () => {
    const memo = fakeMemo()
    const [out] = await node.execute.call(
      executeContext(memo, [{ resource: "memory", operation: "search", query: "Anna" }]),
    )
    expect(out.map((one) => one.json)).toEqual([{ ref: "lead:1" }, { ref: "lead:2" }])
    expect(memo.calls[0]).toMatchObject({ tool: "wcat_read", command: "search all" })
  })

  it("passes a failed request on as an API error", async () => {
    const memo = fakeMemo()
    memo.handle = () => {
      throw new NodeApiError(
        { id: "1", name: "WireCat Memo", type: "x", typeVersion: 1, position: [0, 0], parameters: {} },
        { message: "connect ECONNREFUSED" },
      )
    }
    await expect(node.execute.call(executeContext(memo, [lead]))).rejects.toBeInstanceOf(NodeApiError)
  })
})
