import fs from "fs"
import os from "os"
import path from "path"

// Refuse to touch anything but the throwaway race database. DATABASE_URL is what lib/prisma reads, so it
// is set from RACE_DATABASE_URL here, before any test file imports the app.
const url = process.env.RACE_DATABASE_URL || ""
if (!/^postgres(ql)?:\/\/race:[^@]+@race-db:5432\/race(\?|$)/.test(url)) {
  throw new Error("race tests: RACE_DATABASE_URL must be the throwaway race database (race@race-db:5432/race)")
}
process.env.DATABASE_URL = url
process.env.WA_DELIVERY_DISABLED = "1"
// The attendance routes write selfies to <cwd>/public/uploads: keep them out of the checkout.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nexus-race-"))
process.chdir(dir)
