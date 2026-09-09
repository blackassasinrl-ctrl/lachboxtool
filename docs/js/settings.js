/* ============================================================
   LACHBOX OS — INSTELLINGEN
   Bedrijfsgegevens, facturatie-instellingen, onderdelencatalogus,
   reviews en e-mail (sectie 32/33) + databeheer: demodata, backup/
   restore en migratie vanaf de oude losse factuurtool (sectie 30/31/48).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const storage = () => LachboxOS.storage;
const state = () => LachboxOS.state;

const LEGACY_KEYS = {
  draft: "lachbox_draft_invoice",
  companySettings: "lachbox_company_settings",
  counter: "lachbox_invoice_counter"
};
const MIGRATION_DONE_KEY = "lachbox_os_legacy_migration_done";
const MIGRATION_DISMISSED_KEY = "lachbox_os_legacy_migration_dismissed";

/* ---------- Migratie vanaf de oude factuurtool (sectie 48) ---------- */
function readLegacyData(){
  let draft = null, companySettings = null, counter = null;
  try{ draft = JSON.parse(localStorage.getItem(LEGACY_KEYS.draft) || "null"); }catch(e){}
  try{ companySettings = JSON.parse(localStorage.getItem(LEGACY_KEYS.companySettings) || "null"); }catch(e){}
  try{ counter = JSON.parse(localStorage.getItem(LEGACY_KEYS.counter) || "null"); }catch(e){}
  if (!draft && !companySettings) return null;
  return { draft, companySettings, counter };
}

function legacyMigrationAvailable(){
  if (localStorage.getItem(MIGRATION_DONE_KEY)) return false;
  return !!readLegacyData();
}

async function runLegacyMigration(){
  const legacy = readLegacyData();
  if (!legacy) return { imported: false };

  let importedCustomer = false, importedInvoice = false;

  if (legacy.companySettings){
    const settings = await storage().getSettings();
    settings.company = Object.assign({}, settings.company, legacy.companySettings);
    await storage().saveSettings(settings);
  }
  if (legacy.counter && legacy.counter.year){
    await storage().saveInvoiceCounter({
      id: "main",
      year: legacy.counter.year,
      month: legacy.counter.month || (new Date()).getMonth() + 1,
      lastNumber: legacy.counter.lastNumber || 0
    });
  }
  if (legacy.draft && legacy.draft.customer &&
      (legacy.draft.customer.company || legacy.draft.customer.contactPerson)){
    const c = legacy.draft.customer;
    const customer = await storage().saveCustomer({
      company: c.company || "", contactPerson: c.contactPerson || "",
      street: c.street || "", houseNumber: c.houseNumber || "",
      postalCode: c.postalCode || "", city: c.city || "",
      country: c.country || "Nederland", email: c.email || "", phone: c.phone || "",
      notes: "Geïmporteerd vanuit de oude factuurtool."
    });
    importedCustomer = true;

    if (legacy.draft.lines && legacy.draft.lines.length){
      const totals = utils().calculateInvoiceTotals(legacy.draft.lines);
      const inv = legacy.draft.invoice || {};
      const ev = legacy.draft.event || {};
      await storage().saveInvoice({
        invoiceNumber: inv.number || "",
        customerId: customer.id,
        eventId: null,
        issueDate: inv.date || utils().todayISO(),
        dueDate: inv.dueDate || "",
        lines: legacy.draft.lines,
        subtotal: totals.totalExcl,
        vat: totals.totalVat,
        total: totals.totalIncl,
        paymentStatus: "concept",
        reference: ev.reference || ""
      });
      importedInvoice = true;
    }
  }

  localStorage.setItem(MIGRATION_DONE_KEY, "1");
  await state().refreshAll();
  return { imported: true, importedCustomer, importedInvoice };
}

