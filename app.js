// ============================================================
// app.js — Seva Data Entry App logic
// Depends on PARAMETERS and its helper functions from parameters.js
// ============================================================

let allRecords = [];       // cached, sorted list of records for the View Entries tab
let recordsLoaded = false;

document.addEventListener('DOMContentLoaded', () => {
  initHeader();
  initStatusBanner();
  initTabs();
  populateRelationSelect('pitru1Relation');
  populateRelationSelect('pitru2Relation');
  wireOtherRelationFields();
  wireDateFieldValidation();
  wireForm();
  wireSearch();
});

// ---------------------------------------------------------------
// Header / status
// ---------------------------------------------------------------
function initHeader() {
  document.getElementById('sevaYearDisplay').textContent = PARAMETERS.sevaYear;
  document.getElementById('sevaYearHidden').value = PARAMETERS.sevaYear;
}

function initStatusBanner() {
  const banner = document.getElementById('statusBanner');
  const range = getAllowedDateRange();
  const dateInput = document.getElementById('sevaDate');
  const submitBtn = document.getElementById('submitBtn');

  if (range) {
    banner.className = 'status-banner open';
    dateInput.min = range.minISO;
    dateInput.max = range.maxISO;

    if (range.minISO === range.maxISO) {
      // Only one valid date. Some mobile date pickers (observed on Android)
      // don't reliably enforce "max" when min and max are the same day,
      // letting an out-of-range date be picked through the native widget.
      // Sidestep that entirely: lock the field to the single valid date
      // instead of trusting the picker to enforce it.
      dateInput.value = range.minISO;
      dateInput.disabled = true;
      banner.textContent = `Data entry is open for the only available Seva date: ${PARAMETERS.sevaEndDate}.`;
    } else {
      dateInput.disabled = false;
      banner.textContent =
        `Data entry is open. You may pick a Seva date from ${isoToDDMMYYYY(range.minISO)} to ${PARAMETERS.sevaEndDate}.`;
    }

    submitBtn.disabled = false;
  } else {
    banner.className = 'status-banner closed';
    banner.textContent = 'Data entry is currently closed. Please check back during the next open window.';
    dateInput.disabled = true;
    submitBtn.disabled = true;
  }
}

// ---------------------------------------------------------------
// Tabs
// ---------------------------------------------------------------
function initTabs() {
  const tabButtons = document.querySelectorAll('.tab-btn');
  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => activateTab(btn.dataset.target));
  });
}

function activateTab(targetId) {
  document.querySelectorAll('.tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.target === targetId);
  });
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('active', v.id === targetId);
  });

  if (targetId === 'viewEntriesView' && !recordsLoaded) {
    loadRecords();
  }
}

// ---------------------------------------------------------------
// Relation dropdowns
// ---------------------------------------------------------------
function populateRelationSelect(selectId) {
  const select = document.getElementById(selectId);
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = '-- Select relation --';
  select.appendChild(blank);

  PARAMETERS.relationOptions.forEach((rel) => {
    const opt = document.createElement('option');
    opt.value = rel;
    opt.textContent = rel;
    select.appendChild(opt);
  });
}

function wireOtherRelationFields() {
  ['pitru1', 'pitru2'].forEach((prefix) => {
    const select = document.getElementById(`${prefix}Relation`);
    const otherWrap = document.getElementById(`${prefix}OtherWrap`);
    select.addEventListener('change', () => {
      otherWrap.style.display = select.value === 'Anyother Specify' ? 'block' : 'none';
    });
  });
}

