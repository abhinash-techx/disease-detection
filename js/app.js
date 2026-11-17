
/* PhytoVision AI frontend — separated from the original single-file page. */
'use strict';

const API_BASE = 'http://127.0.0.1:8000';
const MAX_BYTES = 5 * 1024 * 1024;
const DISEASE_SAMPLES = [
  {key:'healthy', label:'Healthy Leaf'},
  {key:'early_blight', label:'Early Blight'},
  {key:'late_blight', label:'Late Blight'},
  {key:'leaf_spot', label:'Leaf Spot'},
  {key:'powdery_mildew', label:'Powdery Mildew'},
  {key:'bacterial_spot', label:'Bacterial Spot'}
];

let selectedFile = null;
let currentResult = null;
const fileInput = document.getElementById('fileInput');
const dropzone = document.getElementById('dropzone');
const previewImg = document.getElementById('previewImg');
const previewWrap = document.getElementById('previewWrap');
const predictBtn = document.getElementById('predictBtn');

function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const target = document.getElementById('view-' + name);
  if (target) target.classList.add('active');
  document.querySelectorAll('.nav-btn[data-view]').forEach(b => b.classList.remove('active'));
  const navName = name === 'result' ? 'detect' : name;
  const nav = document.querySelector('.nav-btn[data-view="' + navName + '"]');
  if (nav) nav.classList.add('active');
  if (name === 'history') renderHistory();
}

document.querySelectorAll('.nav-btn[data-view]').forEach(button => {
  button.addEventListener('click', () => {
    const view = button.dataset.view;
    showView(view === 'detect' ? (currentResult ? 'result' : 'home') : view);
  });
});

function validateFile(file) {
  if (!file) return 'Please choose an image.';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    return 'Please upload a JPG, PNG or WEBP image.';
  }
  if (file.size > MAX_BYTES) return 'Image size must be 5MB or less.';
  return '';
}

function selectFile(file) {
  const error = validateFile(file);
  if (error) {
    alert(error);
    selectedFile = null;
    predictBtn.disabled = true;
    previewWrap.style.display = 'none';
    return;
  }
  selectedFile = file;
  const reader = new FileReader();
  reader.onload = event => {
    previewImg.src = event.target.result;
    previewWrap.style.display = 'block';
    predictBtn.disabled = false;
  };
  reader.readAsDataURL(file);
}

fileInput.addEventListener('change', event => selectFile(event.target.files[0]));
dropzone.addEventListener('dragover', event => {
  event.preventDefault();
  dropzone.classList.add('drag');
});
dropzone.addEventListener('dragleave', () => dropzone.classList.remove('drag'));
dropzone.addEventListener('drop', event => {
  event.preventDefault();
  dropzone.classList.remove('drag');
  selectFile(event.dataTransfer.files[0]);
});

async function analyzeImage(file) {
  const form = new FormData();
  form.append('file', file, file.name || 'plant-image.jpg');
  const response = await fetch(API_BASE + '/api/analyze', {method:'POST', body:form});
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.detail || payload.error || 'Analysis failed. Check backend configuration.');
  return payload;
}

