import {
  dealRecords,
  deleteRecords,
  type Envelope,
  envelopeOf,
  organizationRecords,
  personRecords,
} from "../nodes/WireCatMemo/envelope"

const lead = {
  id: "form-17",
  title: "Anna Example: call back about the clinic site",
  pipelineId: "web",
  pipelineName: "Web",
  stages: [],
  stage: "new",
  name: "Anna Example",
  email: "Anna@Example.com",
  phone: "",
  company: "",
}

const deal = {
  id: "D-1001",
  title: "Clinic site redesign",
  pipelineId: "sales",
  pipelineName: "Sales",
  stages: [],
  stage: "Proposal",
  amount: "1 500,00",
  currency: "eur",
  closeDate: "2026-12-31",
  name: "Boris Example",
  email: "",
  phone: "+34 600 000 001",
  company: "Example Clinic",
}

/** One envelope for each thing the node builds, as memo receives it. */
export const builtEnvelopes: Record<string, Envelope> = {
  lead: envelopeOf("n8n:test", "t-lead", dealRecords("lead", lead)),
  deal: envelopeOf("n8n:test", "t-deal", dealRecords("deal", deal, { organization: false })),
  "deal with own stages": envelopeOf(
    "n8n:test",
    "t-stages",
    dealRecords("deal", {
      ...deal,
      id: "D-1002",
      stage: "signed",
      stages: [
        { id: "talk", name: "Talk", outcome: "open" },
        { id: "signed", name: "Signed", outcome: "won" },
      ],
    }),
  ),
  "deleted deal": envelopeOf("n8n:test", "t-delete", deleteRecords("deal", "D-1001")),
  person: envelopeOf(
    "n8n:test",
    "t-person",
    personRecords(
      { name: "Carla Example", email: "carla@example.com", company: "Example Clinic", position: "CTO" },
      { organization: false },
    ),
  ),
  organization: envelopeOf("n8n:test", "t-org", organizationRecords({ name: "Example Clinic", domain: "Example.org" })),
}
