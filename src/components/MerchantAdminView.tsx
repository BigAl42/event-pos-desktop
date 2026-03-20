import { useState, useEffect, useRef } from "react";
import {
  getHaendlerList,
  createHaendler,
  updateHaendler,
  deleteHaendler,
} from "../db";
import type { HaendlerItem } from "../db";
import { confirm, save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, writeFile } from "@tauri-apps/plugin-fs";
import {
  exportHaendlerCsv,
  exportHaendlerExcel,
  parseCsv,
  parseExcel,
  normalizeNummer as normalizeNummerUtil,
  type HaendlerRow,
} from "../utils/merchantImportExport";
import "./MerchantAdminView.css";

type Props = { onBack: () => void };

type FormState = {
  nummer: string;
  name: string;
  vorname: string;
  nachname: string;
  strasse: string;
  hausnummer: string;
  plz: string;
  stadt: string;
  email: string;
  sort: string;
};

const emptyForm: FormState = {
  nummer: "",
  name: "",
  vorname: "",
  nachname: "",
  strasse: "",
  hausnummer: "",
  plz: "",
  stadt: "",
  email: "",
  sort: "",
};

/** Händlernummer ohne führende Nullen (z. B. "1", "12"). */
function normalizeNummer(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const n = parseInt(trimmed, 10);
  if (Number.isNaN(n) || n < 1) return trimmed;
  return String(n);
}

function formToName(form: FormState): string {
  if (form.name.trim()) return form.name.trim();
  const parts = [form.nachname.trim(), form.vorname.trim()].filter(Boolean);
  return parts.join(", ") || "—";
}

