// ============================================================
// ANA İŞLEM HATTI (PIPELINE) 04.00-05.00 trigger.
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

    // Yazılacak İKİ hedef sayfa: aktif tablo + kasa tablosu
    const maliyetTahminSheet = getOrCreateSheet(ss, "MaliyetTahmin");
    const maliyetTahminSheetKasa = getOrCreateSheet(kasaSS, "MaliyetTahmin");

    if (!kasaSheet || !procSheet)
      throw new Error("Kaynak sayfalar yüklenemedi.");

    const kasaData = kasaSheet.getDataRange().getValues();
    const procData = procSheet.getDataRange().getValues();

    // 2. Mükerrer kaydı önlemek için hedef sayfadaki mevcut işlemId'leri (A sütunu) hafızaya al
    // NOT: Mükerrer kontrolünü iki sayfanın birleşimine göre yapıyoruz ki
    // herhangi birinde zaten yazılmış bir kayıt tekrar üretilmesin.
    const okuMevcutIdler = (sheet) =>
      sheet.getLastRow() > 0
        ? sheet
            .getDataRange()
            .getValues()
            .slice(1)
            .map((r) => String(r[0]).trim())
        : [];

    const mevcutTahminler = [
      ...okuMevcutIdler(maliyetTahminSheet),
      ...okuMevcutIdler(maliyetTahminSheetKasa),
    ];
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

    // Başlık satırı kontrolünü döngü öncesine alıyoruz (Eğer sayfa boşsa başlığı hemen yaz)
    const baslikYaz = (sheet) => {
      if (sheet.getLastRow() === 0) {
        sheet.appendRow([
          "İşlem ID",
          "Kasa Açıklaması",
          "Maliyet Kodu Tahmini",
          "Güven",
        ]);
      }
    };
    baslikYaz(maliyetTahminSheet);
    baslikYaz(maliyetTahminSheetKasa);

    // 3. Hafızada Tahminleme ve Gruplama (Batch) İşlemleri
    const batchSize = CONFIG.defaultBatchSize || 5;
    const col = CONFIG.col;
    let toplamYazilanKayit = 0; // İstatistik takibi için sayaç

    for (let i = 0; i < bekleyenler.length; i += batchSize) {
      const grup = bekleyenler.slice(i, i + batchSize);
      const prompt = buildBatchPrompt(grup, costCodes, filtrelenmisSon200);
      const nihaiYazilacakVeriler = []; // Her batch için listeyi sıfırlıyoruz

      try {
        const raw = callGemini(prompt, 1, false); // 3. parametre test modu bilgisi
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
            // Model ayakta ama bu satırı bir sebeple atladıysa: Tahmin boş, Güven sütununa sadece kod/etiket yazılır
            nihaiYazilacakVeriler.push([
              item.islemId,
              String(item.satir[col.kasa_aciklama]),
              "",
              "M_ATLA",
            ]);
          }
        });
      } catch (batchError) {
        console.error(
          "Batch hatası alındı, hata kodu ilgili satıra işleniyor...",
        );

        // Hata mesajı içinden sadece HTTP kodunu (örn: 404, 429 vb.) ayıklıyoruz
        const errorMsg = batchError.message || "";
        const codeMatch = errorMsg.match(
          /\b(400|401|403|404|429|500|503|504)\b/,
        );
        const sadeceKod = codeMatch ? `HTTP ${codeMatch[0]}` : "API_HATA";

        // API çöktüyse gruptaki tüm satırları e-tabloya "Tahmin Boş, Güven = Sadece Hata Kodu" şeklinde ekliyoruz
        grup.forEach((item) => {
          nihaiYazilacakVeriler.push([
            item.islemId,
            String(item.satir[col.kasa_aciklama]),
            "",
            sadeceKod,
          ]);
        });
      }

      // 4. Mevcut Batch Sonuçlarını ANLIK Olarak İKİ "MaliyetTahmin" Sayfasına da Yazma
      if (nihaiYazilacakVeriler.length > 0) {
        [maliyetTahminSheet, maliyetTahminSheetKasa].forEach((sheet) => {
          const baslangicSatiri = sheet.getLastRow() + 1;
          sheet
            .getRange(baslangicSatiri, 1, nihaiYazilacakVeriler.length, 4)
            .setValues(nihaiYazilacakVeriler);
        });

        toplamYazilanKayit += nihaiYazilacakVeriler.length;
        console.log(`.. ${nihaiYazilacakVeriler.length} kayıt işlendi.`);
        SpreadsheetApp.flush(); // Değişiklikleri hemen Google Sheets'e yansıtması için zorla
      }

      if (i + batchSize < bekleyenler.length) {
        Utilities.sleep(600);
      }
    }

    console.log(
      `✅ İşlem başarıyla tamamlandı. Toplam ${toplamYazilanKayit} kayıt her iki 'MaliyetTahmin' sayfasına da güvenle yazıldı.`,
    );
  } catch (error) {
    console.error("Pipeline hatası:", error.toString());
    throw error;
  }
}
