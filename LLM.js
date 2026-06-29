/**
 * ilgili envanter adı ve açıklamaları kullanarak LLM'den maliyet kodu tahmin etmesini ister.
 * dönüş değerini ilgili hücrelere yazar.
 * hata ya da bizim listemizde olmayan maliyet kodu ataması durumunda hücre boyaması yapar.
 */
// ============================================================
// AYARLAR
// ============================================================
const CONFIG = {
  geminiApiKey  : "AIzaSyCobTrq3fIcQSLovTLbS7X9GkMy3bOU2oY",
  geminiModel   : "gemini-3.1-flash-lite-preview",
  predictSheet  : "Harcamalar",
  categorySheet : "CostCodes",

  // Harcamalar sütun indeksleri (0'dan başlar)
  col: {
    envanter    : 0,
    kasa_acikl  : 1,
    satin_acikl : 2,
    kullaniciTahmini    : 3,  
    firma    : 4,  
    //(boş/başka veri)
    kategori    : 6,
    guven       : 7,
  }
};

// ============================================================
// 1. KATEGORİLERİ YÜKLE
// ============================================================

function loadCostCodes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.categorySheet);
  if (!sheet) throw new Error("CostCodes sayfası bulunamadı.");
  return sheet.getDataRange().getValues().flat().filter(k => String(k).trim() !== "");
}

// ============================================================
// 2. PROMPT OLUŞTUR
// ============================================================

function buildPrompt(row, costCodes) {
  const envanter   = row[CONFIG.col.envanter]    || "-";
  const kasaAcikl  = row[CONFIG.col.kasa_acikl]  || "-";
  const satinAcikl = row[CONFIG.col.satin_acikl] || "-";
  const firma = row[CONFIG.col.firma] || "-";
  const kullaniciTahmini = row[CONFIG.col.kullanici_tahmini] || null;

  return `Sen deneyimli bir inşaat maliyet kontrolörüsün. Görevin, belirsiz harcama açıklamalarını analiz ederek aşağıdaki verilern maliyet maliyet kodlarından (Cost Code) birine atamaktır.

MALİYET KODLARI LİSTESİ:
${costCodes.join("\n")}

ANALİZ EDİLECEK HARCAMA:
- Envanter Kalemi: ${envanter}
- Kasa Kayıt Notu: ${kasaAcikl}
- Satın Alma Detayı: ${satinAcikl}
- Firma Adı: ${firma}

Harcamayı giren kişi bu kalemin "${kullaniciTahmini}" kategorisine girebileceğini düşünüyor. Bu kişi muhasebe uzmanı değil, yanılıyor olabilir. Bu ipucunu dikkate al ama körü körüne güvenme.

KARAR SÜRECİN:
1. Önce açıklama ve firma bilgisinden harcamanın ne olduğunu anla.
2. Kullanıcı ipucunu değerlendir — destekliyorsa kullan, çelişiyorsa kendi kararını ver.
3. Yalnızca yukarıdaki maliyet kodları listesinden seç.
4. "aciklama" alanına kararının gerekçesini tek cümleyle yaz. Eğer hiçbir kod %70'ten fazla güvenle uymuyorsa, en yakın kodu seç ama "guven" alanını "düşük" işaretle.

YANIT FORMATI:
Sadece aşağıdaki JSON formatında yanıt ver. Başka hiçbir açıklama metni ekleme:
{
  "kategori": "...",
  "guven": "yüksek/orta/düşük",
  "aciklama": "Seçtiğin kodun diğer benzer kodlardan farkını belirten kısa açıklama"
}`;
}

// ============================================================
// 3. GEMİNİ ÇAĞRI
// ============================================================

