/* ============================================================
   LACHBOX OS — STORAGE
   Enige plek die IndexedDB aanraakt. Een latere vervanging door een
   API/backend hoeft alleen dit bestand te raken (zie architectuurplan):
   elke functie hieronder is async en retourneert gewone JS-objecten/
   arrays, ongeacht waar de data vandaan komt.

   Objectstores: customers, leads, events, checklists, invoices,
   reviews, settings (1 record, id "main"), invoiceCounter (1 record,
   id "main").
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const DB_NAME = "lachbox_os";
const DB_VERSION = 1;

let dbPromise = null;

function openDb(){
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (ev) => {
      const db = ev.target.result;

      if (!db.objectStoreNames.contains("customers")){
        db.createObjectStore("customers", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("leads")){
        const s = db.createObjectStore("leads", { keyPath: "id" });
        s.createIndex("status", "status");
        s.createIndex("customerId", "customerId");
      }
      if (!db.objectStoreNames.contains("events")){
        const s = db.createObjectStore("events", { keyPath: "id" });
        s.createIndex("date", "date");
        s.createIndex("customerId", "customerId");
        s.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("checklists")){
        const s = db.createObjectStore("checklists", { keyPath: "id" });
        s.createIndex("eventId", "eventId");
      }
      if (!db.objectStoreNames.contains("invoices")){
        const s = db.createObjectStore("invoices", { keyPath: "id" });
        s.createIndex("customerId", "customerId");
        s.createIndex("eventId", "eventId");
        s.createIndex("paymentStatus", "paymentStatus");
        s.createIndex("issueDate", "issueDate");
      }
      if (!db.objectStoreNames.contains("reviews")){
        const s = db.createObjectStore("reviews", { keyPath: "id" });
        s.createIndex("eventId", "eventId");
        s.createIndex("status", "status");
      }
      if (!db.objectStoreNames.contains("settings")){
        db.createObjectStore("settings", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("invoiceCounter")){
        db.createObjectStore("invoiceCounter", { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/* ---------- Generieke CRUD op basis van store-naam ---------- */
