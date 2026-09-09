/* ============================================================
   LACHBOX OS — DASHBOARD
   KPI's en overzichten, allemaal berekend uit echte, opgeslagen
   data (state.cache) — nooit hardcoded voorbeeldcijfers (sectie 40).
   Zolang latere milestones (CRM/Events/Reviews) nog niet gebouwd
   zijn, tonen deze secties gewoon eerlijk "nog niets" totdat er
   data is (bv. via demodata in Instellingen).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;

const OPEN_LEAD_STATUSES = ["Nieuw", "Contact opnemen", "Contact gehad", "Offerte maken", "Offerte verstuurd", "Opvolgen"];

function computeKpis(){
  const c = state().cache;
  const today = utils().todayISO();
  const now = new Date();

  const upcomingEvents = c.events.filter(e => e.date && e.date >= today);
  const openLeads = c.leads.filter(l => OPEN_LEAD_STATUSES.includes(l.status));
  const unpaidInvoices = c.invoices.filter(i => i.paymentStatus !== "betaald");
  const outstandingAmount = unpaidInvoices.reduce((sum, i) => sum + (Number(i.total) || 0), 0);

  const revenueThisMonth = c.invoices
    .filter(i => i.paymentStatus === "betaald")
    .filter(i => {
      const d = utils().parseDateInputValue(i.paidDate || i.issueDate);
      return d && d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0);

  const revenueThisYear = c.invoices
    .filter(i => i.paymentStatus === "betaald")
    .filter(i => {
      const d = utils().parseDateInputValue(i.paidDate || i.issueDate);
      return d && d.getFullYear() === now.getFullYear();
    })
    .reduce((sum, i) => sum + (Number(i.total) || 0), 0);

  return {
    upcomingEventsCount: upcomingEvents.length,
    openLeadsCount: openLeads.length,
    unpaidInvoicesCount: unpaidInvoices.length,
    outstandingAmount,
    revenueThisMonth,
    revenueThisYear,
    upcomingEvents: upcomingEvents.slice().sort((a,b) => a.date.localeCompare(b.date)).slice(0, 5),
    recentLeads: c.leads.slice().sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")).slice(0, 5)
  };
}

// Zie sectie 25: geen pushnotificaties, gewoon een lijst met concrete
// aandachtspunten, elk uit echte data afgeleid.
function computeActions(){
  const c = state().cache;
  const today = utils().todayISO();
  const actions = [];

  c.invoices.forEach(inv => {
    if (inv.paymentStatus === "betaald" || !inv.dueDate) return;
    const days = utils().daysBetween(today, inv.dueDate);
    if (days == null) return;
    const customer = state().getCustomerById(inv.customerId);
    const naam = state().customerDisplayName(customer) || inv.invoiceNumber;
    if (days < 0){
      actions.push({ text: `Factuur ${inv.invoiceNumber} (${naam}) is ${Math.abs(days)} dag${Math.abs(days)===1?"":"en"} verlopen`, level: "danger", onClick: () => nav().navigateTo("invoices/" + inv.id) });
    } else if (days <= 3){
      actions.push({ text: `Factuur ${inv.invoiceNumber} (${naam}) verloopt over ${days} dag${days===1?"":"en"}`, level: "warning", onClick: () => nav().navigateTo("invoices/" + inv.id) });
    }
  });

  c.leads.forEach(lead => {
    if (!OPEN_LEAD_STATUSES.includes(lead.status)) return;
    // Concrete opvolgdatum heeft voorrang op de algemene "N dagen niet
    // opgevolgd"-melding — die laatste is voor leads zonder geplande actie.
    if (lead.nextActionDate){
      const daysUntil = utils().daysBetween(today, lead.nextActionDate);
      if (daysUntil != null && daysUntil <= 0){
        const customer = state().getCustomerById(lead.customerId);
        const naam = state().customerDisplayName(customer) || "onbekende klant";
        const what = lead.nextAction ? `: ${lead.nextAction}` : "";
        const text = daysUntil < 0
          ? `Opvolgactie voor ${naam} is ${Math.abs(daysUntil)} dag${Math.abs(daysUntil)===1?"":"en"} verlopen${what}`
          : `Opvolgactie voor ${naam} staat voor vandaag${what}`;
        actions.push({ text, level: daysUntil < 0 ? "danger" : "warning", onClick: () => { if (LachboxOS.crm) LachboxOS.crm.openLeadById(lead.id); } });
      }
      return;
    }
    const refDate = lead.lastContactAt || lead.createdAt;
    const days = utils().daysBetween(refDate, today);
    if (days != null && days >= 7){
      const customer = state().getCustomerById(lead.customerId);
      const naam = state().customerDisplayName(customer) || "onbekende klant";
      actions.push({ text: `Lead ${naam} is ${days} dagen niet opgevolgd`, level: "warning", onClick: () => { if (LachboxOS.crm) LachboxOS.crm.openLeadById(lead.id); } });
    }
  });

  c.events.forEach(ev => {
    if (ev.status !== "Afgerond") return;
    const review = state().reviewForEvent(ev.id);
    if (!review || review.status === "niet_gevraagd"){
      const customer = state().getCustomerById(ev.customerId);
      const naam = state().customerDisplayName(customer) || ev.eventName || "klant";
      actions.push({ text: `Review nog niet gevraagd voor ${naam}`, level: "info", onClick: () => nav().navigateTo("events/" + ev.id) });
    }
  });

  // Event binnenkort maar checklist nog niet (voldoende) af (sectie 25-voorbeeld).
  if (LachboxOS.checklists){
    c.events.forEach(ev => {
      if (!ev.date || ev.status === "Afgerond" || ev.status === "Geannuleerd") return;
      const days = utils().daysBetween(today, ev.date);
      if (days == null || days < 0 || days > 3) return;
      const checklist = state().checklistForEvent(ev.id);
      const readiness = LachboxOS.checklists.computeChecklistReadiness(checklist);
      if (readiness.percent < 100){
        const customer = state().getCustomerById(ev.customerId);
        const naam = state().customerDisplayName(customer) || ev.eventName || "event";
        actions.push({ text: `Event over ${days} dag${days===1?"":"en"} (${naam}) maar checklist is nog maar ${readiness.percent}%`, level: readiness.level === "red" ? "danger" : "warning", onClick: () => nav().navigateTo("events/" + ev.id) });
      }
    });
  }

  return actions;
}

/* ---------- @Tags: notities bij leads/klanten waarin jij getagd bent ----------
   Scant lead.notes/customer.notes op "@JouwNaam" (zie utils.js:
   textMentionsName/renderTextWithMentions en auth.js: knownTeamNames).
   Geen aparte notificatietabel nodig — de notitie zelf is de bron. */
