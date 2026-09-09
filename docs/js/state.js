/* ============================================================
   LACHBOX OS — STATE
   Kleine in-memory cache + event-bus bovenop storage.js. Modules
   lezen uit de cache (snel, geen herhaalde IndexedDB-round-trips
   voor elke render) en luisteren op wijzigingen via on()/emit() om
   zichzelf te herrenderen. Elke write gaat nog steeds direct naar
   storage.js; de cache wordt daarna simpelweg opnieuw ingeladen.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const storage = () => LachboxOS.storage;

const cache = {
  customers: [], leads: [], events: [], checklists: [], invoices: [], reviews: [], messages: [],
  settings: null, counter: null,
  loaded: false
};

const listeners = {};
function on(event, cb){
  (listeners[event] = listeners[event] || []).push(cb);
  return () => off(event, cb);
}
function off(event, cb){
  if (!listeners[event]) return;
  listeners[event] = listeners[event].filter(fn => fn !== cb);
}
function emit(event, payload){
  (listeners[event] || []).forEach(cb => {
    try{ cb(payload); }catch(e){ console.error("Fout in listener voor " + event, e); }
  });
  (listeners["*"] || []).forEach(cb => {
    try{ cb(event, payload); }catch(e){ console.error("Fout in wildcard-listener", e); }
  });
}

/* ---------- @Tags: actief melden i.p.v. alleen het dashboardpaneel ----------
   Elke refresh die via Realtime binnenkomt (een collega slaat iets op,
   ongeacht welk scherm jij open hebt) vergelijkt de oude met de nieuwe
   data; duikt daar een "@Jouw Naam" in op die er bij de vorige stand
   nog niet stond, dan verschijnt er een toast — dat is de "melding"
   voor tags, zonder dat daar e-mail/push-infrastructuur voor nodig is.
   Alleen ná de eerste keer laden (cache.loaded / messagesLoadedOnce):
   anders zou elke al-bestaande tag bij het opstarten/eerste keer Chat
   openen in één keer als "nieuw" gemeld worden. */
function notifyNewNoteMentions(previousRecords, newRecords, kind){
  const u = LachboxOS.utils, auth = LachboxOS.auth;
  if (!cache.loaded || !u || !auth || !auth.displayName) return;
  const myName = auth.displayName();
  if (!myName) return;
  newRecords.forEach(record => {
    if (!u.textMentionsName(record.notes, myName)) return;
    const before = previousRecords.find(r => r.id === record.id);
    if (before && u.textMentionsName(before.notes, myName)) return; // al eerder gezien, geen nieuwe tag
    const label = kind === "lead"
      ? "lead " + (customerDisplayName(getCustomerById(record.customerId)) || "onbekende klant")
      : "klant " + (customerDisplayName(record) || "onbekend");
    u.showToast(`Je bent getagd in een notitie bij ${label}.`, "info");
  });
}

async function refreshCustomers(){
  const previous = cache.customers;
  cache.customers = await storage().getCustomers();
  notifyNewNoteMentions(previous, cache.customers, "customer");
  emit("customers:changed", cache.customers);
  return cache.customers;
}
async function refreshLeads(){
  const previous = cache.leads;
  cache.leads = await storage().getLeads();
  notifyNewNoteMentions(previous, cache.leads, "lead");
  emit("leads:changed", cache.leads);
  return cache.leads;
}
async function refreshEvents(){ cache.events = await storage().getEvents(); emit("events:changed", cache.events); return cache.events; }
async function refreshChecklists(){ cache.checklists = await storage().getChecklists(); emit("checklists:changed", cache.checklists); return cache.checklists; }
async function refreshInvoices(){ cache.invoices = await storage().getInvoices(); emit("invoices:changed", cache.invoices); return cache.invoices; }
async function refreshReviews(){ cache.reviews = await storage().getReviews(); emit("reviews:changed", cache.reviews); return cache.reviews; }
async function refreshSettings(){ cache.settings = await storage().getSettings(); emit("settings:changed", cache.settings); return cache.settings; }
async function refreshCounter(){ cache.counter = await storage().getInvoiceCounter(); return cache.counter; }

