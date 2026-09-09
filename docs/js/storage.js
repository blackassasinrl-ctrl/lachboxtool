/* ============================================================
   LACHBOX OS — STORAGE (cloud-variant, Milestone 8a)
   Enige plek die de database aanraakt. Zelfde functienamen en
   signatures als voorheen (elke functie is async en retourneert kale
   JS-objecten/arrays) — alleen de implementatie is veranderd van
   lokale IndexedDB naar een gedeelde Supabase-database, precies zoals
   vanaf het begin bedoeld (zie architectuurplan). Geen enkele andere
   module hoeft hierdoor aangepast te worden.

   Tabellen: customers, leads, events, checklists, invoices, reviews,
   settings (1 rij, id "main"), invoice_counter (1 rij, id "main") —
   zie supabase/schema.sql. Elke tabel heeft de kolommen waar hier op
   gefilterd wordt als losse kolom, plus een `data jsonb`-kolom met
   de rest van het record (ongewijzigde vrije structuur: factuurregels,
   extra's, kosten, checklist-items).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};

function sb(){
  if (!LachboxOS.supabaseClient){
    throw new Error("Geen verbinding met Supabase — controleer js/supabase-config.js.");
  }
  return LachboxOS.supabaseClient;
}

/* ---------- Rij <-> record ----------
   Een "record" is precies wat de rest van de app altijd al kreeg: het
   vrije JS-object met een `id`. De losse kolommen bestaan alleen voor
   filteren/verwijzingen in de database, niet voor de UI. */
function rowToRecord(row){
  if (!row) return null;
  return Object.assign({}, row.data, { id: row.id });
}
function rowsToRecords(rows){
  return (rows || []).map(rowToRecord);
}

async function selectAll(table){
  const { data, error } = await sb().from(table).select("*");
  if (error) throw error;
  return rowsToRecords(data);
}
async function selectById(table, id){
  if (!id) return null;
  const { data, error } = await sb().from(table).select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return rowToRecord(data);
}
async function selectByColumn(table, column, value){
  const { data, error } = await sb().from(table).select("*").eq(column, value);
  if (error) throw error;
  return rowsToRecords(data);
}
async function upsertRow(table, row){
  const { data, error } = await sb().from(table).upsert(row).select().single();
  if (error) throw error;
  return rowToRecord(data);
}
async function deleteRow(table, id){
  const { error } = await sb().from(table).delete().eq("id", id);
  if (error) throw error;
  return true;
}
async function clearTable(table){
  // Geen enkele rij heeft dit id — verwijdert dus alles. Alleen gebruikt
  // door back-up/restore (importAllData), nooit door de UI direct.
  const { error } = await sb().from(table).delete().neq("id", "00000000-0000-0000-0000-000000000000");
  if (error) throw error;
  return true;
}

/* ---------- Customers ---------- */
async function getCustomers(){ return selectAll("customers"); }
async function getCustomer(id){ return selectById("customers", id); }
async function saveCustomer(customer){
  if (!customer.id) customer.id = LachboxOS.utils.uuid();
  if (!customer.createdAt) customer.createdAt = LachboxOS.utils.todayISO();
  return upsertRow("customers", { id: customer.id, data: customer });
}
// "Klant verwijderen" verwijdert nu ook alles wat aan deze klant hangt
// (leads, events en facturen) i.p.v. te weigeren zodra er gekoppelde
// records bestaan — een klant apart verwijderen terwijl zijn boekingen/
// facturen blijven bestaan levert alleen maar verweesde records op die
// nergens meer bij horen. Events verwijderen cascadeert in de database
// automatisch hun checklist en review weg (zie schema.sql); leads
// cascaden ook automatisch, maar worden hier voor de duidelijkheid ook
// expliciet verwijderd.
async function deleteCustomer(id){
  const [leads, events, invoices] = await Promise.all([
    selectByColumn("leads", "customer_id", id),
    selectByColumn("events", "customer_id", id),
    selectByColumn("invoices", "customer_id", id)
  ]);
  await Promise.all(events.map(e => deleteRow("events", e.id)));
  await Promise.all(invoices.map(i => deleteRow("invoices", i.id)));
  await Promise.all(leads.map(l => deleteRow("leads", l.id)));
  return deleteRow("customers", id);
}

