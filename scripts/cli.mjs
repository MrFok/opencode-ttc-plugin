#!/usr/bin/env node

import { chmodSync, copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PLUGIN_FILENAME = "ttc-message-transform.js";
const BRIDGE_FILENAME = "tcc-proxy-bridge.js";

const currentFile = fileURLToPath(import.meta.url);
const repoRoot = resolve(dirname(currentFile), "..");
const sourcePluginPath = resolve(repoRoot, "opencode-plugins", PLUGIN_FILENAME);
const sourceBridgePath = resolve(repoRoot, "opencode-plugins", BRIDGE_FILENAME);
const pluginsDir = resolve(homedir(), ".config", "opencode", "plugins");
const installedPluginPath = resolve(pluginsDir, PLUGIN_FILENAME);

function printUsage() {
  console.log("Usage: opencode-ttc-plugin <install|doctor|uninstall>");
}

function detectCommand(argv, scriptName) {
  const explicit = argv[2];
  if (explicit) return explicit;
  if (scriptName.endsWith("-install")) return "install";
  if (scriptName.endsWith("-doctor")) return "doctor";
  if (scriptName.endsWith("-uninstall")) return "uninstall";
  return "";
}

function install() {
  if (!existsSync(sourcePluginPath)) {
    throw new Error(`Missing source plugin at ${sourcePluginPath}`);
  }

  mkdirSync(pluginsDir, { recursive: true });
  copyFileSync(sourcePluginPath, installedPluginPath);
  chmodSync(installedPluginPath, 0o644);

  console.log(`Installed ${PLUGIN_FILENAME} to ${installedPluginPath}`);
  if (existsSync(sourceBridgePath)) {
    console.log(`Optional fallback bridge source is available at ${sourceBridgePath}`);
  }
}

function doctor() {
  const checks = [
    { label: "source plugin", ok: existsSync(sourcePluginPath), value: sourcePluginPath },
    { label: "plugins dir", ok: existsSync(pluginsDir), value: pluginsDir },
    { label: "installed plugin", ok: existsSync(installedPluginPath), value: installedPluginPath },
    { label: "TTC_API_KEY env", ok: Boolean(process.env.TTC_API_KEY), value: process.env.TTC_API_KEY ? "set" : "missing" }
  ];

  let hasFailure = false;
  for (const check of checks) {
    const status = check.ok ? "OK" : "MISSING";
    console.log(`[${status}] ${check.label}: ${check.value}`);
    if (!check.ok) hasFailure = true;
  }

  if (hasFailure) {
    process.exitCode = 1;
  }
}

function uninstall() {
  if (!existsSync(installedPluginPath)) {
    console.log(`Nothing to uninstall at ${installedPluginPath}`);
    return;
  }

  rmSync(installedPluginPath);
  console.log(`Removed ${installedPluginPath}`);
}

function main() {
  const scriptName = basename(process.argv[1] ?? "");
  const command = detectCommand(process.argv, scriptName);

  if (command === "install") {
    install();
    return;
  }

  if (command === "doctor") {
    doctor();
    return;
  }

  if (command === "uninstall") {
    uninstall();
    return;
  }

  printUsage();
  process.exitCode = 1;
}

main();
