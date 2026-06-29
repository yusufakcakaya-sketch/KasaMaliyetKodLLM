// ============================================================
// PROMPT OLUŞTUR
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
// API ÇAĞRISI
// ============================================================
function callGemini(prompt, attempt, test = false) {
  if (test === true) {
    console.log("🤖 [BYPASS MODU] API'ye gidilmedi, sahte yanıt üretiliyor...");
    // 1. ADIM: Regex'i hem 'satir_no' hem de 'satır_no' (Türkçe ı) destekleyecek ve esnek olacak şekilde güncelleyelim
    const satirNoEslenikleri = [...prompt.matchAll(/sat[iı]r_no:\s*(\d+)/gi)];
    let sahteBatchDizisi = [];

    if (satirNoEslenikleri.length > 0) {
      sahteBatchDizisi = satirNoEslenikleri.map((m) => {
        return {
          satir_no: parseInt(m[1]),
          kategori: "TEST_MALIYET_KODU",
          guven: "yüksek",
          aciklama: "Bypass modu ile başarılı simülasyon satırı.",
        };
      });
      return JSON.stringify(sahteBatchDizisi);
    }

    // 2. ADIM (GÜVENLİK DUVARI): Eğer regex yine de bulamazsa, prompt içinde kaç tane HARCAMA_0, HARCAMA_1 geçtiğini sayalım.
    // Sabit 4751 dönmek yerine, döngüdeki mevcut 'bekleyenler' satırlarını kurtaralım.
    else {
      console.warn(
        "⚠️ Regex yine bulamadı! Prompt içinde dinamik tarama yapılıyor...",
      );

      // Prompt'un alt kısmında gerçekten ne yazdığını görmek için son 1000 karakteri loglayalım:
      console.log(
        "Promptun SONU (Burada satır numaraları olmalı):",
        prompt.substring(prompt.length - 1000),
      );

      // Kaç tane harcama istendiğini prompt metninden kabaca çözelim
      const harcamaSayisiMac = prompt.match(/Aşağıdaki\s+(\d+)\s+harcamayı/i);
      const grupBoyutu = harcamaSayisiMac ? parseInt(harcamaSayisiMac[1]) : 5;

      // Hata almamak için geçici bir dizi dönelim ama logu inceleyip asıl sorunu (Adım 1'deki verinin gelmeme durumunu) çözeceğiz
      sahteBatchDizisi = [];
      for (let k = 0; k < grupBoyutu; k++) {
        sahteBatchDizisi.push({
          satir_no: 0, // Burası 0 olacağı için ana pipeline yine 'atladı' diyecektir, ama log bize ipucunu verecek!
          kategori: "TEST_MALIYET_KODU",
          guven: "yüksek",
          aciklama: "Fallback satırı",
        });
      }
      return JSON.stringify(sahteBatchDizisi);
    }
  }

  attempt = attempt || 1;
  const MAX_ATTEMPTS = 3;
  const RETRY_CODES = [429, 503]; // Sadece 429 ve 503 durumlarında tekrar denenecek

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${CONFIG.geminiModel}:generateContent?key=${CONFIG.geminiApiKey}`;

  // Kabaca token hesabı yapıp loglayalım (Karakter / 4)
  const tahminiToken = Math.round(prompt.length / 4);
  if (attempt === 1) {
    console.log(
      `ℹ️ API'ye istek gönderiliyor... (~${tahminiToken} girdi tokenı)`,
    );
  }

  const res = UrlFetchApp.fetch(url, {
    method: "POST",
    contentType: "application/json",
    muteHttpExceptions: true, // Hata kodlarını yakalamak için şart
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  const code = res.getResponseCode();
  const raw = res.getContentText();

  // 429 veya Sunucu Hataları Durumunda Exponential Backoff
  if (RETRY_CODES.includes(code)) {
    let hataDetayi = "";
    try {
      const parsedRaw = JSON.parse(raw);
      hataDetayi = parsedRaw.error?.message || raw;
    } catch (e) {
      hataDetayi = raw.substring(0, 200);
    }

    console.warn(`⚠️ HTTP ${code} Alındı! Detay: ${hataDetayi}`);

    if (attempt <= MAX_ATTEMPTS) {
      let wait = 0;

      // Hata koduna göre bekleme sürelerinin ayarlanması
      if (code === 503) {
        wait = 60000; // 503 için her zaman 1 dakika (60.000 ms)
      } else if (code === 429) {
        // 429 için sırasıyla 1, 2, 4 dakika (60.000, 120.000, 240.000 ms)
        if (attempt === 1) wait = 60000;
        else if (attempt === 2) wait = 120000;
        else if (attempt === 3) wait = 240000;
      }

      console.log(
        `⏳ ${attempt}. deneme başarısız. HTTP ${code} nedeniyle ${wait / 1000 / 60} dakika bekleniyor...`,
      );
      Utilities.sleep(wait);
      return callGemini(prompt, attempt + 1);
    }

    // Maksimum deneme aşılmasına rağmen çözülemediyse hata fırlatılır (pipeline bunu yakalayıp sayfaya basacak)
    throw new Error(
      `API Hata ${code} — ${MAX_ATTEMPTS} denemede çözülemedi. Mesaj: ${hataDetayi}`,
    );
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
