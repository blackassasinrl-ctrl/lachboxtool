/* ============================================================
   LACHBOX OS — FACTUREN
   De losse factuurtool volledig geïntegreerd (sectie 14): elke
   factuur is nu een IndexedDB-record gekoppeld aan customerId en
   optioneel eventId, in plaats van één losse conceptfactuur. De
   BTW-rekenmotor (utils.calculateInvoiceTotals) en de PDF-encoder
   (pdf.js) zijn 1-op-1 hergebruikt uit de losse tool.
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};
const utils = () => LachboxOS.utils;
const storage = () => LachboxOS.storage;
const state = () => LachboxOS.state;
const nav = () => LachboxOS.navigation;
const pdfEngine = () => LachboxOS.pdf;

/* ============================================================
   Factuurnummering — formaat jjjjmmnn, teller reset elke maand.
   Nu IndexedDB-backed (storage.getInvoiceCounter) i.p.v. één
   localStorage-sleutel, en met een extra controle tegen reeds
   bestaande factuurnummers (er bestaan nu meerdere facturen naast
   elkaar, niet meer één concept).
   ============================================================ */
function formatInvoiceNumber(year, month, seq){
  const prefix = (state().cache.settings.invoicing.prefix) || "";
  return `${prefix}${year}${utils().pad2(month)}${String(seq).padStart(2, "0")}`;
}
function parseInvoiceNumber(numberStr){
  const prefix = state().cache.settings.invoicing.prefix || "";
  const prefixPart = prefix ? prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") : "";
  const re = new RegExp(`^${prefixPart}(\\d{4})(\\d{2})(\\d+)$`);
  const m = (numberStr || "").trim().match(re);
  if (!m) return null;
  const month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return { year: parseInt(m[1], 10), month, seq: parseInt(m[3], 10) };
}
function periodKey(year, month){ return year * 12 + month; }

async function generateProvisionalInvoiceNumber(){
  const counter = await storage().getInvoiceCounter();
  const now = new Date();
  const year = now.getFullYear(), month = now.getMonth() + 1;
  let seq = (counter.year === year && counter.month === month) ? counter.lastNumber + 1 : 1;
  let candidate = formatInvoiceNumber(year, month, seq);
  const usedNumbers = new Set(state().cache.invoices.map(i => i.invoiceNumber));
  while (usedNumbers.has(candidate)){ seq++; candidate = formatInvoiceNumber(year, month, seq); }
  return candidate;
}

// Legt het nummer definitief vast in de teller. Wordt alleen aangeroepen bij
// een expliciete statusovergang weg van "concept", nooit automatisch.
async function commitInvoiceNumber(numberStr){
  const parsed = parseInvoiceNumber(numberStr);
  if (!parsed) return;
  const counter = await storage().getInvoiceCounter();
  const now = new Date();
  const currentPeriod = periodKey(now.getFullYear(), now.getMonth() + 1);
  let newCounter;
  if (parsed.year === counter.year && parsed.month === counter.month){
    newCounter = { year: counter.year, month: counter.month, lastNumber: Math.max(counter.lastNumber, parsed.seq) };
  } else if (periodKey(parsed.year, parsed.month) >= currentPeriod){
    newCounter = { year: parsed.year, month: parsed.month, lastNumber: parsed.seq };
  } else {
    newCounter = counter;
  }
  await storage().saveInvoiceCounter(newCounter);
}

/* ============================================================
   Weergavehelpers — gedeeld door de HTML-preview en de PDF-export.
   ============================================================ */
function getCustomerAddressLines(c){
  if (!c) return [];
  const lines = [];
  if (c.company && c.company.trim()) lines.push(c.company.trim());
  const personName = c.contactPerson && c.contactPerson.trim();
  if (personName) lines.push(c.company && c.company.trim() ? `t.n.v. ${personName}` : personName);
  const streetLine = [c.street, c.houseNumber].filter(s => s && s.trim()).join(" ").trim();
  if (streetLine) lines.push(streetLine);
  const cityLine = [c.postalCode, c.city].filter(s => s && s.trim()).join(" ").trim();
  if (cityLine) lines.push(cityLine);
  if (c.country && c.country.trim() && c.country.trim().toLowerCase() !== "nederland") lines.push(c.country.trim());
  return lines;
}

function getLineDisplayParts(l){
  const description = l.description || (l.type === "discount" ? "Korting" : "—");
  const subtextLines = [];
  if (l.subtext && l.subtext.trim()) subtextLines.push(l.subtext.trim());
  if (l.type === "discount" && l.discountMode === "percentage") subtextLines.push(`${l.discountValue}% korting`);
  let priceLabel;
  if (l.type === "item") priceLabel = `${l.qty} × ${utils().formatCurrency(l.price)}`;
  else if (l.discountMode === "percentage") priceLabel = "—";
  else priceLabel = utils().formatCurrency(-Math.abs(Number(l.discountValue) || 0));
  return { description, subtextLines, vatLabel: `${l.vatRate}%`, priceLabel, amountLabel: utils().formatCurrency(l.inclAmount) };
}

function buildEventLineText(event){
  if (!event) return "";
  const bits = [];
  if (event.eventType && event.eventType.trim()) bits.push(event.eventType.trim());
  if (event.date) bits.push(utils().formatDateDisplay(event.date));
  if (event.location && event.location.trim()) bits.push(event.location.trim());
  return bits.length ? "Evenement: " + bits.join(" — ") : "";
}

function buildPaymentText(invoice, company){
  const term = invoice.paymentTermDays || company.defaultPaymentTermDays;
  return `Gelieve binnen ${term} dagen te betalen op ${company.iban} ten name van ${company.name} onder vermelding van factuurnummer ${invoice.invoiceNumber || "(nog geen nummer)"}.`;
}

function invoiceIsOverdue(invoice){
  if (invoice.paymentStatus === "betaald" || !invoice.dueDate) return false;
  return invoice.dueDate < utils().todayISO();
}
function invoiceStatusLabel(invoice){
  if (invoice.paymentStatus === "betaald") return "Betaald";
  if (invoiceIsOverdue(invoice)) return "Verlopen";
  if (invoice.paymentStatus === "verstuurd") return "Verstuurd";
  return "Concept";
}
function invoiceStatusBadgeClass(invoice){
  if (invoice.paymentStatus === "betaald") return "badge-success";
  if (invoiceIsOverdue(invoice)) return "badge-danger";
  if (invoice.paymentStatus === "verstuurd") return "badge-warning";
  return "badge-info";
}

/* ============================================================
   Validatie
   ============================================================ */
