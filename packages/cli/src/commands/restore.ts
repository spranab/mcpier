import { readFileSync } from "node:fs";
import kleur from "kleur";
import { PierClient } from "../client.js";
import { loadLocalConfig } from "../config.js";

export async function restoreCmd(
  path: string,
  opts: { yes: boolean },
): Promise<void> {
  const bundle = readFileSync(path, "utf8");
  try {
    JSON.parse(bundle);
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }

  if (!opts.yes) {
    console.log(
      kleur.yellow(
        "! restore will REPLACE the server's pier.db and manifest.yaml.",
      ),
    );
    console.log(kleur.yellow("! the server's current PIER_MASTER_KEY must match the backup's."));
    console.log(kleur.gray("pass --yes to skip this prompt"));
    const answer = await prompt(`restore from ${path}? (y/N) `);
    if (answer.toLowerCase() !== "y") {
      console.log(kleur.gray("aborted."));
      return;
    }
  }

  const client = new PierClient(loadLocalConfig());
  const result = await client.restore(bundle);
  console.log(
    kleur.green("✓ restored"),
    `${result.restored_servers} server(s) to manifest.`,
  );
  console.log(
    kleur.gray(
      "the server has swapped pier.db in place; existing sessions are unaffected.",
    ),
  );
}

async function prompt(q: string): Promise<string> {
  process.stdout.write(q);
  return new Promise((resolve) => {
    process.stdin.once("data", (d) => resolve(d.toString().trim()));
    process.stdin.resume();
  });
}