// Los van refreshAll() gehouden: chat wordt pas geladen zodra iemand
// het Chat-scherm daadwerkelijk opent, niet al bij het opstarten van
// de rest van de app (die data heeft niemand anders nodig) — maar
// dankzij Realtime (zie initRealtime) komt een nieuw bericht ook
// binnen terwijl je op een ANDERE pagina zit, en dat mag dan best een
// toast geven als het jou tagt.
let messagesLoadedOnce = false;
async function refreshMessages(){
  const previous = cache.messages;
  const alreadyLoadedBefore = messagesLoadedOnce;
  cache.messages = await storage().getMessages();
  messagesLoadedOnce = true;
  if (alreadyLoadedBefore){
    const u = LachboxOS.utils, auth = LachboxOS.auth;
    const myName = (u && auth && auth.displayName) ? auth.displayName() : "";
    if (myName){
      const previousIds = new Set(previous.map(m => m.id));
      cache.messages.forEach(msg => {
        if (previousIds.has(msg.id) || msg.senderName === myName) return;
        if (u.textMentionsName(msg.body, myName)) u.showToast(`${msg.senderName} heeft je getagd in de chat.`, "info");
      });
    }
  }
  emit("messages:changed", cache.messages);
  return cache.messages;
}

async function refreshAll(){
  await Promise.all([
    refreshCustomers(), refreshLeads(), refreshEvents(), refreshChecklists(),
    refreshInvoices(), refreshReviews(), refreshSettings(), refreshCounter()
  ]);
  cache.loaded = true;
  emit("all:changed", cache);
}

/* ---------- Realtime (Milestone 8a) ----------
   Eén gedeelde workspace betekent dat een collega's wijziging ook in
   jouw open scherm moet verschijnen zonder handmatig te herladen.
   Supabase Realtime stuurt een event per tabel-wijziging; we hoeven
   daarop alleen de bijbehorende refreshX() opnieuw aan te roepen —
   die roept via emit() vanzelf alle geabonneerde schermen aan
   (zelfde pub/sub die hierboven al voor lokale writes gebruikt wordt). */
let realtimeChannel = null;
function initRealtime(){
  if (realtimeChannel || !LachboxOS.supabaseClient) return;
  const refreshByTable = {
    customers: refreshCustomers, leads: refreshLeads, events: refreshEvents,
    checklists: refreshChecklists, invoices: refreshInvoices, reviews: refreshReviews,
    settings: refreshSettings, messages: refreshMessages
  };
  realtimeChannel = LachboxOS.supabaseClient.channel("lachbox-os-changes");
  Object.keys(refreshByTable).forEach(table => {
    realtimeChannel.on("postgres_changes", { event: "*", schema: "public", table }, () => {
      refreshByTable[table]().catch(e => console.error("Realtime-refresh mislukt voor " + table, e));
    });
  });
  realtimeChannel.subscribe();
}

/* ---------- Afgeleide lookups (gebruiken de cache, geen extra DB-call) ---------- */
function getCustomerById(id){
  return cache.customers.find(c => c.id === id) || null;
}
function customerDisplayName(customer){
  if (!customer) return "";
  return customer.company || customer.contactPerson || "Naamloze klant";
}
function eventsForCustomer(customerId){
  return cache.events.filter(e => e.customerId === customerId);
}
function invoicesForCustomer(customerId){
  return cache.invoices.filter(i => i.customerId === customerId);
}
function leadsForCustomer(customerId){
  return cache.leads.filter(l => l.customerId === customerId);
}
function reviewsForCustomer(customerId){
  return cache.reviews.filter(r => r.customerId === customerId);
}
function invoicesForEvent(eventId){
  return cache.invoices.filter(i => i.eventId === eventId);
}
function reviewForEvent(eventId){
  return cache.reviews.find(r => r.eventId === eventId) || null;
}
function checklistForEvent(eventId){
  return cache.checklists.find(c => c.eventId === eventId) || null;
}
function leadForEvent(leadId){
  return leadId ? (cache.leads.find(l => l.id === leadId) || null) : null;
}
function customerRevenueTotal(customerId){
  return invoicesForCustomer(customerId)
    .filter(i => i.paymentStatus === "betaald")
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0);
}

LachboxOS.state = {
  cache,
  on, off, emit,
  refreshCustomers, refreshLeads, refreshEvents, refreshChecklists,
  refreshInvoices, refreshReviews, refreshSettings, refreshCounter, refreshAll,
  refreshMessages,
  initRealtime,
  getCustomerById, customerDisplayName,
  eventsForCustomer, invoicesForCustomer, leadsForCustomer, reviewsForCustomer,
  invoicesForEvent, reviewForEvent, checklistForEvent, leadForEvent,
  customerRevenueTotal
};

})();