/* ---------- Leads ---------- */
async function getLeads(){ return selectAll("leads"); }
async function getLead(id){ return selectById("leads", id); }
async function getLeadsByCustomer(customerId){ return selectByColumn("leads", "customer_id", customerId); }
async function saveLead(lead){
  if (!lead.id) lead.id = LachboxOS.utils.uuid();
  if (!lead.createdAt) lead.createdAt = LachboxOS.utils.todayISO();
  if (!lead.status) lead.status = "Nieuw";
  return upsertRow("leads", { id: lead.id, customer_id: lead.customerId || null, status: lead.status, data: lead });
}
async function deleteLead(id){ return deleteRow("leads", id); }

/* ---------- Events ---------- */
async function getEvents(){ return selectAll("events"); }
async function getEvent(id){ return selectById("events", id); }
async function getEventsByCustomer(customerId){ return selectByColumn("events", "customer_id", customerId); }
async function saveEvent(event){
  if (!event.id) event.id = LachboxOS.utils.uuid();
  if (!event.status) event.status = "Gepland";
  return upsertRow("events", {
    id: event.id,
    customer_id: event.customerId || null,
    lead_id: event.leadId || null,
    status: event.status,
    event_date: event.date || null,
    data: event
  });
}
async function deleteEvent(id){ return deleteRow("events", id); }

/* ---------- Checklists ---------- */
async function getChecklists(){ return selectAll("checklists"); }
async function getChecklist(id){ return selectById("checklists", id); }
async function getChecklistByEvent(eventId){
  const rows = await selectByColumn("checklists", "event_id", eventId);
  return rows[0] || null;
}
async function saveChecklist(checklist){
  if (!checklist.id) checklist.id = LachboxOS.utils.uuid();
  return upsertRow("checklists", { id: checklist.id, event_id: checklist.eventId || null, data: checklist });
}
async function deleteChecklist(id){ return deleteRow("checklists", id); }

/* ---------- Invoices ---------- */
async function getInvoices(){ return selectAll("invoices"); }
async function getInvoice(id){ return selectById("invoices", id); }
async function getInvoicesByCustomer(customerId){ return selectByColumn("invoices", "customer_id", customerId); }
async function getInvoicesByEvent(eventId){ return selectByColumn("invoices", "event_id", eventId); }
async function saveInvoice(invoice){
  if (!invoice.id) invoice.id = LachboxOS.utils.uuid();
  if (!invoice.paymentStatus) invoice.paymentStatus = "concept";
  return upsertRow("invoices", {
    id: invoice.id,
    customer_id: invoice.customerId || null,
    event_id: invoice.eventId || null,
    invoice_number: invoice.invoiceNumber || null,
    payment_status: invoice.paymentStatus,
    issue_date: invoice.issueDate || null,
    data: invoice
  });
}
async function deleteInvoice(id){ return deleteRow("invoices", id); }

/* ---------- Reviews ---------- */
async function getReviews(){ return selectAll("reviews"); }
async function getReview(id){ return selectById("reviews", id); }
async function getReviewByEvent(eventId){
  const rows = await selectByColumn("reviews", "event_id", eventId);
  return rows[0] || null;
}
async function saveReview(review){
  if (!review.id) review.id = LachboxOS.utils.uuid();
  if (!review.status) review.status = "niet_gevraagd";
  return upsertRow("reviews", { id: review.id, customer_id: review.customerId || null, event_id: review.eventId || null, status: review.status, data: review });
}
async function deleteReview(id){ return deleteRow("reviews", id); }