/* ---------- Demodata (sectie 31) ---------- */
async function loadDemoData(){
  const customers = [
    { id: utils().uuid(), isDemo: true, company: "Tennisvereniging Sambeek", contactPerson: "Stef Jacobs", street: "Pastoor van Berkelstraat", houseNumber: "4b", postalCode: "5836 BJ", city: "Sambeek", country: "Nederland", email: "stef@vtsambeek.nl", phone: "", notes: "", createdAt: utils().todayISO() },
    { id: utils().uuid(), isDemo: true, company: "", contactPerson: "Peter Jansen", street: "Molenstraat", houseNumber: "12", postalCode: "6511 AB", city: "Nijmegen", country: "Nederland", email: "peter.jansen@voorbeeld.nl", phone: "", notes: "", createdAt: utils().todayISO() },
    { id: utils().uuid(), isDemo: true, company: "Peters BV", contactPerson: "Marloes Peters", street: "Industrieweg", houseNumber: "8", postalCode: "5928 LM", city: "Venlo", country: "Nederland", email: "marloes@petersbv.nl", phone: "", notes: "", createdAt: utils().todayISO() },
    { id: utils().uuid(), isDemo: true, company: "", contactPerson: "Anne de Wit", street: "", houseNumber: "", postalCode: "", city: "Arnhem", country: "Nederland", email: "anne@voorbeeld.nl", phone: "", notes: "", createdAt: utils().todayISO() }
  ];
  for (const c of customers) await storage().saveCustomer(c);
  const [sambeek, jansen, peters, dewit] = customers;

  const today = new Date();
  const inDays = n => utils().formatDateInputValue(utils().addDays(today, n));

  const leads = [
    { id: utils().uuid(), isDemo: true, customerId: dewit.id, source: "Website", status: "Offerte verstuurd", requestedPackage: "Basis", estimatedValue: 375, eventDate: inDays(45), eventType: "Verjaardag", eventLocation: "Arnhem", notes: "Wacht op reactie op offerte.", nextAction: "Bellen over offerte", nextActionDate: inDays(-2), temperature: "warm", createdAt: inDays(-10), lastContactAt: inDays(-9) },
    { id: utils().uuid(), isDemo: true, customerId: jansen.id, source: "Instagram", status: "Gewonnen", requestedPackage: "Premium", estimatedValue: 425, eventDate: inDays(14), eventType: "Bruiloft", eventLocation: "Nijmegen", notes: "", nextAction: "", nextActionDate: "", temperature: "koud", createdAt: inDays(-30), lastContactAt: inDays(-20) }
  ];
  for (const l of leads) await storage().saveLead(l);

  const events = [
    { id: utils().uuid(), isDemo: true, customerId: jansen.id, leadId: leads[1].id, eventName: "Bruiloft Jansen", eventType: "Bruiloft", date: inDays(14), startTime: "18:00", endTime: "23:00", location: "Nijmegen", address: "", package: "Premium", price: 425, extras: [], staff: "", notes: "", checklistId: null, invoiceId: null, status: "Gepland" },
    { id: utils().uuid(), isDemo: true, customerId: peters.id, leadId: null, eventName: "Bedrijfsfeest Peters", eventType: "Bedrijfsfeest", date: inDays(-20), startTime: "20:00", endTime: "01:00", location: "Venlo", address: "", package: "Deluxe", price: 525, extras: [], staff: "", notes: "", checklistId: null, invoiceId: null, status: "Afgerond" },
    { id: utils().uuid(), isDemo: true, customerId: sambeek.id, leadId: null, eventName: "Zomerfeest VTS", eventType: "Verenigingsfeest", date: inDays(-60), startTime: "20:00", endTime: "01:00", location: "Sambeek", address: "", package: "Premium", price: 425, extras: [], staff: "", notes: "", checklistId: null, invoiceId: null, status: "Afgerond" }
  ];
  for (const e of events) await storage().saveEvent(e);

  const jansenLines = [{ id: utils().uuid(), type: "item", description: "Premium pakket", subtext: "", qty: 1, price: 425, priceMode: "incl", vatRate: 21 }];
  const petersLines = [{ id: utils().uuid(), type: "item", description: "Deluxe pakket", subtext: "", qty: 1, price: 525, priceMode: "incl", vatRate: 21 }];
  const sambeekLines = [{ id: utils().uuid(), type: "item", description: "Premium pakket", subtext: "", qty: 1, price: 425, priceMode: "incl", vatRate: 21 }];

  const jansenTotals = utils().calculateInvoiceTotals(jansenLines);
  const petersTotals = utils().calculateInvoiceTotals(petersLines);
  const sambeekTotals = utils().calculateInvoiceTotals(sambeekLines);

  const invoices = [
    { id: utils().uuid(), isDemo: true, invoiceNumber: "20260801", customerId: jansen.id, eventId: events[0].id, issueDate: inDays(-3), dueDate: inDays(2), paymentTermDays: 14, lines: jansenLines, subtotal: jansenTotals.totalExcl, vat: jansenTotals.totalVat, total: jansenTotals.totalIncl, paymentStatus: "verstuurd", paidDate: null, reference: "20260801" },
    { id: utils().uuid(), isDemo: true, invoiceNumber: "20260702", customerId: peters.id, eventId: events[1].id, issueDate: inDays(-19), dueDate: inDays(-5), paymentTermDays: 14, lines: petersLines, subtotal: petersTotals.totalExcl, vat: petersTotals.totalVat, total: petersTotals.totalIncl, paymentStatus: "betaald", paidDate: inDays(-6), reference: "20260702" },
    { id: utils().uuid(), isDemo: true, invoiceNumber: "20260601", customerId: sambeek.id, eventId: events[2].id, issueDate: inDays(-59), dueDate: inDays(-45), paymentTermDays: 14, lines: sambeekLines, subtotal: sambeekTotals.totalExcl, vat: sambeekTotals.totalVat, total: sambeekTotals.totalIncl, paymentStatus: "betaald", paidDate: inDays(-50), reference: "20260601" }
  ];
  for (const i of invoices) await storage().saveInvoice(i);

  const reviews = [
    { id: utils().uuid(), isDemo: true, customerId: sambeek.id, eventId: events[2].id, requestedAt: inDays(-48), status: "ontvangen", platform: "Google", completedAt: inDays(-40) },
    { id: utils().uuid(), isDemo: true, customerId: peters.id, eventId: events[1].id, requestedAt: null, status: "niet_gevraagd", platform: "Google", completedAt: null }
  ];
  for (const r of reviews) await storage().saveReview(r);

  await state().refreshAll();
}