// Gives immediate feedback the moment a date is picked, rather than only at
// submit — a backstop for native date pickers (observed on Android) that
// don't always enforce min/max correctly. If an out-of-range date somehow
// gets through the widget, it's cleared right away with an explanation.
function wireDateFieldValidation() {
  const dateInput = document.getElementById('sevaDate');
  const errorEl = document.getElementById('formError');

  dateInput.addEventListener('change', () => {
    if (!dateInput.value) return;
    const range = getAllowedDateRange();
    if (!range) return; // initStatusBanner already disables the field when closed

    const pickedDDMMYYYY = isoToDDMMYYYY(dateInput.value);
    if (!isDateWithinAllowedRange(pickedDDMMYYYY, range)) {
      errorEl.textContent =
        `${pickedDDMMYYYY} is outside the allowed range (${isoToDDMMYYYY(range.minISO)} to ${isoToDDMMYYYY(range.maxISO)}). Please pick again.`;
      dateInput.value = '';
    } else {
      errorEl.textContent = '';
    }
  });
}

// ---------------------------------------------------------------
// Form submission
// ---------------------------------------------------------------
function wireForm() {
  const form = document.getElementById('sevaForm');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errorEl = document.getElementById('formError');
    errorEl.textContent = '';

    const range = getAllowedDateRange();
    if (!range) {
      errorEl.textContent = 'Data entry is currently closed.';
      return;
    }

    const record = buildRecordFromForm();
    const validationError = validateRecord(record, range);
    if (validationError) {
      errorEl.textContent = validationError;
      return;
    }

    const submitBtn = document.getElementById('submitBtn');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Submitting…';

    try {
      const formData = new FormData();
      formData.append('spreadsheetId', PARAMETERS.sheetId);
      formData.append('sheetName', PARAMETERS.sheetName);
      Object.entries(record).forEach(([key, value]) => formData.append(key, value));

      const response = await fetch(PARAMETERS.scriptURL, {
        method: 'POST',
        body: formData
      });
      const rawText = await response.text();

      let result;
      try {
        result = JSON.parse(rawText);
      } catch (parseErr) {
        // The Apps Script returned something that isn't JSON at all — usually
        // an HTML error/sign-in page, which means the deployment itself needs
        // attention (see the troubleshooting checklist), not the form data.
        throw new Error(
          'The write script did not return a valid response. It may not be deployed for "Anyone" access, the URL may be out of date, or the script may have an error. Please check the Apps Script deployment.'
        );
      }

      if (result.result !== 'success') {
        throw new Error(result.error || 'Submission failed.');
      }

      showReport(record);

      // Best-effort auto-open of WhatsApp with the confirmation prefilled.
      // Some browsers may block this popup (especially on slow connections,
      // since it happens after an awaited network call) — the "Send via
      // WhatsApp" button in the report above is kept as a manual fallback.
      window.open(buildWhatsAppLink(record), '_blank', 'noopener');

      form.reset();
      document.getElementById('sevaYearHidden').value = PARAMETERS.sevaYear;
      document.getElementById('pitru1OtherWrap').style.display = 'none';
      document.getElementById('pitru2OtherWrap').style.display = 'none';

      recordsLoaded = false; // force a fresh fetch since a new row was just added
      activateTab('viewEntriesView'); // jump straight to the (refreshed) entry list
    } catch (err) {
      errorEl.textContent = err.message || 'Could not submit — please check your connection and try again.';
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Submit Seva Details';
    }
  });
}

function buildRecordFromForm() {
  const val = (id) => document.getElementById(id).value.trim();

  const pitru1Relation = val('pitru1Relation') === 'Anyother Specify'
    ? val('pitru1RelationOther') : val('pitru1Relation');
  const pitru2Relation = val('pitru2Relation') === 'Anyother Specify'
    ? val('pitru2RelationOther') : val('pitru2Relation');

  const dateVal = document.getElementById('sevaDate').value; // yyyy-mm-dd
  const sevaDateDDMMYYYY = dateVal ? isoToDDMMYYYY(dateVal) : '';

  return {
    sevaYear: PARAMETERS.sevaYear,
    sevaDate: sevaDateDDMMYYYY,
    sponsorName: val('sponsorName'),
    sponsorMobile: val('sponsorMobile'),
    sponsorGotra: val('sponsorGotra'),
    coSponsorName: val('coSponsorName'),
    coSponsorGotra: val('coSponsorGotra'),
    pitru1Name: val('pitru1Name'),
    pitru1Gotra: val('pitru1Gotra'),
    pitru1Relation: pitru1Relation,
    pitru2Name: val('pitru2Name'),
    pitru2Gotra: val('pitru2Gotra'),
    pitru2Relation: pitru2Relation
  };
}

