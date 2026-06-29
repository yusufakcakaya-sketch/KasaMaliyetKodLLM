// Kaynak dosya ID'leri
const PROC_SS_ID = "1lYBWsIfqriaox3H-y6M3irufpLibaw9KflPopPfScTI";

// ============================================================
// YARDIMCI: Sayfayı al, yoksa oluştur
// ============================================================
function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// ============================================================
// 4. PROMPT OLUŞTUR — Tek satır için
// ============================================================
function buildPrompt(satir, costCodes, son200Ornekler) {
  const col = CONFIG.col;

  const envanter = String(satir[col.envanter] || "-").trim();
  const kasaAcikl = String(satir[col.kasa_aciklama] || "-").trim();
  const satinAcikl = String(satir[col.satinalma_aciklama] || "-").trim();
  const firma = String(satir[col.firma] || "-").trim();
  const kullaniciTahmini = String(satir[col.kullanici_tahmini] || "").trim();

  const fewShotBlock =
    son200Ornekler && son200Ornekler.length > 0
      ? `\nGEÇMİŞ HARCAMALAR (doğrulanmış referanslar):\n` +
        son200Ornekler
          .map((ex, i) => {
            const cs = CONFIG.colSon200;
            const kat = String(ex[cs.kategori] || "").trim();
            const env = String(ex[cs.envanter] || "-").trim();
            const kas = String(ex[cs.kasa_aciklama] || "-").trim();
            const sat = String(ex[cs.satinalma_aciklama] || "-").trim();
            const frm = String(ex[cs.firma] || "-").trim();
            return `${i + 1}. ${env} | ${kas} | ${sat} | ${frm} → ${kat}`;
          })
          .join("\n") +
        "\n"
      : "";

  const ipucuBlogu = kullaniciTahmini
    ? `\nKullanıcı ipucu: "${kullaniciTahmini}" (muhasebe uzmanı değil, doğrula).\n`
    : "";

  return `Sen deneyimli bir inşaat maliyet kontrolörüsün. Harcamayı aşağıdaki listeden birine ata.

    MALİYET KODLARI:
    ${costCodes.join("\n")}
    ${fewShotBlock}
    TAHMİN EDİLECEK HARCAMA:
    - Envanter: ${envanter}
    - Kasa notu: ${kasaAcikl}
    - Satın alma: ${satinAcikl}
    - Firma: ${firma}
    ${ipucuBlogu}
    KURALLAR:
    1. Önce geçmiş harcamalarda aynı firma veya açıklamayı ara — varsa aynı kodu ver.
    2. Yoksa açıklamadan çıkar. %70 altı güvende "düşük" işaretle.
    3. Sadece listedeki kodlardan seç.

    YANIT (yalnızca JSON, başka metin yok):
    {"kategori":"...","guven":"yüksek/orta/düşük","aciklama":"tek cümle gerekçe"}`;
}

// ============================================================
// 5. PROMPT OLUŞTUR — Batch için (N satır birden)
// ============================================================
function buildBatchPrompt(satirlar, costCodes, son200Ornekler) {
  const col = CONFIG.col;

  const fewShotBlock =
    son200Ornekler && son200Ornekler.length > 0
      ? `\nGEÇMİŞ HARCAMALAR (doğrulanmış referanslar):\n` +
        son200Ornekler
          .map((ex, i) => {
            const cs = CONFIG.colSon200;
            const kat = String(ex[cs.kategori] || "").trim();
            const env = String(ex[cs.envanter] || "-").trim();
            const kas = String(ex[cs.kasa_aciklama] || "-").trim();
            const sat = String(ex[cs.satinalma_aciklama] || "-").trim();
            const frm = String(ex[cs.firma] || "-").trim();
            return `${i + 1}. ${env} | ${kas} | ${sat} | ${frm} → ${kat}`;
          })
          .join("\n") +
        "\n"
      : "";

  const satirListesi = satirlar
    .map((s, i) => {
      const env = String(s.satir[col.envanter] || "-").trim();
      const kas = String(s.satir[col.kasa_aciklama] || "-").trim();
      const sat = String(s.satir[col.satinalma_aciklama] || "-").trim();
      const frm = String(s.satir[col.firma] || "-").trim();
      const ipu = String(s.satir[col.kullanici_tahmini] || "").trim();
      return `HARCAMA_${i + 1} (satır_no: ${s.rowNum}):
  envanter: ${env} | kasa: ${kas} | satın_alma: ${sat} | firma: ${frm}${ipu ? ` | kullanıcı_ipucu: ${ipu}` : ""}`;
    })
    .join("\n");

  return `Sen deneyimli bir inşaat maliyet kontrolörüsün. Aşağıdaki ${satirlar.length} harcamayı sınıflandır.

    MALİYET KODLARI:
    ${costCodes.join("\n")}
    ${fewShotBlock}
    TAHMİN EDİLECEK HARCAMALAR:
    ${satirListesi}

    KURALLAR:
    1. Her harcama için geçmiş harcamalarda aynı firma/açıklama varsa aynı kodu ver.
    2. %70 altı güvende "düşük" işaretle. Sadece listeden seç.
    3. satır_no değerlerini olduğu gibi koru — sırayı değiştirme.

    YANIT (yalnızca JSON array, başka metin yok, tam ${satirlar.length} eleman):
    [
      {"satir_no":..., "kategori":"...","guven":"yüksek/orta/düşük","aciklama":"tek cümle"},
      ...
    ]`;
}