async function clearDemoData(){
  await storage().clearDemoData();
  await state().refreshAll();
}

/* ---------- Backup / restore (sectie 30) ---------- */
function downloadBackup(){
  storage().exportAllData().then(backup => {
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lachbox-os-backup-${utils().todayISO()}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    utils().showToast("Back-up gedownload.", "success");
  });
}

function readFileAsText(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsText(file);
  });
}
function readFileAsDataUrl(file){
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

/* ---------- Formulier-opbouw (fieldRow/textField komen uit utils.js) ---------- */
const fieldRow = (...args) => utils().fieldRow(...args);
const textField = (...args) => utils().textField(...args);

function renderCompanySection(container, settings, markDirty){
  const section = utils().make("div", "section-card");
  section.appendChild(utils().make("h2", "section-heading", "Bedrijf"));
  const c = settings.company;
  section.appendChild(fieldRow(
    textField("Bedrijfsnaam", c.name, v => { c.name = v; markDirty(); }),
    textField("KvK-nummer", c.kvk, v => { c.kvk = v; markDirty(); })
  ));
  section.appendChild(fieldRow(
    textField("Straat + huisnr.", c.street, v => { c.street = v; markDirty(); }),
    textField("Postcode + plaats", c.city, v => { c.city = v; markDirty(); })
  ));
  section.appendChild(fieldRow(
    textField("BTW-nummer", c.vatNumber, v => { c.vatNumber = v; markDirty(); }),
    textField("Bank", c.bankName, v => { c.bankName = v; markDirty(); })
  ));
  section.appendChild(fieldRow(
    textField("IBAN", c.iban, v => { c.iban = v; markDirty(); }),
    textField("E-mailadres", c.email, v => { c.email = v; markDirty(); }, { type: "email" })
  ));

  const logoField = utils().make("div", "field");
  logoField.appendChild(utils().make("label", null, "Logo"));
  const logoPreviewWrap = utils().make("div", "logo-preview-wrap");
  const logoImg = document.createElement("img");
  logoImg.className = "logo-preview";
  logoImg.src = c.logoUrl || "";
  logoPreviewWrap.appendChild(logoImg);
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.accept = "image/png";
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;
    if (file.type !== "image/png"){
      utils().showToast("Alleen PNG-bestanden worden ondersteund.", "error");
      return;
    }
    const dataUrl = await readFileAsDataUrl(file);
    c.logoUrl = dataUrl;
    logoImg.src = dataUrl;
    markDirty();
  });
  logoPreviewWrap.appendChild(fileInput);
  logoField.appendChild(logoPreviewWrap);
  logoField.appendChild(utils().make("div", "field-hint", "PNG met transparante achtergrond werkt het best."));
  section.appendChild(logoField);

  container.appendChild(section);
}

