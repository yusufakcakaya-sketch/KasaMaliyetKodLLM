// const KASA_SS_ID = "1npepn6vDwHDIc03ORRg1UkGnDCUdAU0ZAtkjAUl2PR4";
const KASA_SS_ID = "1Ytfqlh3KAWGrvA5GHf6PvJN0IxzZe8deeiJwHeSpUbU"; //test

// ============================================================
// 1. MALİYET KODLARINI YÜKLE
// ============================================================
function loadCostCodes() {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    CONFIG.sheets.costCodes,
  );
  if (!sheet) throw new Error("CostCodes sayfası bulunamadı.");
  return sheet
    .getDataRange()
    .getValues()
    .flat()
    .map((k) => String(k).trim())
    .filter(Boolean);
}

// ============================================================
// 2. VERİ AKTARIMI — Kasa + Proc → Tahminler sayfası
//    J ↔ AC tam eşleşmesi ile çalışır.
//    Tahminler sayfasına daha önce eklenmiş kodlar tekrar eklenmez.
// ============================================================
function harcamalariAktar() {
  const kasaSS = SpreadsheetApp.openById(KASA_SS_ID);
  const procSS = SpreadsheetApp.openById(PROC_SS_ID);
  const hedefSS = SpreadsheetApp.getActiveSpreadsheet();

  const kasaSheet = kasaSS.getSheetByName("Data_Cash");
  const procSheet = procSS.getSheetByName("Data_Proc");
  const tahminSheet = getOrCreateSheet(hedefSS, CONFIG.sheets.tahminler);

  if (!kasaSheet) throw new Error("'Data_Cash' sayfası bulunamadı.");
  if (!procSheet) throw new Error("'Data_Proc' sayfası bulunamadı.");

  // Kasa: D ≠ "FİNANSAL HAREKET" VE E boş
  const kasaData = kasaSheet.getDataRange().getValues();
  const filtrelenmis = kasaData
    .slice(1)
    .filter(
      (r) =>
        String(r[3]).trim() !== "FİNANSAL HAREKET" &&
        String(r[4]).trim() === "",
    );

  if (filtrelenmis.length === 0) {
    console.log("Filtreye uyan kasa kaydı yok.");
    return;
  }

  // Kasa: J (index 9) → { kasaAciklama, firma }
  const kasaMap = {};
  filtrelenmis.forEach((r) => {
    const kod = String(r[9]).trim();
    if (kod) kasaMap[kod] = { kasaAciklama: r[1], firma: r[2] };
  });

  // Proc: AC (index 28) → { tahmin, envanter, satinAlma }
  const procData = procSheet.getDataRange().getValues();
  const procMap = {};
  procData.slice(1).forEach((r) => {
    const kod = String(r[28]).trim();
    if (kod && kasaMap.hasOwnProperty(kod)) {
      procMap[kod] = { tahmin: r[4], envanter: r[6], satinAlma: r[8] };
    }
  });

  // Tahminler sayfasında zaten olan J kodlarını topla (tekrar ekleme önlemi)
  // Kodu A sütununa değil, F sütununa (index 5) saklıyoruz — gizli anahtar
  const tahminData =
    tahminSheet.getLastRow() > 0 ? tahminSheet.getDataRange().getValues() : [];
  const mevcutKodlar = new Set(
    tahminData
      .slice(1)
      .map((r) => String(r[5] || "").trim())
      .filter(Boolean),
  );

  const eklenecek = [];
  Object.keys(kasaMap).forEach((kod) => {
    if (mevcutKodlar.has(kod)) {
      console.log(`⏭ Zaten mevcut: ${kod}`);
      return;
    }
    const proc = procMap[kod];
    if (!proc) return;

    eklenecek.push([
      proc.envanter, // A — envanter
      kasaMap[kod].kasaAciklama, // B — kasa açıklaması   ← kasaMap[kod] kullanılmalı
      proc.satinAlma, // C — satın alma açıklaması
      proc.tahmin, // D — kullanıcı tahmini
      kasaMap[kod].firma, // E — firma
      kod, // F — J/AC kodu (tekrar kontrol anahtarı)
      "", // G — kategori (LLM dolduracak)
      "", // H — güven (LLM dolduracak)
    ]);
  });

  // Düzeltme: B sütunu için kasaMap[kod] kullan
  const duzeltilmis = eklenecek.map((satir) => {
    // satir[1] zaten doğru (yukarıda kasaMap[kod].kasaAciklama)
    // Ama kod erişimi için closure yok, doğrudan yeniden hesaplayalım
    return satir;
  });

  if (eklenecek.length === 0) {
    console.log("Eklenecek yeni kayıt yok.");
    return;
  }

  // Başlık yoksa ekle
  if (tahminSheet.getLastRow() === 0) {
    tahminSheet.appendRow([
      "Envanter",
      "Kasa Açıklaması",
      "Satın Alma Açıklaması",
      "Kullanıcı Tahmini",
      "Firma",
      "Kod (Anahtar)",
      "Kategori",
      "Güven",
    ]);
  }

  const sonSatir = tahminSheet.getLastRow() + 1;
  tahminSheet.getRange(sonSatir, 1, eklenecek.length, 8).setValues(eklenecek);
  console.log(`✅ ${eklenecek.length} yeni kayıt Tahminler sayfasına eklendi.`);
}

