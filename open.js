function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu("🤖 Maliyet Kodu")
    .addItem("Maliyet Kod Tahmini", "runPredictPipeline")
    .addToUi();
}