function renderInvoicingSection(container, settings, markDirty){
  const section = utils().make("div", "section-card");
  section.appendChild(utils().make("h2", "section-heading", "Facturen"));
  const inv = settings.invoicing;
  section.appendChild(fieldRow(
    textField("Factuurnummer-prefix (optioneel)", inv.prefix, v => { inv.prefix = v; markDirty(); }),
    textField("Standaard betaaltermijn (dagen)", String(inv.defaultPaymentTermDays), v => { inv.defaultPaymentTermDays = Number(v) || 0; markDirty(); }, { type: "number" })
  ));
  section.appendChild(fieldRow(
    textField("BTW-percentages (komma-gescheiden)", inv.vatRates.join(", "), v => {
      inv.vatRates = v.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n));
      markDirty();
    }),
    textField("Standaard BTW-percentage", String(inv.defaultVatRate), v => { inv.defaultVatRate = Number(v) || 0; markDirty(); }, { type: "number" })
  ));
  container.appendChild(section);
}

function renderComponentsSection(container, settings, markDirty){
  const section = utils().make("div", "section-card");
  section.appendChild(utils().make("h2", "section-heading", "Pakketten / onderdelen"));
  section.appendChild(utils().make("div", "field-hint", "Deze onderdelen zijn overal in Lachbox OS beschikbaar als bouwstenen voor een factuur."));

  const table = utils().make("div", "components-table");
  const header = utils().make("div", "components-row components-row-head");
  ["Naam", "Prijs", "BTW%", "Incl./Excl.", "Vast", ""].forEach(h => header.appendChild(utils().make("div", null, h)));
  table.appendChild(header);

  function renderRows(){
    Array.from(table.querySelectorAll(".components-row:not(.components-row-head)")).forEach(r => r.remove());
    Object.keys(settings.components).forEach(key => {
      const comp = settings.components[key];
      const row = utils().make("div", "components-row");

      const nameInput = document.createElement("input");
      nameInput.type = "text"; nameInput.value = comp.name;
      nameInput.addEventListener("input", () => { comp.name = nameInput.value; markDirty(); });
      row.appendChild(nameInput);

      const priceInput = document.createElement("input");
      priceInput.type = "number"; priceInput.step = "0.01"; priceInput.value = comp.price;
      priceInput.addEventListener("input", () => { comp.price = Number(priceInput.value) || 0; markDirty(); });
      row.appendChild(priceInput);

      const vatInput = document.createElement("input");
      vatInput.type = "number"; vatInput.value = comp.vatRate;
      vatInput.addEventListener("input", () => { comp.vatRate = Number(vatInput.value) || 0; markDirty(); });
      row.appendChild(vatInput);

      const modeSelect = document.createElement("select");
      ["incl", "excl"].forEach(m => {
        const opt = document.createElement("option");
        opt.value = m; opt.textContent = m === "incl" ? "Incl. BTW" : "Excl. BTW";
        if (comp.priceMode === m) opt.selected = true;
        modeSelect.appendChild(opt);
      });
      modeSelect.addEventListener("change", () => { comp.priceMode = modeSelect.value; markDirty(); });
      row.appendChild(modeSelect);

      const lockedInput = document.createElement("input");
      lockedInput.type = "checkbox"; lockedInput.checked = !!comp.locked;
      lockedInput.title = "Staat standaard vast op elke nieuwe factuur";
      lockedInput.addEventListener("change", () => { comp.locked = lockedInput.checked; markDirty(); });
      row.appendChild(lockedInput);

      const delBtn = utils().make("button", "icon-btn", "✕");
      delBtn.type = "button";
      delBtn.addEventListener("click", () => {
        delete settings.components[key];
        markDirty();
        renderRows();
      });
      row.appendChild(delBtn);

      table.appendChild(row);
    });
  }
  renderRows();
  section.appendChild(table);

  const addBtn = utils().make("button", "btn secondary small", "+ Onderdeel toevoegen");
  addBtn.type = "button";
  addBtn.style.marginTop = "10px";
  addBtn.addEventListener("click", () => {
    let key = "onderdeel-" + utils().slugify(String(Object.keys(settings.components).length + 1));
    while (settings.components[key]) key += "x";
    settings.components[key] = { name: "Nieuw onderdeel", subtext: "", price: 0, vatRate: settings.invoicing.defaultVatRate, priceMode: "incl" };
    markDirty();
    renderRows();
  });
  section.appendChild(addBtn);

  container.appendChild(section);
}

