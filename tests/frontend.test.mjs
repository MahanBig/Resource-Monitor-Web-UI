// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { classify, isRoutineConsumable, parseMessage } from "../Frontend/js/rules.js";
import { translatePrinterMessage } from "../Frontend/js/printer-messages.js";
import { buildPrinter, printerId, readSupplies, readTrays, snapshotDate, modelImage } from "../Frontend/js/printers.js";

const rules = JSON.parse(readFileSync(new URL("../Frontend/error_rules.json", import.meta.url)));
const cases = JSON.parse(readFileSync(new URL("./classification-cases.json", import.meta.url)));
const demo = JSON.parse(readFileSync(new URL("../Frontend/demo/printer_data.json", import.meta.url)));

test("classification matches the shared cases", () => {
  for (const c of cases) {
    const result = classify(c.message, rules);
    assert.deepEqual(result ? [result.category, result.level] : [null, null], [c.category, c.level], c.message);
  }
});

test("parseMessage splits the code", () => {
  assert.deepEqual(parseMessage("Papirstopp {40132}"), { raw: "Papirstopp {40132}", code: "40132", message: "Papirstopp" });
});

test("routine consumables never include empty toner", () => {
  assert.equal(isRoutineConsumable(classify("Nesten tom: sort toner", rules)), true);
  assert.equal(isRoutineConsumable(classify("Tom: sort toner", rules)), false);
});

test("printer message translation", () => {
  assert.equal(translatePrinterMessage("Papirstopp", "en"), "Paper jam");
  assert.equal(translatePrinterMessage("Tomt for papir: magasin 1", "en"), "Out of paper: tray 1");
  assert.equal(translatePrinterMessage("Out of paper: tray 1", "nb"), "Tomt for papir: magasin 1");
  assert.equal(translatePrinterMessage("Nesten tom: sort toner", "de"), "Fast leer: Toner Schwarz");
  assert.equal(translatePrinterMessage("Unknown thing", "nb"), "Unknown thing");
  // no partial-word replacements
  assert.equal(translatePrinterMessage("Traymaster", "nb"), "Traymaster");
});

test("printer ids match the PHP algorithm", () => {
  assert.equal(printerId({ Serial: " X1 ", IP: "1.2.3.4" }), "serial:X1");
  assert.equal(printerId({ Serial: "", IP: "1.2.3.4" }), "ip:1.2.3.4");
  assert.equal(printerId({ Name: "A" }), "name:A");
});

test("legacy snapshot format still works", () => {
  const legacy = { IP: "1.1.1.1", Name: "Old", Time: "01 11 2026, 09:41", Model: "IM C3000",
    "Ink Levels": ["35%", "100%", "48%", "52%", "-3%"], "Tray Information": ["220", "0", "-3"], Errors: [] };
  assert.deepEqual(readSupplies(legacy).map((s) => [s.color, s.percent, s.someRemaining]),
    [["black", 35, false], ["cyan", 48, false], ["magenta", 52, false], ["yellow", null, true]]);
  assert.deepEqual(readTrays(legacy).map((t) => t.state), ["ok", "empty"]);
  assert.equal(snapshotDate(legacy).getHours(), 9);
  assert.equal(modelImage("IM C3000"), "images/IM-C3000.png");
  assert.equal(buildPrinter(legacy, { rules }).status, "ok");
});

test("demo data builds and offline printers are critical", () => {
  const printers = demo.map((p) => buildPrinter(p, { rules }));
  const offline = printers.find((p) => p.offline);
  assert.equal(offline.status, "critical");
  assert.equal(offline.messages.length, 0);
  const library = printers.find((p) => p.name === "Library");
  assert.equal(library.messages.length, 1); // energy saver ignored
  const hidden = buildPrinter(demo[1], { rules, hideConsumables: true });
  assert.equal(hidden.messages.length, 0);
});