function validateRecord(record, range) {
  if (!record.sevaDate) return 'Please pick a Seva date.';
  if (!isDateWithinAllowedRange(record.sevaDate, range)) {
    return `Please pick a Seva date between ${isoToDDMMYYYY(range.minISO)} and ${isoToDDMMYYYY(range.maxISO)}.`;
  }
  if (!record.sponsorName) return 'Sponsor name is required.';
  if (!PARAMETERS.mobileNumberRegex.test(record.sponsorMobile)) {
    return 'Enter a valid 10-digit mobile number starting with 6, 7, 8 or 9.';
  }
  if (!record.pitru1Name) return 'Pitru 1 name is required.';
  if (!record.pitru1Relation) return 'Pitru 1 relation is required.';
  return null;
}

// Re-checks the picked date against the actual allowed range, independent of
// whatever the native <input type="date"> widget did or didn't enforce —
// some mobile date pickers (observed on Android, especially when min and max
// are the same single day) let a date outside the range through regardless
// of the min/max attributes, so this is a required backstop, not a formality.
// Deliberately avoids `new Date("YYYY-MM-DD")`, which JS parses as UTC
// midnight (not local midnight) and can silently shift by a day depending on
// the device's timezone — everything here is built from plain y/m/d numbers,
// compared as local dates, matching how the rest of the app handles dates.
function isDateWithinAllowedRange(ddmmyyyyStr, range) {
  const [d, m, y] = ddmmyyyyStr.split('/').map(Number);
  const picked = new Date(y, m - 1, d);

  const [minY, minM, minD] = range.minISO.split('-').map(Number);
  const [maxY, maxM, maxD] = range.maxISO.split('-').map(Number);
  const min = new Date(minY, minM - 1, minD);
  const max = new Date(maxY, maxM - 1, maxD);

  return picked >= min && picked <= max;
}