function renderReviewsAndEmailSection(container, settings, markDirty){
  const section = utils().make("div", "section-card");
  section.appendChild(utils().make("h2", "section-heading", "Reviews & e-mail"));
  section.appendChild(fieldRow(
    textField("Google review-URL", settings.reviews.googleReviewUrl, v => { settings.reviews.googleReviewUrl = v; markDirty(); }),
    textField("Standaard afzendernaam", settings.email.senderName, v => { settings.email.senderName = v; markDirty(); })
  ));
  section.appendChild(textField("Standaard afsluiting e-mail", settings.email.signOff, v => { settings.email.signOff = v; markDirty(); }, { textarea: true, rows: 3 }));
  container.appendChild(section);
}

function renderDataSection(container, onChanged){
  const section = utils().make("div", "section-card");
  section.appendChild(utils().make("h2", "section-heading", "Data beheer"));

  const row = utils().make("div", "data-actions");

  const demoBtn = utils().make("button", "btn secondary", "Demodata laden");
  demoBtn.type = "button";
  demoBtn.addEventListener("click", async () => {
    if (await storage().hasDemoData()){
      utils().showToast("Demodata staat er al. Verwijder eerst de bestaande demodata voordat je opnieuw laadt.", "error");
      return;
    }
    const ok = await utils().askConfirm("Demodata laden?", "Dit voegt fictieve voorbeeldklanten, leads, events en facturen toe (duidelijk gemarkeerd, later in één keer te verwijderen).", { danger: false, okLabel: "Laden" });
    if (!ok) return;
    try{
      await loadDemoData();
      utils().showToast("Demodata geladen.", "success");
      onChanged();
    }catch(e){
      utils().showToast("Demodata laden is mislukt: " + e.message, "error");
    }
  });
  row.appendChild(demoBtn);

  const clearDemoBtn = utils().make("button", "btn secondary", "Demodata verwijderen");
  clearDemoBtn.type = "button";
  clearDemoBtn.addEventListener("click", async () => {
    const ok = await utils().askConfirm("Demodata verwijderen?", "Alle records die als demodata zijn gemarkeerd worden verwijderd. Eigen ingevoerde data blijft staan.");
    if (!ok) return;
    await clearDemoData();
    utils().showToast("Demodata verwijderd.", "success");
    onChanged();
  });
  row.appendChild(clearDemoBtn);

  const backupBtn = utils().make("button", "btn secondary", "Backup maken");
  backupBtn.type = "button";
  backupBtn.addEventListener("click", downloadBackup);
  row.appendChild(backupBtn);

  const restoreBtn = utils().make("button", "btn secondary", "Backup importeren");
  restoreBtn.type = "button";
  const restoreInput = document.createElement("input");
  restoreInput.type = "file";
  restoreInput.accept = "application/json";
  restoreInput.hidden = true;
  restoreInput.addEventListener("change", async () => {
    const file = restoreInput.files[0];
    if (!file) return;
    let backup;
    try{
      backup = JSON.parse(await readFileAsText(file));
    }catch(e){
      utils().showToast("Dit bestand is geen geldige back-up (ongeldige JSON).", "error");
      return;
    }
    const ok = await utils().askConfirm(
      "Backup herstellen?",
      "Alle huidige data (klanten, leads, events, facturen, reviews, instellingen) wordt overschreven met de inhoud van deze back-up. Dit kan niet ongedaan worden gemaakt.",
      { okLabel: "Overschrijven" }
    );
    if (!ok) { restoreInput.value = ""; return; }
    try{
      await storage().importAllData(backup);
      await state().refreshAll();
      utils().showToast("Backup hersteld.", "success");
      onChanged();
    }catch(e){
      utils().showToast("Herstellen mislukt: " + e.message, "error");
    }
    restoreInput.value = "";
  });
  restoreBtn.addEventListener("click", () => restoreInput.click());
  row.appendChild(restoreBtn);
  row.appendChild(restoreInput);

  section.appendChild(row);
  container.appendChild(section);
}

