import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, describe, expect, it } from "vitest"
import { builtEnvelopes } from "./envelopes.mjs"

const wcat = spawnSync("wcat-wirecat", ["--version"], { encoding: "utf8" }).status === 0

// A throwaway store and folders, so the check never reads or locks the owner's wcat, nor reaches the keyring.
// Vitest's own variables stay out: wcat run under VITEST behaves as in its own tests and crashes here.
const dir = mkdtempSync(join(tmpdir(), "n8n-nodes-wirecat-"))
const sandbox = () => {
  return {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DBUS_SESSION_BUS_ADDRESS: "disabled:",
    WCAT_NO_UPDATE_CHECK: "1",
    WCAT_CONFIG_DIR: join(dir, "config"),
    WCAT_STATE_DIR: join(dir, "state"),
    WCAT_CACHE_DIR: join(dir, "cache"),
    WIRECAT_STATE_DIR: join(dir, "wirecat"),
    MESSAGING_STORE: join(dir, "store.db"),
  }
}

describe.skipIf(!wcat)("wcat records check", () => {
  const env = sandbox()
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  // A delete names a record an earlier import made, and a check writes nothing, so it has none to find.
  it.each(Object.entries(builtEnvelopes).filter(([name]) => name !== "deleted deal"))(
    "accepts every record of the %s envelope",
    (_name, envelope) => {
      const out = execFileSync("wcat-wirecat", ["records", "check", "-", "--account", "n8n:test", "--json"], {
        env,
        input: JSON.stringify(envelope),
        encoding: "utf8",
      })
      const { item } = JSON.parse(out) as { item: { refused: number; errors: unknown[]; created: number } }
      expect(item.errors).toEqual([])
      expect(item.refused).toBe(0)
      expect(item.created).toBe(envelope.records.length)
    },
    30_000,
  )
})
