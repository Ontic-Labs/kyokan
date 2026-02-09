#!/usr/bin/env npx tsx
/**
 * pipeline.ts — Single-entry-point data pipeline orchestrator
 *
 * Runs the full canonical ingredient pipeline in order:
 *   1. populate-multi-fdc-membership  (fill membership from FDC)
 *   2. purge-prepared-foods           (safety net: remove any banned categories)
 *   3. aggregate-recipe-nutrients     (compute nutrient stats)
 *   4. validate-data                  (invariant checks — aborts on failure)
 *   5. dump-synthetic-ingredients     (export JSONL)
 *
 * Usage:
 *   npx tsx scripts/pipeline.ts              # dry run (all steps preview)
 *   npx tsx scripts/pipeline.ts --write      # execute all steps
 *   npx tsx scripts/pipeline.ts --step 3     # run from step 3 onward
 *   npx tsx scripts/pipeline.ts --only 4     # run only step 4
 */

import { execFileSync } from "child_process";
import * as path from "path";

const STEPS = [
  {
    num: 1,
    name: "populate-multi-fdc-membership",
    script: "populate-multi-fdc-membership.ts",
    writeFlag: true,
    description: "Map FDC foods → canonical ingredients (allowed categories only)",
  },
  {
    num: 2,
    name: "purge-prepared-foods",
    script: "purge-prepared-foods.ts",
    writeFlag: true,
    description: "Safety net: purge any banned categories that slipped through",
  },
  {
    num: 3,
    name: "aggregate-recipe-nutrients",
    script: "aggregate-recipe-nutrients.ts",
    writeFlag: false, // uses --force instead
    forceFlag: true,
    description: "Compute nutrient stats (median, P10, P90) per canonical",
  },
  {
    num: 4,
    name: "validate-data",
    script: "validate-data.ts",
    writeFlag: false,
    description: "Run invariant checks (aborts pipeline on failure)",
  },
  {
    num: 5,
    name: "dump-synthetic-ingredients",
    script: "dump-synthetic-ingredients.ts",
    writeFlag: false,
    description: "Export canonical ingredients + nutrients to JSONL",
  },
];

function parseArgs(): { write: boolean; startStep: number; onlyStep: number | null } {
  const args = process.argv.slice(2);
  const write = args.includes("--write");

  let startStep = 1;
  const stepIdx = args.indexOf("--step");
  if (stepIdx !== -1) {
    startStep = parseInt(args[stepIdx + 1], 10);
    if (isNaN(startStep) || startStep < 1 || startStep > STEPS.length) {
      console.error(`Invalid --step value. Must be 1-${STEPS.length}`);
      process.exit(1);
    }
  }

  let onlyStep: number | null = null;
  const onlyIdx = args.indexOf("--only");
  if (onlyIdx !== -1) {
    onlyStep = parseInt(args[onlyIdx + 1], 10);
    if (isNaN(onlyStep) || onlyStep < 1 || onlyStep > STEPS.length) {
      console.error(`Invalid --only value. Must be 1-${STEPS.length}`);
      process.exit(1);
    }
  }

  return { write, startStep, onlyStep };
}

function runStep(step: (typeof STEPS)[number], write: boolean): void {
  const scriptPath = path.join(__dirname, step.script);
  const args: string[] = [scriptPath];

  if (write) {
    if (step.writeFlag) args.push("--write");
    if ("forceFlag" in step && step.forceFlag) args.push("--force");
  }

  console.log(`  Command: npx tsx ${step.script}${args.length > 1 ? " " + args.slice(1).join(" ") : ""}`);
  console.log();

  try {
    execFileSync("npx", ["tsx", ...args], {
      stdio: "inherit",
      cwd: path.join(__dirname, ".."),
      env: process.env,
    });
  } catch (error: unknown) {
    const exitCode =
      error && typeof error === "object" && "status" in error
        ? (error as { status: number }).status
        : 1;
    console.error(`\n❌ Step ${step.num} (${step.name}) failed with exit code ${exitCode}`);
    process.exit(exitCode);
  }
}

function main(): void {
  const { write, startStep, onlyStep } = parseArgs();

  console.log("╔══════════════════════════════════════════════╗");
  console.log("║    Kyokan Data Pipeline Orchestrator         ║");
  console.log("╚══════════════════════════════════════════════╝");
  console.log();
  console.log(`Mode: ${write ? "🔥 WRITE" : "👀 DRY RUN"}`);
  if (onlyStep) {
    console.log(`Running: step ${onlyStep} only`);
  } else if (startStep > 1) {
    console.log(`Running: steps ${startStep}–${STEPS.length}`);
  } else {
    console.log(`Running: all ${STEPS.length} steps`);
  }
  console.log();

  // Show plan
  console.log("Pipeline steps:");
  for (const step of STEPS) {
    const willRun =
      onlyStep ? step.num === onlyStep : step.num >= startStep;
    const marker = willRun ? "▶" : "⏭";
    console.log(`  ${marker} ${step.num}. ${step.name} — ${step.description}`);
  }
  console.log();

  // Execute
  const stepsToRun = onlyStep
    ? STEPS.filter((s) => s.num === onlyStep)
    : STEPS.filter((s) => s.num >= startStep);

  for (const step of stepsToRun) {
    console.log(`\n${"═".repeat(60)}`);
    console.log(`Step ${step.num}/${STEPS.length}: ${step.name}`);
    console.log(`${"═".repeat(60)}\n`);

    runStep(step, write);

    console.log(`\n✅ Step ${step.num} (${step.name}) completed.\n`);
  }

  console.log("═".repeat(60));
  console.log("🎉 Pipeline complete!");
  console.log("═".repeat(60));
}

main();
