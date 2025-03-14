const { ipcRenderer } = require("electron");

document.getElementById("selectPdf").addEventListener("click", async () => {
  const pdfPaths = await ipcRenderer.invoke("select-files", "pdf");
  document.getElementById("pdfPath").textContent =
    pdfPaths ? pdfPaths.join(" - ") : "No file selected";
});

document.getElementById("selectXlsm").addEventListener("click", async () => {
  const xlsmPath = await ipcRenderer.invoke("select-files", "xlsm");
  document.getElementById("xlsmPath").textContent =
    xlsmPath || "No file selected";
});

document.getElementById("processFiles").addEventListener("click", async () => {
  const pdfPaths = document.getElementById("pdfPath").textContent.split(" - ");
  const xlsmPath = document.getElementById("xlsmPath").textContent;
  const platform = document.getElementById("platform").value;

  if (!pdfPaths || !xlsmPath) {
    alert("Please select both PDF and XLSM files.");
    return;
  }

  const outputPath = await ipcRenderer.invoke(
    "process-files",
    pdfPaths,
    xlsmPath,
    platform
  );
  if (outputPath) {
    document.getElementById(
      "outputMessage"
    ).textContent = `File saved: ${outputPath}`;
  } else {
    document.getElementById("outputMessage").textContent = "Processing failed.";
  }
});
