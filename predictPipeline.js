// ============================================================
// ANA İŞLEM HATTI (PIPELINE)
// ============================================================
function runPredictPipeline() {
  console.log("Pipeline başlatıldı (Fonksiyonel & Modüler Versiyon).");

  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const costCodes = loadCostCodes();

    // 1. Kaynak sayfaları oku
    const kasaSS = SpreadsheetApp.openById(KASA_SS_ID);
    const procSS = SpreadsheetApp.openById(PROC_SS_ID);

    const kasaSheet = kasaSS.getSheetByName("Data_Cash");
    const procSheet = procSS.getSheetByName("Data_Proc");
    const maliyetTahminSheet = getOrCreateSheet(ss, "MaliyetTahmin");

    if (!kasaSheet || !procSheet)
      throw new Error("Kaynak sayfalar yüklenemedi.");

    const kasaData = kasaSheet.getDataRange().getValues();
    const procData = procSheet.getDataRange().getValues();

    // 2. Mükerrer kaydı önlemek için hedef sayfadaki mevcut işlemId'leri (A sütunu) hafızaya al
    const mevcutTahminler =
      maliyetTahminSheet.getLastRow() > 0
        ? maliyetTahminSheet
            .getDataRange()
            .getValues()
            .slice(1)
            .map((r) => String(r[0]).trim())
        : [];
    const islenmisIdSet = new Set(mevcutTahminler);

    // ============================================================
    // FONKSİYON ÇAĞRILARI (Sadece veri döndürürler, sayfaya yazmazlar)
    // ============================================================
    const filtrelenmisSon200 = ornekGetir(kasaData, procData);
    const bekleyenler = harcamaGetir(kasaData, procData, islenmisIdSet);

    console.log(
      `Veriler hafızaya alındı. Bekleyen: ${bekleyenler.length}, Referans Örnek: ${filtrelenmisSon200.length}`,
    );

    if (bekleyenler.length === 0) {
      console.log("Tahmin edilecek yeni veri yok. Pipeline sonlandırıldı.");
      return;
    }

    // 3. Hafızada Tahminleme ve Gruplama (Batch) İşlemleri
    const batchSize = CONFIG.defaultBatchSize || 5;
    const nihaiYazilacakVeriler = [];
    const col = CONFIG.col;

    for (let i = 0; i < bekleyenler.length; i += batchSize) {
      const grup = bekleyenler.slice(i, i + batchSize);
      const prompt = buildBatchPrompt(grup, costCodes, filtrelenmisSon200);

      try {
        const raw = callGemini(prompt);
        const results = JSON.parse(raw);
        const sonucMap = {};

        if (Array.isArray(results)) {
          results.forEach((r) => {
            sonucMap[r.satir_no] = r;
          });
        }

        grup.forEach((item) => {
          const sonuc = sonucMap[item.rowNum];
          if (sonuc) {
            nihaiYazilacakVeriler.push([
              item.islemId,
              String(item.satir[col.kasa_aciklama]),
              sonuc.kategori,
              sonuc.guven,
            ]);
          } else {
            nihaiYazilacakVeriler.push([
              item.islemId,
              String(item.satir[col.kasa_aciklama]),
              "HATA: Model satırı atladı",
              "düşük",
            ]);
          }
        });
      } catch (batchError) {
        console.log(
          `Batch hatası, tekli işleme dönülüyor: ${batchError.message}`,
        );

        grup.forEach((item) => {
          const singlePrompt = buildPrompt(
            item.satir,
            costCodes,
            filtrelenmisSon200,
          );
          try {
            const rawSingle = callGemini(singlePrompt);
            const resSingle = JSON.parse(rawSingle);

            nihaiYazilacakVeriler.push([
              item.islemId,
              String(item.satir[col.kasa_aciklama]),
              resSingle.kategori,
              resSingle.guven,
            ]);
          } catch (singleError) {
            nihaiYazilacakVeriler.push([
              item.islemId,
              String(item.satir[col.kasa_aciklama]),
              `HATA: ${singleError.message}`,
              "düşük",
            ]);
          }
          Utilities.sleep(300);
        });
      }

      if (i + batchSize < bekleyenler.length) {
        Utilities.sleep(600);
      }
    }

    // 4. Nihai Sonuçları Tek Seferde "MaliyetTahmin" Sayfasına Yazma
    if (nihaiYazilacakVeriler.length > 0) {
      if (maliyetTahminSheet.getLastRow() === 0) {
        maliyetTahminSheet.appendRow([
          "işlemId",
          "kasa açıklaması",
          "tahmin değeri",
          "güven",
        ]);
      }

      const baslangicSatiri = maliyetTahminSheet.getLastRow() + 1;
      maliyetTahminSheet
        .getRange(baslangicSatiri, 1, nihaiYazilacakVeriler.length, 4)
        .setValues(nihaiYazilacakVeriler);

      console.log(
        `✅ İşlem başarıyla tamamlandı. ${nihaiYazilacakVeriler.length} kayıt 'MaliyetTahmin' sayfasına yazıldı.`,
      );
    }
  } catch (error) {
    console.error("Pipeline hatası:", error.toString());
    throw error;
  }
}
