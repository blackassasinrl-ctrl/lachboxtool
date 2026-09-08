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
      actions.push({ text: `Factuur ${inv.invoiceNumber} (${naam}) is ${Math.abs(days)} dag${Math.abs(days)===1?"":"en"} verlopen`, level: "danger" });
    } else if (days <= 3){
      actions.push({ text: `Factuur ${inv.invoiceNumber} (${naam}) verloopt over ${days} dag${days===1?"":"en"}`, level: "warning" });
    }
  });

  c.leads.forEach(lead => {
    if (!OPEN_LEAD_STATUSES.includes(lead.status)) return;
    const refDate = lead.lastContactAt || lead.createdAt;
    const days = utils().daysBetween(refDate, today);
    if (days != null && days >= 7){
      const customer = state().getCustomerById(lead.customerId);
      const naam = state().customerDisplayName(customer) || "onbekende klant";
      actions.push({ text: `Lead ${naam} is ${days} dagen niet opgevolgd`, level: "warning" });
    }
  });

  c.events.forEach(ev => {
    if (ev.status !== "Afgerond") return;
    const review = state().reviewForEvent(ev.id);
    if (!review || review.status === "niet_gevraagd"){
      const customer = state().getCustomerById(ev.customerId);
      const naam = state().customerDisplayName(customer) || ev.eventName || "klant";
      actions.push({ text: `Review nog niet gevraagd voor ${naam}`, level: "info" });
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
        actions.push({ text: `Event over ${days} dag${days===1?"":"en"} (${naam}) maar checklist is nog maar ${readiness.percent}%`, level: readiness.level === "red" ? "danger" : "warning" });
      }
    });
  }

  return actions;
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
      const row = u.make("div", "action-row action-" + a.level);
      row.appendChild(u.make("span", "action-dot"));
      row.appendChild(u.make("span", null, a.text));
      list.appendChild(row);
    });
    actionsPanel.appendChild(list);
  }
  grid.appendChild(actionsPanel);

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
