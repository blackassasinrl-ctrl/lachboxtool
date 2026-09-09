/* ============================================================
   LACHBOX OS — REVIEWS
   Centraliseert reviewstatus-labels (events.js en crm.js gebruikten
   voorheen hun eigen kopie) en bouwt de review-pipeline: elk afgerond
   event is automatisch een kandidaat, een Review-record wordt pas
   echt aangemaakt zodra er een status-actie op wordt genomen — geen
   nep-records voor events waar nog niets mee gebeurd is.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const storage = () => LachboxOS.storage;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;

const REVIEW_STATUSES = ["niet_gevraagd", "verzoek_klaar", "verstuurd", "ontvangen", "niet_reageren"];
const REVIEW_LABELS = {
  niet_gevraagd: "Niet gevraagd", verzoek_klaar: "Verzoek klaar", verstuurd: "Verstuurd",
  ontvangen: "Ontvangen", niet_reageren: "Niet gereageerd"
};
function reviewStatusLabel(status){ return REVIEW_LABELS[status] || status; }
function reviewStatusBadgeClass(status){
  if (status === "ontvangen") return "badge-success";
  if (status === "niet_reageren") return "badge-danger";
  if (status === "verzoek_klaar" || status === "verstuurd") return "badge-warning";
  return "badge-info"; // niet_gevraagd
}

// Bestaand record, of een niet-opgeslagen "stub" zodat de pipeline elk
// afgerond event kan tonen zonder al voor elk event een record te maken.
function reviewOrStub(event){
  const existing = state().reviewForEvent(event.id);
  if (existing) return existing;
  return { id: null, customerId: event.customerId, eventId: event.id, status: "niet_gevraagd", platform: "Google", requestedAt: null, completedAt: null };
}

async function setReviewStatus(event, status){
  const existing = state().reviewForEvent(event.id);
  const review = existing ? Object.assign({}, existing) : { customerId: event.customerId, eventId: event.id, platform: "Google", requestedAt: null, completedAt: null };
  review.status = status;
  const today = utils().todayISO();
  if ((status === "verzoek_klaar" || status === "verstuurd") && !review.requestedAt) review.requestedAt = today;
  if (status === "ontvangen" || status === "niet_reageren") review.completedAt = today;
  if (status === "niet_gevraagd"){ review.requestedAt = null; review.completedAt = null; }
  const saved = await storage().saveReview(review);
  await state().refreshReviews();
  return saved;
}

function pipelineRows(){
  return state().cache.events
    .filter(e => e.status === "Afgerond")
    .map(e => ({ event: e, review: reviewOrStub(e) }));
}

function computePipelineStats(){
  const rows = pipelineRows();
  const counts = { niet_gevraagd: 0, verzoek_klaar: 0, verstuurd: 0, ontvangen: 0, niet_reageren: 0 };
  rows.forEach(r => { counts[r.review.status] = (counts[r.review.status] || 0) + 1; });
  const askedTotal = counts.verstuurd + counts.ontvangen + counts.niet_reageren;
  const responseRate = askedTotal > 0 ? Math.round((counts.ontvangen / askedTotal) * 100) : null;
  return { total: rows.length, counts, responseRate };
}

/* ============================================================
   Pipeline-pagina
   ============================================================ */
const REVIEW_FILTER_KEY = "lachbox_os_reviews_filter";
const REVIEW_FILTERS = [{ key: "all", label: "Alle" }].concat(REVIEW_STATUSES.map(s => ({ key: s, label: reviewStatusLabel(s) })));

function buildRow(row, onChanged){
  const ev = row.event, review = row.review;
  const customer = state().getCustomerById(ev.customerId);
  const tr = document.createElement("tr");
  tr.style.cursor = "default";
  tr.appendChild(utils().make("td", null, state().customerDisplayName(customer) || "—"));
  tr.appendChild(utils().make("td", null, ev.eventName || ev.eventType || "Event"));
  tr.appendChild(utils().make("td", "cell-muted", ev.date ? utils().formatDateDisplay(ev.date) : "—"));
  tr.appendChild(utils().make("td", "cell-muted", review.platform || "Google"));

  const statusTd = document.createElement("td");
  const select = document.createElement("select");
  REVIEW_STATUSES.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s; opt.textContent = reviewStatusLabel(s);
    if (s === review.status) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener("change", async () => {
    await setReviewStatus(ev, select.value);
    utils().showToast("Reviewstatus bijgewerkt.", "success");
    onChanged();
  });
  statusTd.appendChild(select);
  tr.appendChild(statusTd);

  const actionsTd = utils().make("td", "row-actions");
  if (review.status !== "ontvangen" && LachboxOS.email){
    const emailBtn = utils().make("button", "btn secondary small", "E-mail");
    emailBtn.type = "button";
    const templateKey = (review.status === "niet_gevraagd" || review.status === "verzoek_klaar") ? "review_verzoek" : "review_herinnering";
    emailBtn.addEventListener("click", () => {
      LachboxOS.email.openEmailGenerator({ customerId: ev.customerId, eventId: ev.id, templateKey });
    });
    actionsTd.appendChild(emailBtn);
  }
  const detailLink = utils().make("a", "icon-btn", "Event →");
  detailLink.href = "#/events/" + ev.id;
  actionsTd.appendChild(detailLink);
  tr.appendChild(actionsTd);
  return tr;
}