function renderMigrationBanner(container, onChanged){
  if (!legacyMigrationAvailable()) return;
  if (localStorage.getItem(MIGRATION_DISMISSED_KEY)) return;

  const banner = utils().make("div", "migration-banner");
  banner.appendChild(utils().make("div", null, "We hebben gegevens van de oude factuurtool gevonden op dit apparaat. Wil je deze importeren als klant en factuur?"));
  const actions = utils().make("div", "migration-banner-actions");
  const importBtn = utils().make("button", "btn primary small", "Importeren");
  importBtn.type = "button";
  importBtn.addEventListener("click", async () => {
    const result = await runLegacyMigration();
    if (result.imported){
      utils().showToast("Oude gegevens geïmporteerd.", "success");
    } else {
      utils().showToast("Er was niets bruikbaars om te importeren.", "info");
    }
    onChanged();
  });
  const dismissBtn = utils().make("button", "btn ghost small", "Niet nu");
  dismissBtn.type = "button";
  dismissBtn.addEventListener("click", () => {
    localStorage.setItem(MIGRATION_DISMISSED_KEY, "1");
    onChanged();
  });
  actions.appendChild(importBtn);
  actions.appendChild(dismissBtn);
  banner.appendChild(actions);
  container.appendChild(banner);
}

async function render(container){
  const settings = JSON.parse(JSON.stringify(await storage().getSettings())); // lokale werkkopie
  let dirty = false;
  function markDirty(){ dirty = true; saveBtn.disabled = false; }

  function rerender(){ utils().clear(container); render(container); }

  const page = utils().make("div", "page");
  page.appendChild(utils().make("h1", "page-title", "Instellingen"));

  renderMigrationBanner(page, rerender);

  renderCompanySection(page, settings, markDirty);
  renderInvoicingSection(page, settings, markDirty);
  renderComponentsSection(page, settings, markDirty);
  renderReviewsAndEmailSection(page, settings, markDirty);

  const saveBtn = utils().make("button", "btn primary", "Instellingen opslaan");
  saveBtn.type = "button";
  saveBtn.disabled = true;
  saveBtn.addEventListener("click", async () => {
    await storage().saveSettings(settings);
    await state().refreshSettings();
    dirty = false;
    saveBtn.disabled = true;
    utils().showToast("Instellingen opgeslagen.", "success");
  });
  page.appendChild(saveBtn);

  renderDataSection(page, rerender);

  container.appendChild(page);
}

LachboxOS.navigation.registerRoute({ path: "settings", label: "Instellingen", icon: "⚙", group: null, render });
LachboxOS.settingsModule = { legacyMigrationAvailable, runLegacyMigration };

})();
