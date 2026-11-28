import type { INodeProperties } from "n8n-workflow"

const on = (resource: string[], operation?: string[]) => ({
  show: { resource, ...(operation ? { operation } : {}) },
})

const operations: INodeProperties[] = [
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: on(["lead", "deal"]),
    options: [
      {
        name: "Create or Update",
        value: "upsert",
        description: "Create a new record, or update the current one if it already exists (upsert)",
        action: "Create or update a record",
      },
      {
        name: "Delete",
        value: "delete",
        description: "Tell wcat the source deleted it. wcat keeps the record and marks it deleted at the source.",
        action: "Delete a record",
      },
    ],
    default: "upsert",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: on(["person", "organization"]),
    options: [
      {
        name: "Create or Update",
        value: "upsert",
        description: "Create a new record, or update the current one if it already exists (upsert)",
        action: "Create or update a contact",
      },
    ],
    default: "upsert",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: on(["envelope"]),
    options: [
      { name: "Import", value: "import", description: "Write its records into wcat", action: "Import an envelope" },
      {
        name: "Check",
        value: "check",
        description: "Show what an import would do, writing nothing",
        action: "Check an envelope",
      },
    ],
    default: "import",
  },
  {
    displayName: "Operation",
    name: "operation",
    type: "options",
    noDataExpression: true,
    displayOptions: on(["memory"]),
    options: [
      {
        name: "Search",
        value: "search",
        description: "Search everything wcat keeps",
        action: "Search memory",
      },
      {
        name: "Run Read Command",
        value: "read",
        description: "Run one wcat command that only reads, such as leads list",
        action: "Run a read command",
      },
      {
        name: "Find Command",
        value: "findCommand",
        description: "List the commands wcat offers and the arguments each takes",
        action: "Find a command",
      },
    ],
    default: "search",
  },
]

const recordTypes = ["lead", "deal", "person", "organization"]

const contactFields = (resources: string[]): INodeProperties[] => [
  {
    displayName: "Contact Name",
    name: "contactName",
    type: "string",
    default: "",
    displayOptions: on(resources, ["upsert"]),
  },
  {
    displayName: "Email",
    name: "email",
    type: "string",
    placeholder: "name@email.com",
    default: "",
    description: "Links the record in wcat to the one person with this e-mail, or makes that person",
    displayOptions: on(resources, ["upsert"]),
  },
  {
    displayName: "Phone",
    name: "phone",
    type: "string",
    default: "",
    description: "Used like the e-mail when there is no e-mail",
    displayOptions: on(resources, ["upsert"]),
  },
  {
    displayName: "Company",
    name: "company",
    type: "string",
    default: "",
    description: "The organization's name; the same name links to the same organization",
    displayOptions: on(resources, ["upsert"]),
  },
]

const stageFields: INodeProperties[] = [
  {
    displayName: "Pipeline ID",
    name: "pipelineId",
    type: "string",
    default: "web",
    displayOptions: on(["lead"], ["upsert"]),
  },
  {
    displayName: "Pipeline ID",
    name: "pipelineId",
    type: "string",
    default: "sales",
    displayOptions: on(["deal"], ["upsert"]),
  },
  {
    displayName: "Pipeline Name",
    name: "pipelineName",
    type: "string",
    default: "Web",
    displayOptions: on(["lead"], ["upsert"]),
  },
  {
    displayName: "Pipeline Name",
    name: "pipelineName",
    type: "string",
    default: "Sales",
    displayOptions: on(["deal"], ["upsert"]),
  },
  {
    displayName: "Stage",
    name: "stage",
    type: "string",
    default: "new",
    description:
      "One stage ID of the pipeline. Without your own stages a lead has new; a deal has new, proposal, won and lost.",
    displayOptions: on(["lead", "deal"], ["upsert"]),
  },
  {
    displayName: "Stages",
    name: "stages",
    type: "fixedCollection",
    typeOptions: { multipleValues: true, sortable: true },
    placeholder: "Add Stage",
    default: {},
    description: "The pipeline's stages in order. Leave empty for the default stages.",
    displayOptions: on(["lead", "deal"], ["upsert"]),
    options: [
      {
        displayName: "Stage",
        name: "stage",
        values: [
          { displayName: "ID", name: "id", type: "string", default: "" },
          { displayName: "Name", name: "name", type: "string", default: "" },
          {
            displayName: "Outcome",
            name: "outcome",
            type: "options",
            options: [
              { name: "Open", value: "open" },
              { name: "Won", value: "won" },
              { name: "Lost", value: "lost" },
            ],
            default: "open",
          },
        ],
      },
    ],
  },
]

