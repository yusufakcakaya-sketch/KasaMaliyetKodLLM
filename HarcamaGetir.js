// ============================================================
// 2. VERİ AKTARIMI — Kasa + Proc → Filtrelenmiş Tahmin Edilecekler
//    J ↔ AC tam eşleşmesi ile çalışır.
//    Artık sayfaya yazmaz, doğrudan tahmin edilecek temiz veriyi RETURN eder.
// ============================================================
function harcamaGetir(kasaData, procData, islenmisIdSet) {
  // Maliyet kodu hariç harcamalar
  const filtrelenmis = kasaData.slice(1).filter(
    (r) =>
      String(r[3]).trim() !== "FİNANSAL HAREKET" &&
      String(r[3]).trim() !== "DÖVİZ-USD-LYD" &&
      String(r[4]).trim() === "", // E boş = maliyet kodu yok (tahmin edilecek)
  );

  if (filtrelenmis.length === 0) {
    console.log("Filtreye uyan kasa kaydı yok.");
    return [];
  }

  // Kasa: J (index 9) → { kasaAciklama, firma }
  const kasaMap = {};
  filtrelenmis.forEach((r) => {
    const kod = String(r[9]).trim();
    if (kod) kasaMap[kod] = { kasaAciklama: r[1], firma: r[2] };
  });

  // Proc: AC (index 28) → { tahmin, envanter, satinAlma }
  const procMap = {};
  procData.slice(1).forEach((r) => {
    const kod = String(r[28]).trim();
    if (kod && kasaMap.hasOwnProperty(kod)) {
      procMap[kod] = { tahmin: r[4], envanter: r[6], satinAlma: r[8] };
    }
  });

  const eklenecek = [];
  let eslesenSayisi = 0;
  let eslesmeyenSayisi = 0;

  // Kasa datasındaki orijinal satır takibi için index + 2 kullanıyoruz
  kasaData.slice(1).forEach((r, idx) => {
    const kod = String(r[9]).trim();
    if (!kod || !kasaMap[kod]) return;

    // Mükerrer kontrolü: MaliyetTahmin sayfasında zaten varsa atla
    if (islenmisIdSet.has(kod)) return;

    const proc = procMap[kod];

    if (proc) {
      eslesenSayisi++;
    } else {
      eslesmeyenSayisi++;
    }

    // Klasik formatta array yapısını oluştur ve sanal rowNum ekle
    eklenecek.push({
      rowNum: idx + 2,
      islemId: kod,
      satir: [
        proc ? proc.envanter : "-", // A — envanter
        kasaMap[kod].kasaAciklama, // B — kasa açıklaması
        proc ? proc.satinAlma : "-", // C — satın alma açıklaması
        proc ? proc.tahmin : "-", // D — kullanıcı tahmini
        kasaMap[kod].firma, // E — firma
      ],
    });
  });

  console.log(
    `Kasada tahmin edilecek veri sayısı=${filtrelenmis.length}, ` +
      `Tahmin edilecek verilerin proc karşılığı bulunan sayısı=${eslesenSayisi}, ` +
      `Proc karşılığı bulunamayan sayısı=${eslesmeyenSayisi}`,
  );

  return eklenecek;
}

// ============================================================
// SON200 VERİLERİNİ GETİR
//
// Kasa (Data_Cash) filtreleri ile maliyet kodu atanmış harcamaları
// J ve AC kodları üzerinden Proc ile eşleştirir.
// Artık sayfayı sıfırlayıp yazmaz, referans array'i RETURN eder.
// ============================================================
function ornekGetir(kasaData, procData) {
  // Maliyet kodu alan harcamalar
  const filtrelenmis = kasaData.slice(1).filter(
    (r) =>
      String(r[3]).trim() !== "FİNANSAL HAREKET" &&
      String(r[3]).trim() !== "DÖVİZ-USD-LYD" &&
      String(r[4]).trim() !== "", // E dolu = maliyet kodu var (doğrulanmış)
  );

  if (filtrelenmis.length === 0) {
    console.log("Son200: Maliyet kodu atanmış kasa kaydı bulunamadı.");
    return [];
  }

  // Kasa: J (index 9) → { kasaAciklama (B), firma (C), maliyetKodu (E) }
  const kasaMap = {};
  filtrelenmis.forEach((r) => {
    const kod = String(r[9]).trim();
    if (kod)
      kasaMap[kod] = {
        kasaAciklama: r[1],
        firma: r[2],
        maliyetKodu: r[4], // E — gerçek maliyet kodu (few-shot'ta kategori olacak)
      };
  });

  // Proc: AC (index 28) → { tahmin (E→4), envanter (G→6), satinAlma (I→8) }
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

  // --- Eşleşen satırları birleştir ---
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
      kasa.maliyetKodu, // F — kategori (maliyet kodu)
    ]);
  });

  // Son 200'ü sınırla ve geri döndür
  return satirlar.slice(-CONFIG.son200Boyutu);
}

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

function getOrCreateSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}
