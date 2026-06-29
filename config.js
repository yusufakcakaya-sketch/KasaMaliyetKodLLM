// ============================================================
// YAPILANDIRMA
// ============================================================
const CONFIG = {
  geminiApiKey:
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY"),
  // geminiModel: "gemini-3.5-flash",
  geminiModel: "gemini-2.5-flash",

  sheets: {
    harcamalar: "Harcamalar", // Kaynak: tüm geçmiş + kategori dolu olanlar
    son200: "Son200", // Referans: LLM'e gönderilen few-shot örnekler
    tahminler: "Tahminler", // Hedef: LLM'in tahmin edeceği yeni satırlar
    costCodes: "CostCodes",
  },

  // Harcamalar / Son200 / Tahminler sütun indeksleri (0-bazlı, aynı format)
  col: {
    envanter: 0, // A
    kasa_aciklama: 1, // B
    satinalma_aciklama: 2, // C
    kullanici_tahmini: 3, // D
    firma: 4, // E
    //               : 5,  // F — boş
    kategori: 6, // G
    guven: 7, // H
  },

  colSon200: {
    envanter: 0, // A
    kasa_aciklama: 1, // B
    satinalma_aciklama: 2, // C
    kullanici_tahmini: 3, // D
    firma: 4, // E
    kategori: 5, // F
  },

  son200Boyutu: 200,
  defaultBatchSize: 5, // 0 = toplu, N = N'li gruplar
};
