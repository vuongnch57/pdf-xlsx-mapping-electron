const { app, BrowserWindow, dialog, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { PDFDocument, rgb } = require("pdf-lib");
const pdfParse = require("pdf-parse");
const XLSX = require("xlsx");

let mainWindow;

app.whenReady().then(() => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 800,
    webPreferences: {
      nodeIntegration: true, // Allow using Node.js in the renderer process
      contextIsolation: false,
    },
  });

  mainWindow.loadURL(`file://${__dirname}/index.html`);

  mainWindow.on("closed", () => (mainWindow = null));
});

// Handle File Upload (from Renderer Process)
ipcMain.handle("select-files", async (event, type) => {
  const { filePaths } = await dialog.showOpenDialog({
    properties: ["openFile", ...(type === "pdf" ? ["multiSelections"] : [])],
    filters:
      type === "pdf"
        ? [{ name: "PDF Files", extensions: ["pdf"] }]
        : [{ name: "Excel Files", extensions: ["xlsm", "xlsx"] }],
  });

  return filePaths.length > 0 ? filePaths : null;
});

// Process PDF and XLSM Files
ipcMain.handle("process-files", async (event, pdfPaths, xlsmPath, platform) => {
  try {
    const combinedPdfDoc = await PDFDocument.create();

    for (const pdfPath of pdfPaths) {
      const pdfBuffer = fs.readFileSync(pdfPath);
      const workbook = XLSX.readFile(xlsmPath);

      // Extract Order IDs
      const data = await pdfParse(pdfBuffer);
      console.log("Extracted PDF Text:", data.text);
      let pagesText = data.text
        .split(/\n\s*\n/)
        .filter((page) => page.trim().length > 0);

      // Special handling for tiktok: merge pages without "Order ID:" or "TT số thứ tự :" with the next page that has one
      if (platform === "tiktok") {
        let mergedPages = [];
        let buffer = "";

        for (let i = 0; i < pagesText.length; i++) {
          const page = pagesText[i];
          const hasOrderId =
            page.includes("Order ID:") || page.includes("TT số thứ tự :");

          if (!hasOrderId) {
            buffer += (buffer ? "\n\n" : "") + page;
          } else {
            if (buffer) {
              mergedPages.push(buffer + "\n\n" + page);
              buffer = "";
            } else {
              mergedPages.push(page);
            }
          }
        }
        // If buffer remains at the end, push it as a page
        if (buffer) mergedPages.push(buffer);
        pagesText = mergedPages;
      }
      console.log("Pages Text:", pagesText);
      let orderIdsPerPage = [];
      for (let i = 0; i < pagesText.length; i++) {
        let orderId = null;
        // if(i > 15) {
        //   console.log(`page ${i + 1}`, pagesText[i]);
        // }
        const lines = pagesText[i].split("\n");
        for (let j = 0; j < lines.length; j++) {
          if (platform === "shopee") {
            const match = lines[j].match(/\b(\d[\w\d]+)\b/); // Order ID must start with a digit
            if (match && match[1].length === 14) {
              orderId = match[1];
              break;
            }
          } else {
            if (lines[j].includes("Order ID:")) {
              orderId = lines[j + 1];
              break;
            } else if (lines[j].includes("TT số thứ tự :")) {
              orderId = `${lines[j + 3]}_BEST`;
              break;
            }
          }
          if (orderId) break;
        }
        if (orderId) {
          orderIdsPerPage.push({ pageIndex: i, orderId });
        }
      }
      console.log("Order IDs per page:", orderIdsPerPage);
      // console.log("Final Extracted Order IDs:", orderIds);

      // Extract SKU mapping from XLSM
      const sheet = XLSX.utils.sheet_to_json(
        workbook.Sheets[workbook.SheetNames[0]],
        { header: 1 }
      );
      const skuMapping = {};
      for (let i = 3; i < sheet.length; i++) {
        const orderId = sheet[i][1]; // "Mã Đơn" column
        let skuCombos = [];

        if (orderId) {
          skuCombos.push(sheet[i][11]);
          for (let k = 1; k < 6; k++) {
            if (sheet[i + k][1]) {
              break;
            }
            if (sheet[i + k][11]) {
              skuCombos.push(sheet[i + k][11]);
            }
          }
          skuMapping[orderId] = skuCombos;
        }
      }

      const pdfDoc = await PDFDocument.load(pdfBuffer);
      const pages = pdfDoc.getPages();

      orderIdsPerPage.forEach(({ pageIndex, orderId }) => {
        const realOrderId = orderId.includes("BEST")
          ? orderId.split("_")[0]
          : orderId;
        if (realOrderId && skuMapping[realOrderId]) {
          let page = pages[pageIndex];
          if (!page) return;
          const skus = skuMapping[realOrderId];

          let { width, height } = page.getSize();
          // Define box position and size
          const boxPos =
            platform === "shopee" ? 230 : orderId.includes("BEST") ? 313 : 295;
          const boxX = orderId.includes("BEST") ? 12 : 10;
          const boxY = height - boxPos;
          const boxHeight = orderId.includes("BEST") ? 58 : 110; // Adjust height based on SKU count

          page.drawRectangle({
            x: boxX,
            y: boxY - boxHeight, // Align box properly
            width: orderId.includes("BEST") ? 190 : 200,
            height: boxHeight,
            color: rgb(1.0, 1.0, 1.0), // Light blue
            opacity: 1, // Transparency for blur effect
          });

          let textY = boxY - 10;

          skus.forEach((sku, skuIdx) => {
            page.drawText(`${skuIdx + 1}. ${sku.trim()}`, {
              x: boxX + 10,
              y: textY,
              size: 10,
              color: rgb(0, 0, 0),
            });
            textY -= 15;
          });
        }
      });

      // Copy all modified pages into the combined PDF
      const copiedPages = await combinedPdfDoc.copyPages(
        pdfDoc,
        pdfDoc.getPageIndices()
      );
      copiedPages.forEach((page) => combinedPdfDoc.addPage(page));
    }

    // Save modified PDF
    const hash = new Date().getTime();
    const outputPath = path.join(
      app.getPath("desktop"),
      `Invoices_${hash}.pdf`
    );
    fs.writeFileSync(outputPath, await combinedPdfDoc.save());
    return outputPath;
  } catch (error) {
    console.error("Processing error:", error);
    return null;
  }
});
