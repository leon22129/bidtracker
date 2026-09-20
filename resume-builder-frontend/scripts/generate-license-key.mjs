import { sign } from "node:crypto"
import { appendFile, mkdir, readFile } from "node:fs/promises"
import { createInterface } from "node:readline/promises"
import { stdin as input, stdout as output } from "node:process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const appRoot = resolve(__dirname, "..")
const DEFAULT_PRIVATE_KEY_PATH = ".license-keys/private.pem"
const DEFAULT_HISTORY_PATH = ".license-keys/history.jsonl"
const ONE_DAY_MS = 24 * 60 * 60 * 1000
const FLAGS_WITH_VALUES = new Set(["--machine-id", "--days", "--licensee", "--private-key", "--history"])

function printUsage() {
  console.error([
    "Usage:",
    "  npm run license:generate",
    "  npm run license:generate -- <machine-id> <expire-days> [licensee]",
    "  npm run license:generate -- --machine-id <machine-id> --days <expire-days> [--licensee <name>] [--private-key <path>] [--history <path>]",
    "",
    "Examples:",
    "  npm run license:generate",
    "  npm run license:generate -- abc123 30",
    "  npm run license:generate -- --machine-id abc123 --days 365 --licensee \"Customer Name\"",
  ].join("\n"))
}

function getArg(name, fallback = "") {
  const index = process.argv.indexOf(name)
  if (index === -1) {
    return fallback
  }

  return process.argv[index + 1] || fallback
}

function hasFlag(name) {
  return process.argv.includes(name)
}

function getNpmConfig(name) {
  return process.env[`npm_config_${name.replace(/^--/, "").replace(/-/g, "_")}`] || ""
}

function getPositionalArgs() {
  const positionalArgs = []
  const args = process.argv.slice(2)

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]

    if (FLAGS_WITH_VALUES.has(arg)) {
      index += 1
      continue
    }

    if (arg.startsWith("--")) {
      continue
    }

    positionalArgs.push(arg)
  }

  return positionalArgs
}

function toBase64Url(value) {
  return Buffer.from(value).toString("base64url")
}

function parsePositiveDays(value) {
  if (!/^\d+$/.test(value.trim())) {
    return null
  }

  const days = Number(value)
  if (!Number.isSafeInteger(days) || days <= 0) {
    return null
  }

  return days
}

function addDays(date, days) {
  return new Date(date.getTime() + days * ONE_DAY_MS)
}

function formatHistoryRecord(record) {
  return `${JSON.stringify(record)}\n`
}

function parseArguments() {
  const positionalArgs = getPositionalArgs()
  const privateKeyPath = resolve(
    appRoot,
    getArg("--private-key", getNpmConfig("--private-key") || DEFAULT_PRIVATE_KEY_PATH),
  )
  const historyPath = resolve(
    appRoot,
    getArg("--history", getNpmConfig("--history") || DEFAULT_HISTORY_PATH),
  )

  return {
    machineId: getArg("--machine-id", getNpmConfig("--machine-id") || positionalArgs[0] || "").trim(),
    daysInput: getArg("--days", getNpmConfig("--days") || positionalArgs[1] || "").trim(),
    licensee: getArg("--licensee", getNpmConfig("--licensee") || positionalArgs[2] || "").trim(),
    privateKeyPath,
    historyPath,
    help: hasFlag("--help") || hasFlag("-h"),
    interactive: hasFlag("--interactive") || positionalArgs.length === 0,
    verbose: hasFlag("--verbose"),
  }
}

async function appendHistory(historyPath, record) {
  await mkdir(dirname(historyPath), { recursive: true })
  await appendFile(historyPath, formatHistoryRecord(record), "utf8")
}

function createLicenseKey(privateKey, payload) {
  const payloadPart = toBase64Url(JSON.stringify(payload))
  const signaturePart = sign(null, Buffer.from(payloadPart, "utf8"), privateKey).toString("base64url")
  return `${payloadPart}.${signaturePart}`
}