function validateInvoice(invoice, customer){
  const errors = [];
  if (!customer || !((customer.company && customer.company.trim()) || (customer.contactPerson && customer.contactPerson.trim()))){
    errors.push("Kies of maak eerst een klant.");
  }
  if (!invoice.invoiceNumber || !invoice.invoiceNumber.trim()) errors.push("Factuurnummer ontbreekt.");
  if (!invoice.issueDate) errors.push("Factuurdatum ontbreekt.");
  const itemLines = invoice.lines.filter(l => l.type === "item");
  if (itemLines.length === 0) errors.push("Voeg minimaal één factuurregel toe.");
  invoice.lines.forEach((l, idx) => {
    if (l.type === "item"){
      if (!l.description || !l.description.trim()) errors.push(`Regel ${idx + 1}: omschrijving ontbreekt.`);
      if (isNaN(Number(l.price))) errors.push(`Regel ${idx + 1}: ongeldig bedrag.`);
      if (isNaN(Number(l.qty)) || Number(l.qty) <= 0) errors.push(`Regel ${idx + 1}: ongeldig aantal.`);
    } else if (isNaN(Number(l.discountValue))){
      errors.push("Korting: ongeldige waarde.");
    }
    if (isNaN(Number(l.vatRate)) || Number(l.vatRate) < 0) errors.push(`Regel ${idx + 1}: ongeldig BTW-percentage.`);
  });
  return errors;
}

/* ============================================================
   Factuur aanmaken (los, of vanuit een event — sectie 14)
   ============================================================ */
function buildDefaultLines(settings){
  const comp = Object.values(settings.components || {}).find(c => c.locked);
  if (!comp) return [];
  return [{ id: utils().uuid(), type: "item", locked: true, description: comp.name, subtext: comp.subtext || "", qty: 1, price: comp.price, priceMode: comp.priceMode, vatRate: comp.vatRate }];
}

async function createInvoice({ customerId, eventId }){
  const settings = state().cache.settings;
  const term = settings.invoicing.defaultPaymentTermDays;
  const number = await generateProvisionalInvoiceNumber();
  const invoice = {
    invoiceNumber: number, customerId, eventId: eventId || null,
    issueDate: utils().todayISO(), paymentTermDays: term,
    dueDate: utils().formatDateInputValue(utils().addDays(new Date(), term)),
    lines: buildDefaultLines(settings),
    subtotal: 0, vat: 0, total: 0,
    paymentStatus: "concept", paidDate: null, reference: number
  };
  const saved = await storage().saveInvoice(invoice);
  await state().refreshInvoices();
  return saved;
}

// Vanuit een event: klant, pakket, prijs, extra's en korting automatisch
// overgenomen; gebruiker controleert/vult aan in de editor voordat hij de
// factuur verstuurt (sectie 14: "laat de gebruiker alles controleren").
async function createInvoiceFromEvent(event){
  const settings = state().cache.settings;
  const term = settings.invoicing.defaultPaymentTermDays;
  const number = await generateProvisionalInvoiceNumber();
  const lines = [];
  if (event.package){
    const comp = Object.values(settings.components).find(c => c.name === event.package);
    lines.push({
      id: utils().uuid(), type: "item", description: event.package, subtext: comp ? (comp.subtext || "") : "",
      qty: 1, price: Number(event.price) || 0,
      priceMode: comp ? comp.priceMode : "incl", vatRate: comp ? comp.vatRate : settings.invoicing.defaultVatRate
    });
  }
  (event.extras || []).forEach(extra => {
    if (!extra.label && !extra.price) return;
    lines.push({ id: utils().uuid(), type: "item", description: extra.label || "Extra", subtext: "", qty: 1, price: Number(extra.price) || 0, priceMode: "incl", vatRate: settings.invoicing.defaultVatRate });
  });
  if (event.discount){
    lines.push({ id: utils().uuid(), type: "discount", description: "Korting", subtext: "", discountMode: "fixed", discountValue: Math.abs(Number(event.discount) || 0), priceMode: "incl", vatRate: settings.invoicing.defaultVatRate });
  }
  if (lines.length === 0) lines.push(...buildDefaultLines(settings));

  const invoice = {
    invoiceNumber: number, customerId: event.customerId, eventId: event.id,
    issueDate: utils().todayISO(), paymentTermDays: term,
    dueDate: utils().formatDateInputValue(utils().addDays(new Date(), term)),
    lines, subtotal: 0, vat: 0, total: 0,
    paymentStatus: "concept", paidDate: null,
    reference: event.eventName || event.eventType || number
  };
  const saved = await storage().saveInvoice(invoice);
  event.invoiceId = saved.id;
  await storage().saveEvent(event);
  await Promise.all([state().refreshInvoices(), state().refreshEvents()]);
  return saved;
}

/* ============================================================
   HTML A4-preview
   ============================================================ */