// ============================================================
// 6. GEMİNİ API ÇAĞRISI
// ============================================================
function callGemini(prompt, attempt) {
  attempt = attempt || 1;
  const MAX_ATTEMPTS = 3;
  const RETRY_CODES = [429, 500, 503];

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.geminiModel}:generateContent?key=${CONFIG.geminiApiKey}`;

  const res = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }, // Sınıflandırma için reasoning gereksiz
      },
    }),
  });

  const code = res.getResponseCode();
  const raw = res.getContentText();

  if (RETRY_CODES.includes(code)) {
    if (attempt < MAX_ATTEMPTS) {
      const wait = attempt * 10000;
      console.log(
        `⚠️ HTTP ${code} — ${attempt}. deneme, ${wait / 1000}s bekleniyor...`,
      );
      Utilities.sleep(wait);
      return callGemini(prompt, attempt + 1);
    }
    // Maksimum deneme bittikten sonra hata koduna göre spesifik mesaj fırlatıyoruz
    if (code === 429) {
      throw new Error("RATE_LIMIT");
    } else {
      throw new Error(
        `API Hata ${code} — ${MAX_ATTEMPTS} denemede çözülemedi.`,
      );
    }
  }

  if (code !== 200) throw new Error(`API Hata ${code}: ${raw}`);

  const json = JSON.parse(raw);
  const textRaw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!textRaw) throw new Error("Model boş yanıt döndürdü.");

  return textRaw
    .replace(/```json\s*/g, "")
    .replace(/```\s*/g, "")
    .trim();
}

// ============================================================
// 7. TAHMİN FONKSİYONU — Parametrik batch
//
//   batchSize = 0  → Tüm satırlar tek seferde (uyarı verir)
//   batchSize = N  → N'li gruplar halinde (önerilen: 5)
//   batchSize = 1  → Satır satır (en güvenli)
// ============================================================
function categorizeNewRows(batchSize) {
  if (batchSize === undefined) batchSize = CONFIG.defaultBatchSize;

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tahminSheet = ss.getSheetByName(CONFIG.sheets.tahminler);
  const son200Sheet = ss.getSheetByName(CONFIG.sheets.son200);

  if (!tahminSheet) {
    console.log("Tahminler sayfası bulunamadı.");
    return;
  }

  const costCodes = loadCostCodes();
  const col = CONFIG.col;

  // Son200 sayfasını oku (few-shot referanslar)
  const son200Rows =
    son200Sheet && son200Sheet.getLastRow() > 1
      ? son200Sheet.getDataRange().getValues().slice(1) // başlık satırını atla
      : [];

  console.log(
    `${costCodes.length} maliyet kodu, ${son200Rows.length} referans örnek yüklendi.`,
  );

  // Tahminler: G sütunu boş olan satırları topla
  const rows = tahminSheet.getDataRange().getValues();
  const bekleyenler = [];
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[col.kategori] || "").trim()) continue; // Dolu → atla
    if (!row[col.satinalma_aciklama] && !row[col.kasa_aciklama]) continue; // Açıklama yok → atla
    bekleyenler.push({ rowNum: i + 1, satir: row });
  }

  if (bekleyenler.length === 0) {
    console.log("Tahmin edilecek satır yok.");
    return;
  }

  // batchSize = 0 ise uyar ama çalıştır
  if (batchSize === 0) {
    console.log(
      `⚠️ UYARI: Toplu mod (batchSize=0). ${bekleyenler.length} satır tek seferde gönderiliyor.`,
    );
    console.log("   Hata olursa tüm batch yeniden gönderilmek zorunda kalır.");
    _processBatch(bekleyenler, costCodes, son200Rows, tahminSheet, col);
    return;
  }

  // N'li gruplara böl
  console.log(
    `Mod: ${batchSize === 1 ? "satır-satır" : batchSize + "'li batch"} | Toplam: ${bekleyenler.length} satır`,
  );
  let done = 0;

  for (let i = 0; i < bekleyenler.length; i += batchSize) {
    const grup = bekleyenler.slice(i, i + batchSize);

    // Tek elemanlı grup → tek satır promptu (daha verimli)
    const basarili =
      grup.length === 1
        ? _processSingle(grup[0], costCodes, son200Rows, tahminSheet, col)
        : _processBatch(grup, costCodes, son200Rows, tahminSheet, col);

    done += basarili;

    if (i + batchSize < bekleyenler.length) {
      Utilities.sleep(batchSize === 1 ? 300 : 600);
    }
  }

  console.log(`\nTamamlandı. Başarılı: ${done} / ${bekleyenler.length} satır.`);
}

// ============================================================
// İÇ: Tek satır işle
// ============================================================
function _processSingle(item, costCodes, son200Rows, sheet, col) {
  const prompt = buildPrompt(item.satir, costCodes, son200Rows);
  try {
    const raw = callGemini(prompt);
    const result = JSON.parse(raw);
    _yazSonuc(sheet, item.rowNum, result, col, costCodes);
    console.log(`✓ Satır ${item.rowNum}: ${result.kategori} (${result.guven})`);
    return 1;
  } catch (e) {
    if (e.message === "RATE_LIMIT") throw e;
    console.log(`✗ Satır ${item.rowNum}: ${e.message}`);
    _yazHata(sheet, item.rowNum, e.message, col);
    return 0;
  }
}

// ============================================================
// İÇ: N'li batch işle
// ============================================================
function _processBatch(grup, costCodes, son200Rows, sheet, col) {
  const prompt = buildBatchPrompt(grup, costCodes, son200Rows);
  let basarili = 0;

  try {
    const raw = callGemini(prompt);
    const results = JSON.parse(raw);

    if (!Array.isArray(results)) throw new Error("Model array döndürmedi.");

    // satir_no ile eşleştir
    const sonucMap = {};
    results.forEach((r) => {
      sonucMap[r.satir_no] = r;
    });

    grup.forEach((item) => {
      const sonuc = sonucMap[item.rowNum];
      if (!sonuc) {
        console.log(`⚠️ Satır ${item.rowNum}: Model yanıtta bulunamadı.`);
        _yazHata(sheet, item.rowNum, "Model bu satırı atladı", col);
        return;
      }
      _yazSonuc(sheet, item.rowNum, sonuc, col, costCodes);
      console.log(`✓ Satır ${item.rowNum}: ${sonuc.kategori} (${sonuc.guven})`);
      basarili++;
    });
  } catch (e) {
    if (e.message === "RATE_LIMIT") throw e;
    console.log(
      `✗ Batch (${grup.map((g) => g.rowNum).join(",")}): ${e.message}`,
    );
    console.log("  → Bu grubu satır-satır yeniden deniyorum...");

    // Batch başarısız → gruptaki her satırı tek tek dene (fallback)
    grup.forEach((item) => {
      try {
        basarili += _processSingle(item, costCodes, son200Rows, sheet, col);
        Utilities.sleep(300);
      } catch (e2) {
        if (e2.message === "RATE_LIMIT") throw e2;
      }
    });
  }

  return basarili;
}

// ============================================================
// İÇ: Sonucu sayfaya yaz
// ============================================================
function _yazSonuc(sheet, rowNum, result, col, costCodes) {
  const katCol = col.kategori + 1;
  const guvCol = col.guven + 1;
  const kategori = String(result.kategori || "").trim();
  const guven = String(result.guven || "düşük").trim();
  const aciklama = String(result.aciklama || "").trim();

  const gecerli = costCodes.some((c) => String(c).trim() === kategori);
  if (!gecerli) {
    sheet
      .getRange(rowNum, katCol)
      .setValue(`[GEÇERSİZ] ${kategori}`)
      .setBackground("#FFE0B2");
    sheet.getRange(rowNum, guvCol).setValue(guven);
    return;
  }

  const renk =
    guven === "yüksek" ? null : guven === "orta" ? "#FFF176" : "#FFCDD2";

  sheet.getRange(rowNum, katCol).setValue(kategori).setBackground(renk);
  sheet.getRange(rowNum, guvCol).setValue(`${guven} — ${aciklama}`);
}

// ============================================================
// İÇ: Hata durumunu sayfaya işaretle
// ============================================================
function _yazHata(sheet, rowNum, mesaj, col) {
  sheet
    .getRange(rowNum, col.guven + 1)
    .setValue(`HATA: ${mesaj}`)
    .setBackground("#EF9A9A");
}

// ============================================================
// 8. TAM AKIŞ — Aktar → Son200 → Kategorize
// ============================================================
function aktarVeKategorize(batchSize) {
  if (batchSize === undefined) batchSize = CONFIG.defaultBatchSize;

  console.log("=== Adım 1: Veri aktarımı (Kasa + Proc → Tahminler) ===");
  harcamalariAktar();

  console.log("\n=== Adım 2: Son200 referans sayfası güncelleniyor ===");
  guncelleSon200();

  console.log(`\n=== Adım 3: LLM Kategorileme (batchSize=${batchSize}) ===`);
  try {
    categorizeNewRows(batchSize);
  } catch (e) {
    if (e.message === "RATE_LIMIT") {
      console.log(
        "Rate limit aşıldı. Kalan satırlar bir sonraki çalıştırmada işlenecek.",
      );
    } else {
      throw e;
    }
  }
}

// ============================================================
// 9. MANUEL ÇALIŞTIRMA KISAYOLLARI
//    Apps Script editöründe bunları dropdown'dan seçebilirsiniz
// ============================================================

// Satır satır (en güvenli, en yavaş)
function kategorizeSatirSatir() {
  categorizeNewRows(1);
}

// 5'li batch (önerilen)
function kategorize5li() {
  categorizeNewRows(5);
}

// 10'lu batch
function kategorize10lu() {
  categorizeNewRows(10);
}

// Toplu (uyarı verir, riskli)
function kategorizeToplu() {
  categorizeNewRows(0);
}

// Tam akış, 5'li batch
function tamAkis() {
  aktarVeKategorize(5);
}

// ============================================================
// 10. TEK SATIR TESTİ
// ============================================================
function testSingleRow() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const tahminSheet = ss.getSheetByName(CONFIG.sheets.tahminler);
  const son200Sheet = ss.getSheetByName(CONFIG.sheets.son200);

  if (!tahminSheet) {
    console.log("Tahminler sayfası bulunamadı.");
    return;
  }

  const rows = tahminSheet.getDataRange().getValues();
  const item = rows.slice(1).find((r) => !r[CONFIG.col.kategori]);
  if (!item) {
    console.log("Test edilecek satır yok.");
    return;
  }

  const costCodes = loadCostCodes();
  const son200Rows =
    son200Sheet && son200Sheet.getLastRow() > 1
      ? son200Sheet.getDataRange().getValues().slice(1)
      : [];

  const prompt = buildPrompt(item, costCodes, son200Rows);
  const tokenTahmini = Math.round(prompt.length / 4);

  console.log(`Prompt: ${prompt.length} karakter, ~${tokenTahmini} token`);
  console.log("Son200 örnek sayısı:", son200Rows.length);
  console.log("=== PROMPT ===\n" + prompt);
  console.log("=== YANIT ===");

  try {
    const result = JSON.parse(callGemini(prompt));
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("Hata: " + e.message);
  }
}