/* ---------- Settings (één rij, id "main") ---------- */
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
      phone: "+31 6 27822258",
      website: "www.lachbox.nl",
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
    email: { senderName: "Team Lachbox", signOff: "Met vriendelijke groet,", signatureEmail: "contact@lachbox.nl" }
  };
}
async function getSettings(){
  const existing = await selectById("settings", "main");
  if (existing) return existing;
  const defaults = defaultSettings();
  await upsertRow("settings", { id: "main", data: defaults });
  return defaults;
}
async function saveSettings(settings){
  settings.id = "main";
  return upsertRow("settings", { id: "main", data: settings });
}

/* ---------- Factuurteller (id "main") ---------- */
async function getInvoiceCounter(){
  const { data, error } = await sb().from("invoice_counter").select("*").eq("id", "main").maybeSingle();
  if (error) throw error;
  if (data) return { id: data.id, year: data.year, month: data.month, lastNumber: data.last_number };
  const now = new Date();
  return saveInvoiceCounter({ id: "main", year: now.getFullYear(), month: now.getMonth() + 1, lastNumber: 0 });
}
async function saveInvoiceCounter(counter){
  const { data, error } = await sb().from("invoice_counter").upsert({
    id: "main", year: counter.year, month: counter.month, last_number: counter.lastNumber
  }).select().single();
  if (error) throw error;
  return { id: data.id, year: data.year, month: data.month, lastNumber: data.last_number };
}

/* ---------- Teamchat (één gedeeld kanaal, geen threads) ----------
   Bewust buiten backup/restore en demodata gehouden — dat is bedoeld
   voor bedrijfsdata, een gespreksgeschiedenis hoort daar niet zomaar
   stilletjes in mee te gaan bij een restore. */
async function getMessages(limit){
  const { data, error } = await sb().from("messages").select("*").order("created_at", { ascending: true }).limit(limit || 300);
  if (error) throw error;
  return rowsToRecords(data);
}
async function saveMessage(message){
  if (!message.id) message.id = LachboxOS.utils.uuid();
  if (!message.createdAt) message.createdAt = new Date().toISOString();
  return upsertRow("messages", { id: message.id, data: message });
}
async function deleteMessage(id){ return deleteRow("messages", id); }

/* ---------- Backup / restore ---------- */
const ALL_STORES = ["customers", "leads", "events", "checklists", "invoices", "reviews", "settings"];

async function exportAllData(){
  const data = {};
  for (const name of ALL_STORES) data[name] = await selectAll(name);
  data.invoiceCounter = [await getInvoiceCounter()];
  return { exportedAt: new Date().toISOString(), version: 1, data };
}

// Overschrijft ALLE tabellen met de inhoud van een eerdere backup. De
// aanroeper moet zelf eerst om bevestiging vragen (askConfirm) — deze
// functie doet dat niet.
async function importAllData(backup){
  if (!backup || typeof backup !== "object" || !backup.data){
    throw new Error("Ongeldig back-upbestand.");
  }
  const saveFns = {
    customers: saveCustomer, leads: saveLead, events: saveEvent, checklists: saveChecklist,
    invoices: saveInvoice, reviews: saveReview, settings: saveSettings
  };
  for (const name of ALL_STORES){
    await clearTable(name);
    const rows = Array.isArray(backup.data[name]) ? backup.data[name] : [];
    for (const row of rows) await saveFns[name](row);
  }
  if (Array.isArray(backup.data.invoiceCounter) && backup.data.invoiceCounter[0]){
    await saveInvoiceCounter(backup.data.invoiceCounter[0]);
  }
  return true;
}

/* ---------- Demodata ---------- */
// Elke demo-record krijgt isDemo:true, zodat "demodata verwijderen" alleen
// deze records raakt en nooit echte, door het team ingevoerde data.
async function clearDemoData(){
  for (const name of ["customers", "leads", "events", "checklists", "invoices", "reviews"]){
    const rows = await selectAll(name);
    for (const row of rows){
      if (row.isDemo) await deleteRow(name, row.id);
    }
  }
  return true;
}
async function hasDemoData(){
  const customers = await selectAll("customers");
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
  getMessages, saveMessage, deleteMessage,
  exportAllData, importAllData,
  clearDemoData, hasDemoData
};

})();