predictBtn.addEventListener('click', async () => {
  if (!selectedFile) return;
  predictBtn.disabled = true;
  const originalText = predictBtn.textContent;
  predictBtn.textContent = 'Analyzing image...';
  try {
    const result = await analyzeImage(selectedFile);
    currentResult = {result, imageUrl: previewImg.src, fileName: selectedFile.name};
    renderResult(result, previewImg.src);
    if (result.is_leaf) pushHistory(result);
    showView('result');
  } catch (error) {
    alert(error.message);
  } finally {
    predictBtn.disabled = !selectedFile;
    predictBtn.textContent = originalText;
  }
});

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value == null || value === '' ? '-' : value;
}
function addListItems(list, items) {
  list.innerHTML = '';
  (items || []).forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
}
function safeInfoRows(rows) {
  const table = document.getElementById('infoTable');
  table.replaceChildren();
  rows.forEach(([label, value]) => {
    const tr = document.createElement('tr');
    const th = document.createElement('td');
    const td = document.createElement('td');
    const strong = document.createElement('b');
    strong.textContent = label;
    th.appendChild(strong);
    td.textContent = value || '-';
    tr.append(th, td);
    table.appendChild(tr);
  });
}
function drawGauge(canvas, pct) {
  const ctx = canvas.getContext('2d');
  const w = canvas.width, h = canvas.height, cx = w/2, cy = h/2, r = w*.38;
  ctx.clearRect(0,0,w,h);
  ctx.lineWidth = w*.14;
  ctx.strokeStyle = '#eee';
  ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.stroke();
  const color = pct <= 30 ? '#2ecc71' : pct <= 70 ? '#f39c12' : '#e74c3c';
  ctx.strokeStyle = color; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(cx,cy,r,-Math.PI/2,-Math.PI/2+(pct/100)*Math.PI*2); ctx.stroke();
  ctx.fillStyle = '#333'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = 'bold 24px Arial'; ctx.fillText(Math.round(pct)+'%',cx,cy-6);
  ctx.font = '12px Arial'; ctx.fillStyle = '#777'; ctx.fillText('Severity',cx,cy+18);
}
function renderResult(data, imageUrl) {
  document.getElementById('resultImg').src = imageUrl;
  const badge = document.getElementById('diseaseBadge');
  if (!data.is_leaf) {
    badge.textContent = '✖ Not a Plant Leaf';
    badge.className = 'badge-danger';
    setText('diseaseName', 'Not a plant leaf');
    setText('sciName', 'Not applicable');
    setText('confidence', 'Not applicable');
    setText('descText', 'Detected object: ' + (data.detected_object || 'Unrecognized object') +
      '. This image is not a plant leaf, so disease detection was not performed.');
    drawGauge(document.getElementById('gaugeCanvas'), 0);
    setText('severityLabel', 'Not applicable');
    setText('severityNote', 'Upload a clear close-up image of one plant leaf.');
    document.getElementById('severityLabel').className = 'severity-pill low';
    addListItems(document.getElementById('treatmentList'), []);
    safeInfoRows([['Image validation','Rejected'],['Detected object',data.detected_object || 'Unknown']]);
    document.getElementById('pdfBtn').disabled = true;
    document.getElementById('similarGrid').replaceChildren();
    return;
  }

  badge.textContent = data.disease_name === 'Healthy Leaf' ? '✓ Healthy Leaf' : '⚠ Disease Detected';
  badge.className = data.disease_name === 'Healthy Leaf' ? 'badge-success' : 'badge-danger';
  setText('diseaseName', data.disease_name);
  setText('sciName', data.scientific_name);
  setText('confidence', Number(data.confidence || 0).toFixed(1) + '% (AI estimate)');
  setText('descText', data.description);
  const severity = Math.max(0, Math.min(100, Number(data.severity || 0)));
  drawGauge(document.getElementById('gaugeCanvas'), severity);
  const level = severity <= 30 ? 'Low' : severity <= 70 ? 'Medium' : 'High';
  const pill = document.getElementById('severityLabel');
  pill.textContent = level + ' Severity';
  pill.className = 'severity-pill ' + level.toLowerCase();
  setText('severityNote', data.severity_note || 'Visual estimate only; confirm with an agricultural expert.');
  addListItems(document.getElementById('treatmentList'), data.treatment_en || []);
  safeInfoRows([
    ['Affected Crop',data.affected_crop],
    ['Causal Organism',data.causal_organism],
    ['Common Season',data.common_season],
    ['Impact',data.impact],
    ['Prevention',data.prevention]
  ]);
  document.getElementById('pdfBtn').disabled = false;
  buildSampleGrid('similarGrid');
}