const recordFields: INodeProperties[] = [
  {
    displayName: "Account",
    name: "account",
    type: "string",
    default: "n8n:site",
    required: true,
    description:
      "The source in wcat, as provider:name. Everything one workflow sends goes to one account, and wcat records clear --account removes it whole.",
    displayOptions: on(recordTypes),
  },
  {
    displayName: "ID",
    name: "id",
    type: "string",
    default: "",
    required: true,
    placeholder: "web-17",
    description:
      "The record's ID at the source, such as the form submission's or the CRM's. The same ID sent again updates the record instead of adding another, also when n8n retries the execution.",
    displayOptions: on(["lead", "deal"]),
  },
  {
    displayName: "Title",
    name: "title",
    type: "string",
    default: "",
    required: true,
    displayOptions: on(["lead", "deal"], ["upsert"]),
  },
  ...stageFields,
  ...contactFields(["lead", "deal"]),
  {
    displayName: "Name",
    name: "contactName",
    type: "string",
    default: "",
    displayOptions: on(["person"]),
  },
  ...contactFields(["person"]).slice(1),
  {
    displayName: "Name",
    name: "name",
    type: "string",
    default: "",
    required: true,
    displayOptions: on(["organization"]),
  },
  {
    displayName: "Additional Fields",
    name: "additionalFields",
    type: "collection",
    placeholder: "Add Field",
    default: {},
    displayOptions: on(["lead", "deal"], ["upsert"]),
    options: [
      {
        displayName: "Amount",
        name: "amount",
        type: "string",
        default: "",
        placeholder: "1500.00",
        description:
          "A number, with a dot for decimals. 1,500.00 and 1500,50 are read too; 1,500 and 1.500,00 are refused, because they read two ways.",
      },
      { displayName: "Close Date", name: "closeDate", type: "string", default: "", placeholder: "2026-12-31" },
      { displayName: "Currency", name: "currency", type: "string", default: "", placeholder: "EUR" },
      { displayName: "URL", name: "url", type: "string", default: "", description: "The source's page for it" },
    ],
  },
  {
    displayName: "Additional Fields",
    name: "additionalFields",
    type: "collection",
    placeholder: "Add Field",
    default: {},
    displayOptions: on(["person"]),
    options: [
      {
        displayName: "ID",
        name: "id",
        type: "string",
        default: "",
        description: "The person's ID at the source. Without it the e-mail, else the phone, is the ID.",
      },
      { displayName: "Position", name: "position", type: "string", default: "", description: "The job title" },
    ],
  },
  {
    displayName: "Additional Fields",
    name: "additionalFields",
    type: "collection",
    placeholder: "Add Field",
    default: {},
    displayOptions: on(["organization"]),
    options: [
      {
        displayName: "Domain",
        name: "domain",
        type: "string",
        default: "",
        placeholder: "example.com",
        description: "Links the record in wcat to the organization with this domain",
      },
      {
        displayName: "ID",
        name: "id",
        type: "string",
        default: "",
        description: "The organization's ID at the source. Without it the name in lower case is the ID.",
      },
    ],
  },
]

const envelopeFields: INodeProperties[] = [
  {
    displayName: "Envelope",
    name: "envelope",
    type: "json",
    default:
      '{\n  "schema_version": 1,\n  "source": { "provider": "n8n", "account": "site", "batch_id": "" },\n  "records": []\n}',
    required: true,
    description: "A records envelope as wcat records templates show prints it. Its source names the account.",
    displayOptions: on(["envelope"]),
  },
]

const memoryFields: INodeProperties[] = [
  {
    displayName: "Query",
    name: "query",
    type: "string",
    default: "",
    required: true,
    placeholder: "clinic site",
    displayOptions: on(["memory"], ["search"]),
  },
  {
    displayName: "Command",
    name: "command",
    type: "string",
    default: "",
    required: true,
    placeholder: "leads list",
    description: "A command Find Command lists as one that does not write",
    displayOptions: on(["memory"], ["read"]),
  },
  {
    displayName: "Arguments",
    name: "arguments",
    type: "json",
    default: "{}",
    description: "The command's arguments as Find Command shows them",
    displayOptions: on(["memory"], ["read"]),
  },
  {
    displayName: "Words",
    name: "words",
    type: "string",
    default: "",
    placeholder: "leads",
    description: "Words for the task; leave empty to list every command",
    displayOptions: on(["memory"], ["findCommand"]),
  },
]

const options: INodeProperties = {
  displayName: "Options",
  name: "options",
  type: "collection",
  placeholder: "Add Option",
  default: {},
  displayOptions: on(recordTypes),
  options: [
    {
      displayName: "Batch ID",
      name: "batchId",
      type: "string",
      default: "",
      description: "A label for this import on wcat's receipt. Without it the execution ID and the item number.",
    },
  ],
}

export const properties: INodeProperties[] = [
  {
    displayName: "Resource",
    name: "resource",
    type: "options",
    noDataExpression: true,
    options: [
      { name: "Deal", value: "deal" },
      { name: "Envelope", value: "envelope" },
      { name: "Lead", value: "lead" },
      { name: "Memory", value: "memory" },
      { name: "Organization", value: "organization" },
      { name: "Person", value: "person" },
    ],
    default: "lead",
  },
  ...operations,
  ...recordFields,
  ...envelopeFields,
  ...memoryFields,
  options,
]
