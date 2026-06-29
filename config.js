// ============================================================
// YAPILANDIRMA
// ============================================================

const PROC_SS_ID = "1lYBWsIfqriaox3H-y6M3irufpLibaw9KflPopPfScTI";

// const KASA_SS_ID = "1npepn6vDwHDIc03ORRg1UkGnDCUdAU0ZAtkjAUl2PR4";
const KASA_SS_ID = "1Ytfqlh3KAWGrvA5GHf6PvJN0IxzZe8deeiJwHeSpUbU"; //test

const CONFIG = {
  geminiApiKey:
    PropertiesService.getScriptProperties().getProperty("GEMINI_API_KEY"),
  // geminiModel: "gemini-3.5-flash",
  geminiModel: "gemini-2.5-flash",
  geminiModel: "gemini-1.5-flash",
  // geminiModel: "gemini-2.0-flash",

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

  son200Boyutu: 20,
  defaultBatchSize: 50, // 0 = toplu, N = N'li gruplar
};
