/**
 * Captures handbook screenshots via Tauri WebDriver (Linux / Windows).
 * Requires: cargo install tauri-driver --locked
 * Linux: WebKitWebDriver (e.g. package webkit2gtk-driver)
 * Windows: Microsoft Edge WebDriver on PATH (matching Edge version)
 *
 * Desktop macOS is not supported by Tauri WebDriver; this script exits 0 with a notice.
 */
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, until, Capabilities } from "selenium-webdriver";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const deAssets = path.join(repoRoot, "docs", "handbuch", "de", "assets");
const enAssets = path.join(repoRoot, "docs", "handbuch", "en", "assets");

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForDriver(timeoutMs = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch("http://127.0.0.1:4444/status");
      if (res.ok) return;
    } catch {
      /* ignore */
    }
    await sleep(200);
  }
  throw new Error("tauri-driver did not become ready on http://127.0.0.1:4444/status");
}

function appBinaryPath() {
  const name = process.platform === "win32" ? "app.exe" : "app";
  return path.join(repoRoot, "src-tauri", "target", "debug", name);
}

function tauriDriverPath() {
  const base = path.join(os.homedir(), ".cargo", "bin", "tauri-driver");
  return process.platform === "win32" ? `${base}.exe` : base;
}

async function saveScreenshot(driver, filePath) {
  const b64 = await driver.takeScreenshot();
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(b64, "base64"));
}

async function completeInitialSetup(driver) {
  await driver.wait(
    until.elementLocated(By.css('[data-testid="initial-setup-master-btn"], [data-testid="home-page-root"]')),
    120000
  );
  const masters = await driver.findElements(By.css('[data-testid="initial-setup-master-btn"]'));
  if (masters.length === 0) return;

  await masters[0].click();
  const nameInput = await driver.wait(until.elementLocated(By.css('[data-testid="initial-setup-kasse-name"]')), 30000);
  await nameInput.clear();
  await nameInput.sendKeys("Handbuch-Screenshots");
  const submit = await driver.findElement(By.css('[data-testid="initial-setup-submit"]'));
  await submit.click();
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 120000);
}

async function ensureActiveAbrechnungslauf(driver) {
  await driver.findElement(By.css(".tile-einstellungen")).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="settings-section-abrechnungslaeufe"]')), 30000);
  const accordion = await driver.findElement(By.css('[data-testid="settings-section-abrechnungslaeufe"]'));
  const open = await accordion.getAttribute("open");
  if (!open) {
    await accordion.findElement(By.css("summary")).click();
    await sleep(400);
  }
  const laufInput = await driver.findElement(By.css('[data-testid="settings-new-lauf-name-input"]'));
  await laufInput.clear();
  await laufInput.sendKeys("Demo-Lauf");
  await driver.findElement(By.css('[data-testid="settings-new-lauf-start-btn"]')).click();
  await sleep(300);
  await driver.findElement(By.css('[data-testid="settings-new-lauf-confirm-btn"]')).click();
  await sleep(800);
  await driver.findElement(By.css('[data-testid="settings-back-btn"]')).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 30000);
}

async function switchToEnglish(driver) {
  await driver.executeScript(`
    localStorage.setItem('i18nextLng', 'en');
    location.reload();
  `);
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 120000);
}

