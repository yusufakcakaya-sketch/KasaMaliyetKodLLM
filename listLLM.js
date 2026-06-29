// ============================================================
// MODEL KEŞİF VE KARŞILAŞTIRMA FONKSİYONLARI
// ============================================================

function listAvailableGeminiModels() {
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${CONFIG.geminiApiKey}`;
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });

  if (res.getResponseCode() !== 200) {
    console.log("Model listesi alınamadı: " + res.getContentText());
    return;
  }

  const models = JSON.parse(res.getContentText()).models || [];

  // Sadece generateContent destekleyenleri filtrele
  const eligible = models.filter((m) =>
    m.supportedGenerationMethods?.includes("generateContent"),
  );

  console.log(`\n=== KULLANILABİLİR MODELLER (${eligible.length} adet) ===\n`);
  eligible.forEach((m) => {
    console.log(`📌 ${m.name}`);
    console.log(`   Görünen ad : ${m.displayName}`);
    console.log(
      `   Input limit: ${m.inputTokenLimit?.toLocaleString() || "?"} token`,
    );
    console.log(
      `   Output limit: ${m.outputTokenLimit?.toLocaleString() || "?"} token`,
    );
    console.log("");
  });

  return eligible;
}

// ============================================================
// MODEL KIYASLAMA — Tek satır ile 3 modeli yarıştır
// ============================================================

const CANDIDATE_MODELS = [
  "gemini-2.0-flash-lite", // En ucuz, hızlı
  "gemini-2.0-flash", // Denge noktası (önerilen)
  "gemini-2.5-flash-preview-05-20", // Reasoning desteği var, biraz pahalı
];

function benchmarkModels() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.predictSheet);
  const rows = sheet.getDataRange().getValues();
  const costCodes = loadCostCodes();

  // Test için H sütunu DOLU bir satır seç (cevabını biliyoruz)
  const testRow = rows.slice(1).find((r) => r[CONFIG.col.kategori]);
  if (!testRow) {
    console.log("Test satırı bulunamadı.");
    return;
  }

  const dogruCevap = testRow[CONFIG.col.kategori];
  const prompt = buildPrompt(testRow, costCodes);

  console.log(`\n=== MODEL KIYASLAMASI ===`);
  console.log(`Doğru cevap: "${dogruCevap}"\n`);

  CANDIDATE_MODELS.forEach((model) => {
    const baslangic = Date.now();
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${CONFIG.geminiApiKey}`;
      const res = UrlFetchApp.fetch(url, {
        method: "POST",
        contentType: "application/json",
        muteHttpExceptions: true,
        payload: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0 },
        }),
      });

      const sure = ((Date.now() - baslangic) / 1000).toFixed(1);

      if (res.getResponseCode() !== 200) {
        console.log(`❌ ${model} — HTTP ${res.getResponseCode()} (${sure}s)`);
        return;
      }

      const json = JSON.parse(res.getContentText());
      const textRaw =
        json.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
      const cleaned = textRaw.replace(/```json|```/g, "").trim();
      const result = JSON.parse(cleaned);

      const dogru = result.kategori?.trim() === dogruCevap?.trim();
      const emoji = dogru ? "✅" : "⚠️";

      console.log(`${emoji} ${model}`);
      console.log(`   Süre    : ${sure}s`);
      console.log(`   Tahmin  : "${result.kategori}"`);
      console.log(`   Güven   : ${result.guven}`);
      console.log(
        `   Doğru mu: ${dogru ? "Evet" : "Hayır (beklenen: " + dogruCevap + ")"}`,
      );
      console.log("");
    } catch (e) {
      const sure = ((Date.now() - baslangic) / 1000).toFixed(1);
      console.log(`❌ ${model} — Hata: ${e.message} (${sure}s)\n`);
    }

    Utilities.sleep(1000); // rate limit arası
  });
}
