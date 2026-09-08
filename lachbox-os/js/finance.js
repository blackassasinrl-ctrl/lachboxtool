/* ============================================================
   LACHBOX OS — FINANCIEEL
   Omzetdashboard + winst per event (sectie financieel van het
   bouwplan). Gebaseerd op afgeronde events (boekingswaarde min
   kosten), niet op factuurstatus: de winst van een klus is meteen
   zichtbaar zodra het event is afgerond, ongeacht wanneer de factuur
   later betaald wordt. Kosten worden per event ingevoerd (events.js,
   sectie "Kosten") en hier alleen gelezen/opgeteld.

   De grafiek is met de hand getekend in SVG — geen chart-library,
   want de app moet ook zonder internetverbinding werken als hij
   rechtstreeks vanaf schijf (file://) geopend wordt.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;

function eventBookingTotal(ev){
  const extrasSum = (ev.extras || []).reduce((s, e) => s + (Number(e.price) || 0), 0);
  return (Number(ev.price) || 0) + extrasSum - (Number(ev.discount) || 0);
}
function eventCostsTotal(ev){
  return (ev.costs || []).reduce((s, c) => s + (Number(c.amount) || 0), 0);
}
function eventProfit(ev){
  return eventBookingTotal(ev) - eventCostsTotal(ev);
}
function completedEvents(){
  return state().cache.events.filter(e => e.status === "Afgerond");
}

function computeMonthlySeries(monthsBack){
  const now = new Date();
  const months = [];
  for (let i = monthsBack - 1; i >= 0; i--){
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ year: d.getFullYear(), month: d.getMonth() });
  }
  const events = completedEvents();
  return months.map(m => {
    const monthEvents = events.filter(e => {
      const d = utils().parseDateInputValue(e.date);
      return d && d.getFullYear() === m.year && d.getMonth() === m.month;
    });
    const omzet = utils().roundMoney(monthEvents.reduce((s, e) => s + eventBookingTotal(e), 0));
    const kosten = utils().roundMoney(monthEvents.reduce((s, e) => s + eventCostsTotal(e), 0));
    return {
      label: `${utils().MONTH_NAMES_NL[m.month].slice(0, 3)} '${String(m.year).slice(2)}`,
      omzet, kosten, winst: utils().roundMoney(omzet - kosten), count: monthEvents.length
    };
  });
}

function computeYearTotals(year){
  const events = completedEvents().filter(e => {
    const d = utils().parseDateInputValue(e.date);
    return d && d.getFullYear() === year;
  });
  const omzet = utils().roundMoney(events.reduce((s, e) => s + eventBookingTotal(e), 0));
  const kosten = utils().roundMoney(events.reduce((s, e) => s + eventCostsTotal(e), 0));
  const winst = utils().roundMoney(omzet - kosten);
  const margin = omzet > 0 ? Math.round((winst / omzet) * 100) : null;
  return { omzet, kosten, winst, margin, count: events.length };
}

/* ---------- Hand-getekende SVG-staafgrafiek (omzet + winst per maand) ---------- */
const SVG_NS = "http://www.w3.org/2000/svg";
function svgEl(tag, attrs){
  const el = document.createElementNS(SVG_NS, tag);
  if (attrs) Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
  return el;
}

function buildMonthlyChart(series){
  const barGroupW = 60, barW = 18, gap = 6;
  const chartH = 220, padTop = 16, padBottom = 30;
  const plotH = chartH - padTop - padBottom;
  const width = series.length * barGroupW + 16;

  const allValues = series.reduce((acc, s) => acc.concat([s.omzet, s.winst]), []);
  const maxPos = Math.max(0, ...allValues);
  const maxNeg = Math.min(0, ...allValues);
  const range = (maxPos - maxNeg) || 1;
  const zeroY = padTop + (maxPos / range) * plotH;
  function yFor(value){ return zeroY - (value / range) * plotH; }
  function barRect(value, x){
    const y1 = yFor(value);
    return { x, y: Math.min(y1, zeroY), height: Math.max(Math.abs(y1 - zeroY), 0.5), width: barW };
  }

  const svg = svgEl("svg", { viewBox: `0 0 ${width} ${chartH}`, width: "100%", height: String(chartH), class: "finance-chart", role: "img", "aria-label": "Omzet en winst per maand" });
  svg.appendChild(svgEl("line", { x1: 2, x2: width - 2, y1: zeroY, y2: zeroY, class: "chart-baseline" }));

  series.forEach((m, i) => {
    const groupX = 8 + i * barGroupW;

    const omzetR = barRect(m.omzet, groupX);
    const omzetBar = svgEl("rect", Object.assign({ class: "chart-bar chart-bar-omzet" }, omzetR));
    const omzetTitle = svgEl("title", {});
    omzetTitle.textContent = `Omzet ${m.label}: ${utils().formatCurrency(m.omzet)}`;
    omzetBar.appendChild(omzetTitle);
    svg.appendChild(omzetBar);

    const winstR = barRect(m.winst, groupX + barW + gap);
    const winstBar = svgEl("rect", Object.assign({ class: "chart-bar " + (m.winst < 0 ? "chart-bar-loss" : "chart-bar-winst") }, winstR));
    const winstTitle = svgEl("title", {});
    winstTitle.textContent = `Winst ${m.label}: ${utils().formatCurrency(m.winst)}`;
    winstBar.appendChild(winstTitle);
    svg.appendChild(winstBar);

    const label = svgEl("text", { x: groupX + barW + gap / 2, y: chartH - 10, class: "chart-label", "text-anchor": "middle" });
    label.textContent = m.label;
    svg.appendChild(label);
  });

  return svg;
}