function pushHistory(data) {
  const history = JSON.parse(localStorage.getItem('pv_history') || '[]');
  history.unshift({
    time:new Date().toLocaleString(),
    disease:data.disease_name,
    confidence:Number(data.confidence || 0).toFixed(1)+'%',
    severity:Number(data.severity || 0).toFixed(0)+'%'
  });
  localStorage.setItem('pv_history', JSON.stringify(history.slice(0,50)));
}
function renderHistory() {
  const history = JSON.parse(localStorage.getItem('pv_history') || '[]');
  const table = document.getElementById('historyTable');
  const empty = document.getElementById('noHistory');
  table.replaceChildren();
  if (!history.length) { empty.style.display = 'block'; return; }
  empty.style.display = 'none';
  const header = document.createElement('tr');
  ['Time','Disease','Confidence','Severity'].forEach(label => {
    const th = document.createElement('th'); th.textContent = label; header.appendChild(th);
  });
  table.appendChild(header);
  history.forEach(item => {
    const tr = document.createElement('tr');
    [item.time,item.disease,item.confidence,item.severity].forEach(value => {
      const td = document.createElement('td'); td.textContent = value; tr.appendChild(td);
    });
    table.appendChild(tr);
  });
}

function sampleCanvas(type) {
  const canvas = document.createElement('canvas');
  canvas.width = 220; canvas.height = 160;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#eef7ee'; ctx.fillRect(0,0,220,160);
  ctx.fillStyle = '#4caf50'; ctx.beginPath(); ctx.ellipse(110,80,92,53,0,0,Math.PI*2); ctx.fill();
  ctx.strokeStyle = '#2e7d32'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(30,80); ctx.lineTo(190,80); ctx.stroke();
  const spot = (x,y,r,color) => {ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fill();};
  if (type === 'early_blight') for(let i=0;i<7;i++){let x=55+Math.random()*110,y=48+Math.random()*64;spot(x,y,8,'#8d5524');spot(x,y,3,'#d3a14a');}
  if (type === 'late_blight') for(let i=0;i<4;i++) spot(55+Math.random()*110,45+Math.random()*70,13,'#3b2616');
  if (type === 'leaf_spot') for(let i=0;i<18;i++) spot(40+Math.random()*140,35+Math.random()*90,3,'#5c3a1e');
  if (type === 'powdery_mildew') for(let i=0;i<60;i++) spot(40+Math.random()*140,35+Math.random()*90,2,'#fff');
  if (type === 'bacterial_spot') for(let i=0;i<14;i++){let x=40+Math.random()*140,y=35+Math.random()*90;spot(x,y,4,'#d4b94a');spot(x,y,2,'#4a2c18');}
  return canvas;
}
function buildSampleGrid(containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  grid.replaceChildren();
  DISEASE_SAMPLES.forEach(sample => {
    const canvas = sampleCanvas(sample.key);
    const item = document.createElement('div');
    item.className = 'sample-item';
    const img = document.createElement('img');
    img.src = canvas.toDataURL('image/png');
    img.alt = sample.label;
    const label = document.createElement('span');
    label.textContent = sample.label;
    item.append(img,label);
    item.addEventListener('click', () => canvas.toBlob(blob => {
      const file = new File([blob], sample.key + '.png', {type:'image/png'});
      selectFile(file);
      showView('home');
    }));
    grid.appendChild(item);
  });
}

document.getElementById('tryAnotherBtn').addEventListener('click', () => {
  selectedFile = null; currentResult = null; fileInput.value = '';
  previewWrap.style.display = 'none'; predictBtn.disabled = true;
  document.getElementById('pdfBtn').disabled = false;
  showView('home');
});