function isoToDDMMYYYY(iso) {
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

// ---------------------------------------------------------------
// Report + WhatsApp
// ---------------------------------------------------------------
function showReport(record) {
  const container = document.getElementById('reportContainer');
  container.innerHTML = '';

  const card = document.createElement('div');
  card.className = 'report-card';

  const title = document.createElement('h2');
  title.textContent = 'Seva Confirmed';
  card.appendChild(title);

  const rows = [
    ['Seva Year', record.sevaYear],
    ['Seva Date', record.sevaDate],
    ['Sponsor', record.sponsorName],
    ['Mobile', record.sponsorMobile],
    ['Sponsor Gotra', record.sponsorGotra || '—'],
    ['Co-Sponsor', record.coSponsorName || '—'],
    ['Pitru 1', `${record.pitru1Name} (${record.pitru1Relation})`],
    ['Pitru 2', record.pitru2Name ? `${record.pitru2Name} (${record.pitru2Relation})` : '—']
  ];

  rows.forEach(([label, value]) => {
    const row = document.createElement('div');
    row.className = 'report-row';
    row.innerHTML = `<span>${label}</span><span></span>`;
    row.querySelector('span:last-child').textContent = value;
    card.appendChild(row);
  });

  const waLink = document.createElement('a');
  waLink.className = 'btn-secondary';
  waLink.textContent = 'Send via WhatsApp';
  waLink.href = buildWhatsAppLink(record);
  waLink.target = '_blank';
  waLink.rel = 'noopener';
  card.appendChild(waLink);

  container.appendChild(card);
}

function buildWhatsAppLink(record) {
  const lines = [
    `Seva Confirmation`,
    `Seva Year: ${record.sevaYear}`,
    `Seva Date: ${record.sevaDate}`,
    `Sponsor: ${record.sponsorName} (${record.sponsorMobile})`,
    record.sponsorGotra ? `Sponsor Gotra: ${record.sponsorGotra}` : null,
    record.coSponsorName ? `Co-Sponsor: ${record.coSponsorName}` : null,
    `Pitru 1: ${record.pitru1Name} (${record.pitru1Relation})`,
    record.pitru2Name ? `Pitru 2: ${record.pitru2Name} (${record.pitru2Relation})` : null,
    `Thank you.`
  ].filter(Boolean).join('\n');

  return `https://wa.me/${PARAMETERS.whatsappNumber}?text=${encodeURIComponent(lines)}`;
}

// ---------------------------------------------------------------
// View Entries — load, sort, search, expand
// ---------------------------------------------------------------
async function loadRecords() {
  const listEl = document.getElementById('recordsList');
  listEl.innerHTML = '<div class="loading-state">Loading entries…</div>';

  try {
    const res = await fetch(PARAMETERS.readDataURL);
    const rows = await res.json(); // array of arrays

    const dataRows = rows.filter((row) => {
      // Skip a header row if present (sevaYear column won't be numeric there)
      return row.length > 0 && !isNaN(Number(row[0]));
    });

    const records = dataRows.map(rowArrayToRecord);

    records.sort((a, b) =>
      String(a.sponsorMobile).localeCompare(String(b.sponsorMobile))
    );

    records.forEach((rec, idx) => { rec._sno = idx + 1; });

    allRecords = records;
    recordsLoaded = true;
    renderRecords(allRecords);
  } catch (err) {
    listEl.innerHTML = '<div class="error-text">Could not load entries. Please try again later.</div>';
  }
}

function renderRecords(records) {
  const listEl = document.getElementById('recordsList');
  listEl.innerHTML = '';

  if (records.length === 0) {
    listEl.innerHTML = '<div class="empty-state">No matching entries found.</div>';
    return;
  }

  records.forEach((rec) => {
    const card = document.createElement('div');
    card.className = 'record-card';

    card.innerHTML = `
      <div class="rc-top">
        <span class="sno">#${rec._sno}</span>
        <span class="mobile">${rec.sponsorMobile}</span>
      </div>
      <div class="row"><span class="lbl">Sponsor:</span>${rec.sponsorName}</div>
      <div class="row"><span class="lbl">Pitru1:</span>${rec.pitru1Name || '—'}${rec.pitru1Relation ? ` (${rec.pitru1Relation})` : ''}</div>
      <div class="row"><span class="lbl">Pitru2:</span>${rec.pitru2Name || '—'}${rec.pitru2Relation ? ` (${rec.pitru2Relation})` : ''}</div>
      <div class="row"><span class="lbl">Seva Date:</span>${rec.sevaDate}</div>
      <div class="detail">
        <div class="row"><span class="lbl">Seva Year:</span>${rec.sevaYear}</div>
        <div class="row"><span class="lbl">Sponsor Gotra:</span>${rec.sponsorGotra || '—'}</div>
        <div class="row"><span class="lbl">Co-Sponsor:</span>${rec.coSponsorName || '—'}</div>
        <div class="row"><span class="lbl">Co-Sponsor Gotra:</span>${rec.coSponsorGotra || '—'}</div>
        <div class="row"><span class="lbl">Pitru1 Gotra:</span>${rec.pitru1Gotra || '—'}</div>
        <div class="row"><span class="lbl">Pitru2 Gotra:</span>${rec.pitru2Gotra || '—'}</div>
      </div>
    `;

    card.addEventListener('click', () => card.classList.toggle('expanded'));
    listEl.appendChild(card);
  });
}

function wireSearch() {
  const input = document.getElementById('searchInput');
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) {
      renderRecords(allRecords);
      return;
    }
    const filtered = allRecords.filter((rec) =>
      String(rec.sponsorMobile).toLowerCase().includes(q) ||
      String(rec.sponsorName).toLowerCase().includes(q)
    );
    renderRecords(filtered);
  });
}