function buildLegend(){
  const legend = utils().make("div", "chart-legend");
  function item(cls, label){
    const el = utils().make("span", "chart-legend-item");
    el.appendChild(utils().make("span", "chart-legend-swatch " + cls));
    el.appendChild(document.createTextNode(label));
    return el;
  }
  legend.appendChild(item("chart-bar-omzet", "Omzet"));
  legend.appendChild(item("chart-bar-winst", "Winst"));
  return legend;
}

/* ============================================================
   Financieel-pagina
   ============================================================ */
function renderContent(container){
  const page = utils().make("div", "page");
  page.appendChild(utils().make("h1", "page-title", "Financieel"));

  const yearTotals = computeYearTotals(new Date().getFullYear());
  const summary = utils().make("div", "kpi-row");
  function statCard(label, value){
    const c = utils().make("div", "kpi-card");
    c.appendChild(utils().make("div", "kpi-label", label));
    c.appendChild(utils().make("div", "kpi-value", value));
    return c;
  }
  summary.appendChild(statCard("Omzet dit jaar", utils().formatCurrency(yearTotals.omzet)));
  summary.appendChild(statCard("Kosten dit jaar", utils().formatCurrency(yearTotals.kosten)));
  summary.appendChild(statCard("Winst dit jaar", utils().formatCurrency(yearTotals.winst)));
  summary.appendChild(statCard("Marge", yearTotals.margin == null ? "—" : yearTotals.margin + "%"));
  summary.appendChild(statCard("Afgeronde events", String(yearTotals.count)));
  page.appendChild(summary);
  page.appendChild(utils().make("div", "field-hint", "Gebaseerd op afgeronde events (boekingswaarde min kosten), niet op factuurstatus — zo is de winst van een klus meteen zichtbaar zodra het event is afgerond."));

  const chartPanel = utils().make("div", "section-card");
  chartPanel.appendChild(utils().make("h2", "section-heading", "Omzet & winst per maand"));
  const series = computeMonthlySeries(12);
  if (!series.some(s => s.count > 0)){
    chartPanel.appendChild(utils().make("div", "empty-hint", "Nog geen afgeronde events in de afgelopen 12 maanden."));
  } else {
    const chartWrap = utils().make("div", "finance-chart-wrap");
    chartWrap.appendChild(buildMonthlyChart(series));
    chartPanel.appendChild(chartWrap);
    chartPanel.appendChild(buildLegend());
  }
  page.appendChild(chartPanel);

  const tablePanel = utils().make("div", "section-card");
  tablePanel.appendChild(utils().make("h2", "section-heading", "Winst per event"));
  const events = completedEvents().slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  if (events.length === 0){
    tablePanel.appendChild(utils().make("div", "empty-hint", "Nog geen afgeronde events."));
  } else {
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Event", "Klant", "Datum", "Omzet", "Kosten", "Winst", "Marge"].forEach(h => headRow.appendChild(utils().make("th", null, h)));
    thead.appendChild(headRow); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    events.forEach(ev => {
      const customer = state().getCustomerById(ev.customerId);
      const omzet = eventBookingTotal(ev);
      const kosten = eventCostsTotal(ev);
      const winst = eventProfit(ev);
      const margin = omzet > 0 ? Math.round((winst / omzet) * 100) : null;
      const tr = document.createElement("tr");
      tr.appendChild(utils().make("td", null, ev.eventName || ev.eventType || "Event"));
      tr.appendChild(utils().make("td", null, state().customerDisplayName(customer) || "—"));
      tr.appendChild(utils().make("td", "cell-muted", ev.date ? utils().formatDateDisplay(ev.date) : "—"));
      tr.appendChild(utils().make("td", "cell-num", utils().formatCurrency(omzet)));
      tr.appendChild(utils().make("td", "cell-num", utils().formatCurrency(kosten)));
      tr.appendChild(utils().make("td", "cell-num" + (winst < 0 ? " cell-danger" : ""), utils().formatCurrency(winst)));
      tr.appendChild(utils().make("td", "cell-num", margin == null ? "—" : margin + "%"));
      tr.addEventListener("click", () => nav().navigateTo("events/" + ev.id));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tablePanel.appendChild(table);
  }
  page.appendChild(tablePanel);

  container.appendChild(page);
}

function render(container){
  renderContent(container);
  return state().on("*", () => { utils().clear(container); renderContent(container); });
}

nav().registerRoute({ path: "financieel", label: "Financieel", icon: "▲", group: null, render });

LachboxOS.finance = { eventBookingTotal, eventCostsTotal, eventProfit, computeYearTotals, computeMonthlySeries };

})();
