/* ============================================================
   LACHBOX OS — PDF
   Generieke, dependency-vrije PDF 1.4-encoder (geen library): eigen
   object/xref-writer, de standaard Helvetica/Helvetica-Bold basis-
   fonts (met echte AFM-glyfbreedtes voor uitlijning/woordomslag) en
   de Web Compression Streams API voor het comprimeren van content en
   afbeeldingen. Herbruikbaar voor elk A4-document (nu facturen,
   later eventueel offertes) — bevat zelf geen factuur-specifieke
   opmaak, zie daarvoor invoices.js.

   Direct 1-op-1 overgenomen uit de losse factuurtool, waar dit al
   uitgebreid getest is (echte PDF-viewer, tekstterugloop, logo met
   alfakanaal via SMask).
   ============================================================ */
(function(){
"use strict";

window.LachboxOS = window.LachboxOS || {};

function pdfNum(v){ return (Math.round(v * 1000) / 1000).toString(); }

function concatBytes(chunks){
  let total = 0;
  for (const c of chunks) total += c.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks){ out.set(c, off); off += c.length; }
  return out;
}

// Eén teken -> één byte (Latin-1/WinAnsi-bereik). Voor PDF-dictionaries/
// operators (pure ASCII) en voor al-WinAnsi-geëncodeerde tekststrings.
function strToBytes(str){
  const out = new Uint8Array(str.length);
  for (let i=0;i<str.length;i++) out[i] = str.charCodeAt(i) & 0xFF;
  return out;
}

async function pdfDeflate(bytes){
  const cs = new CompressionStream('deflate');
  const writer = cs.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
async function pdfInflate(bytes){
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(ds.readable).arrayBuffer());
}

function readUint32BE(bytes, off){
  return (bytes[off]<<24 | bytes[off+1]<<16 | bytes[off+2]<<8 | bytes[off+3]) >>> 0;
}

// Decodeert een 8-bit RGBA PNG (geen interlacing) naar ruwe pixelrijen.
// Alleen dit ene, voorspelbare formaat is nodig: het eigen logobestand.
async function decodePngToRows(pngBytes){
  if (!(pngBytes[0]===0x89 && pngBytes[1]===0x50 && pngBytes[2]===0x4E && pngBytes[3]===0x47)){
    throw new Error("Bestand is geen geldige PNG.");
  }
  let pos = 8, width=0, height=0, bitDepth=0, colorType=0;
  const idatChunks = [];
  while (pos < pngBytes.length){
    const length = readUint32BE(pngBytes, pos);
    const type = String.fromCharCode(pngBytes[pos+4], pngBytes[pos+5], pngBytes[pos+6], pngBytes[pos+7]);
    const data = pngBytes.slice(pos+8, pos+8+length);
    pos += 8 + length + 4;
    if (type === "IHDR"){
      width = readUint32BE(data, 0); height = readUint32BE(data, 4);
      bitDepth = data[8]; colorType = data[9];
    } else if (type === "IDAT"){
      idatChunks.push(data);
    } else if (type === "IEND"){
      break;
    }
  }
  if (bitDepth !== 8 || colorType !== 6){
    throw new Error("Alleen 8-bit RGBA PNG's worden ondersteund voor PDF-export.");
  }
  const raw = await pdfInflate(concatBytes(idatChunks));
  const bpp = 4, stride = width * bpp;
  let prev = new Uint8Array(stride);
  const rows = [];
  let p = 0;
  for (let y=0; y<height; y++){
    const ftype = raw[p]; p += 1;
    const row = raw.slice(p, p+stride); p += stride;
    if (ftype === 1){
      for (let i=bpp;i<stride;i++) row[i] = (row[i] + row[i-bpp]) & 0xFF;
    } else if (ftype === 2){
      for (let i=0;i<stride;i++) row[i] = (row[i] + prev[i]) & 0xFF;
    } else if (ftype === 3){
      for (let i=0;i<stride;i++){
        const a = i>=bpp ? row[i-bpp] : 0;
        row[i] = (row[i] + ((a+prev[i])>>1)) & 0xFF;
      }
    } else if (ftype === 4){
      for (let i=0;i<stride;i++){
        const a = i>=bpp ? row[i-bpp] : 0, bb = prev[i], c = i>=bpp ? prev[i-bpp] : 0;
        const pr0 = a+bb-c;
        const pa = Math.abs(pr0-a), pb = Math.abs(pr0-bb), pc = Math.abs(pr0-c);
        const pr = (pa<=pb && pa<=pc) ? a : (pb<=pc ? bb : c);
        row[i] = (row[i] + pr) & 0xFF;
      }
    }
    rows.push(row);
    prev = row;
  }
  return { width, height, rows };
}

// Standaard Adobe AFM-glyfbreedtes (in 1/1000 em) voor de basis-14 PDF-
// fonts Helvetica en Helvetica-Bold. Publiek/standaard lettertype-metadata,
// geen embedding nodig — elke PDF-viewer kent deze fonts intrinsiek.
const PDF_FONT_WIDTHS = {
  Helvetica: {
    32:278,33:278,34:355,35:556,36:556,37:889,38:667,39:191,40:333,41:333,
    42:389,43:584,44:278,45:333,46:278,47:278,
    48:556,49:556,50:556,51:556,52:556,53:556,54:556,55:556,56:556,57:556,
    58:278,59:278,60:584,61:584,62:584,63:556,64:1015,
    65:667,66:667,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:500,
    75:667,76:556,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,
    85:722,86:667,87:944,88:667,89:667,90:611,
    91:278,92:278,93:278,94:469,95:556,96:333,
    97:556,98:556,99:500,100:556,101:556,102:278,103:556,104:556,105:222,
    106:222,107:500,108:222,109:833,110:556,111:556,112:556,113:556,114:333,
    115:500,116:278,117:556,118:500,119:722,120:500,121:500,122:500,
    123:334,124:260,125:334,126:584,160:278,8364:556
  },
  "Helvetica-Bold": {
    32:278,33:333,34:474,35:556,36:556,37:889,38:722,39:238,40:333,41:333,
    42:389,43:584,44:278,45:333,46:278,47:278,
    48:556,49:556,50:556,51:556,52:556,53:556,54:556,55:556,56:556,57:556,
    58:333,59:333,60:584,61:584,62:584,63:611,64:975,
    65:722,66:722,67:722,68:722,69:667,70:611,71:778,72:722,73:278,74:556,
    75:722,76:611,77:833,78:722,79:778,80:667,81:778,82:722,83:667,84:611,
    85:722,86:667,87:944,88:667,89:667,90:611,
    91:333,92:278,93:333,94:584,95:556,96:333,
    97:556,98:611,99:556,100:611,101:556,102:333,103:611,104:611,105:278,
    106:278,107:556,108:278,109:889,110:611,111:611,112:611,113:611,114:389,
    115:556,116:333,117:611,118:556,119:778,120:556,121:556,122:500,
    123:389,124:280,125:389,126:584,160:278,8364:556
  }
};
const PDF_DEFAULT_CHAR_WIDTH = 556;

function pdfCharWidth(fontName, codePoint){
  const table = PDF_FONT_WIDTHS[fontName] || PDF_FONT_WIDTHS.Helvetica;
  return table[codePoint] != null ? table[codePoint] : PDF_DEFAULT_CHAR_WIDTH;
}
function pdfTextWidth(str, fontName, sizePt){
  let units = 0;
  for (let i=0;i<str.length;i++) units += pdfCharWidth(fontName, str.charCodeAt(i));
  return units / 1000 * sizePt;
}
// Woordomslag op echte glyfbreedtes, niet op een gok/gemiddelde.
function pdfWrapText(str, maxWidthPt, fontName, sizePt){
  const words = str.split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  for (const word of words){
    const candidate = current ? current + " " + word : word;
    if (pdfTextWidth(candidate, fontName, sizePt) > maxWidthPt && current){
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const PDF_WINANSI_SPECIAL = { 0x20AC:0x80, 0x2018:0x91, 0x2019:0x92, 0x201C:0x93, 0x201D:0x94, 0x2013:0x96, 0x2014:0x97 };
function toWinAnsiChar(codePoint){
  if (PDF_WINANSI_SPECIAL[codePoint] != null) return String.fromCharCode(PDF_WINANSI_SPECIAL[codePoint]);
  if (codePoint <= 0xFF) return String.fromCharCode(codePoint);
  return "?"; // niet-ondersteund teken (buiten Latin-1) — nette fallback i.p.v. corrupte PDF
}
function encodeWinAnsi(str){
  let out = "";
  for (let i=0;i<str.length;i++) out += toWinAnsiChar(str.charCodeAt(i));
  return out;
}
function escapePdfLiteral(str){
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

// Bouwt de content-stream (tekst/lijnen/afbeelding) voor één A4-pagina.
// Alle y-coördinaten die deze builder ontvangt zijn "vanaf de bovenkant"
// (zoals in CSS) en worden hier omgerekend naar PDF's coördinatenstelsel
// (oorsprong linksonder).
function createPdfContentBuilder(pageHeight){
  let ops = "";
  const fontName = (f) => f === "F2" ? "Helvetica-Bold" : "Helvetica";

  function text(x, yTop, str, { font = "F1", size = 10, align = "left", gray = 0 } = {}){
    const win = encodeWinAnsi(str);
    let x2 = x;
    if (align === "right") x2 = x - pdfTextWidth(win, fontName(font), size);
    else if (align === "center") x2 = x - pdfTextWidth(win, fontName(font), size) / 2;
    const y = pageHeight - yTop;
    ops += `${pdfNum(gray)} g\nBT /${font} ${pdfNum(size)} Tf ${pdfNum(x2)} ${pdfNum(y)} Td (${escapePdfLiteral(win)}) Tj ET\n`;
  }

  function paragraph(x, yTop, str, maxWidth, { font = "F1", size = 9.5, lineHeight = 12.5, gray = 0.15, align = "left" } = {}){
    const lines = pdfWrapText(str, maxWidth, fontName(font), size);
    let y = yTop;
    for (const ln of lines){ text(x, y, ln, { font, size, align, gray }); y += lineHeight; }
    return y;
  }

  function ruleLine(x1, yTop1, x2, yTop2, { width = 0.75, gray = 0.85 } = {}){
    const y1 = pageHeight - yTop1, y2 = pageHeight - yTop2;
    ops += `${pdfNum(gray)} G\n${pdfNum(width)} w\n${pdfNum(x1)} ${pdfNum(y1)} m ${pdfNum(x2)} ${pdfNum(y2)} l S\n`;
  }

  function image(x, yTop, w, h){
    const y = pageHeight - yTop - h;
    ops += `q ${pdfNum(w)} 0 0 ${pdfNum(h)} ${pdfNum(x)} ${pdfNum(y)} cm /Im0 Do Q\n`;
  }

  return {
    text, paragraph, line: ruleLine, image,
    textWidth: (str, font, size) => pdfTextWidth(encodeWinAnsi(str), fontName(font), size),
    get ops(){ return ops; }
  };
}

// Assembleert de losse onderdelen tot een geldig PDF 1.4-bestand: objecten,
// xref-tabel (met correcte byte-offsets) en trailer.
async function assemblePdf({ pageWidth, pageHeight, contentOps, image }){
  const OBJ_CATALOG = 1, OBJ_PAGES = 2, OBJ_PAGE = 3, OBJ_CONTENT = 4;
  const OBJ_FONT_REG = 5, OBJ_FONT_BOLD = 6, OBJ_IMAGE = 7, OBJ_SMASK = 8;
  const hasImage = !!image;

  const resourcesDict = hasImage
    ? `<< /Font << /F1 ${OBJ_FONT_REG} 0 R /F2 ${OBJ_FONT_BOLD} 0 R >> /XObject << /Im0 ${OBJ_IMAGE} 0 R >> >>`
    : `<< /Font << /F1 ${OBJ_FONT_REG} 0 R /F2 ${OBJ_FONT_BOLD} 0 R >> >>`;

  const contentCompressed = await pdfDeflate(strToBytes(contentOps));
  const parts = [];

  parts.push({ num: OBJ_CATALOG, bytes: strToBytes(`<< /Type /Catalog /Pages ${OBJ_PAGES} 0 R >>`) });
  parts.push({ num: OBJ_PAGES, bytes: strToBytes(`<< /Type /Pages /Kids [${OBJ_PAGE} 0 R] /Count 1 >>`) });
  parts.push({ num: OBJ_PAGE, bytes: strToBytes(
    `<< /Type /Page /Parent ${OBJ_PAGES} 0 R /MediaBox [0 0 ${pdfNum(pageWidth)} ${pdfNum(pageHeight)}] /Resources ${resourcesDict} /Contents ${OBJ_CONTENT} 0 R >>`
  ) });
  parts.push({ num: OBJ_CONTENT, bytes: concatBytes([
    strToBytes(`<< /Length ${contentCompressed.length} /Filter /FlateDecode >>\nstream\n`),
    contentCompressed,
    strToBytes(`\nendstream`)
  ]) });
  parts.push({ num: OBJ_FONT_REG, bytes: strToBytes(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`) });
  parts.push({ num: OBJ_FONT_BOLD, bytes: strToBytes(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>`) });

  if (hasImage){
    const rgbCompressed = await pdfDeflate(image.rgb);
    const alphaCompressed = await pdfDeflate(image.alpha);
    parts.push({ num: OBJ_IMAGE, bytes: concatBytes([
      strToBytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask ${OBJ_SMASK} 0 R /Length ${rgbCompressed.length} >>\nstream\n`),
      rgbCompressed, strToBytes(`\nendstream`)
    ]) });
    parts.push({ num: OBJ_SMASK, bytes: concatBytes([
      strToBytes(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alphaCompressed.length} >>\nstream\n`),
      alphaCompressed, strToBytes(`\nendstream`)
    ]) });
  }

  parts.sort((a,b) => a.num - b.num);

  const headerBytes = concatBytes([
    strToBytes(`%PDF-1.4\n%`), new Uint8Array([0xE2,0xE3,0xCF,0xD3]), strToBytes(`\n`)
  ]);

  const chunks = [headerBytes];
  const offsets = {};
  let running = headerBytes.length;
  for (const p of parts){
    offsets[p.num] = running;
    const objHead = strToBytes(`${p.num} 0 obj\n`), objTail = strToBytes(`\nendobj\n`);
    chunks.push(objHead, p.bytes, objTail);
    running += objHead.length + p.bytes.length + objTail.length;
  }

  const xrefOffset = running;
  const maxNum = Math.max(...parts.map(p => p.num));
  let xref = `xref\n0 ${maxNum+1}\n0000000000 65535 f \n`;
  for (let nObj=1; nObj<=maxNum; nObj++){
    const off = offsets[nObj];
    xref += off == null ? `0000000000 00000 f \n` : `${String(off).padStart(10,"0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${maxNum+1} /Root ${OBJ_CATALOG} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
  chunks.push(strToBytes(xref), strToBytes(trailer));

  return concatBytes(chunks);
}

function base64ToBytes(b64){
  const binStr = atob(b64);
  const bytes = new Uint8Array(binStr.length);
  for (let i=0;i<binStr.length;i++) bytes[i] = binStr.charCodeAt(i);
  return bytes;
}

function triggerBlobDownload(bytes, filename){
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

const PAGE_W = 595.28, PAGE_H = 841.89; // A4 portrait, in punten

LachboxOS.pdf = {
  PAGE_W, PAGE_H,
  assemblePdf, createPdfContentBuilder, decodePngToRows, pdfWrapText,
  base64ToBytes, triggerBlobDownload
};

})();