export default function MerchantAdminView({ onBack }: Props) {
  const [list, setList] = useState<HaendlerItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [form, setForm] = useState<FormState>(emptyForm);
  const [editing, setEditing] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const nummerInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    getHaendlerList()
      .then(setList)
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!editing && !saving) nummerInputRef.current?.focus();
  }, [editing, saving]);

  function startAdd() {
    setEditing(null);
    setForm(emptyForm);
  }

  function startEdit(h: HaendlerItem) {
    setEditing(h.haendlernummer);
    setForm({
      nummer: h.haendlernummer,
      name: h.name ?? "",
      vorname: h.vorname ?? "",
      nachname: h.nachname ?? "",
      strasse: h.strasse ?? "",
      hausnummer: h.hausnummer ?? "",
      plz: h.plz ?? "",
      stadt: h.stadt ?? "",
      email: h.email ?? "",
      sort: h.sort != null ? String(h.sort) : "",
    });
  }

  async function handleSave() {
    const nummer = normalizeNummer(form.nummer);
    if (!nummer) {
      setError("Nummer ist Pflicht (Zahl ab 1).");
      return;
    }
    const name = formToName(form);
    if (!form.name.trim() && !form.vorname.trim() && !form.nachname.trim()) {
      setError("Mindestens ein Name (Name, Vorname oder Nachname) ist Pflicht.");
      return;
    }
    setError("");
    setSaving(true);
    try {
      const sort = form.sort.trim() ? parseInt(form.sort, 10) : undefined;
      const params = {
        haendlernummer: nummer,
        name: name || "—",
        sort: sort ?? null,
        vorname: form.vorname.trim() || null,
        nachname: form.nachname.trim() || null,
        strasse: form.strasse.trim() || null,
        hausnummer: form.hausnummer.trim() || null,
        plz: form.plz.trim() || null,
        stadt: form.stadt.trim() || null,
        email: form.email.trim() || null,
      };
      if (editing !== null) {
        if (editing !== nummer) {
          await deleteHaendler(editing);
          await createHaendler(params);
        } else {
          await updateHaendler(nummer, {
            name: params.name,
            sort: params.sort,
            vorname: params.vorname,
            nachname: params.nachname,
            strasse: params.strasse,
            hausnummer: params.hausnummer,
            plz: params.plz,
            stadt: params.stadt,
            email: params.email,
          });
        }
      } else {
        await createHaendler(params);
      }
      setForm(emptyForm);
      setEditing(null);
      load();
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(haendlernummer: string) {
    const ok = await confirm(`Händler „${haendlernummer}“ wirklich löschen?`, {
      title: "Händler löschen",
      kind: "warning",
      okLabel: "Löschen",
      cancelLabel: "Abbrechen",
    });
    if (!ok) return;
    setError("");
    try {
      await deleteHaendler(haendlernummer);
      if (editing === haendlernummer) {
        setForm(emptyForm);
        setEditing(null);
      }
      load();
    } catch (e) {
      setError(String(e));
    }
  }

  function displayName(h: HaendlerItem): string {
    if (h.name) return h.name;
    const parts = [h.nachname, h.vorname].filter(Boolean);
    return parts.join(", ") || h.haendlernummer;
  }

  async function handleExportCsv() {
    const path = await save({
      filters: [{ name: "CSV", extensions: ["csv"] }],
      defaultPath: "haendler.csv",
    });
    if (path) {
      try {
        const csv = exportHaendlerCsv(list);
        await writeTextFile(path, "\uFEFF" + csv);
        setImportMessage("CSV exportiert.");
      } catch (e) {
        setImportMessage("Export fehlgeschlagen: " + String(e));
      }
    }
  }

  async function handleExportExcel() {
    const path = await save({
      filters: [{ name: "Excel", extensions: ["xlsx"] }],
      defaultPath: "haendler.xlsx",
    });
    if (path) {
      try {
        const buffer = exportHaendlerExcel(list);
        await writeFile(path, new Uint8Array(buffer));
        setImportMessage("Excel exportiert.");
      } catch (e) {
        setImportMessage("Export fehlgeschlagen: " + String(e));
      }
    }
  }

  async function applyImportRows(rows: HaendlerRow[]) {
    setImportMessage("");
    if (rows.length === 0) {
      setImportMessage("Keine gültigen Zeilen zum Importieren.");
      return;
    }
    const existing = await getHaendlerList();
    const existingNummern = new Set(existing.map((h) => normalizeNummerUtil(h.haendlernummer)));
    let created = 0;
    let updated = 0;
    const errors: string[] = [];
    for (const row of rows) {
      const nummer = normalizeNummerUtil(row.nummer);
      if (!nummer) continue;
      const name = row.name.trim() || [row.nachname, row.vorname].filter(Boolean).join(", ") || "—";
      const sort = row.sort.trim() ? parseInt(row.sort, 10) : undefined;
      try {
        if (existingNummern.has(nummer)) {
          await updateHaendler(nummer, {
            name,
            sort: sort ?? null,
            vorname: row.vorname || null,
            nachname: row.nachname || null,
            strasse: row.strasse || null,
            hausnummer: row.hausnummer || null,
            plz: row.plz || null,
            stadt: row.stadt || null,
            email: row.email || null,
          });
          updated++;
        } else {
          await createHaendler({
            haendlernummer: nummer,
            name,
            sort: sort ?? null,
            vorname: row.vorname || null,
            nachname: row.nachname || null,
            strasse: row.strasse || null,
            hausnummer: row.hausnummer || null,
            plz: row.plz || null,
            stadt: row.stadt || null,
            email: row.email || null,
          });
          created++;
          existingNummern.add(nummer);
        }
      } catch (e) {
        errors.push(`Nr. ${nummer}: ${e}`);
      }
    }
    load();
    if (errors.length > 0) {
      setImportMessage(`Import mit Fehlern: ${created} angelegt, ${updated} aktualisiert. Fehler: ${errors.join("; ")}`);
    } else {
      setImportMessage(`${created} Händler angelegt, ${updated} aktualisiert.`);
    }
  }

  async function handleImportFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const name = file.name.toLowerCase();
    try {
      if (name.endsWith(".csv")) {
        const text = await file.text();
        const rows = parseCsv(text);
        await applyImportRows(rows);
      } else if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
        const buffer = await file.arrayBuffer();
        const rows = parseExcel(buffer);
        await applyImportRows(rows);
      } else {
        setImportMessage("Nur .csv oder .xlsx/.xls Dateien unterstützt.");
      }
    } catch (err) {
      setImportMessage(String(err));
    }
  }

  return (
    <div className="merchant-admin-view">
      <header className="merchant-admin-header">
        <button type="button" onClick={onBack}>
          ← Zurück
        </button>
        <h1>Händlerverwaltung</h1>
      </header>

      {error && <p className="merchant-admin-error">{error}</p>}
      {importMessage && (
        <p className={importMessage.includes("Fehler") ? "merchant-admin-error" : "merchant-admin-import-ok"}>
          {importMessage}
        </p>
      )}

      <section className="merchant-admin-import-export">
        <h2>Import / Export</h2>
        <div className="merchant-admin-io-buttons">
          <button type="button" onClick={handleExportCsv}>
            Export CSV
          </button>
          <button type="button" onClick={handleExportExcel}>
            Export Excel
          </button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,.xlsx,.xls"
            style={{ display: "none" }}
            onChange={handleImportFile}
          />
          <button type="button" onClick={() => importInputRef.current?.click()}>
            Import CSV / Excel
          </button>
        </div>
      </section>

      <section className="merchant-admin-form">
        <div className="merchant-admin-form-title-row">
          <h2>{editing !== null ? "Händler bearbeiten" : "Neuer Händler"}</h2>
          <button type="button" className="button-neu" onClick={startAdd}>
            + Neuer Händler
          </button>
        </div>
        <div className="merchant-admin-form-row">
          <label>
            Nummer
            <input
              ref={nummerInputRef}
              type="number"
              min={1}
              value={form.nummer}
              onChange={(e) => setForm((f) => ({ ...f, nummer: e.target.value }))}
              placeholder="1"
              disabled={editing !== null}
            />
          </label>
          <label>
            Sortierung (optional)
            <input
              type="number"
              value={form.sort}
              onChange={(e) => setForm((f) => ({ ...f, sort: e.target.value }))}
              placeholder="Zahl"
            />
          </label>
        </div>
        <label>
          Name / Bezeichnung (optional, sonst aus Vorname/Nachname)
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="z. B. Anzeigename"
          />
        </label>
        <div className="merchant-admin-form-row">
          <label>
            Vorname
            <input
              type="text"
              value={form.vorname}
              onChange={(e) => setForm((f) => ({ ...f, vorname: e.target.value }))}
              placeholder="Vorname"
            />
          </label>
          <label>
            Nachname
            <input
              type="text"
              value={form.nachname}
              onChange={(e) => setForm((f) => ({ ...f, nachname: e.target.value }))}
              placeholder="Nachname"
            />
          </label>
        </div>
        <label>
          E-Mail (optional)
          <input
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            placeholder="name@example.com"
          />
        </label>
        <div className="merchant-admin-form-row">
          <label>
            Straße
            <input
              type="text"
              value={form.strasse}
              onChange={(e) => setForm((f) => ({ ...f, strasse: e.target.value }))}
              placeholder="Straße"
            />
          </label>
          <label>
            Hausnummer
            <input
              type="text"
              value={form.hausnummer}
              onChange={(e) => setForm((f) => ({ ...f, hausnummer: e.target.value }))}
              placeholder="Nr."
            />
          </label>
        </div>
        <div className="merchant-admin-form-row">
          <label>
            PLZ
            <input
              type="text"
              value={form.plz}
              onChange={(e) => setForm((f) => ({ ...f, plz: e.target.value }))}
              placeholder="PLZ"
            />
          </label>
          <label>
            Stadt
            <input
              type="text"
              value={form.stadt}
              onChange={(e) => setForm((f) => ({ ...f, stadt: e.target.value }))}
              placeholder="Stadt"
            />
          </label>
        </div>
        <div className="merchant-admin-form-actions">
          {editing !== null && (
            <button type="button" onClick={startAdd}>
              Abbrechen
            </button>
          )}
          <button type="button" onClick={handleSave} disabled={saving}>
            {saving ? "Speichern…" : "Speichern"}
          </button>
        </div>
      </section>

      <section className="merchant-admin-list">
        <h2>Händlerliste</h2>
        {loading ? (
          <p>Lade…</p>
        ) : list.length === 0 ? (
          <p className="merchant-admin-empty">Noch keine Händler angelegt.</p>
        ) : (
          <ul>
            {list.map((h) => (
              <li key={h.haendlernummer}>
                <span className="haendler-nr">{h.haendlernummer}</span>
                <span className="haendler-name">{displayName(h)}</span>
                {h.sort != null && <span className="haendler-sort">({h.sort})</span>}
                <div className="haendler-actions">
                  <button type="button" onClick={() => startEdit(h)}>
                    Bearbeiten
                  </button>
                  <button type="button" onClick={() => handleDelete(h.haendlernummer)}>
                    Löschen
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