function renderInvoicePreview(root, invoice, customer, event, company){
  utils().clear(root);
  const calc = utils().calculateInvoiceTotals(invoice.lines);
  const make = utils().make;

  const header = make("div", "inv-header");
  const logoBlock = make("div", "inv-logo");
  if (company.logoUrl){
    const img = document.createElement("img");
    img.src = company.logoUrl; img.alt = company.name;
    logoBlock.appendChild(img);
  } else {
    logoBlock.textContent = company.name || "Lachbox";
  }
  header.appendChild(logoBlock);

  const titleBlock = make("div", "inv-title");
  titleBlock.appendChild(make("h1", null, "FACTUUR"));
  const metaLine = make("div", "inv-meta-line");
  const numB = document.createElement("b"); numB.textContent = invoice.invoiceNumber || "—";
  metaLine.appendChild(document.createTextNode("Factuurnr. "));
  metaLine.appendChild(numB);
  titleBlock.appendChild(metaLine);
  titleBlock.appendChild(make("div", "inv-meta-line", `Datum: ${utils().formatDateDisplay(invoice.issueDate) || "—"}`));
  header.appendChild(titleBlock);
  root.appendChild(header);

  const parties = make("div", "inv-parties");
  const toBlock = make("div", "inv-block to");
  toBlock.appendChild(make("div", "block-label", "Factuur aan"));
  const addrLines = getCustomerAddressLines(customer);
  if (addrLines.length === 0) toBlock.appendChild(make("div", "line empty-state", "Nog geen klant gekoppeld"));
  else addrLines.forEach(t => toBlock.appendChild(make("div", "line", t)));
  parties.appendChild(toBlock);

  const metaBlock = make("div", "inv-block meta");
  metaBlock.appendChild(make("div", "block-label", "Factuurgegevens"));
  const metaRows = [
    ["Factuurdatum", utils().formatDateDisplay(invoice.issueDate)],
    ["Vervaldatum", utils().formatDateDisplay(invoice.dueDate)],
    ["Betaaltermijn", invoice.paymentTermDays ? `${invoice.paymentTermDays} dagen` : ""]
  ];
  if (invoice.reference && invoice.reference.trim()) metaRows.push(["Referentie", invoice.reference.trim()]);
  metaRows.filter(([,v]) => v).forEach(([k,v]) => {
    const row = make("div", "meta-row");
    row.appendChild(make("span", "k", k));
    row.appendChild(make("span", "v", v));
    metaBlock.appendChild(row);
  });
  parties.appendChild(metaBlock);
  root.appendChild(parties);

  const eventLineText = buildEventLineText(event);
  if (eventLineText) root.appendChild(make("div", "inv-event-line", eventLineText));

  const table = document.createElement("table");
  table.className = "inv-table";
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  [["Omschrijving", ""], ["BTW", "num"], ["Prijs", "num"], ["Bedrag", "num"]].forEach(([txt, cls]) => {
    const th = document.createElement("th");
    if (cls) th.className = cls;
    th.textContent = txt;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = document.createElement("tbody");
  if (calc.lines.length === 0){
    const tr = document.createElement("tr");
    const td = document.createElement("td");
    td.colSpan = 4; td.className = "empty-state"; td.textContent = "Nog geen factuurregels toegevoegd.";
    tr.appendChild(td); tbody.appendChild(tr);
  } else {
    calc.lines.forEach(l => {
      const parts = getLineDisplayParts(l);
      const tr = document.createElement("tr");
      if (l.type === "discount") tr.className = "discount-row";
      const tdDesc = document.createElement("td");
      tdDesc.appendChild(make("div", "desc-main", parts.description));
      parts.subtextLines.forEach(sub => tdDesc.appendChild(make("div", "desc-sub", sub)));
      tr.appendChild(tdDesc);
      const tdVat = document.createElement("td"); tdVat.className = "num"; tdVat.textContent = parts.vatLabel; tr.appendChild(tdVat);
      const tdPrice = document.createElement("td"); tdPrice.className = "num"; tdPrice.textContent = parts.priceLabel; tr.appendChild(tdPrice);
      const tdAmount = document.createElement("td"); tdAmount.className = "num"; tdAmount.textContent = parts.amountLabel; tr.appendChild(tdAmount);
      tbody.appendChild(tr);
    });
  }
  table.appendChild(tbody);
  root.appendChild(table);

  const totalsWrap = make("div", "inv-totals");
  const box = make("div", "totals-box");
  const subRow = make("div", "totals-row");
  subRow.appendChild(make("span", "k", "Subtotaal excl. BTW"));
  subRow.appendChild(make("span", "v", utils().formatCurrency(calc.totalExcl)));
  box.appendChild(subRow);
  calc.vatBreakdown.forEach(v => {
    if (v.vatAmount === 0 && v.exclBase === 0) return;
    const row = make("div", "totals-row");
    row.appendChild(make("span", "k", `BTW ${v.rate}% over ${utils().formatCurrency(v.exclBase)}`));
    row.appendChild(make("span", "v", utils().formatCurrency(v.vatAmount)));
    box.appendChild(row);
  });
  const grandRow = make("div", "totals-row grand");
  grandRow.appendChild(make("span", null, "Totaal"));
  grandRow.appendChild(make("span", null, utils().formatCurrency(calc.totalIncl)));
  box.appendChild(grandRow);
  totalsWrap.appendChild(box);
  root.appendChild(totalsWrap);

  const footer = make("div", "inv-footer");
  const payment = make("div", "inv-payment");
  payment.appendChild(make("div", "pay-label", "Betaalinstructie"));
  payment.appendChild(make("div", null, buildPaymentText(invoice, company)));
  footer.appendChild(payment);
  const companyFooter = make("div", "inv-companyfooter");
  const bits = [company.name, [company.street, company.city].filter(Boolean).join(", "), "KvK " + company.kvk, "BTW " + company.vatNumber, company.iban].filter(Boolean);
  bits.forEach((b, i) => { if (i > 0) companyFooter.appendChild(document.createTextNode(" · ")); companyFooter.appendChild(document.createTextNode(b)); });
  footer.appendChild(companyFooter);
  root.appendChild(footer);

  return calc;
}

/* ============================================================
   PDF-export
   ============================================================ */
async function getPdfLogoImage(company){
  const url = company.logoUrl;
  if (!url || !url.startsWith("data:image/png;base64,")) return null;
  const pngBytes = pdfEngine().base64ToBytes(url.slice("data:image/png;base64,".length));
  const { width, height, rows } = await pdfEngine().decodePngToRows(pngBytes);
  const rgb = new Uint8Array(width * height * 3);
  const alpha = new Uint8Array(width * height);
  for (let y=0; y<height; y++){
    const row = rows[y];
    for (let x=0; x<width; x++){
      const si = x*4, di = x*3;
      rgb[y*width*3+di] = row[si]; rgb[y*width*3+di+1] = row[si+1]; rgb[y*width*3+di+2] = row[si+2];
      alpha[y*width+x] = row[si+3];
    }
  }
  return { width, height, rgb, alpha };
}

const PDF_MARGIN = 50;
function renderInvoicePdfOps(b, ctx){
  const PW = pdfEngine().PAGE_W, PH = pdfEngine().PAGE_H;
  const RIGHT_X = PW - PDF_MARGIN, COL_VAT = 400, COL_PRICE = 475, COL_AMOUNT = RIGHT_X, COL_DESC_END = COL_VAT - 15;
  const { company, addressLines, invoiceMeta, eventLine, lines, totals, paymentText, logo } = ctx;

  let logoBottom = PDF_MARGIN;
  if (logo){
    const h = 34, w = h * (logo.width / logo.height);
    b.image(PDF_MARGIN, PDF_MARGIN, w, h);
    logoBottom = PDF_MARGIN + h;
  } else {
    b.text(PDF_MARGIN, PDF_MARGIN + 16, company.name || "Lachbox", { font: "F2", size: 18 });
    logoBottom = PDF_MARGIN + 22;
  }
  b.text(RIGHT_X, PDF_MARGIN + 24, "FACTUUR", { font: "F2", size: 25, align: "right" });
  b.text(RIGHT_X, PDF_MARGIN + 40, `Factuurnr. ${invoiceMeta.number}`, { size: 9.5, align: "right", gray: 0.35 });
  b.text(RIGHT_X, PDF_MARGIN + 53, `Datum: ${invoiceMeta.dateDisplay}`, { size: 9.5, align: "right", gray: 0.35 });

  let y = Math.max(logoBottom, PDF_MARGIN + 53) + 32;
  const blockTop = y;
  b.text(PDF_MARGIN, y, "FACTUUR AAN", { size: 8, gray: 0.55, font: "F2" });
  let ly = y + 16;
  for (const ln of addressLines){ b.text(PDF_MARGIN, ly, ln, { size: 10.5, gray: 0.1 }); ly += 14; }

  b.text(RIGHT_X, blockTop, "FACTUURGEGEVENS", { size: 8, gray: 0.55, font: "F2", align: "right" });
  let ry = blockTop + 16;
  const metaRows = [["Factuurdatum", invoiceMeta.dateDisplay], ["Vervaldatum", invoiceMeta.dueDateDisplay], ["Betaaltermijn", invoiceMeta.paymentTermText]];
  if (invoiceMeta.reference) metaRows.push(["Referentie", invoiceMeta.reference]);
  for (const [k,v] of metaRows){ b.text(RIGHT_X, ry, `${k}: ${v}`, { size: 9.5, gray: 0.25, align: "right" }); ry += 14; }

  y = Math.max(ly, ry) + 10;
  if (eventLine){
    b.line(PDF_MARGIN, y, RIGHT_X, y, { gray: 0.85, width: 0.75 }); y += 14;
    b.text(PDF_MARGIN, y, eventLine, { size: 9, gray: 0.45 }); y += 8;
    b.line(PDF_MARGIN, y, RIGHT_X, y, { gray: 0.85, width: 0.75 }); y += 22;
  } else { y += 12; }

  b.text(PDF_MARGIN, y, "OMSCHRIJVING", { size: 8, gray: 0.55, font: "F2" });
  b.text(COL_VAT, y, "BTW", { size: 8, gray: 0.55, font: "F2", align: "right" });
  b.text(COL_PRICE, y, "PRIJS", { size: 8, gray: 0.55, font: "F2", align: "right" });
  b.text(COL_AMOUNT, y, "BEDRAG", { size: 8, gray: 0.55, font: "F2", align: "right" });
  y += 6; b.line(PDF_MARGIN, y, RIGHT_X, y, { gray: 0.1, width: 1 }); y += 16;

  if (lines.length === 0){ b.text(PDF_MARGIN, y, "Nog geen factuurregels toegevoegd.", { size: 10, gray: 0.6 }); y += 20; }

  for (const item of lines){
    const maxDescWidth = COL_DESC_END - PDF_MARGIN;
    const descLines = b.textWidth(item.description, "F2", 10.5) > maxDescWidth
      ? pdfEngine().pdfWrapText(item.description, maxDescWidth, "Helvetica-Bold", 10.5)
      : [item.description];
    for (let i=0;i<descLines.length;i++) b.text(PDF_MARGIN, y + i*13, descLines[i], { size: 10.5, gray: 0.1, font: "F2" });
    let rowBottom = y + (descLines.length-1)*13;
    b.text(COL_VAT, y, item.vatLabel, { size: 10, gray: 0.15, align: "right" });
    b.text(COL_PRICE, y, item.priceLabel, { size: 10, gray: 0.15, align: "right" });
    b.text(COL_AMOUNT, y, item.amountLabel, { size: 10, gray: 0.1, align: "right" });
    for (const sub of (item.subtextLines || [])){ rowBottom += 13; b.text(PDF_MARGIN, rowBottom, sub, { size: 8.5, gray: 0.5 }); }
    y = rowBottom + 12;
    b.line(PDF_MARGIN, y, RIGHT_X, y, { gray: 0.88, width: 0.6 }); y += 16;
  }

  const totalsX0 = RIGHT_X - 230;
  b.text(totalsX0, y, "Subtotaal excl. BTW", { size: 9.5, gray: 0.4 });
  b.text(COL_AMOUNT, y, utils().formatCurrency(totals.totalExcl), { size: 9.5, gray: 0.15, align: "right" });
  y += 15;
  for (const v of totals.vatBreakdown){
    if (v.vatAmount === 0 && v.exclBase === 0) continue;
    b.text(totalsX0, y, `BTW ${v.rate}% over ${utils().formatCurrency(v.exclBase)}`, { size: 9.5, gray: 0.4 });
    b.text(COL_AMOUNT, y, utils().formatCurrency(v.vatAmount), { size: 9.5, gray: 0.15, align: "right" });
    y += 15;
  }
  y += 4; b.line(totalsX0, y, RIGHT_X, y, { gray: 0.1, width: 1.1 }); y += 16;
  b.text(totalsX0, y, "Totaal", { size: 12.5, gray: 0, font: "F2" });
  b.text(COL_AMOUNT, y, utils().formatCurrency(totals.totalIncl), { size: 12.5, gray: 0, font: "F2", align: "right" });
  y += 34;

  b.text(PDF_MARGIN, y, "BETAALINSTRUCTIE", { size: 8, gray: 0.55, font: "F2" }); y += 14;
  y = b.paragraph(PDF_MARGIN, y, paymentText, RIGHT_X - PDF_MARGIN, { size: 9.5, gray: 0.15, lineHeight: 13 });

  const footerY = PH - 40;
  b.line(PDF_MARGIN, footerY - 14, RIGHT_X, footerY - 14, { gray: 0.85, width: 0.75 });
  const footerText = [company.name, company.addressLine, `KvK ${company.kvk}`, `BTW ${company.vatNumber}`, company.iban].filter(Boolean).join("   ·   ");
  b.text((PDF_MARGIN+RIGHT_X)/2, footerY, footerText, { size: 8, gray: 0.55, align: "center" });
}

function slugify(text){
  return (text || "").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function suggestedFilename(invoice, customer){
  const naam = customer ? (customer.company || customer.contactPerson || "Klant") : "Klant";
  return `Factuur_${invoice.invoiceNumber || "concept"}_${slugify(naam)}.pdf`;
}

async function downloadInvoicePdf(invoice, customer, event, company){
  const calc = utils().calculateInvoiceTotals(invoice.lines);
  const ctx = {
    company: { name: company.name, addressLine: [company.street, company.city].filter(Boolean).join(", "), kvk: company.kvk, vatNumber: company.vatNumber, iban: company.iban },
    addressLines: getCustomerAddressLines(customer),
    invoiceMeta: {
      number: invoice.invoiceNumber || "—", dateDisplay: utils().formatDateDisplay(invoice.issueDate),
      dueDateDisplay: utils().formatDateDisplay(invoice.dueDate),
      paymentTermText: invoice.paymentTermDays ? `${invoice.paymentTermDays} dagen` : "",
      reference: invoice.reference && invoice.reference.trim()
    },
    eventLine: buildEventLineText(event),
    lines: calc.lines.map(getLineDisplayParts),
    totals: { totalExcl: calc.totalExcl, totalVat: calc.totalVat, totalIncl: calc.totalIncl, vatBreakdown: calc.vatBreakdown },
    paymentText: buildPaymentText(invoice, company)
  };
  let logo = null;
  try{ logo = await getPdfLogoImage(company); }
  catch(e){ console.warn("Logo kon niet worden ingebed in de PDF, tekst-fallback gebruikt:", e); }

  const b = pdfEngine().createPdfContentBuilder(pdfEngine().PAGE_H);
  renderInvoicePdfOps(b, Object.assign({}, ctx, { logo }));
  const bytes = await pdfEngine().assemblePdf({ pageWidth: pdfEngine().PAGE_W, pageHeight: pdfEngine().PAGE_H, contentOps: b.ops, image: logo });
  pdfEngine().triggerBlobDownload(bytes, suggestedFilename(invoice, customer));
}

/* ============================================================
   Regel-editor (line cards) — 1-op-1 uit de losse tool, adapted om
   op een genest invoice.lines-array te werken i.p.v. globale state.
   ============================================================ */
function createEmptyLine(type, defaultVatRate){
  if (type === "discount"){
    return { id: utils().uuid(), type: "discount", description: "Korting", subtext: "", discountMode: "percentage", discountValue: 10, priceMode: "incl", vatRate: defaultVatRate };
  }
  return { id: utils().uuid(), type: "item", description: "", subtext: "", qty: 1, price: 0, priceMode: "incl", vatRate: defaultVatRate };
}

function buildLineCard(line, index, hooks){
  const u = utils();
  const card = u.make("div", "line-card" + (line.type === "discount" ? " discount" : ""));
  card.dataset.lineId = line.id;

  const head = u.make("div", "line-card-head");
  const badge = u.make("span", "line-type-badge", line.type === "discount" ? "Korting" : (line.locked ? "Vast onderdeel" : `Regel ${index + 1}`));
  head.appendChild(badge);
  const actions = u.make("div", "line-card-actions");
  const dupBtn = u.make("button", "icon-btn", "⧉"); dupBtn.type = "button"; dupBtn.title = "Dupliceren";
  dupBtn.addEventListener("click", () => hooks.onDuplicate(line.id));
  actions.appendChild(dupBtn);
  if (!line.locked){
    const delBtn = u.make("button", "icon-btn", "✕"); delBtn.type = "button"; delBtn.title = "Verwijderen";
    delBtn.addEventListener("click", () => hooks.onRemove(line.id));
    actions.appendChild(delBtn);
  }
  head.appendChild(actions);
  card.appendChild(head);

  const descField = u.make("div", "field");
  descField.appendChild(u.make("label", null, "Omschrijving"));
  const descInput = document.createElement("input");
  descInput.type = "text"; descInput.value = line.description;
  descInput.placeholder = line.type === "discount" ? "bijv. Seizoenskorting" : "bijv. Extra uur photobooth";
  descInput.addEventListener("input", () => { line.description = descInput.value; hooks.onFieldChange(); });
  descField.appendChild(descInput);
  card.appendChild(descField);

  const subField = u.make("div", "field");
  subField.appendChild(u.make("label", null, "Subtekst (optioneel)"));
  const subInput = document.createElement("input");
  subInput.type = "text"; subInput.value = line.subtext || "";
  subInput.addEventListener("input", () => { line.subtext = subInput.value; hooks.onFieldChange(); });
  subField.appendChild(subInput);
  card.appendChild(subField);

  const grid = u.make("div", "line-grid");

  function numberField(labelText, value, step, onChange){
    const field = u.make("div", "field");
    field.appendChild(u.make("label", null, labelText));
    const input = document.createElement("input");
    input.type = "number"; input.step = step; input.value = value;
    input.addEventListener("input", () => { onChange(input.value === "" ? "" : Number(input.value)); hooks.onFieldChange(); });
    field.appendChild(input);
    return field;
  }
  function vatModeToggle(){
    const field = u.make("div", "field span-2");
    field.appendChild(u.make("label", null, "Prijs is"));
    const toggle = u.make("div", "vat-mode-toggle");
    const inclBtn = u.make("button", line.priceMode === "incl" ? "active" : "", "Incl. BTW"); inclBtn.type = "button";
    const exclBtn = u.make("button", line.priceMode === "excl" ? "active" : "", "Excl. BTW"); exclBtn.type = "button";
    inclBtn.addEventListener("click", () => { line.priceMode = "incl"; hooks.onStructuralChange(); });
    exclBtn.addEventListener("click", () => { line.priceMode = "excl"; hooks.onStructuralChange(); });
    toggle.appendChild(inclBtn); toggle.appendChild(exclBtn);
    field.appendChild(toggle);
    return field;
  }
  function vatRateField(){
    const field = u.make("div", "field");
    field.appendChild(u.make("label", null, "BTW %"));
    const select = document.createElement("select");
    const presets = state().cache.settings.invoicing.vatRates.slice();
    const isPreset = presets.includes(Number(line.vatRate));
    presets.forEach(r => {
      const opt = document.createElement("option");
      opt.value = r; opt.textContent = r + "%";
      if (Number(line.vatRate) === r) opt.selected = true;
      select.appendChild(opt);
    });
    const customOpt = document.createElement("option");
    customOpt.value = "custom"; customOpt.textContent = "Aangepast…";
    if (!isPreset) customOpt.selected = true;
    select.appendChild(customOpt);
    field.appendChild(select);
    if (!isPreset){
      const customInput = document.createElement("input");
      customInput.type = "number"; customInput.step = "0.1"; customInput.style.marginTop = "6px"; customInput.value = line.vatRate;
      customInput.addEventListener("input", () => { line.vatRate = Number(customInput.value) || 0; hooks.onFieldChange(); });
      field.appendChild(customInput);
    }
    select.addEventListener("change", () => {
      if (select.value === "custom") line.vatRate = line.vatRate || 0;
      else line.vatRate = Number(select.value);
      hooks.onStructuralChange();
    });
    return field;
  }
  function discountModeField(){
    const field = u.make("div", "field");
    field.appendChild(u.make("label", null, "Type korting"));
    const select = document.createElement("select");
    [["percentage", "Percentage (%)"], ["fixed", "Vast bedrag (€)"]].forEach(([val, txt]) => {
      const opt = document.createElement("option");
      opt.value = val; opt.textContent = txt;
      if (line.discountMode === val) opt.selected = true;
      select.appendChild(opt);
    });
    select.addEventListener("change", () => { line.discountMode = select.value; hooks.onStructuralChange(); });
    field.appendChild(select);
    return field;
  }

  if (line.type === "item"){
    grid.appendChild(numberField("Aantal", line.qty, 1, v => line.qty = v));
    grid.appendChild(numberField("Prijs (€)", line.price, 0.01, v => line.price = v));
    grid.appendChild(vatModeToggle());
    grid.appendChild(vatRateField());
  } else {
    grid.appendChild(discountModeField());
    grid.appendChild(numberField(line.discountMode === "percentage" ? "Percentage (%)" : "Bedrag (€)", line.discountValue, 0.01, v => line.discountValue = v));
    if (line.discountMode === "fixed") grid.appendChild(vatModeToggle());
    else grid.appendChild(u.make("div"));
    grid.appendChild(vatRateField());
  }
  card.appendChild(grid);

  const amountRow = u.make("div", "amount-readout");
  amountRow.dataset.role = "line-amount";
  card.appendChild(amountRow);

  return card;
}

/* ============================================================
   Factuur-editorpagina
   ============================================================ */
function renderInvoiceEditorPage(container, params){
  const original = state().cache.invoices.find(i => i.id === params.id);
  if (!original){
    const page = utils().make("div", "page");
    const back = utils().make("a", "detail-back", "← Terug naar facturen");
    back.href = "#/invoices";
    page.appendChild(back);
    page.appendChild(utils().make("div", "empty-hint", "Deze factuur bestaat niet (meer)."));
    container.appendChild(page);
    return;
  }
  const invoice = JSON.parse(JSON.stringify(original));
  const settings = state().cache.settings;
  let saveTimer = null;

  function companyWithDefaults(){
    return Object.assign({}, settings.company, { defaultPaymentTermDays: settings.invoicing.defaultPaymentTermDays });
  }

  function renderReload(){ utils().clear(container); renderInvoiceEditorPage(container, params); }

  function currentCustomer(){ return state().getCustomerById(invoice.customerId); }
  function currentEvent(){ return invoice.eventId ? state().cache.events.find(e => e.id === invoice.eventId) : null; }

  async function persist(){
    const calc = utils().calculateInvoiceTotals(invoice.lines);
    invoice.subtotal = calc.totalExcl; invoice.vat = calc.totalVat; invoice.total = calc.totalIncl;
    await storage().saveInvoice(invoice);
    await state().refreshInvoices();
  }
  function scheduleSave(){ if (saveTimer) clearTimeout(saveTimer); saveTimer = setTimeout(persist, 500); }

  const page = utils().make("div", "page");
  const back = utils().make("a", "detail-back no-print", "← Terug naar facturen");
  back.href = "#/invoices";
  page.appendChild(back);

  const header = utils().make("div", "detail-header no-print");
  const titleWrap = utils().make("div");
  titleWrap.appendChild(utils().make("h1", "page-title", invoice.invoiceNumber || "Nieuwe factuur"));
  titleWrap.appendChild(utils().make("span", "badge " + LachboxOS.invoices.invoiceStatusBadgeClass(invoice), LachboxOS.invoices.invoiceStatusLabel(invoice)));
  header.appendChild(titleWrap);
  if (LachboxOS.email && invoice.customerId){
    const emailBtn = utils().make("button", "btn secondary small", "E-mail");
    emailBtn.type = "button";
    emailBtn.addEventListener("click", () => {
      const templateKey = invoiceIsOverdue(invoice) ? "betalingsherinnering" : "factuur_versturen";
      LachboxOS.email.openEmailGenerator({ customerId: invoice.customerId, eventId: invoice.eventId, invoiceId: invoice.id, templateKey });
    });
    header.appendChild(emailBtn);
  }
  const delBtn = utils().make("button", "btn danger small", "Factuur verwijderen");
  delBtn.type = "button";
  delBtn.addEventListener("click", async () => {
    const ok = await utils().askConfirm("Factuur verwijderen?", "Deze factuur wordt permanent verwijderd.");
    if (!ok) return;
    await storage().deleteInvoice(invoice.id);
    await state().refreshInvoices();
    utils().showToast("Factuur verwijderd.", "success");
    nav().navigateTo("invoices");
  });
  header.appendChild(delBtn);
  page.appendChild(header);

  const grid = utils().make("div", "invoice-editor-grid");
  const formCol = utils().make("div", "invoice-editor-form no-print");
  const previewCol = utils().make("div", "invoice-editor-preview");
  grid.appendChild(formCol); grid.appendChild(previewCol);
  page.appendChild(grid);
  container.appendChild(page);

  // Preview-DOM + refreshPreview() staan hier al, vóór de rest van het
  // formulier: de klant-picker hieronder roept zijn onChange-callback
  // synchroon aan tijdens het bouwen, dus refreshPreview() moet al bestaan.
  const filenameLine = utils().make("div", "field-hint");
  const previewWrapper = utils().make("div", "invoice-preview-wrapper");
  const previewA4 = utils().make("div", "a4");
  previewA4.id = "invoicePreview";
  previewWrapper.appendChild(previewA4);
  previewCol.appendChild(previewWrapper);
  function refreshPreview(){
    LachboxOS.invoices.renderInvoicePreview(previewA4, invoice, currentCustomer(), currentEvent(), companyWithDefaults());
    filenameLine.textContent = "Bestandsnaam: " + suggestedFilename(invoice, currentCustomer());
  }

  // ---- Klant ----
  const customerSection = utils().make("div", "section-card");
  customerSection.appendChild(utils().make("h2", "section-heading", "Klant"));
  const picker = LachboxOS.crm.buildCustomerPicker({
    initialCustomerId: invoice.customerId,
    onChange: v => { invoice.customerId = v; scheduleSave(); refreshPreview(); }
  });
  customerSection.appendChild(picker.el);
  formCol.appendChild(customerSection);

  // ---- Factuurgegevens ----
  const metaSection = utils().make("div", "section-card");
  metaSection.appendChild(utils().make("h2", "section-heading", "Factuurgegevens"));
  const numberField = utils().textField("Factuurnummer", invoice.invoiceNumber, v => { invoice.invoiceNumber = v; scheduleSave(); refreshPreview(); });
  if (invoice.paymentStatus !== "concept"){
    numberField._input.disabled = true;
    numberField.appendChild(utils().make("div", "field-hint", "Vastgelegd — alleen aan te passen als concept."));
  }
  metaSection.appendChild(utils().fieldRow(
    numberField,
    utils().textField("Factuurdatum", invoice.issueDate, v => { invoice.issueDate = v; scheduleSave(); refreshPreview(); }, { type: "date" })
  ));
  metaSection.appendChild(utils().fieldRow(
    utils().textField("Betaaltermijn (dagen)", invoice.paymentTermDays, v => {
      invoice.paymentTermDays = Number(v) || 0;
      if (invoice.issueDate) invoice.dueDate = utils().formatDateInputValue(utils().addDays(utils().parseDateInputValue(invoice.issueDate) || new Date(), invoice.paymentTermDays));
      scheduleSave(); refreshPreview(); renderReload();
    }, { type: "number" }),
    utils().textField("Vervaldatum", invoice.dueDate, v => { invoice.dueDate = v; scheduleSave(); refreshPreview(); }, { type: "date" })
  ));
  metaSection.appendChild(utils().textField("Referentie", invoice.reference, v => { invoice.reference = v; scheduleSave(); refreshPreview(); }));
  formCol.appendChild(metaSection);

  // ---- Onderdelen & regels ----
  const linesSection = utils().make("div", "section-card");
  linesSection.appendChild(utils().make("h2", "section-heading", "Onderdelen & factuurregels"));
  const componentSelect = document.createElement("select");
  componentSelect.className = "component-select-input";
  const placeholderOpt = document.createElement("option");
  placeholderOpt.value = ""; placeholderOpt.textContent = "+ Kies een onderdeel om toe te voegen…";
  componentSelect.appendChild(placeholderOpt);
  Object.keys(settings.components).forEach(key => {
    const comp = settings.components[key];
    const opt = document.createElement("option");
    opt.value = key; opt.textContent = `${comp.name} — ${utils().formatCurrency(comp.price)}`;
    componentSelect.appendChild(opt);
  });
  componentSelect.addEventListener("change", () => {
    if (!componentSelect.value) return;
    const comp = settings.components[componentSelect.value];
    invoice.lines.push({ id: utils().uuid(), type: "item", description: comp.name, subtext: comp.subtext || "", qty: 1, price: comp.price, priceMode: comp.priceMode, vatRate: comp.vatRate });
    componentSelect.value = "";
    scheduleSave(); renderLineEditors(); refreshPreview();
  });
  const componentWrap = utils().make("div", "component-select");
  componentWrap.appendChild(componentSelect);
  linesSection.appendChild(componentWrap);

  const linesList = utils().make("div", "lines-list");
  linesSection.appendChild(linesList);

  const addLineBtn = utils().make("button", "btn secondary small", "+ Regel toevoegen");
  addLineBtn.type = "button";
  addLineBtn.addEventListener("click", () => {
    invoice.lines.push(createEmptyLine("item", settings.invoicing.defaultVatRate));
    scheduleSave(); renderLineEditors(); refreshPreview();
  });
  const addDiscountBtn = utils().make("button", "btn secondary small", "+ Korting toevoegen");
  addDiscountBtn.type = "button";
  addDiscountBtn.addEventListener("click", () => {
    invoice.lines.push(createEmptyLine("discount", settings.invoicing.defaultVatRate));
    scheduleSave(); renderLineEditors(); refreshPreview();
  });
  const addRow = utils().make("div", "add-line-buttons");
  addRow.appendChild(addLineBtn); addRow.appendChild(addDiscountBtn);
  linesSection.appendChild(addRow);
  formCol.appendChild(linesSection);

  function renderLineEditors(){
    utils().clear(linesList);
    if (invoice.lines.length === 0){
      linesList.appendChild(utils().make("div", "empty-hint", "Nog geen factuurregels. Kies een onderdeel of voeg een regel toe."));
      return;
    }
    const hooks = {
      onFieldChange(){ scheduleSave(); refreshPreview(); },
      onStructuralChange(){ scheduleSave(); renderLineEditors(); refreshPreview(); },
      onRemove(id){
        const line = invoice.lines.find(l => l.id === id);
        if (line && line.locked){ utils().showToast("Dit onderdeel staat vast op de factuur en kan niet verwijderd worden.", "error"); return; }
        invoice.lines = invoice.lines.filter(l => l.id !== id);
        scheduleSave(); renderLineEditors(); refreshPreview();
      },
      onDuplicate(id){
        const idx = invoice.lines.findIndex(l => l.id === id);
        if (idx < 0) return;
        const copy = Object.assign({}, invoice.lines[idx], { id: utils().uuid(), locked: false });
        invoice.lines.splice(idx + 1, 0, copy);
        scheduleSave(); renderLineEditors(); refreshPreview();
      }
    };
    invoice.lines.forEach((line, idx) => linesList.appendChild(buildLineCard(line, idx, hooks)));
  }

  // ---- Acties ----
  const actionsSection = utils().make("div", "section-card invoice-actions");
  actionsSection.appendChild(filenameLine);
  const actionsRow = utils().make("div", "data-actions");

  const saveBtn = utils().make("button", "btn secondary", "Concept opslaan");
  saveBtn.type = "button";
  saveBtn.addEventListener("click", async () => { await persist(); utils().showToast("Concept opgeslagen.", "success"); });
  actionsRow.appendChild(saveBtn);

  if (invoice.paymentStatus === "concept"){
    const sendBtn = utils().make("button", "btn secondary", "Markeren als verstuurd");
    sendBtn.type = "button";
    sendBtn.addEventListener("click", async () => {
      const errors = LachboxOS.invoices.validateInvoice(invoice, currentCustomer());
      if (errors.length){ utils().showToast(errors.length === 1 ? errors[0] : `${errors.length} problemen: ${errors.join(" ")}`, "error"); return; }
      await commitInvoiceNumber(invoice.invoiceNumber);
      invoice.paymentStatus = "verstuurd";
      await persist();
      utils().showToast(`Factuur verstuurd. Nummer ${invoice.invoiceNumber} is vastgelegd.`, "success");
      renderReload();
    });
    actionsRow.appendChild(sendBtn);
  }
  if (invoice.paymentStatus !== "betaald"){
    const paidBtn = utils().make("button", "btn secondary", "Markeren als betaald");
    paidBtn.type = "button";
    paidBtn.addEventListener("click", () => openMarkPaidModal(invoice, async () => { await persist(); renderReload(); }));
    actionsRow.appendChild(paidBtn);
  }
  const printBtn = utils().make("button", "btn secondary", "Print");
  printBtn.type = "button";
  printBtn.addEventListener("click", () => {
    const errors = LachboxOS.invoices.validateInvoice(invoice, currentCustomer());
    if (errors.length){ utils().showToast(errors.length === 1 ? errors[0] : `${errors.length} problemen: ${errors.join(" ")}`, "error"); return; }
    const originalTitle = document.title;
    document.title = suggestedFilename(invoice, currentCustomer()).replace(/\.pdf$/i, "");
    window.print();
    setTimeout(() => { document.title = originalTitle; }, 500);
  });
  actionsRow.appendChild(printBtn);

  const downloadBtn = utils().make("button", "btn primary", "Download factuur (PDF)");
  downloadBtn.type = "button";
  downloadBtn.addEventListener("click", async () => {
    const errors = LachboxOS.invoices.validateInvoice(invoice, currentCustomer());
    if (errors.length){ utils().showToast(errors.length === 1 ? errors[0] : `${errors.length} problemen: ${errors.join(" ")}`, "error"); return; }
    downloadBtn.disabled = true;
    const originalLabel = downloadBtn.textContent;
    downloadBtn.textContent = "PDF genereren…";
    try{
      await LachboxOS.invoices.downloadInvoicePdf(invoice, currentCustomer(), currentEvent(), companyWithDefaults());
      utils().showToast("Factuur gedownload.", "success");
    }catch(e){
      console.error(e);
      utils().showToast("Downloaden mislukt: " + e.message, "error");
    }finally{
      downloadBtn.disabled = false; downloadBtn.textContent = originalLabel;
    }
  });
  actionsRow.appendChild(downloadBtn);

  actionsSection.appendChild(actionsRow);
  formCol.appendChild(actionsSection);

  renderLineEditors();
  refreshPreview();
}

function openMarkPaidModal(invoice, onDone){
  let paidDate = utils().todayISO();
  utils().openModal({
    title: "Markeren als betaald",
    build(body, modal){
      body.appendChild(utils().textField("Betaaldatum", paidDate, v => paidDate = v, { type: "date" }));
      const footer = utils().make("div", "modal-footer");
      const actions = utils().make("div", "modal-footer-actions");
      const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
      cancelBtn.type = "button"; cancelBtn.addEventListener("click", () => modal.close());
      const okBtn = utils().make("button", "btn primary small", "Bevestigen");
      okBtn.type = "button";
      okBtn.addEventListener("click", async () => {
        if (!paidDate){ utils().showToast("Vul een betaaldatum in.", "error"); return; }
        if (invoice.paymentStatus === "concept") await commitInvoiceNumber(invoice.invoiceNumber);
        invoice.paymentStatus = "betaald";
        invoice.paidDate = paidDate;
        modal.close();
        utils().showToast("Factuur gemarkeerd als betaald.", "success");
        await onDone();
      });
      actions.appendChild(cancelBtn); actions.appendChild(okBtn);
      footer.appendChild(actions);
      body.appendChild(footer);
    }
  });
}

/* ============================================================
   Facturen-overzicht / openstaande-facturenmonitor (sectie 15)
   ============================================================ */
const INVOICE_FILTER_KEY = "lachbox_os_invoices_filter";
const INVOICE_FILTERS = [
  { key: "all", label: "Alle" },
  { key: "concept", label: "Concept" },
  { key: "verstuurd", label: "Verstuurd" },
  { key: "betaald", label: "Betaald" },
  { key: "verlopen", label: "Verlopen" }
];

function renderInvoicesListPage(container){
  const page = utils().make("div", "page");
  const header = utils().make("div", "page-header");
  header.appendChild(utils().make("h1", "page-title", "Facturen"));
  const newBtn = utils().make("button", "btn primary", "+ Nieuwe factuur");
  newBtn.type = "button";
  newBtn.addEventListener("click", () => {
    utils().openModal({
      title: "Nieuwe factuur",
      build(body, modal){
        const picker = LachboxOS.crm.buildCustomerPicker({ autofocus: true });
        body.appendChild(picker.el);
        const footer = utils().make("div", "modal-footer");
        const actions = utils().make("div", "modal-footer-actions");
        const cancelBtn = utils().make("button", "btn secondary small", "Annuleren");
        cancelBtn.type = "button"; cancelBtn.addEventListener("click", () => modal.close());
        const okBtn = utils().make("button", "btn primary small", "Aanmaken");
        okBtn.type = "button";
        okBtn.addEventListener("click", async () => {
          const customerId = picker.getValue();
          if (!customerId){ utils().showToast("Kies of maak eerst een klant.", "error"); return; }
          const invoice = await createInvoice({ customerId });
          modal.close();
          nav().navigateTo("invoices/" + invoice.id);
        });
        actions.appendChild(cancelBtn); actions.appendChild(okBtn);
        footer.appendChild(actions);
        body.appendChild(footer);
      }
    });
  });
  header.appendChild(newBtn);
  page.appendChild(header);

  // ---- Samenvatting ----
  const invoices = state().cache.invoices;
  const openInvoices = invoices.filter(i => i.paymentStatus !== "betaald");
  const outstandingTotal = openInvoices.reduce((s, i) => s + (Number(i.total) || 0), 0);
  const overdueTotal = openInvoices.filter(i => LachboxOS.invoices.invoiceIsOverdue(i)).reduce((s, i) => s + (Number(i.total) || 0), 0);
  const soonTotal = openInvoices.filter(i => {
    if (!i.dueDate || LachboxOS.invoices.invoiceIsOverdue(i)) return false;
    const days = utils().daysBetween(utils().todayISO(), i.dueDate);
    return days != null && days <= 7;
  }).reduce((s, i) => s + (Number(i.total) || 0), 0);

  const summary = utils().make("div", "kpi-row invoice-summary-row");
  function summaryCard(label, value){
    const card = utils().make("div", "kpi-card");
    card.appendChild(utils().make("div", "kpi-label", label));
    card.appendChild(utils().make("div", "kpi-value", value));
    return card;
  }
  summary.appendChild(summaryCard("Openstaand", utils().formatCurrency(outstandingTotal)));
  summary.appendChild(summaryCard("Verlopen", utils().formatCurrency(overdueTotal)));
  summary.appendChild(summaryCard("Binnen 7 dagen", utils().formatCurrency(soonTotal)));
  page.appendChild(summary);

  const toolbar = utils().make("div", "toolbar");
  const searchInput = document.createElement("input");
  searchInput.type = "text"; searchInput.className = "search-input";
  searchInput.placeholder = "Zoek op klant of factuurnummer…";
  toolbar.appendChild(searchInput);
  page.appendChild(toolbar);

  const pillsRow = utils().make("div", "filter-pills");
  page.appendChild(pillsRow);
  const content = utils().make("div");
  page.appendChild(content);
  container.appendChild(page);

  let activeFilter = localStorage.getItem(INVOICE_FILTER_KEY) || "all";
  const pillButtons = {};
  INVOICE_FILTERS.forEach(f => {
    const btn = utils().make("button", "filter-pill", f.label);
    btn.type = "button";
    btn.addEventListener("click", () => { activeFilter = f.key; localStorage.setItem(INVOICE_FILTER_KEY, f.key); updatePills(); renderTable(); });
    pillButtons[f.key] = btn;
    pillsRow.appendChild(btn);
  });
  function updatePills(){ INVOICE_FILTERS.forEach(f => pillButtons[f.key].classList.toggle("active", f.key === activeFilter)); }

  function renderTable(){
    utils().clear(content);
    let rows = invoices.slice();
    if (activeFilter === "verlopen") rows = rows.filter(i => LachboxOS.invoices.invoiceIsOverdue(i));
    else if (activeFilter !== "all") rows = rows.filter(i => i.paymentStatus === activeFilter);
    const q = searchInput.value.trim().toLowerCase();
    if (q){
      rows = rows.filter(i => {
        const customer = state().getCustomerById(i.customerId);
        const hay = [i.invoiceNumber, state().customerDisplayName(customer)].filter(Boolean).join(" ").toLowerCase();
        return hay.includes(q);
      });
    }
    rows.sort((a,b) => (b.issueDate||"").localeCompare(a.issueDate||""));

    if (rows.length === 0){ content.appendChild(utils().make("div", "empty-hint", "Geen facturen gevonden.")); return; }
    const table = document.createElement("table");
    table.className = "data-table";
    const thead = document.createElement("thead");
    const headRow = document.createElement("tr");
    ["Factuurnummer", "Klant", "Factuurdatum", "Vervaldatum", "Bedrag", "Status", "Dagen"].forEach(h => headRow.appendChild(utils().make("th", null, h)));
    thead.appendChild(headRow); table.appendChild(thead);
    const tbody = document.createElement("tbody");
    rows.forEach(inv => {
      const customer = state().getCustomerById(inv.customerId);
      const tr = document.createElement("tr");
      tr.appendChild(utils().make("td", null, inv.invoiceNumber || "Concept"));
      tr.appendChild(utils().make("td", null, state().customerDisplayName(customer) || "—"));
      tr.appendChild(utils().make("td", "cell-muted", inv.issueDate ? utils().formatDateDisplay(inv.issueDate) : "—"));
      tr.appendChild(utils().make("td", "cell-muted", inv.dueDate ? utils().formatDateDisplay(inv.dueDate) : "—"));
      tr.appendChild(utils().make("td", "cell-num", utils().formatCurrency(inv.total || 0)));
      const statusTd = document.createElement("td");
      statusTd.appendChild(utils().make("span", "badge " + LachboxOS.invoices.invoiceStatusBadgeClass(inv), LachboxOS.invoices.invoiceStatusLabel(inv)));
      tr.appendChild(statusTd);
      const daysTd = document.createElement("td");
      if (inv.paymentStatus === "betaald"){
        daysTd.appendChild(utils().make("span", "cell-muted", "✓ Betaald"));
      } else if (inv.dueDate){
        const days = utils().daysBetween(utils().todayISO(), inv.dueDate);
        daysTd.appendChild(utils().make("span", days < 0 ? "cell-danger" : "cell-muted", days < 0 ? `${Math.abs(days)} dagen verlopen` : `Nog ${days} dagen`));
      } else {
        daysTd.appendChild(document.createTextNode("—"));
      }
      tr.appendChild(daysTd);
      tr.addEventListener("click", () => nav().navigateTo("invoices/" + inv.id));
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    content.appendChild(table);
  }
  searchInput.addEventListener("input", renderTable);
  updatePills();
  renderTable();
}

nav().registerRoute({ path: "invoices", label: "Facturen", icon: "▥", group: "Sales", render: (c) => renderInvoicesListPage(c) });
nav().registerRoute({ path: "invoices/:id", render: (c, params) => renderInvoiceEditorPage(c, params) });

LachboxOS.invoices = {
  generateProvisionalInvoiceNumber, commitInvoiceNumber, parseInvoiceNumber,
  createInvoice, createInvoiceFromEvent,
  invoiceStatusLabel, invoiceStatusBadgeClass, invoiceIsOverdue,
  renderInvoicePreview, downloadInvoicePdf, validateInvoice,
  getCustomerAddressLines, buildEventLineText, buildPaymentText
};

})();
