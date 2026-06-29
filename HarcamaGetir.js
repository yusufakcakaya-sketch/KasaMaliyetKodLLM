/**
 * Kasa dosyasındaki Data_Cash sayfasından;
 * - D sütunu "FİNANSAL İŞLEM" olmayanları
 * - E sütunu boş olanları filtreler.
 *
 * Filtrelenen satırların J sütunundaki kodları,
 * Proc dosyasındaki Data_Proc sayfasının AC sütununda arar.
 *
 * Eşleşen kayıtlardan şu verileri toplar:
 * - Proc → E (kullanıcı tahmini), G (envanter), I (satın alma açıklaması)
 * - Kasa → B (kasa açıklaması), C (firma)
 *
 * Toplanan verileri aktif dosyadaki Harcamalar sayfasına
 * mevcut verinin altına sırayla ekler.
 * Daha sonra LLM çalıştırılarak tahminleme yapılır.
 */

// =============================================
// YAPILANDIRMA — Sadece bu alanları doldurun
// =============================================
const KASA_SS_ID = "1npepn6vDwHDIc03ORRg1UkGnDCUdAU0ZAtkjAUl2PR4";
const PROC_SS_ID = "1lYBWsIfqriaox3H-y6M3irufpLibaw9KflPopPfScTI";
// =============================================

/**
 * TODO:
 * maliyet kodu atama işlemi şöyledir:
 * tüm maliyet kodları kasada verilir, günün sonunda o harcamalar finansa aktarılır.
 * Finans içerisinde maliyet kodu atama işlemi sadece POG için yapılır, istisnai bir durumdur.
 * yapılması gereken kontrol, finansa aktarım yapıldığında maliyet kodu aktarılmış mı?
 * eğer aktarılmamışsa farklı sayfalarda bu kendini belli eder.
 */
function harcamalariAktar() {
  // --- Kaynak sayfaları aç ---
  const kasaSS = SpreadsheetApp.openById(KASA_SS_ID);
  const procSS = SpreadsheetApp.openById(PROC_SS_ID);
  const hedefSS = SpreadsheetApp.getActiveSpreadsheet();

  const kasaSheet = kasaSS.getSheetByName("Data_Cash");
  const procSheet = procSS.getSheetByName("Data_Proc");
  const hedefSheet = hedefSS.getSheetByName("Harcamalar");

  if (!kasaSheet) throw new Error("'Data_Cash' sayfası bulunamadı.");
  if (!procSheet) throw new Error("'Data_Proc' sayfası bulunamadı.");
  if (!hedefSheet) throw new Error("'Harcamalar' sayfası bulunamadı.");

  // --- Kasa verisini çek ---
  const kasaData = kasaSheet.getDataRange().getValues();

  // Başlık satırını atla (1. satır), filtrele:
  //   D sütunu (index 3) "FİNANSAL HAREKET" OLMAYAN
  //   E sütunu (index 4) BOŞ olan
  const filtrelenmis = kasaData.slice(1).filter((row) => {
    const kolD = String(row[3]).trim();
    const kolE = String(row[4]).trim();
    return kolD !== "FİNANSAL HAREKET" && kolE === "";
  });

  if (filtrelenmis.length === 0) {
    SpreadsheetApp.getUi().alert("Filtreye uyan kayıt bulunamadı.");
    return;
  }

  // Kasa filtreli satırlardan J sütunu (index 9) kodlarını topla
  // Aynı zamanda B (index 1) ve C (index 2) verilerini eşle
  const kasaMap = {}; // kod → { kasaAciklama, firma }
  filtrelenmis.forEach((row) => {
    const kod = String(row[9]).trim();
    if (kod) {
      kasaMap[kod] = {
        kasaAciklama: row[1],
        firma: row[2],
      };
    }
  });

  // --- Proc verisini çek ---
  const procData = procSheet.getDataRange().getValues();

  // AC sütunu = index 28
  // E  sütunu = index 4  → kullanıcı tahmin
  // G  sütunu = index 6  → envanter
  // I  sütunu = index 8  → satın alma açıklaması
  const procMap = {}; // kod → { tahmin, envanter, satinAlma }
  procData.slice(1).forEach((row) => {
    const kod = String(row[28]).trim();
    if (kod && kasaMap.hasOwnProperty(kod)) {
      procMap[kod] = {
        tahmin: row[4],
        envanter: row[6],
        satinAlma: row[8],
      };
    }
  });

  // --- Harcamalar sayfasına eklenecek satırları hazırla ---
  const eklenecek = [];

  Object.keys(kasaMap).forEach((kod) => {
    const kasa = kasaMap[kod];
    const proc = procMap[kod];

    if (!proc) return; // Proc'ta eşleşme yoksa atla

    eklenecek.push([
      proc.envanter,
      kasa.kasaAciklama,
      proc.satinAlma,
      proc.tahmin,
      kasa.firma,
    ]);
  });

  if (eklenecek.length === 0) {
    console.log("Proc'ta eşleşen kayıt bulunamadı.");
    return;
  }

  // --- Mevcut verinin altına ekle ---
  const sonSatir = hedefSheet.getLastRow() + 1;
  hedefSheet
    .getRange(sonSatir, 1, eklenecek.length, eklenecek[0].length)
    .setValues(eklenecek);

  console.log(`✅ ${eklenecek.length} kayıt Harcamalar sayfasına eklendi.`);
}
