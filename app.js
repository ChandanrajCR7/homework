const fileInput = document.querySelector("#file-input");
const dropzone = document.querySelector("#dropzone");
const fileArea = document.querySelector("#file-area");
const fileList = document.querySelector("#file-list");
const fileCount = document.querySelector("#file-count");
const clearButton = document.querySelector("#clear-button");
const convertButton = document.querySelector("#convert-button");
const convertLabel = document.querySelector("#convert-label");
const pageSizeSelect = document.querySelector("#page-size");
const statusMessage = document.querySelector("#status-message");

const images = [];
let nextImageId = 0;
let isConverting = false;

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function setStatus(message, isError = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("is-error", isError);
}

function renderFiles() {
  fileList.replaceChildren();
  fileArea.hidden = images.length === 0;
  fileCount.textContent = `${images.length} ${images.length === 1 ? "image" : "images"} selected`;
  convertButton.disabled = images.length === 0 || isConverting;

  for (const image of images) {
    const item = document.createElement("li");
    item.className = "file-item";

    const preview = document.createElement("img");
    preview.className = "file-preview";
    preview.src = image.url;
    preview.alt = "";

    const details = document.createElement("div");
    details.className = "file-details";
    const name = document.createElement("div");
    name.className = "file-name";
    name.textContent = image.file.name;
    const size = document.createElement("div");
    size.className = "file-size";
    size.textContent = formatFileSize(image.file.size);
    details.append(name, size);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-file";
    remove.setAttribute("aria-label", `Remove ${image.file.name}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => removeImage(image.id));

    item.append(preview, details, remove);
    fileList.append(item);
  }
}

function removeImage(id) {
  const index = images.findIndex((image) => image.id === id);
  if (index === -1) return;
  URL.revokeObjectURL(images[index].url);
  images.splice(index, 1);
  renderFiles();
  setStatus("");
}

function addFiles(fileCollection) {
  const files = Array.from(fileCollection);
  const imageFiles = files.filter((file) => file.type.startsWith("image/"));
  const rejectedCount = files.length - imageFiles.length;

  for (const file of imageFiles) {
    images.push({ id: nextImageId++, file, url: URL.createObjectURL(file) });
  }

  renderFiles();
  if (rejectedCount > 0) {
    setStatus(`${rejectedCount} unsupported ${rejectedCount === 1 ? "file was" : "files were"} skipped. Choose image files.`, true);
  } else if (imageFiles.length > 0) {
    setStatus("");
  }
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function joinBytes(chunks) {
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function imageToJpeg(file) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      if (!context) {
        reject(new Error(`Could not process ${file.name}.`));
        return;
      }
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);
      const binary = atob(dataUrl.slice(dataUrl.indexOf(",") + 1));
      const jpeg = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        jpeg[index] = binary.charCodeAt(index);
      }
      resolve({ width: canvas.width, height: canvas.height, bytes: jpeg });
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error(`Could not read ${file.name}. Try another image.`));
    };
    image.src = objectUrl;
  });
}

async function createPdf() {
  const paperSizes = {
    a4: [595.28, 841.89],
    letter: [612, 792],
  };
  const [pageWidth, pageHeight] = paperSizes[pageSizeSelect.value];
  const selectedFiles = images.map((image) => image.file);
  const pageObjects = [];
  const objectBytes = [];

  objectBytes[1] = ascii("<< /Type /Catalog /Pages 2 0 R >>");

  for (let index = 0; index < selectedFiles.length; index += 1) {
    setStatus(`Preparing image ${index + 1} of ${selectedFiles.length}…`);
    const raster = await imageToJpeg(selectedFiles[index]);
    const imageObjectNumber = 5 + index * 3;
    const pageObjectNumber = 3 + index * 3;
    const contentObjectNumber = 4 + index * 3;
    const margin = 30;
    const scale = Math.min(
      (pageWidth - margin * 2) / raster.width,
      (pageHeight - margin * 2) / raster.height,
    );
    const drawWidth = raster.width * scale;
    const drawHeight = raster.height * scale;
    const x = (pageWidth - drawWidth) / 2;
    const y = (pageHeight - drawHeight) / 2;
    const content = ascii(`q ${drawWidth.toFixed(3)} 0 0 ${drawHeight.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm /Im0 Do Q`);

    pageObjects.push(`${pageObjectNumber} 0 R`);
    objectBytes[pageObjectNumber] = ascii(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /XObject << /Im0 ${imageObjectNumber} 0 R >> >> /Contents ${contentObjectNumber} 0 R >>`,
    );
    objectBytes[contentObjectNumber] = joinBytes([
      ascii(`<< /Length ${content.length} >>\nstream\n`),
      content,
      ascii("\nendstream"),
    ]);
    objectBytes[imageObjectNumber] = joinBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${raster.width} /Height ${raster.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${raster.bytes.length} >>\nstream\n`),
      raster.bytes,
      ascii("\nendstream"),
    ]);
  }

  objectBytes[2] = ascii(`<< /Type /Pages /Kids [${pageObjects.join(" ")}] /Count ${pageObjects.length} >>`);

  const chunks = [ascii("%PDF-1.4\n")];
  const offsets = [0];
  let byteOffset = chunks[0].length;
  for (let objectNumber = 1; objectNumber < objectBytes.length; objectNumber += 1) {
    offsets[objectNumber] = byteOffset;
    const object = joinBytes([
      ascii(`${objectNumber} 0 obj\n`),
      objectBytes[objectNumber],
      ascii("\nendobj\n"),
    ]);
    chunks.push(object);
    byteOffset += object.length;
  }

  const xrefOffset = byteOffset;
  const xref = [
    `xref\n0 ${objectBytes.length}\n`,
    "0000000000 65535 f \n",
    ...offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`),
    `trailer\n<< /Size ${objectBytes.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`,
  ].join("");
  chunks.push(ascii(xref));
  return new Blob(chunks, { type: "application/pdf" });
}

async function downloadPdf() {
  if (images.length === 0 || isConverting) return;
  isConverting = true;
  convertButton.disabled = true;
  convertLabel.textContent = "Creating PDF…";

  try {
    const pdf = await createPdf();
    const url = URL.createObjectURL(pdf);
    const link = document.createElement("a");
    link.href = url;
    link.download = "paperplane-images.pdf";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Your PDF is ready · ${formatFileSize(pdf.size)}`);
  } catch (error) {
    setStatus(error instanceof Error ? error.message : "Something went wrong while creating your PDF.", true);
  } finally {
    isConverting = false;
    convertLabel.textContent = "Create PDF";
    convertButton.disabled = images.length === 0;
  }
}

fileInput.addEventListener("change", (event) => {
  addFiles(event.target.files);
  fileInput.value = "";
});

clearButton.addEventListener("click", () => {
  for (const image of images) URL.revokeObjectURL(image.url);
  images.length = 0;
  renderFiles();
  setStatus("");
});

convertButton.addEventListener("click", downloadPdf);

dropzone.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    fileInput.click();
  }
});

for (const eventName of ["dragenter", "dragover"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add("is-dragging");
  });
}

for (const eventName of ["dragleave", "drop"]) {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-dragging");
  });
}

dropzone.addEventListener("drop", (event) => addFiles(event.dataTransfer.files));