function withStore(storeName, mode, fn){
  return openDb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    try{
      result = fn(store);
    }catch(e){ reject(e); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getAll(storeName){
  const db = await openDb();
  return reqToPromise(db.transaction(storeName, "readonly").objectStore(storeName).getAll());
}
async function getById(storeName, id){
  const db = await openDb();
  return reqToPromise(db.transaction(storeName, "readonly").objectStore(storeName).get(id));
}
async function getByIndex(storeName, indexName, value){
  const db = await openDb();
  return reqToPromise(db.transaction(storeName, "readonly").objectStore(storeName).index(indexName).getAll(value));
}
async function put(storeName, record){
  return withStore(storeName, "readwrite", store => { store.put(record); return record; });
}
async function remove(storeName, id){
  return withStore(storeName, "readwrite", store => { store.delete(id); return true; });
}
async function clearStore(storeName){
  return withStore(storeName, "readwrite", store => { store.clear(); return true; });
}

/* ---------- Customers ---------- */
async function getCustomers(){ return getAll("customers"); }
async function getCustomer(id){ return getById("customers", id); }
async function saveCustomer(customer){
  if (!customer.id) customer.id = LachboxOS.utils.uuid();
  if (!customer.createdAt) customer.createdAt = LachboxOS.utils.todayISO();
  await put("customers", customer);
  return customer;
}
// Weigert te verwijderen zolang er nog leads/events/facturen naar deze klant verwijzen.
async function deleteCustomer(id){
  const [leads, events, invoices] = await Promise.all([
    getByIndex("leads", "customerId", id),
    getByIndex("events", "customerId", id),
    getByIndex("invoices", "customerId", id)
  ]);
  if (leads.length || events.length || invoices.length){
    const err = new Error("Klant kan niet worden verwijderd omdat er gekoppelde leads, evenementen of facturen bestaan.");
    err.code = "HAS_RELATIONS";
    throw err;
  }
  return remove("customers", id);
}

/* ---------- Leads ---------- */
async function getLeads(){ return getAll("leads"); }
async function getLead(id){ return getById("leads", id); }
async function getLeadsByCustomer(customerId){ return getByIndex("leads", "customerId", customerId); }
async function saveLead(lead){
  if (!lead.id) lead.id = LachboxOS.utils.uuid();
  if (!lead.createdAt) lead.createdAt = LachboxOS.utils.todayISO();
  if (!lead.status) lead.status = "Nieuw";
  await put("leads", lead);
  return lead;
}
async function deleteLead(id){ return remove("leads", id); }

/* ---------- Events ---------- */
async function getEvents(){ return getAll("events"); }
async function getEvent(id){ return getById("events", id); }
async function getEventsByCustomer(customerId){ return getByIndex("events", "customerId", customerId); }
async function saveEvent(event){
  if (!event.id) event.id = LachboxOS.utils.uuid();
  if (!event.status) event.status = "Gepland";
  await put("events", event);
  return event;
}
async function deleteEvent(id){ return remove("events", id); }

/* ---------- Checklists ---------- */
async function getChecklists(){ return getAll("checklists"); }
async function getChecklist(id){ return getById("checklists", id); }
async function getChecklistByEvent(eventId){
  const rows = await getByIndex("checklists", "eventId", eventId);
  return rows[0] || null;
}
async function saveChecklist(checklist){
  if (!checklist.id) checklist.id = LachboxOS.utils.uuid();
  await put("checklists", checklist);
  return checklist;
}
async function deleteChecklist(id){ return remove("checklists", id); }

/* ---------- Invoices ---------- */
async function getInvoices(){ return getAll("invoices"); }
async function getInvoice(id){ return getById("invoices", id); }
async function getInvoicesByCustomer(customerId){ return getByIndex("invoices", "customerId", customerId); }
async function getInvoicesByEvent(eventId){ return getByIndex("invoices", "eventId", eventId); }
async function saveInvoice(invoice){
  if (!invoice.id) invoice.id = LachboxOS.utils.uuid();
  if (!invoice.paymentStatus) invoice.paymentStatus = "concept";
  await put("invoices", invoice);
  return invoice;
}
async function deleteInvoice(id){ return remove("invoices", id); }

/* ---------- Reviews ---------- */
async function getReviews(){ return getAll("reviews"); }
async function getReview(id){ return getById("reviews", id); }
async function getReviewByEvent(eventId){
  const rows = await getByIndex("reviews", "eventId", eventId);
  return rows[0] || null;
}
async function saveReview(review){
  if (!review.id) review.id = LachboxOS.utils.uuid();
  if (!review.status) review.status = "niet_gevraagd";
  await put("reviews", review);
  return review;
}
async function deleteReview(id){ return remove("reviews", id); }

/* ---------- Settings (één record, id "main") ---------- */
function defaultSettings(){
  return {
    id: "main",
    company: {
      name: "Lachbox",
      street: "Baarskampstraat 49",
      city: "5995 AT Kessel",
      country: "Nederland",
      bankName: "Revolut Business",
      iban: "NL65REVO3992711382",
      kvk: "98646222",
      vatNumber: "868583078B01",
      email: "info@lachbox.nl",
      logoUrl: LachboxOS.LOGO_DATA_URL || ""
    },
    invoicing: {
      prefix: "",
      defaultPaymentTermDays: 14,
      vatRates: [0, 9, 21],
      defaultVatRate: 21
    },
    components: {
      mirrorbooth: { name: "Mirrorbooth", subtext: "Inclusief gepersonaliseerde fotostrip, opbouw en afbouw", price: 375, vatRate: 21, priceMode: "incl", locked: true },
      onbeperkt:   { name: "Onbeperkt printen", subtext: "Standaard zijn 75 prints inbegrepen", price: 35, vatRate: 21, priceMode: "incl" },
      props:       { name: "Props-pakket", subtext: "Brillen, bordjes en hoedjes voor extra gekke poses", price: 15, vatRate: 21, priceMode: "incl" },
      backdrop:    { name: "Backdrop", subtext: "Achtergrond voor een strak studiogevoel", price: 45, vatRate: 21, priceMode: "incl" },
      rodeloper:   { name: "Rode loper met afzetpaaltjes", subtext: "Hollywood-entree waar gasten mee binnenkomen", price: 40, vatRate: 21, priceMode: "incl" }
    },
    reviews: { googleReviewUrl: "" },
    email: { senderName: "Team Lachbox", signOff: "Groet,\nTeam Lachbox" }
  };
}
async function getSettings(){
  const existing = await getById("settings", "main");
  if (existing) return existing;
  const defaults = defaultSettings();
  await put("settings", defaults);
  return defaults;
}
async function saveSettings(settings){
  settings.id = "main";
  await put("settings", settings);
  return settings;
}

/* ---------- Factuurteller (id "main") ---------- */
async function getInvoiceCounter(){
  const existing = await getById("invoiceCounter", "main");
  if (existing) return existing;
  const now = new Date();
  const fresh = { id: "main", year: now.getFullYear(), month: now.getMonth() + 1, lastNumber: 0 };
  await put("invoiceCounter", fresh);
  return fresh;
}
async function saveInvoiceCounter(counter){
  counter.id = "main";
  await put("invoiceCounter", counter);
  return counter;
}

/* ---------- Backup / restore (sectie 30) ---------- */
const ALL_STORES = ["customers", "leads", "events", "checklists", "invoices", "reviews", "settings", "invoiceCounter"];

async function exportAllData(){
  const data = {};
  for (const name of ALL_STORES) data[name] = await getAll(name);
  return { exportedAt: new Date().toISOString(), version: DB_VERSION, data };
}

// Overschrijft ALLE stores met de inhoud van een eerdere backup. De aanroeper
// moet zelf eerst om bevestiging vragen (askConfirm) — deze functie doet dat niet.
async function importAllData(backup){
  if (!backup || typeof backup !== "object" || !backup.data){
    throw new Error("Ongeldig back-upbestand.");
  }
  for (const name of ALL_STORES){
    const rows = Array.isArray(backup.data[name]) ? backup.data[name] : [];
    await clearStore(name);
    for (const row of rows) await put(name, row);
  }
  return true;
}

/* ---------- Demodata (sectie 31) ---------- */
// Elke demo-record krijgt isDemo:true, zodat "demodata verwijderen" alleen
// deze records raakt en nooit echte, door de gebruiker ingevoerde data.
async function clearDemoData(){
  for (const name of ["customers", "leads", "events", "checklists", "invoices", "reviews"]){
    const rows = await getAll(name);
    for (const row of rows){
      if (row.isDemo) await remove(name, row.id);
    }
  }
  return true;
}
async function hasDemoData(){
  const customers = await getAll("customers");
  return customers.some(c => c.isDemo);
}

LachboxOS.storage = {
  getCustomers, getCustomer, saveCustomer, deleteCustomer,
  getLeads, getLead, getLeadsByCustomer, saveLead, deleteLead,
  getEvents, getEvent, getEventsByCustomer, saveEvent, deleteEvent,
  getChecklists, getChecklist, getChecklistByEvent, saveChecklist, deleteChecklist,
  getInvoices, getInvoice, getInvoicesByCustomer, getInvoicesByEvent, saveInvoice, deleteInvoice,
  getReviews, getReview, getReviewByEvent, saveReview, deleteReview,
  getSettings, saveSettings, defaultSettings,
  getInvoiceCounter, saveInvoiceCounter,
  exportAllData, importAllData,
  clearDemoData, hasDemoData
};

})();