function computeMentions(){
  const myName = LachboxOS.auth && LachboxOS.auth.displayName && LachboxOS.auth.displayName();
  if (!myName) return [];
  const c = state().cache;
  const hits = [];
  c.leads.forEach(lead => {
    if (utils().textMentionsName(lead.notes, myName)){
      const customer = state().getCustomerById(lead.customerId);
      hits.push({
        text: `Lead ${state().customerDisplayName(customer) || "onbekende klant"}`,
        snippet: lead.notes,
        onClick: () => { if (LachboxOS.crm) LachboxOS.crm.openLeadById(lead.id); }
      });
    }
  });
  c.customers.forEach(customer => {
    if (utils().textMentionsName(customer.notes, myName)){
      hits.push({
        text: `Klant ${state().customerDisplayName(customer) || "onbekend"}`,
        snippet: customer.notes,
        onClick: () => nav().navigateTo("crm/customers/" + customer.id)
      });
    }
  });
  return hits;
}

function kpiCard(label, value, sub){
  const card = utils().make("div", "kpi-card");
  card.appendChild(utils().make("div", "kpi-label", label));
  card.appendChild(utils().make("div", "kpi-value", value));
  if (sub) card.appendChild(utils().make("div", "kpi-sub", sub));
  return card;
}

function renderContent(container){
  const u = utils(), s = state();
  const kpis = computeKpis();
  const actions = computeActions();
  const mentions = computeMentions();

  const page = u.make("div", "page");
  page.appendChild(u.make("h1", "page-title", "Dashboard"));

  const kpiRow = u.make("div", "kpi-row");
  kpiRow.appendChild(kpiCard("Aankomende events", String(kpis.upcomingEventsCount)));
  kpiRow.appendChild(kpiCard("Openstaande leads", String(kpis.openLeadsCount)));
  kpiRow.appendChild(kpiCard("Openstaande facturen", String(kpis.unpaidInvoicesCount)));
  kpiRow.appendChild(kpiCard("Openstaand bedrag", u.formatCurrency(kpis.outstandingAmount)));
  kpiRow.appendChild(kpiCard("Omzet deze maand", u.formatCurrency(kpis.revenueThisMonth)));
  kpiRow.appendChild(kpiCard("Omzet dit jaar", u.formatCurrency(kpis.revenueThisYear)));
  page.appendChild(kpiRow);

  const grid = u.make("div", "dashboard-grid");

  // Aankomende events
  const eventsPanel = u.make("div", "panel");
  eventsPanel.appendChild(u.make("div", "panel-title", "Aankomende events"));
  if (kpis.upcomingEvents.length === 0){
    eventsPanel.appendChild(u.make("div", "empty-hint", "Nog geen aankomende events."));
  } else {
    const list = u.make("div", "event-list");
    kpis.upcomingEvents.forEach(ev => {
      const customer = s.getCustomerById(ev.customerId);
      const row = u.make("div", "event-row");
      row.appendChild(u.make("div", "event-row-date", u.formatDateDisplay(ev.date)));
      const info = u.make("div", "event-row-info");
      info.appendChild(u.make("div", "event-row-name", ev.eventName || s.customerDisplayName(customer)));
      const metaBits = [ev.package, ev.location].filter(Boolean).join(" · ");
      if (metaBits) info.appendChild(u.make("div", "event-row-meta", metaBits));
      row.appendChild(info);
      list.appendChild(row);
    });
    eventsPanel.appendChild(list);
  }
  grid.appendChild(eventsPanel);

  // Openstaande taken / acties
  const actionsPanel = u.make("div", "panel");
  actionsPanel.appendChild(u.make("div", "panel-title", "Acties"));
  if (actions.length === 0){
    actionsPanel.appendChild(u.make("div", "empty-hint", "Geen openstaande aandachtspunten."));
  } else {
    const list = u.make("div", "action-list");
    actions.forEach(a => {
      const row = u.make("div", "action-row action-" + a.level + (a.onClick ? " action-clickable" : ""));
      row.appendChild(u.make("span", "action-dot"));
      row.appendChild(u.make("span", null, a.text));
      if (a.onClick) row.addEventListener("click", a.onClick);
      list.appendChild(row);
    });
    actionsPanel.appendChild(list);
  }
  grid.appendChild(actionsPanel);

  // Voor jou getagd (@mentions in notities)
  const mentionsPanel = u.make("div", "panel");
  mentionsPanel.appendChild(u.make("div", "panel-title", "Voor jou getagd"));
  if (mentions.length === 0){
    mentionsPanel.appendChild(u.make("div", "empty-hint", "Niemand heeft je getagd in een notitie."));
  } else {
    const list = u.make("div", "action-list");
    mentions.forEach(m => {
      const row = u.make("div", "action-row action-info action-clickable mention-row");
      row.appendChild(u.make("span", "action-dot"));
      const textWrap = u.make("div", "mention-row-body");
      textWrap.appendChild(u.make("div", null, m.text));
      const snippet = u.make("div", "mention-snippet");
      snippet.appendChild(u.renderTextWithMentions(m.snippet));
      textWrap.appendChild(snippet);
      row.appendChild(textWrap);
      row.addEventListener("click", m.onClick);
      list.appendChild(row);
    });
    mentionsPanel.appendChild(list);
  }
  grid.appendChild(mentionsPanel);

  // Recente leads
  const leadsPanel = u.make("div", "panel");
  leadsPanel.appendChild(u.make("div", "panel-title", "Recente leads"));
  if (kpis.recentLeads.length === 0){
    leadsPanel.appendChild(u.make("div", "empty-hint", "Nog geen leads."));
  } else {
    const list = u.make("div", "lead-list");
    kpis.recentLeads.forEach(lead => {
      const customer = s.getCustomerById(lead.customerId);
      const row = u.make("div", "lead-row");
      row.appendChild(u.make("div", "lead-row-name", s.customerDisplayName(customer) || "Naamloze lead"));
      row.appendChild(u.make("span", "badge badge-info", lead.status));
      list.appendChild(row);
    });
    leadsPanel.appendChild(list);
  }
  grid.appendChild(leadsPanel);

  page.appendChild(grid);
  container.appendChild(page);
}

function render(container){
  renderContent(container);
  return state().on("*", () => { utils().clear(container); renderContent(container); });
}

LachboxOS.navigation.registerRoute({ path: "dashboard", label: "Dashboard", icon: "◆", group: null, render });

})();