// ============================================================
// SON200 SAYFASINI GÜNCELLE
//
// Kasa (Data_Cash) filtreleri:
//   - D sütunu "FİNANSAL HAREKET" OLMAYAN
//   - E sütunu DOLU (maliyet kodu atanmış)
//
// Bu satırların J kodu üzerinden Proc (Data_Proc) AC koduyla
// eşleştirilir, her iki kaynaktan veriler birleştirilerek
// harcamalariAktar() ile aynı formatta Son200 sayfasına yazılır.
//
// Son 200 kayıt alınır. Sayfa her çalıştırmada sıfırlanır.
// ============================================================
function guncelleSon200() {
  const kasaSS = SpreadsheetApp.openById(KASA_SS_ID);
  const procSS = SpreadsheetApp.openById(PROC_SS_ID);
  const hedefSS = SpreadsheetApp.getActiveSpreadsheet();

  const kasaSheet = kasaSS.getSheetByName("Data_Cash");
  const procSheet = procSS.getSheetByName("Data_Proc");
  const son200Sheet = getOrCreateSheet(hedefSS, CONFIG.sheets.son200);

  if (!kasaSheet) throw new Error("'Data_Cash' sayfası bulunamadı.");
  if (!procSheet) throw new Error("'Data_Proc' sayfası bulunamadı.");

  // --- Kasa: D ≠ "FİNANSAL HAREKET" VE E dolu ---
  const kasaData = kasaSheet.getDataRange().getValues();
  const filtrelenmis = kasaData.slice(1).filter(
    (r) =>
      String(r[3]).trim() !== "FİNANSAL HAREKET" && String(r[4]).trim() !== "", // E dolu = maliyet kodu var
  );

  if (filtrelenmis.length === 0) {
    console.log("Son200: Maliyet kodu atanmış kasa kaydı bulunamadı.");
    return;
  }

  // Kasa: J (index 9) → { kasaAciklama (B), firma (C), maliyetKodu (E) }
  const kasaMap = {};
  filtrelenmis.forEach((r) => {
    const kod = String(r[9]).trim();
    if (kod)
      kasaMap[kod] = {
        kasaAciklama: r[1],
        firma: r[2],
        maliyetKodu: r[4], // E — gerçek maliyet kodu (few-shot'ta kategori olarak kullanılacak)
      };
  });

  // Proc: AC (index 28) → { tahmin (E→4), envanter (G→6), satinAlma (I→8) }
  const procData = procSheet.getDataRange().getValues();
  const procMap = {};
  procData.slice(1).forEach((r) => {
    const kod = String(r[28]).trim();
    if (kod && kasaMap.hasOwnProperty(kod)) {
      procMap[kod] = {
        tahmin: r[4],
        envanter: r[6],
        satinAlma: r[8],
      };
    }
  });

  // --- Eşleşen satırları birleştir (harcamalariAktar ile aynı format) ---
  // Sütun sırası: A=envanter, B=kasaAcikl, C=satinAcikl, D=kullaniciTahmini,
  //               E=firma, F=kod(anahtar), G=kategori, H=güven
  const satirlar = [];
  Object.keys(kasaMap).forEach((kod) => {
    const kasa = kasaMap[kod];
    const proc = procMap[kod];
    if (!proc) return; // Proc'ta karşılığı yoksa atla

    satirlar.push([
      proc.envanter, // A
      kasa.kasaAciklama, // B
      proc.satinAlma, // C
      proc.tahmin, // D — kullanıcı tahmini
      kasa.firma, // E
      kasa.maliyetKodu, // F — kategori
    ]);
  });

  if (satirlar.length === 0) {
    console.log("Son200: Proc eşleşmesi bulunan kayıt yok.");
    return;
  }

  // Son 200'ü al (en güncel olanlar sona yazılmış varsayımıyla)
  const son200 = satirlar.slice(-CONFIG.son200Boyutu);

  // Sayfayı temizle ve yeniden yaz
  son200Sheet.clearContents();
  son200Sheet.appendRow([
    "Envanter",
    "Kasa Açıklaması",
    "Satın Alma Açıklaması",
    "Kullanıcı Tahmini",
    "Firma",
    "Kategori",
  ]);

  son200Sheet.getRange(2, 1, son200.length, 6).setValues(son200);

  console.log(
    `✅ Son200 güncellendi: ${son200.length} referans satır yazıldı (${satirlar.length} toplam eşleşmeden).`,
  );
}