function callGemini(prompt, attempt = 1) {
  const MAX_ATTEMPTS = 3;
  const RETRY_CODES  = [429, 500, 503];
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.geminiModel}:generateContent?key=${CONFIG.geminiApiKey}`;

  const res = UrlFetchApp.fetch(url, {
    method            : "POST",
    contentType       : "application/json",
    muteHttpExceptions: true,
    payload           : JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 }
    })
  });

  const code = res.getResponseCode();
  const raw  = res.getContentText();

  if (RETRY_CODES.includes(code)) {
    if (code === 429) throw new Error("RATE_LIMIT");
    if (attempt < MAX_ATTEMPTS) {
      const wait = attempt * 10000; // 10s, 20s
      console.log(`⚠️ Hata ${code} — ${attempt}. deneme, ${wait/1000}s bekleniyor...`);
      Utilities.sleep(wait);
      return callGemini(prompt, attempt + 1);
    }
    throw new Error(`API Hata ${code} — ${MAX_ATTEMPTS} denemede çözülemedi.`);
  }

  if (code !== 200) throw new Error(`API Hata ${code}: ${raw}`);

  const json    = JSON.parse(raw);
  const textRaw = json.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
  if (!textRaw) throw new Error("Model boş yanıt döndürdü.");

  const cleaned = textRaw.replace(/```json|```/g, "").trim();
  return JSON.parse(cleaned);
}

// ============================================================
// 4. ANA FONKSİYON — TAHMİN
// ============================================================

function categorizeNewRows() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.predictSheet);
  if (!sheet) { console.log("Harcamalar sayfası bulunamadı."); return; }

  const costCodes = loadCostCodes();
  console.log(`${costCodes.length} maliyet kodu yüklendi.`);

  const rows = sheet.getDataRange().getValues();
  const katCol   = CONFIG.col.kategori + 1;  // H (1-bazlı)
  const guvenCol = CONFIG.col.guven + 1;     // I (1-bazlı)
  let done = 0;

  for (let i = 1; i < rows.length; i++) {
    const row      = rows[i];
    const katMevcut = row[CONFIG.col.kategori];

    // H sütunu doluysa atla
    if (katMevcut) continue;

    // En az bir açıklama olmalı
    const satinAcikl = row[CONFIG.col.satin_acikl];
    const kasaAcikl  = row[CONFIG.col.kasa_acikl];    if (!satinAcikl && !kasaAcikl) continue;

    const prompt = buildPrompt(row, costCodes);
    const rowNum = i + 1;

    try {
      const result = callGemini(prompt);
      const { kategori, guven, aciklama } = result;

      // Kategori gerçekten listede var mı kontrol et
      const gecerli = costCodes.some(c => String(c).trim() === String(kategori).trim());
      if (!gecerli) {
        console.log(`⚠️ Satır ${rowNum}: Model listede olmayan kategori döndürdü → "${kategori}"`);
        sheet.getRange(rowNum, katCol).setValue(`[GEÇERSİZ] ${kategori}`).setBackground("#FFE0B2");
        sheet.getRange(rowNum, guvenCol).setValue(guven || "-");
        continue;
      }

      // Güvene göre renklendir
      const renk = guven === "yüksek" ? null : guven === "orta" ? "#FFF176" : "#FFCDD2";
      sheet.getRange(rowNum, katCol).setValue(kategori).setBackground(renk);
      sheet.getRange(rowNum, guvenCol).setValue(`${guven} — ${aciklama}`);

      done++;
      console.log(`✓ Satır ${rowNum}: ${kategori} (${guven})`);
      Utilities.sleep(500); // rate limit için

    } catch (e) {
      if (e.message === "RATE_LIMIT") {
        console.log("Rate limit. Duruyorum.");
        break;
      }
      console.log(`✗ Satır ${rowNum}: ${e.message}`);
    }
  }

  console.log(`Tamamlandı. İşlenen: ${done} satır.`);
}

// ============================================================
// 5. TEK SATIR TESTİ
// ============================================================

function testSingleRow() {
  const ss    = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.predictSheet);
  const rows  = sheet.getDataRange().getValues();

  // H sütunu boş olan ilk satırı bul
  const row = rows.slice(1).find(r => !r[CONFIG.col.kategori]);
  if (!row) { console.log("Test edilecek satır yok."); return; }

  const costCodes = loadCostCodes();
  const prompt    = buildPrompt(row, costCodes);

  console.log("=== PROMPT ===");
  console.log(prompt);
  console.log("=== YANIT ===");

  try {
    const result = callGemini(prompt);
    console.log(JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("Hata: " + e.message);
  }
}

// ============================================================
// 6. TRIGGER
// ============================================================

function createNightlyTrigger() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("categorizeNewRows")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .create();
  console.log("Gece trigger'ı kuruldu: Her gece 02:00");
}

function deleteAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  console.log("Tüm trigger'lar silindi.");
}