function renderReviewsPage(container){
  const page = utils().make("div", "page");
  page.appendChild(utils().make("h1", "page-title", "Reviews"));

  const summary = utils().make("div", "kpi-row invoice-summary-row");
  function statCard(label, value){
    const c = utils().make("div", "kpi-card");
    c.appendChild(utils().make("div", "kpi-label", label));
    const valueEl = utils().make("div", "kpi-value", value);
    c.appendChild(valueEl);
    c._valueEl = valueEl;
    return c;
  }
  const cardTotal = statCard("Afgeronde events", "");
  const cardOpen = statCard("Nog te vragen", "");
  const cardPending = statCard("Onderweg", "");
  const cardReceived = statCard("Ontvangen", "");
  const cardResponse = statCard("Respons", "");
  [cardTotal, cardOpen, cardPending, cardReceived, cardResponse].forEach(c => summary.appendChild(c));
  page.appendChild(summary);

  function refreshSummary(){
    const stats = computePipelineStats();
    cardTotal._valueEl.textContent = String(stats.total);
    cardOpen._valueEl.textContent = String(stats.counts.niet_gevraagd);
    cardPending._valueEl.textContent = String(stats.counts.verzoek_klaar + stats.counts.verstuurd);
    cardReceived._valueEl.textContent = String(stats.counts.ontvangen);
    cardResponse._valueEl.textContent = stats.responseRate == null ? "—" : stats.responseRate + "%";
  }
  refreshSummary();

  const toolbar = utils().make("div", "toolbar");
  const searchInput = document.createElement("input");
  searchInput.type = "text"; searchInput.className = "search-input";
  searchInput.placeholder = "Zoek op klant of event…";
  toolbar.appendChild(searchInput);
  page.appendChild(toolbar);

  const pillsRow = utils().make("div", "filter-pills");
  page.appendChild(pillsRow);
  const content = utils().make("div");
  page.appendChild(content);
  container.appendChild(page);

  let activeFilter = localStorage.getItem(REVIEW_FILTER_KEY) || "all";
  const pillButtons = {};
  REVIEW_FILTERS.forEach(f => {
    const btn = utils().make("button", "filter-pill", f.label);
    btn.type = "button";
    btn.addEventListener("click", () => { activeFilter = f.key; localStorage.setItem(REVIEW_FILTER_KEY, f.key); updatePills(); renderTable(); });
    pillButtons[f.key] = btn;
    pillsRow.appendChild(btn);
  });
  function updatePills(){ REVIEW_FILTERS.forEach(f => pillButtons[f.key].classList.toggle("active", f.key === activeFilter)); }

  function renderTable(){
    refreshSummary();
    utils().clear(content);
    let rows = pipelineRows();
    if (activeFilter !== "all") rows = rows.filter(r => r.review.status === activeFilter);
    const q = searchInput.value.trim().toLowerCase();
    if (q){
      rows = rows.filter(r => {
        const customer = state().getCustomerById(r.event.customerId);
        const hay = [state().customerDisplayName(customer), r.event.eventName, r.event.eventType].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    rows.sort((a, b) => (b.event.date || "").localeCompare(a.event.date || ""));

    if (rows.length === 0){ content.appendChild(utils().make("div", "empty-hint", "Geen afgeronde events gevonden.")); return; }
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Klant", "Event", "Datum", "Platform", "Status", "Acties"].forEach(h => headRow.appendChild(utils().make("th", null, h)));
    thead.appendChild(headRow); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(r => tbody.appendChild(buildRow(r, renderTable)));
    table.appendChild(tbody);
    content.appendChild(utils().tableScrollWrap(table));
  }
  searchInput.addEventListener("input", renderTable);
  updatePills();
  renderTable();
}

nav().registerRoute({ path: "communicatie/reviews", label: "Reviews", icon: "reviews", group: "Communicatie", render: (c) => renderReviewsPage(c) });

LachboxOS.reviews = { REVIEW_STATUSES, reviewStatusLabel, reviewStatusBadgeClass, setReviewStatus, reviewOrStub, computePipelineStats };

})();