function escapeHtml(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, ch =>
    ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function buildBilingualReport(data, fileName) {
  const treatmentEn = (data.treatment_en || []).map(x => '<li>'+escapeHtml(x)+'</li>').join('');
  const treatmentHi = (data.treatment_hi || []).map(x => '<li>'+escapeHtml(x)+'</li>').join('');
  const rows = [
    ['Crop / फसल',data.affected_crop],
    ['Causal organism / रोगजनक',data.causal_organism],
    ['Common season / सामान्य मौसम',data.common_season],
    ['Impact / प्रभाव',data.impact],
    ['Prevention / रोकथाम',data.prevention],
    ['Severity / गंभीरता',data.severity+'% ('+data.severity_level+')']
  ].map(([k,v])=>'<tr><th>'+escapeHtml(k)+'</th><td>'+escapeHtml(v)+'</td></tr>').join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>PhytoVision AI Report</title>
  <style>
  body{font-family:Arial,"Noto Sans Devanagari",sans-serif;color:#23352a;margin:28px;line-height:1.5}
  h1,h2{color:#1b7a3d}h1{margin-bottom:2px}.muted{color:#657568}
  .section{border-top:1px solid #dce8df;padding-top:10px;margin-top:14px}
  table{border-collapse:collapse;width:100%}td,th{border:1px solid #dce8df;padding:8px;text-align:left}
  th{background:#f2f8f3;width:32%}.notice{background:#f5fbf6;padding:10px}
  @media print{button{display:none}body{margin:12mm}}
  </style></head><body>
  <h1>PhytoVision AI</h1><div class="muted">Plant Disease Diagnostic Report / पौध रोग निदान रिपोर्ट</div>
  <p><b>Report ID:</b> ${escapeHtml(data.report_id)} &nbsp; <b>Date:</b> ${new Date().toLocaleString()}</p>
  <p><b>Image:</b> ${escapeHtml(fileName)}</p>
  <div class="section"><h2>English Report</h2>
  <p><b>Result:</b> ${escapeHtml(data.disease_name)}</p>
  <p><b>Scientific name:</b> ${escapeHtml(data.scientific_name)}</p>
  <p><b>AI confidence estimate:</b> ${escapeHtml(data.confidence)}%</p>
  <p><b>Description:</b> ${escapeHtml(data.description)}</p>
  <p><b>Severity:</b> ${escapeHtml(data.severity)}% (${escapeHtml(data.severity_level)})</p>
  <h3>Treatment suggestions</h3><ul>${treatmentEn}</ul></div>
  <div class="section" lang="hi"><h2>हिन्दी रिपोर्ट</h2>
  <p><b>परिणाम:</b> ${escapeHtml(data.disease_name_hi)}</p>
  <p><b>वैज्ञानिक नाम:</b> ${escapeHtml(data.scientific_name)}</p>
  <p><b>विश्वसनीयता का AI अनुमान:</b> ${escapeHtml(data.confidence)}%</p>
  <p><b>विवरण:</b> ${escapeHtml(data.description_hi)}</p>
  <p><b>गंभीरता:</b> ${escapeHtml(data.severity)}% (${escapeHtml(data.severity_level_hi)})</p>
  <h3>उपचार के सुझाव</h3><ul>${treatmentHi}</ul></div>
  <div class="section"><h2>Additional Information / अतिरिक्त जानकारी</h2><table>${rows}</table></div>
  <p class="notice">This is preliminary AI-assisted guidance, not a laboratory diagnosis. Confirm disease and pesticide decisions with a qualified local agricultural expert.<br>
  यह AI आधारित प्रारंभिक सुझाव है, प्रयोगशाला निदान नहीं। रोग और दवा की पुष्टि स्थानीय कृषि विशेषज्ञ से करें।</p>
  <button onclick="window.print()">Print / Save as PDF</button></body></html>`;
}
document.getElementById('pdfBtn').addEventListener('click', () => {
  if (!currentResult || !currentResult.result.is_leaf) return;
  const reportWindow = window.open('', '_blank');
  if (!reportWindow) { alert('Please allow pop-ups to print the bilingual report.'); return; }
  reportWindow.document.open();
  reportWindow.document.write(buildBilingualReport(currentResult.result, currentResult.fileName));
  reportWindow.document.close();
  reportWindow.focus();
  setTimeout(() => reportWindow.print(), 500);
});

document.getElementById('zipBtn1').addEventListener('click', () =>
  alert('The complete source ZIP is provided separately with this project package.'));
document.getElementById('zipBtn2').addEventListener('click', () =>
  alert('The complete source ZIP is provided separately with this project package.'));

buildSampleGrid('sampleGrid');
renderHistory();
fetch(API_BASE + '/health').catch(() => {});
