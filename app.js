// app.js — runs in the browser

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycby9OkTASxpBHy5lIwxCIYi7-O0FKvR0-SpJsl8dQxPVydzX0BLWXJSbWMdPh4ihCOfWPA/exec"; // ← paste from Part 1

let selectedFile = null;

// Drag-and-drop
const dropZone = document.getElementById("drop-zone");
dropZone.addEventListener("dragover", e => { e.preventDefault(); dropZone.classList.add("dragover"); });
dropZone.addEventListener("dragleave", () => dropZone.classList.remove("dragover"));
dropZone.addEventListener("drop", e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});

document.getElementById("file-input").addEventListener("change", e => {
  if (e.target.files[0]) setFile(e.target.files[0]);
});

function setFile(file) {
  selectedFile = file;
  document.getElementById("file-name").textContent = "📎 " + file.name;
  document.getElementById("upload-btn").disabled = false;
}

function setStatus(type, msg) {
  const el = document.getElementById("status");
  el.className = "status " + type;
  el.textContent = msg;
}

function showPreview(fields) {
  const container = document.getElementById("preview-fields");
  container.innerHTML = "";
  Object.entries(fields).forEach(([k, v]) => {
    const row = document.createElement("div");
    row.className = "field-row";
    row.innerHTML = `<span class="field-key">${k}</span><span class="field-val">${v}</span>`;
    container.appendChild(row);
  });
  document.getElementById("preview").style.display = "block";
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function getMimeType(file) {
  if (file.type) return file.type;
  const ext = file.name.split(".").pop().toLowerCase();
  const map = { pdf: "application/pdf", jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };
  return map[ext] || "application/octet-stream";
}

async function callGemini(apiKey, base64, mimeType, examLabel) {
  const prompt = `You are reading an exam marksheet or scorecard.
Extract ALL subject names and their corresponding marks/scores.
Also extract the candidate's name, roll number, total marks, and percentage if present.
${examLabel ? `This is for exam: "${examLabel}".` : ""}

Return ONLY valid JSON in this format (no markdown, no explanation):
{
  "Candidate Name": "...",
  "Roll Number": "...",
  "Subject 1 Name": score_as_number,
  "Subject 2 Name": score_as_number,
  "Total Marks": number_or_null,
  "Percentage": number_or_null
}

Use the actual subject names from the marksheet as keys.
If a field is not found, use null.
Scores should be numbers, not strings.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }]
  };

  const resp = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${apiKey}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
  );

  if (!resp.ok) {
    const err = await resp.json();
    throw new Error(err.error?.message || "Gemini API error");
  }

  const data = await resp.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

  // Strip markdown code fences if Gemini adds them
  const cleaned = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  return JSON.parse(cleaned);
}

async function sendToSheets(fields, filename, examLabel) {
  if (examLabel) fields["Exam Label"] = examLabel;

  const payload = {
    fields,
    filename,
    timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })
  };

  const resp = await fetch(APPS_SCRIPT_URL, {
    method: "POST",
    body: JSON.stringify(payload)
  });

  const result = await resp.json();
  if (!result.success) throw new Error(result.error || "Apps Script error");
  return result;
}

async function processFile() {
  const apiKey = document.getElementById("gemini-key").value.trim();
  const examLabel = document.getElementById("exam-label").value.trim();

  if (!apiKey) { setStatus("error", "⚠️ Please enter your Gemini API key."); return; }
  if (!selectedFile) { setStatus("error", "⚠️ Please select a file."); return; }

  document.getElementById("upload-btn").disabled = true;
  document.getElementById("preview").style.display = "none";
  setStatus("loading", "⏳ Reading marksheet with Gemini...");

  try {
    const base64 = await fileToBase64(selectedFile);
    const mimeType = getMimeType(selectedFile);

    setStatus("loading", "🔍 Extracting scores...");
    const fields = await callGemini(apiKey, base64, mimeType, examLabel);

    showPreview(fields);
    setStatus("loading", "📤 Sending to Google Sheets...");

    await sendToSheets(fields, selectedFile.name, examLabel);

    setStatus("success", "✅ Done! Row added to your Google Sheet.");
  } catch (err) {
    setStatus("error", "❌ Error: " + err.message);
    console.error(err);
  } finally {
    document.getElementById("upload-btn").disabled = false;
  }
}