async function issueLicense({ machineId, days, licensee, privateKey, historyPath }) {
  const issuedAtDate = new Date()
  const expiresAtDate = addDays(issuedAtDate, days)
  const payload = {
    v: 2,
    app: "resume-builder",
    machineId,
    expiresAt: expiresAtDate.toISOString(),
    issuedAt: issuedAtDate.toISOString(),
    ...(licensee ? { licensee } : {}),
  }
  const licenseKey = createLicenseKey(privateKey, payload)
  const historyRecord = {
    createdAt: new Date().toISOString(),
    machineId,
    expireDays: days,
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    ...(licensee ? { licensee } : {}),
    licenseKey,
  }

  await appendHistory(historyPath, historyRecord)

  return {
    licenseKey,
    payload,
  }
}

function printIssuedLicense({ licenseKey, payload }, historyPath) {
  console.log("")
  console.log("License key:")
  console.log(licenseKey)
  console.log("")
  console.log(`Machine ID: ${payload.machineId}`)
  console.log(`Expires: ${payload.expiresAt}`)
  console.log(`History: ${historyPath}`)
  console.log("")
}

async function runOneShot(args, privateKey) {
  const days = parsePositiveDays(args.daysInput)

  if (!args.machineId || !days) {
    printUsage()
    process.exit(1)
  }

  const issuedLicense = await issueLicense({
    machineId: args.machineId,
    days,
    licensee: args.licensee,
    privateKey,
    historyPath: args.historyPath,
  })

  if (args.verbose) {
    printIssuedLicense(issuedLicense, args.historyPath)
  } else {
    console.log(issuedLicense.licenseKey)
  }
}

async function runInteractive(args, privateKey) {
  if (!input.isTTY) {
    await runInteractiveFromPipedInput(args, privateKey)
    return
  }

  const rl = createInterface({ input, output })
  let blankMachineIdCount = 0

  console.log("Resume Builder License Generator")
  console.log("Enter a blank machine ID twice to exit.")
  console.log("")

  try {
    while (true) {
      const machineId = (await rl.question("Machine ID: ")).trim()

      if (!machineId) {
        blankMachineIdCount += 1
        if (blankMachineIdCount >= 2) {
          console.log("Exiting.")
          return
        }

        console.log("Press Enter again to exit.")
        continue
      }

      blankMachineIdCount = 0
      const daysInput = (await rl.question("Expire days: ")).trim()
      const days = parsePositiveDays(daysInput)

      if (!days) {
        console.log("Expire days must be a positive whole number, for example 30 or 365.")
        console.log("")
        continue
      }

      const issuedLicense = await issueLicense({
        machineId,
        days,
        licensee: args.licensee,
        privateKey,
        historyPath: args.historyPath,
      })

      printIssuedLicense(issuedLicense, args.historyPath)
    }
  } finally {
    rl.close()
  }
}

async function runInteractiveFromPipedInput(args, privateKey) {
  const chunks = []
  for await (const chunk of input) {
    chunks.push(Buffer.from(chunk))
  }

  const lines = Buffer.concat(chunks).toString("utf8").split(/\r?\n/)
  let blankMachineIdCount = 0
  let index = 0

  console.log("Resume Builder License Generator")
  console.log("Enter a blank machine ID twice to exit.")
  console.log("")

  while (index < lines.length) {
    const machineId = (lines[index++] || "").trim()

    if (!machineId) {
      blankMachineIdCount += 1
      if (blankMachineIdCount >= 2) {
        console.log("Exiting.")
        return
      }

      console.log("Press Enter again to exit.")
      continue
    }

    blankMachineIdCount = 0
    const daysInput = (lines[index++] || "").trim()
    const days = parsePositiveDays(daysInput)

    if (!days) {
      console.log("Expire days must be a positive whole number, for example 30 or 365.")
      console.log("")
      continue
    }

    const issuedLicense = await issueLicense({
      machineId,
      days,
      licensee: args.licensee,
      privateKey,
      historyPath: args.historyPath,
    })

    printIssuedLicense(issuedLicense, args.historyPath)
  }
}

const args = parseArguments()

if (args.help) {
  printUsage()
  process.exit(0)
}

let privateKey = ""
try {
  privateKey = await readFile(args.privateKeyPath, "utf8")
} catch {
  console.error(`Could not read private key: ${args.privateKeyPath}`)
  console.error("Run `npm run license:init` first, or pass --private-key <path>.")
  process.exit(1)
}

if (args.interactive) {
  await runInteractive(args, privateKey)
} else {
  await runOneShot(args, privateKey)
}