async function captureSet(driver, outDir) {
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 30000);
  await saveScreenshot(driver, path.join(outDir, "startseite.png"));

  await driver.findElement(By.css(".tile-kasse")).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="cash-register-view"]')), 30000);
  await saveScreenshot(driver, path.join(outDir, "kasse.png"));
  await driver.findElement(By.css(".cash-register-header button")).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 30000);

  await driver.findElement(By.css(".tile-einstellungen")).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="settings-back-btn"]')), 30000);
  const accordion = await driver.findElement(By.css('[data-testid="settings-section-abrechnungslaeufe"]'));
  const open = await accordion.getAttribute("open");
  if (!open) {
    await accordion.findElement(By.css("summary")).click();
    await sleep(400);
  }
  await driver.executeScript("arguments[0].scrollIntoView({block:'start'})", accordion);
  await sleep(400);
  await saveScreenshot(driver, path.join(outDir, "einstellungen.png"));
  await driver.findElement(By.css('[data-testid="settings-back-btn"]')).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 30000);

  await driver.findElement(By.css(".tile-handbook")).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="handbook-view-root"]')), 30000);
  await sleep(500);
  await saveScreenshot(driver, path.join(outDir, "handbuch-ansicht.png"));
  await driver.findElement(By.css(".handbook-back")).click();
  await driver.wait(until.elementLocated(By.css('[data-testid="home-page-root"]')), 30000);
}

async function main() {
  if (process.platform === "darwin") {
    console.info(
      "[handbook:screenshots] Skipping on macOS: Tauri WebDriver has no WKWebView driver. " +
        "Run on Linux or Windows (or regenerate PNGs in CI). Placeholder assets in docs/handbuch/*/assets stay unchanged."
    );
    process.exit(0);
  }

  const td = tauriDriverPath();
  if (!fs.existsSync(td)) {
    console.error(`[handbook:screenshots] Missing tauri-driver at ${td}. Install: cargo install tauri-driver --locked`);
    process.exit(1);
  }

  console.info("[handbook:screenshots] Building Tauri app (debug, no bundle)…");
  const build = spawnSync("npm", ["exec", "--", "tauri", "build", "--debug", "--no-bundle"], {
    cwd: repoRoot,
    stdio: "inherit",
    // Use shell on Windows; on Linux CI some runners resolve `npm exec` more reliably with a shell.
    shell: true,
  });
  if (build.status !== 0) {
    process.exit(build.status ?? 1);
  }

  const application = appBinaryPath();
  if (!fs.existsSync(application)) {
    console.error(`[handbook:screenshots] Expected app binary missing: ${application}`);
    process.exit(1);
  }

  fs.mkdirSync(deAssets, { recursive: true });
  fs.mkdirSync(enAssets, { recursive: true });

  const instance = `handbook_cap_${Date.now()}`;
  const caps = new Capabilities();
  caps.set("browserName", "wry");
  caps.set("tauri:options", {
    application,
    env: { KASSEN_INSTANCE: instance },
  });

  let tauriDriverProc;
  let driver;
  let exitOk = false;

  try {
    tauriDriverProc = spawn(td, [], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });
    tauriDriverProc.stdout?.on("data", (d) => process.stdout.write(d));
    tauriDriverProc.stderr?.on("data", (d) => process.stderr.write(d));
    tauriDriverProc.on("error", (err) => {
      console.error("tauri-driver spawn error:", err);
    });
    tauriDriverProc.on("exit", (code) => {
      if (!exitOk && code !== 0 && code !== null) {
        console.error("tauri-driver exited with code", code);
      }
    });

    await waitForDriver();

    driver = await new Builder().withCapabilities(caps).usingServer("http://127.0.0.1:4444/").build();

    await completeInitialSetup(driver);
    await ensureActiveAbrechnungslauf(driver);

    console.info("[handbook:screenshots] Capturing DE locale (default)…");
    await captureSet(driver, deAssets);

    console.info("[handbook:screenshots] Switching UI to EN and capturing…");
    await switchToEnglish(driver);
    await captureSet(driver, enAssets);

    console.info("[handbook:screenshots] Done. Wrote PNGs to docs/handbuch/de|en/assets/. Run: node scripts/sync-handbook-assets.mjs");
  } finally {
    exitOk = true;
    try {
      if (driver) await driver.quit();
    } catch {
      /* ignore */
    }
    if (tauriDriverProc && !tauriDriverProc.killed) {
      tauriDriverProc.kill("SIGTERM");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
