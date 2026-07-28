// FMO Smart Queue Application Logic (K2D & 1-Page Mobile Quick Allocation with Explicit 24-Hour Time)

let currentQueueRole = 'DIRECTOR';
let allPersonnelList = [];
let previewedDirectors = [];
let previewedStaff = [];
let autoFetchDebounceTimer = null;

document.addEventListener('DOMContentLoaded', () => {
  initApp();
  initTheme();
  checkUrlActionParams(); // ตรวจสอบ URL query params จาก LINE redirect (เช่น ?action=busy)
});

function initApp() {
  populate24HourTimeOptions('alloc-start-time', '09:00');
  populate24HourTimeOptions('alloc-end-time', '17:00');
  setDefaultMissionTimes();
  loadDirectorSelectList();
  switchTab('quick');
  loadDashboardStats();
  loadQueueView('DIRECTOR');
  loadPersonnelDropdown();
  loadAllMissions();
}

// -------------------------------------------------------------
// LINE REDIRECT HANDLER: ?action=busy&mission_id=X&personnel_id=Y
// รองรับการกดปุ่ม "ติดภารกิจ" จาก LINE แล้ว redirect มาเปิดหน้าเว็บสำหรับป้อนตัวแทน
// -------------------------------------------------------------
async function checkUrlActionParams() {
  const params = new URLSearchParams(window.location.search);
  const action = params.get('action');
  const missionId = params.get('mission_id');
  const personnelId = params.get('personnel_id');

  if (action === 'busy' && missionId && personnelId) {
    // ลบ query params ออกจาก URL เพื่อความสะอาด
    window.history.replaceState({}, document.title, window.location.pathname);

    // หน่วงเล็กน้อยให้ UI โหลดก่อน
    await new Promise(r => setTimeout(r, 600));

    // เปิด SweetAlert2 ถามรหัสตัวแทน
    const { value: empCode } = await Swal.fire({
      title: '<span style="font-size: 20px;">🔴 แจ้งติดภารกิจ - ป้อนผู้ปฏิบัติงานแทน</span>',
      html: '<p style="color:#64748b; font-size:14px;">การแจ้งผ่านปุ่มใน LINE<br>กรุณาระบุรหัสพนักงานผู้มาทำหน้าที่แทน</p>',
      input: 'text',
      inputLabel: 'รหัสพนักงานตัวแทน (EMP-XXX)',
      inputPlaceholder: 'เช่น EMP-001',
      showCancelButton: true,
      confirmButtonText: '✅ ยืนยันส่งตัวแทน',
      cancelButtonText: 'ยกเลิก',
      confirmButtonColor: '#dc2626',
      width: '380px',
      customClass: { popup: 'rounded-popup', input: 'rounded-input' },
      inputValidator: (val) => { if (!val) return 'กรุณาระบุรหัสพนักงานตัวแทน'; }
    });

    if (!empCode) return;

    try {
      const res = await fetch('/api/missions/respond', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mission_id: parseInt(missionId),
          personnel_id: parseInt(personnelId),
          response_status: 'DECLINED_BUSY',
          substitute_emp_code: empCode.trim()
        })
      });
      const result = await res.json();

      if (result.success) {
        showToast(`🎉 ${result.message}`, 'success');
        // สลับไปหน้ารายงานและเปิด modal กิจกรรม
        setTimeout(() => {
          switchTab('reports');
          loadDashboardStats();
          openMissionDetailModal(parseInt(missionId));
        }, 800);
      } else {
        showToast(`❌ ${result.error}`, 'danger');
      }
    } catch (err) {
      console.error('Error processing LINE busy action:', err);
      showToast('เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง', 'danger');
    }
  }
}


// -------------------------------------------------------------
// 24-HOUR TIME DROPDOWN POPULATOR
// -------------------------------------------------------------
function populate24HourTimeOptions(selectId, defaultTime = '09:00') {
  const select = document.getElementById(selectId);
  if (!select) return;

  let html = '';
  for (let h = 0; h < 24; h++) {
    for (let m = 0; m < 60; m += 30) {
      const hh = String(h).padStart(2, '0');
      const mm = String(m).padStart(2, '0');
      const timeStr = `${hh}:${mm}`;
      const selected = timeStr === defaultTime ? 'selected' : '';
      html += `<option value="${timeStr}" ${selected}>${timeStr} น.</option>`;
    }
  }
  select.innerHTML = html;
}

// -------------------------------------------------------------
// LIGHT / DARK THEME TOGGLE
// -------------------------------------------------------------
function initTheme() {
  const savedTheme = localStorage.getItem('fmo_theme');
  if (savedTheme === 'light') {
    document.body.classList.add('light-mode');
    updateThemeIcon(true);
  }
}

function toggleTheme() {
  const isLight = document.body.classList.toggle('light-mode');
  localStorage.setItem('fmo_theme', isLight ? 'light' : 'dark');
  updateThemeIcon(isLight);
}

function updateThemeIcon(isLight) {
  const icon = document.getElementById('theme-toggle-icon');
  if (!icon) return;
  if (isLight) {
    icon.className = 'fa-solid fa-sun';
    icon.style.color = '#f59e0b';
  } else {
    icon.className = 'fa-solid fa-moon';
    icon.style.color = '#38bdf8';
  }
}

// -------------------------------------------------------------
// TAB NAVIGATION
// -------------------------------------------------------------
function switchTab(tabId) {
  document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = Array.from(document.querySelectorAll('.nav-btn')).find(btn => btn.getAttribute('onclick')?.includes(tabId));
  if (activeBtn) activeBtn.classList.add('active');

  document.querySelectorAll('.view-content').forEach(view => view.classList.remove('active'));
  const targetView = document.getElementById(`view-${tabId}`);
  if (targetView) targetView.classList.add('active');

  if (tabId === 'quick') previewCandidates();
  else if (tabId === 'dashboard') loadDashboardStats();
  else if (tabId === 'queue') loadQueueView(currentQueueRole);
  else if (tabId === 'individual') {
    if (allPersonnelList.length === 0) loadPersonnelDropdown();
  } else if (tabId === 'reports') loadAllMissions();
}

// -------------------------------------------------------------
// AUTO-FETCH QUEUE ON INPUT CHANGE
// -------------------------------------------------------------
function autoFetchOnNumberChange() {
  clearTimeout(autoFetchDebounceTimer);
  autoFetchDebounceTimer = setTimeout(() => {
    previewCandidates();
  }, 250);
}

// -------------------------------------------------------------
// DASHBOARD STATS & ACTIVE QUEUE TRACKER
// -------------------------------------------------------------
async function loadDashboardStats() {
  try {
    const res = await fetch('/api/dashboard/stats');
    const result = await res.json();

    if (result.success) {
      const data = result.data;
      document.getElementById('stat-director-round').innerText = `Round ${data.rounds.directorRound}`;
      document.getElementById('stat-staff-round').innerText = `Round ${data.rounds.staffRound}`;
      document.getElementById('stat-participation-rate').innerText = `${data.participationRate.ratePct}%`;
      document.getElementById('stat-hold-count').innerText = `${data.holdsCount} ท่าน`;

      document.getElementById('dash-dir-round-num').innerText = data.rounds.directorRound;
      document.getElementById('dash-staff-round-num').innerText = data.rounds.staffRound;

      renderActiveQueueTracker(data.activeQueueTracker, data.rounds);
      renderRoundProgress('dash-dir-progress', data.directorBreakdown, 8);
      renderRoundProgress('dash-staff-progress', data.staffBreakdown, 94);
      loadRecentMissionsList();
    }
  } catch (err) {
    console.error('Error loading dashboard stats:', err);
  }
}

function renderActiveQueueTracker(tracker, rounds) {
  const nextDir = tracker.nextDirector;
  const nextStaff = tracker.nextStaff;

  const dirNameEl = document.getElementById('tracker-dir-name');
  const dirPosEl = document.getElementById('tracker-dir-pos');
  const dirRoundTag = document.getElementById('tracker-dir-round-tag');

  if (nextDir) {
    const isHold = nextDir.status === 'HOLD';
    dirNameEl.innerHTML = `${escapeHtml(nextDir.name)} ${isHold ? '<span class="badge badge-hold">HOLD Priority</span>' : ''}`;
    dirPosEl.innerText = `${nextDir.position} (${nextDir.department}) | รหัส: ${nextDir.emp_code}`;
    dirRoundTag.innerText = `Round ${nextDir.current_round}`;
  } else {
    dirNameEl.innerText = 'ครบทุกคนในรอบแล้ว';
    dirPosEl.innerText = 'กำลังขึ้นรอบใหม่';
    dirRoundTag.innerText = `Round ${rounds.directorRound}`;
  }

  const staffNameEl = document.getElementById('tracker-staff-name');
  const staffPosEl = document.getElementById('tracker-staff-pos');
  const staffRoundTag = document.getElementById('tracker-staff-round-tag');

  if (nextStaff) {
    const isHold = nextStaff.status === 'HOLD';
    staffNameEl.innerHTML = `ลำดับที่ ${nextStaff.queue_order}: ${escapeHtml(nextStaff.name)} ${isHold ? '<span class="badge badge-hold">HOLD Priority</span>' : ''}`;
    staffPosEl.innerText = `${nextStaff.position} (${nextStaff.department}) | รหัส: ${nextStaff.emp_code}`;
    staffRoundTag.innerText = `Round ${nextStaff.current_round}`;
  } else {
    staffNameEl.innerText = 'ครบทุกคนในรอบแล้ว';
    staffPosEl.innerText = 'กำลังขึ้นรอบใหม่';
    staffRoundTag.innerText = `Round ${rounds.staffRound}`;
  }
}

function renderRoundProgress(containerId, breakdown, total) {
  const container = document.getElementById(containerId);
  if (!container) return;

  let completed = 0, hold = 0, waiting = 0;
  breakdown.forEach(b => {
    if (b.status === 'COMPLETED') completed = b.count;
    else if (b.status === 'HOLD') hold = b.count;
    else if (b.status === 'WAITING') waiting = b.count;
  });

  const compPct = Math.round((completed / total) * 100);

  container.innerHTML = `
    <div style="display:flex; justify-content:space-between; font-size:0.8rem; color:var(--text-muted); margin-bottom:4px;">
      <span>เสร็จสิ้นกิจกรรมในรอบนี้: ${completed}/${total} ท่าน (${compPct}%)</span>
      <span>HOLD: ${hold} | WAITING: ${waiting}</span>
    </div>
    <div style="width:100%; height:8px; background:var(--card-border); border-radius:4px; overflow:hidden; display:flex;">
      <div style="width:${(completed/total)*100}%; background:#10b981;" title="COMPLETED"></div>
      <div style="width:${(hold/total)*100}%; background:#f59e0b;" title="HOLD"></div>
      <div style="width:${(waiting/total)*100}%; background:#0284c7;" title="WAITING"></div>
    </div>
  `;
}

async function loadRecentMissionsList() {
  try {
    const res = await fetch('/api/missions');
    const result = await res.json();

    const container = document.getElementById('dash-recent-missions');
    if (!result.success || result.missions.length === 0) {
      container.innerHTML = '<p style="color:var(--text-muted); padding:1rem;">ยังไม่มีรายการกิจกรรมในระบบ</p>';
      return;
    }

    const recent = result.missions.slice(0, 5);
    let html = `
      <table class="custom-table">
        <thead>
          <tr>
            <th>ชื่อกิจกรรม</th>
            <th>สถานที่</th>
            <th>วันที่เริ่มต้น (เวลา 24 ชม.)</th>
            <th>สถานะ</th>
          </tr>
        </thead>
        <tbody>
    `;

    recent.forEach(m => {
      const statusBadge = m.status === 'COMPLETED' 
        ? '<span class="badge badge-completed">COMPLETED</span>' 
        : '<span class="badge badge-waiting">SCHEDULED</span>';

      html += `
        <tr>
          <td><strong style="color:var(--text-heading);">${escapeHtml(m.mission_title)}</strong></td>
          <td>${escapeHtml(m.location || '-')}</td>
          <td>${formatDate(m.start_date)}</td>
          <td>${statusBadge}</td>
        </tr>
      `;
    });

    html += '</tbody></table>';
    container.innerHTML = html;
  } catch (err) {
    console.error('Error loading recent activities:', err);
  }
}

// -------------------------------------------------------------
// DUAL QUEUE VISUALIZER
// -------------------------------------------------------------
async function loadQueueView(roleType) {
  currentQueueRole = roleType;

  const btnDir = document.getElementById('tab-btn-director');
  const btnStaff = document.getElementById('tab-btn-staff');

  if (roleType === 'DIRECTOR') {
    btnDir.className = 'btn btn-primary btn-sm';
    btnStaff.className = 'btn btn-secondary btn-sm';
  } else {
    btnDir.className = 'btn btn-secondary btn-sm';
    btnStaff.className = 'btn btn-primary btn-sm';
  }

  const tbody = document.getElementById('queue-table-body');
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">กำลังโหลดข้อมูลคิว...</td></tr>';

  // --- ฟังก์ชันช่วยนับเฉพาะคนที่ "รอคิวจริง" ---
  const countWaiting = (membersList) => {
    return membersList.filter(m => m.status === 'WAITING' || m.status === 'HOLD').length;
  };

  // --- แอบดึงข้อมูลของอีกแท็บมาเพื่อนับจำนวนคิวที่เหลือ / จำนวนทั้งหมด ---
  const otherRole = roleType === 'DIRECTOR' ? 'STAFF' : 'DIRECTOR';
  fetch(`/api/queue/${otherRole}`)
    .then(res => res.json())
    .then(otherResult => {
       const otherMembers = otherResult.data || otherResult.members || [];
       const otherWaitingCount = countWaiting(otherMembers);
       const otherTotal = otherMembers.length;
       
       if (otherRole === 'STAFF') {
          document.getElementById('tab-btn-staff-text').innerText = `คิว พนักงาน (เหลือ ${otherWaitingCount}/${otherTotal} ท่าน)`;
       } else {
          document.getElementById('tab-btn-director-text').innerText = `คิว ผอ.ฝ่าย (เหลือ ${otherWaitingCount}/${otherTotal} ท่าน)`;
       }
    })
    .catch(err => console.log('Background fetch error:', err));

  try {
    const res = await fetch(`/api/queue/${roleType}`);
    const result = await res.json();

    if (!result.success) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; color:var(--danger);">${result.error}</td></tr>`;
      return;
    }

    const members = result.data || result.members || [];
    const waitingCount = countWaiting(members);
    const totalCount = members.length;

    // อัปเดตข้อความบนปุ่มของแท็บปัจจุบัน (แสดงยอดที่เหลือ / จำนวนทั้งหมด)
    if (roleType === 'DIRECTOR') {
       document.getElementById('tab-btn-director-text').innerText = `คิว ผอ.ฝ่าย (เหลือ ${waitingCount}/${totalCount} ท่าน)`;
    } else {
       document.getElementById('tab-btn-staff-text').innerText = `คิว พนักงาน (เหลือ ${waitingCount}/${totalCount} ท่าน)`;
    }

    if (members.length === 0) {
       tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">ไม่พบข้อมูลบุคลากรในระบบ</td></tr>';
       return;
    }

    let html = '';
    members.forEach((m, idx) => {
      let statusBadge = '';
      if (m.status === 'HOLD') {
        statusBadge = `<span class="badge badge-hold"><i class="fa-solid fa-pause"></i> HOLD (ค้างสิทธิ์)</span><br><small style="color:var(--warning);">${escapeHtml(m.hold_reason || '')}</small>`;
      } else if (m.status === 'COMPLETED') {
        statusBadge = '<span class="badge badge-completed"><i class="fa-solid fa-check"></i> COMPLETED</span>';
      } else {
        statusBadge = '<span class="badge badge-waiting"><i class="fa-solid fa-clock"></i> WAITING (รอคิว)</span>';
      }

      let actions = '';
      if (m.status === 'HOLD') {
        actions = `<button class="btn btn-primary btn-sm" onclick="unholdPerson(${m.personnel_id})"><i class="fa-solid fa-play"></i> คืนสิทธิ์ปกติ</button>`;
      } else if (m.status === 'WAITING') {
        actions = `<button class="btn btn-warning btn-sm" onclick="openSkipModal(${m.personnel_id}, '${escapeHtml(m.name)}')"><i class="fa-solid fa-pause"></i> ข้ามคิว (Hold)</button>`;
      } else {
        actions = `<span style="color:var(--text-muted); font-size:0.8rem;">ปฏิบัติกิจกรรมในรอบนี้แล้ว</span>`;
      }

      html += `
        <tr>
          <td><strong style="color:var(--primary);">#${idx + 1}</strong></td>
          <td><code>${m.emp_code}</code></td>
          <td><strong style="color:var(--text-heading);">${escapeHtml(m.name)}</strong></td>
          <td>${escapeHtml(m.position)}<br><small style="color:var(--text-muted);">${escapeHtml(m.department)}</small></td>
          <td>${statusBadge}</td>
          <td><strong style="color:var(--success);">${m.total_missions_joined}</strong> ครั้ง</td>
          <td>${m.last_assigned_at ? formatDate(m.last_assigned_at) : '<span style="color:var(--text-muted);">-</span>'}</td>
          <td class="no-print">${actions}</td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Error loading queue:', err);
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--danger);">เกิดข้อผิดพลาดในการดึงข้อมูล</td></tr>';
  }
}

// -------------------------------------------------------------
// SKIP & HOLD ACTIONS
// -------------------------------------------------------------
function openSkipModal(personnelId, name) {
  document.getElementById('modal-skip-person-id').value = personnelId;
  document.getElementById('modal-skip-person-name').innerText = name;
  document.getElementById('modal-skip-reason').value = '';
  openModal('modal-skip');
}

async function confirmSkipHold() {
  const pId = document.getElementById('modal-skip-person-id').value;
  const reason = document.getElementById('modal-skip-reason').value.trim();

  if (!reason) {
    showToast('กรุณาระบุเหตุผลการข้ามคิว', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/queue/skip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personnel_id: pId, reason })
    });
    const result = await res.json();

    if (result.success) {
      closeModal('modal-skip');
      loadQueueView(currentQueueRole);
      loadDashboardStats();
      previewCandidates();
      showToast('บันทึกการข้ามคิว (Hold) เรียบร้อยแล้ว', 'warning');
    } else {
      showToast(`Error: ${result.error}`, 'danger');
    }
  } catch (err) {
    console.error('Skip error:', err);
  }
}

async function unholdPerson(personnelId) {
  if (!confirm('ยืนยันการคืนสิทธิ์ให้บุคลากรท่านนี้กลับสู่สถานะรอคิวปกติ?')) return;

  try {
    const res = await fetch('/api/queue/unhold', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personnel_id: personnelId })
    });
    const result = await res.json();

    if (result.success) {
      loadQueueView(currentQueueRole);
      loadDashboardStats();
      previewCandidates();
      showToast('คืนสิทธิ์ให้บุคลากรกลับสู่สถานะรอคิวปกติเรียบร้อยแล้ว', 'success');
    } else {
      showToast(`Error: ${result.error}`, 'danger');
    }
  } catch (err) {
    console.error('Unhold error:', err);
  }
}

// -------------------------------------------------------------
// EMERGENCY SUBSTITUTION (การเปลี่ยนตัวกะทันหัน)
// -------------------------------------------------------------
function openSubstituteModal(missionId, origPersonId, origPersonName) {
  document.getElementById('sub-mission-id').value = missionId;
  document.getElementById('sub-orig-person-id').value = origPersonId;
  document.getElementById('sub-orig-person-name').innerText = origPersonName;
  document.getElementById('sub-reason').value = '';
  openModal('modal-substitute');
}

async function confirmSubstitution() {
  const missionId = document.getElementById('sub-mission-id').value;
  const origPersonId = document.getElementById('sub-orig-person-id').value;
  const reason = document.getElementById('sub-reason').value.trim();

  if (!reason) {
    showToast('กรุณาระบุเหตุผลการขอเปลี่ยนตัว', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/missions/substitute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mission_id: missionId, original_personnel_id: origPersonId, reason })
    });
    const result = await res.json();

    if (result.success) {
      showToast(`🎉 ${result.message}`, 'success');
      closeModal('modal-substitute');
      closeModal('modal-mission-detail');
      loadAllMissions();
      loadDashboardStats();
      previewCandidates();
    } else {
      showToast(`Error: ${result.error}`, 'danger');
    }
  } catch (err) {
    console.error('Substitution error:', err);
  }
}

async function loadDirectorSelectList() {
  const container =
    document.getElementById('director-select-list');

  if (!container) {
    console.error('❌ ไม่พบ element: director-select-list');
    return;
  }

  try {
    const res = await fetch('/api/queue/DIRECTOR');

    if (!res.ok) {
      throw new Error(
        `เซิร์ฟเวอร์ตอบกลับด้วยสถานะ ${res.status}`
      );
    }

    const result = await res.json();

    if (
      !result.success ||
      !Array.isArray(result.members)
    ) {
      throw new Error(
        result.message ||
        'ไม่สามารถโหลดรายชื่อ ผอ.ฝ่ายได้'
      );
    }

    allDirectorsList = result.members;

    // ---------------------------------------------------------
    // 1. หาหัวหน้าตามคิวจริง
    //
    // - ใช้เฉพาะ DIR-01 ถึง DIR-08
    // - ใช้เฉพาะสถานะ WAITING
    // - เรียง DIR-01 → DIR-08
    // ---------------------------------------------------------
    const fixedDirector =
      allDirectorsList
        .filter(person => {
          const empCode = String(
            person.emp_code || ''
          )
            .trim()
            .toUpperCase();

          const queueStatus = String(
            person.queue_status ||
            person.status ||
            ''
          )
            .trim()
            .toUpperCase();

          return (
            /^DIR-0[1-8]$/.test(empCode) &&
            queueStatus === 'WAITING'
          );
        })
        .sort((a, b) => {
          const codeA = Number(
            String(a.emp_code || '')
              .replace(/\D/g, '')
          );

          const codeB = Number(
            String(b.emp_code || '')
              .replace(/\D/g, '')
          );

          return codeA - codeB;
        })[0] || null;

    // ---------------------------------------------------------
    // 2. ผอ.ฝ่ายสำรอง
    //
    // แสดง DIR-10 ก่อน DIR-09
    // ไม่ถูกเลือกอัตโนมัติ แต่เลือกเพิ่มได้
    // ---------------------------------------------------------
    const reserveOrder = {
      'DIR-10': 1,
      'DIR-09': 2
    };

    const reserveDirectors =
      allDirectorsList
        .filter(person => {
          const empCode = String(
            person.emp_code || ''
          )
            .trim()
            .toUpperCase();

          return [
            'DIR-10',
            'DIR-09'
          ].includes(empCode);
        })
        .sort((a, b) => {
          const codeA = String(
            a.emp_code || ''
          )
            .trim()
            .toUpperCase();

          const codeB = String(
            b.emp_code || ''
          )
            .trim()
            .toUpperCase();

          return (
            (reserveOrder[codeA] || 99) -
            (reserveOrder[codeB] || 99)
          );
        });

    // ---------------------------------------------------------
    // 3. ลำดับรายการด้านซ้าย
    //
    // DIR-10 → DIR-09 → หัวหน้าตามคิวปัจจุบัน
    // ---------------------------------------------------------
    const displayedDirectors = [
      ...reserveDirectors,
      ...(fixedDirector
        ? [fixedDirector]
        : [])
    ];

    console.log(
      '✅ หัวหน้าตามคิวปัจจุบัน:',
      fixedDirector
        ? {
            emp_code:
              fixedDirector.emp_code,
            status:
              fixedDirector.queue_status ||
              fixedDirector.status
          }
        : 'ไม่พบ DIRECTOR สถานะ WAITING'
    );

    console.log(
      '➕ ผอ.ฝ่ายสำรอง:',
      reserveDirectors.map(
        person => person.emp_code
      )
    );

    // ---------------------------------------------------------
    // 4. กรณีไม่พบข้อมูล
    // ---------------------------------------------------------
    if (displayedDirectors.length === 0) {
      container.innerHTML = `
        <p
          style="
            color: var(--text-muted);
            font-size: 0.82rem;
            margin: 0;
          "
        >
          ไม่พบรายชื่อ ผอ.ฝ่าย
        </p>
      `;

      previewedDirectors = [];

      renderCandidatesList(
        'preview-directors-list',
        previewedDirectors
      );

      const badge = document.getElementById(
        'selected-directors-badge'
      );

      if (badge) {
        badge.textContent = 'เลือกแล้ว 0 ท่าน';
      }

      return;
    }

    // ID ของหัวหน้าตามคิวในรอบปัจจุบัน
    const fixedPersonnelId = String(
      fixedDirector?.personnel_id ||
      fixedDirector?.id ||
      ''
    );

    // ---------------------------------------------------------
    // 5. สร้างรายการ Checkbox
    // ---------------------------------------------------------
    container.innerHTML =
      displayedDirectors
        .map(person => {
          const personnelId = String(
            person.personnel_id ||
            person.id ||
            ''
          );

          const empCode = String(
            person.emp_code || ''
          )
            .trim()
            .toUpperCase();

          // ห้ามฟิกด้วย empCode === DIR-01
          // เพราะรอบต่อไปอาจเป็น DIR-02, DIR-03 เป็นต้น
          const isFixed =
            Boolean(fixedPersonnelId) &&
            personnelId === fixedPersonnelId;

          const description = isFixed
            ? 'ผอ.ฝ่ายรันคิวอัตโนมัติ'
            : 'ผู้บริหารระดับสูง';

          return `
            <label
              class="${
                isFixed
                  ? 'director-auto-selected'
                  : 'director-reserve-option'
              }"
              style="
                display: flex;
                align-items: center;
                gap: 12px;
                background: ${
                  isFixed
                    ? '#e5e7eb'
                    : 'var(--input-bg)'
                };
                padding: 12px 14px;
                border-radius: 10px;
                border: 1px solid var(--card-border);
                cursor: ${
                  isFixed
                    ? 'default'
                    : 'pointer'
                };
                transition: all 0.2s;
              "
            >
              <input
                type="checkbox"
                class="director-checkbox"
                name="assigned_director_ids"
                value="${personnelId}"
                data-emp-code="${empCode}"
                data-fixed="${
                  isFixed ? '1' : '0'
                }"
                ${isFixed ? 'checked' : ''}
                onchange="onDirectorSelectionChange(this)"
                style="
                  accent-color: var(--primary);
                  width: 18px;
                  height: 18px;
                "
              >

              <div
                style="
                  flex: 1;
                  min-width: 0;
                "
              >
                <div
                  style="
                    font-size: 0.88rem;
                    font-weight: 700;
                    color: var(--text-heading);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                  "
                >
                  ${escapeHtml(person.name || '-')}
                </div>

                <div
                  style="
                    font-size: 0.76rem;
                    color: var(--text-muted);
                    white-space: nowrap;
                    overflow: hidden;
                    text-overflow: ellipsis;
                  "
                >
                  ${escapeHtml(person.position || '-')}
                </div>
              </div>

              <div
                style="
                  display: flex;
                  flex-direction: column;
                  align-items: flex-end;
                  gap: 2px;
                "
              >
                <strong
                  style="
                    font-size: 0.78rem;
                    color: var(--text-muted);
                  "
                >
                  ${escapeHtml(empCode)}
                </strong>

                <small
                  style="
                    font-size: 0.68rem;
                    color: ${
                      isFixed
                        ? '#64748b'
                        : '#d97706'
                    };
                    white-space: nowrap;
                  "
                >
                  ${description}
                </small>
              </div>
            </label>
          `;
        })
        .join('');

    // อัปเดตจำนวนที่เลือกและการ์ดด้านขวา
    onDirectorSelectionChange();
  } catch (err) {
    console.error(
      'Error loading director select list:',
      err
    );

    container.innerHTML = `
      <p
        style="
          color: #dc2626;
          font-size: 0.82rem;
          margin: 0;
        "
      >
        ไม่สามารถโหลดรายชื่อ ผอ.ฝ่ายได้
      </p>
    `;
  }
}

function onDirectorSelectionChange(
  changedCheckbox = null
) {
  // ---------------------------------------------------------
  // DIR-01 เป็นหัวหน้าฟิก ห้ามยกเลิก
  // ---------------------------------------------------------
  if (
    changedCheckbox &&
    changedCheckbox.dataset.fixed === '1'
  ) {
    changedCheckbox.checked = true;
  }

  const checkedBoxes =
    document.querySelectorAll(
      '#director-select-list ' +
      '.director-checkbox:checked'
    );

  const selectedIds =
    Array.from(checkedBoxes)
      .map(checkbox =>
        Number.parseInt(
          checkbox.value,
          10
        )
      )
      .filter(Number.isInteger);

  // ---------------------------------------------------------
  // อัปเดตป้ายจำนวนผู้ถูกเลือก
  // ---------------------------------------------------------
  const badge =
    document.getElementById(
      'selected-directors-badge'
    );

  if (badge) {
    badge.textContent =
      `เลือกแล้ว ${selectedIds.length} ท่าน`;
  }

  // ---------------------------------------------------------
  // ดึงข้อมูลเฉพาะผู้ที่ถูกเลือก
  // ---------------------------------------------------------
  previewedDirectors =
    allDirectorsList.filter(person => {
      const personnelId = Number(
        person.personnel_id ||
        person.id
      );

      return selectedIds.includes(
        personnelId
      );
    });

    // 3. ลำดับด้านซ้าย:
    //    DIR-10 → DIR-09 → DIR-01
    // ---------------------------------------------------------
    const displayedDirectors = [
      ...reserveDirectors,
      ...(fixedDirector
        ? [fixedDirector]
        : [])
    ];
  
    // ---------------------------------------------------------
  // เรียงการ์ดด้านขวา:
  // 1. DIR-01 เป็นคิว #1
  // 2. ตัวสำรองที่เลือกเพิ่ม เช่น DIR-10 เป็นคิว #2
  // 3. DIR-09 เป็นลำดับถัดไป
  // ---------------------------------------------------------
  previewedDirectors.sort((a, b) => {
    const order = {
      'DIR-01': 1,
      'DIR-10': 2,
      'DIR-09': 3
    };

    const codeA = String(
      a.emp_code || ''
    )
      .trim()
      .toUpperCase();

    const codeB = String(
      b.emp_code || ''
    )
      .trim()
      .toUpperCase();

    return (
      (order[codeA] || 99) -
      (order[codeB] || 99)
    );
  });

  // แสดงหัวหน้าทีมทางขวาตามที่เลือกจริง
  renderCandidatesList(
    'preview-directors-list',
    previewedDirectors
  );

  console.log(
    '👔 หัวหน้าทีมที่เลือก:',
    previewedDirectors.map(
      person => person.emp_code
    )
  );
}

function onDirectorSelectionChange(changedCheckbox = null) {
  // DIR-01 เป็นหัวหน้าฟิก ห้ามยกเลิก
  if (
    changedCheckbox &&
    changedCheckbox.dataset.fixed === '1'
  ) {
    changedCheckbox.checked = true;
  }

  // อ่าน ID ของ Checkbox ที่เลือก โดยใช้ String ป้องกันชนิดข้อมูลไม่ตรงกัน
  const selectedIds = Array.from(
    document.querySelectorAll(
      '#director-select-list .director-checkbox:checked'
    )
  )
    .map(checkbox => String(checkbox.value))
    .filter(Boolean);

  // อัปเดตป้ายจำนวนที่เลือก
  const badge = document.getElementById(
    'selected-directors-badge'
  );

  if (badge) {
    badge.textContent =
      `เลือกแล้ว ${selectedIds.length} ท่าน`;
  }

  // ดึงรายชื่อที่เลือกจริง
  previewedDirectors = (allDirectorsList || [])
    .filter(person => {
      const personnelId = String(
        person.personnel_id ||
        person.id ||
        ''
      );

      return selectedIds.includes(personnelId);
    });

  // ด้านขวาเรียง DIR-01 ก่อน แล้ว DIR-10 และ DIR-09
  const directorOrder = {
    'DIR-01': 1,
    'DIR-10': 2,
    'DIR-09': 3
  };

  previewedDirectors.sort((a, b) => {
    const codeA = String(a.emp_code || '')
      .trim()
      .toUpperCase();

    const codeB = String(b.emp_code || '')
      .trim()
      .toUpperCase();

    return (
      (directorOrder[codeA] || 99) -
      (directorOrder[codeB] || 99)
    );
  });

  // แสดงหัวหน้าทีมด้านขวาตาม Checkbox ที่เลือกจริง
  renderCandidatesList(
    'preview-directors-list',
    previewedDirectors
  );

  console.log(
    '👔 หัวหน้าทีมที่เลือกจริง:',
    previewedDirectors.map(person => ({
      id: person.personnel_id || person.id,
      emp_code: person.emp_code
    }))
  );
}

// -------------------------------------------------------------
// 1-PAGE QUICK ALLOCATION FORM
// -------------------------------------------------------------
function setDefaultMissionTimes() {
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);

  const y = tomorrow.getFullYear();
  const m = String(tomorrow.getMonth() + 1).padStart(2, '0');
  const d = String(tomorrow.getDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  const startDateEl = document.getElementById('alloc-start-date');
  const endDateEl = document.getElementById('alloc-end-date');

  if (startDateEl) startDateEl.value = dateStr;
  if (endDateEl) endDateEl.value = dateStr;
}

// -------------------------------------------------------------
// PREVIEW STAFF CANDIDATES
//
// หน้าที่:
// - ดึงพนักงานตามคิวสุ่ม
// - แสดงพนักงานด้านขวา
//
// ไม่จัดการ ผอ.ฝ่าย
// ผอ.ฝ่ายให้ loadDirectorSelectList() และ
// onDirectorSelectionChange() ดูแลเพียงระบบเดียว
// -------------------------------------------------------------
async function previewCandidates() {
  const reqStaffInput =
    document.getElementById('alloc-req-staff')?.value;

  const parsedStaff =
    Number.parseInt(reqStaffInput, 10);

  const reqStaff =
    Number.isInteger(parsedStaff) && parsedStaff > 0
      ? parsedStaff
      : 5;

  try {
    const res = await fetch(
      '/api/missions/preview-candidates',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          // ผอ.ฝ่ายไม่ได้จัดการในฟังก์ชันนี้
          required_directors: 0,
          required_staff: reqStaff
        })
      }
    );

    if (!res.ok) {
      throw new Error(
        `เซิร์ฟเวอร์ตอบกลับด้วยสถานะ ${res.status}`
      );
    }

    const result = await res.json();

    if (!result.success) {
      throw new Error(
        result.message ||
        'ไม่สามารถโหลดรายชื่อพนักงานตามคิวได้'
      );
    }

    // ---------------------------------------------------------
    // รับเฉพาะพนักงานจาก API
    // ---------------------------------------------------------
    previewedStaff =
      Array.isArray(result.data?.staff)
        ? result.data.staff
        : [];

    // ---------------------------------------------------------
    // แสดงพนักงานด้านขวา
    // ---------------------------------------------------------
    renderCandidatesList(
      'preview-staff-list',
      previewedStaff
    );

    console.log(
      '🎲 พนักงานตามคิวสุ่ม:',
      previewedStaff.map(
        person => person.emp_code
      )
    );
  } catch (err) {
    console.error(
      'Error previewing staff candidates:',
      err
    );

    showToast(
      `ไม่สามารถโหลดคิวพนักงานได้: ${err.message}`,
      'danger'
    );
  }
}

function renderCandidatesList(containerId, list) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (list.length === 0) {
    const emptyMsg = containerId === 'preview-directors-list' ? 'ยังไม่ได้เลือกหัวหน้าทีม' : 'ไม่พบคู่คิวที่ตรงเงื่อนไข';
    container.innerHTML = `<p style="color:var(--text-muted); font-size:0.85rem;">${emptyMsg}</p>`;
    return;
  }

  let html = '<ul style="list-style:none; display:flex; flex-direction:column; gap:8px; padding:0; margin:0; width:100%;">';

  list.forEach((item, idx) => {
    const isHold = item.queue_status === 'HOLD';
    const badge = isHold 
      ? '<span class="badge badge-hold"><i class="fa-solid fa-pause"></i> HOLD</span>' 
      : `<span class="badge badge-waiting">คิว #${idx + 1}</span>`;

    html += `
      <li style="background:var(--table-row-hover); padding:0.65rem 0.85rem; border-radius:10px; border:1px solid var(--card-border); width:100%; max-width:100%;">
        <div style="display:flex; align-items:center; justify-content:space-between; gap:8px; width:100%;">
          <div style="display:flex; align-items:center; gap:6px; min-width:0; flex:1; overflow:hidden;">
            <strong style="color:var(--text-heading); font-size:0.9rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(item.name)}</strong>
            <small style="color:var(--text-muted); font-size:0.78rem; flex-shrink:0;">(${item.emp_code})</small>
          </div>
          <div style="flex-shrink:0;">${badge}</div>
        </div>
        <div style="font-size:0.78rem; color:var(--text-muted); margin-top:3px; line-height:1.3; word-break:break-word;">
          <i class="fa-solid fa-briefcase" style="font-size:0.7rem; color:var(--accent);"></i> ${escapeHtml(item.position)} — <span style="color:var(--accent); font-weight:500;">${escapeHtml(item.department)}</span>
        </div>
      </li>
    `;
  });

  html += '</ul>';
  container.innerHTML = html;
}

async function handleCreateMission(event) {
  event.preventDefault();

  const title = document.getElementById('alloc-title').value.trim();
  const location = document.getElementById('alloc-location').value.trim();
  const dressCode = document.getElementById('alloc-dress-code').value.trim();
  
  const startDate = document.getElementById('alloc-start-date').value;
  const startTime = document.getElementById('alloc-start-time').value;
  const endDate = document.getElementById('alloc-end-date').value;
  const endTime = document.getElementById('alloc-end-time').value;

  const desc = document.getElementById('alloc-desc').value.trim();

  if (!startDate || !endDate) {
    showToast('กรุณาเลือกวันที่เริ่มต้นและสิ้นสุด', 'warning');
    return;
  }

  const startFull = `${startDate} ${startTime}:00`;
  const endFull = `${endDate} ${endTime}:00`;

  const dirIds = previewedDirectors.map(d => d.personnel_id);
  const staffIds = previewedStaff.map(s => s.personnel_id);

  if (dirIds.length === 0 && staffIds.length === 0) {
    showToast('กรุณาเลือกหรือระบุจำนวนผู้ปฏิบัติงานก่อนยืนยัน', 'warning');
    return;
  }

  try {
    const res = await fetch('/api/missions/create', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mission_title: title,
        location,
        dress_code: dressCode,
        start_date: startFull,
        end_date: endFull,
        description: desc,
        assigned_director_ids: dirIds,
        assigned_staff_ids: staffIds
      })
    });
    const result = await res.json();

    if (result.success) {
      // 1. โชว์ Toast แจ้งเตือน
      showToast(`🎉 ${result.message}<br>⏰ เวลาปฏิบัติงาน: ${startTime} น. - ${endTime} น.`, 'success');
      
      // 2. เคลียร์ฟอร์ม
      document.getElementById('form-quick-mission').reset();
      setDefaultMissionTimes();
      
      // 3. หน่วงเวลา 1.5 วินาที ให้ผู้ใช้อ่าน Toast ทัน แล้วค่อยสลับไปหน้ารายงาน
      setTimeout(() => {
        switchTab('reports');
        loadDashboardStats();
      }, 1500); 
    } else {
      showToast(`Error: ${result.error}`, 'danger');
    }
  } catch (err) {
    console.error('Error creating activity:', err);
  }
}

// -------------------------------------------------------------
// INDIVIDUAL HISTORY VIEW (หน้าประวัติย้อนหลังรายบุคคล)
// -------------------------------------------------------------
async function loadPersonnelDropdown() {
  try {
    const res = await fetch('/api/personnel');
    const result = await res.json();

    if (result.success) {
      allPersonnelList = result.data;
      renderPersonnelSelectOptions(allPersonnelList);
    }
  } catch (err) {
    console.error('Error loading personnel:', err);
  }
}

function renderPersonnelSelectOptions(list) {
  const select = document.getElementById('indiv-select-person');
  if (!select) return;

  let html = '<option value="">-- กรุณาเลือกบุคลากร (ผอ. 8 ท่าน / พนักงาน 94 ท่าน) --</option>';

  const directors = list.filter(p => p.role_type === 'DIRECTOR');
  const staff = list.filter(p => p.role_type === 'STAFF');

  if (directors.length > 0) {
    html += '<optgroup label="ผอ.ฝ่าย (8 ท่าน)">';
    directors.forEach(d => {
      html += `<option value="${d.id}">[${d.emp_code}] ${escapeHtml(d.name)} - ${escapeHtml(d.position)}</option>`;
    });
    html += '</optgroup>';
  }

  if (staff.length > 0) {
    html += '<optgroup label="พนักงาน (94 ท่าน)">';
    staff.forEach((s) => {
      html += `<option value="${s.id}">[${s.emp_code}] ${escapeHtml(s.name)} - ${escapeHtml(s.department)} (ลำดับที่ ${s.queue_order})</option>`;
    });
    html += '</optgroup>';
  }

  select.innerHTML = html;
}

function filterPersonDropdown(keyword) {
  if (!keyword.trim()) {
    renderPersonnelSelectOptions(allPersonnelList);
    return;
  }

  const kw = keyword.toLowerCase();
  const filtered = allPersonnelList.filter(p => 
    p.name.toLowerCase().includes(kw) || 
    p.emp_code.toLowerCase().includes(kw) || 
    p.position.toLowerCase().includes(kw)
  );

  renderPersonnelSelectOptions(filtered);
}

function loadSelectedPerson() {
  const personId = document.getElementById('indiv-select-person').value;
  if (personId) {
    loadIndividualHistory(personId);
  } else {
    showToast('กรุณาเลือกบุคลากร', 'warning');
  }
}

async function loadIndividualHistory(personId) {
  if (!personId) return;

  try {
    const res = await fetch(`/api/history/individual/${personId}`);
    const result = await res.json();

    if (!result.success) {
      showToast(result.error, 'danger');
      return;
    }

    const { person, queueStatus, summary, historyByRound, activeRound } = result;

    document.getElementById('indiv-profile-card').style.display = 'block';

    const queueOrderLabel = person.role_type === 'DIRECTOR' 
      ? `ผอ.ฝ่ายลำดับที่ ${queueStatus ? queueStatus.queue_order : '-'}`
      : `พนักงานลำดับที่ ${queueStatus ? queueStatus.queue_order : '-'}`;

    document.getElementById('indiv-header-info').innerText = 
      `ข้อมูล: ${person.name} (${person.department}) | รหัสคิว: ${queueOrderLabel} (${person.emp_code})`;

    let statusText = `สถานะปัจจุบัน: อยู่ระหว่างรอรับกิจกรรมใน Round ${activeRound}`;
    if (queueStatus && queueStatus.status === 'HOLD') {
      statusText = `สถานะปัจจุบัน: ติดกิจกรรมซ้อน (Hold_In_Round) ใน Round ${queueStatus.current_round} — จะได้รับสิทธิ์ดึงคิวแรกสุดในกิจกรรมถัดไป`;
    } else if (queueStatus && queueStatus.status === 'COMPLETED') {
      statusText = `สถานะปัจจุบัน: ปฏิบัติกิจกรรมครบเรียบร้อยแล้วใน Round ${queueStatus.current_round} (เตรียมพร้อมสู่ Round ${queueStatus.current_round + 1})`;
    }
    document.getElementById('indiv-header-status').innerText = statusText;

    document.getElementById('indiv-header-summary').innerText = 
      `สรุปประวัติรวม: เข้าร่วมแล้ว ${summary.totalJoined} กิจกรรม | รวม ${summary.totalHours} ชั่วโมง | ${summary.attendanceNote}`;

    const container = document.getElementById('indiv-rounds-container');
    let html = '';

    const rounds = Object.keys(historyByRound).sort((a, b) => Number(a) - Number(b));

    if (rounds.length === 0) {
      html += `
        <div style="background:var(--input-bg); padding:1rem; border-radius:10px; margin-bottom:1rem; border:1px solid var(--card-border);">
          <h5 style="color:var(--primary); font-size:1rem; margin-bottom:6px;">Round 1</h5>
          <p style="color:var(--text-muted); font-size:0.9rem;">(รอการจัดสรรอัตโนมัติ)</p>
        </div>
      `;
    } else {
      rounds.forEach(r => {
        const roundMissions = historyByRound[r];
        html += `
          <div style="background:var(--input-bg); padding:1.25rem; border-radius:12px; margin-bottom:1.25rem; border:1px solid var(--card-border);">
            <h5 style="color:var(--primary); font-size:1.05rem; font-weight:700; margin-bottom:10px; display:flex; align-items:center; gap:8px;">
              <i class="fa-solid fa-rotate"></i> Round ${r}
            </h5>
            <div class="table-responsive">
              <table class="custom-table">
                <thead>
                  <tr>
                    <th>ชื่อกิจกรรม</th>
                    <th>วันที่ปฏิบัติกิจกรรม (เวลา 24 ชม.)</th>
                    <th>ระยะเวลา</th>
                    <th>การแต่งกาย</th>
                    <th>หัวหน้าทีม (ผอ.ฝ่าย) / บริบทร่วม</th>
                    <th>สถานะ</th>
                  </tr>
                </thead>
                <tbody>
        `;

        roundMissions.forEach(m => {
          let leaderContext = '-';
          if (person.role_type === 'STAFF') {
            leaderContext = m.director_leader_name 
              ? `ร่วมกับ ${m.director_leader_position || m.director_leader_name}` 
              : 'ร่วมกับ ผอ.ฝ่ายประจำกิจกรรม';
          } else {
            leaderContext = `ทำหน้าที่หัวหน้าทีมปฏิบัติการ (${m.location || 'อสป.'})`;
          }

          if (m.notes) {
            leaderContext += ` <br><small style="color:var(--warning);">${escapeHtml(m.notes)}</small>`;
          }

          const statusBadge = m.assignment_status === 'JOINED' 
            ? '<span class="badge badge-completed">เข้าร่วมเรียบร้อย</span>'
            : `<span class="badge badge-hold">เปลี่ยนตัว/ขอลา</span>`;

          html += `
            <tr>
              <td><strong style="color:var(--text-heading);">${escapeHtml(m.mission_title)}</strong></td>
              <td>${formatDate(m.start_date)}</td>
              <td>${m.duration_hours || 8} ชั่วโมง</td>
              <td><code>${escapeHtml(m.dress_code || 'ชุดปฏิบัติงาน อสป.')}</code></td>
              <td>${leaderContext}</td>
              <td>${statusBadge}</td>
            </tr>
          `;
        });

        html += `</tbody></table></div></div>`;
      });

      const nextPendingRound = Number(rounds[rounds.length - 1]) + 1;
      html += `
        <div style="background:var(--input-bg); padding:1rem 1.25rem; border-radius:12px; border:1px dashed var(--card-border); opacity:0.85;">
          <h5 style="color:var(--text-muted); font-size:0.95rem; margin-bottom:4px;">Round ${nextPendingRound}:</h5>
          <p style="color:var(--text-muted); font-size:0.88rem; font-style:italic;">(รอการจัดสรรอัตโนมัติ)</p>
        </div>
      `;
    }

    container.innerHTML = html;

  } catch (err) {
    console.error('Error loading individual history:', err);
  }
}

// -------------------------------------------------------------
// REPORTS & ALL MISSIONS / ACTIVITIES VIEW
// -------------------------------------------------------------
async function loadAllMissions() {
  const tbody = document.getElementById('all-missions-table-body');
  tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">กำลังโหลดรายการกิจกรรม...</td></tr>';

  try {
    const res = await fetch('/api/missions');
    const result = await res.json();

    if (!result.success || result.missions.length === 0) {
      tbody.innerHTML = '<tr><td colspan="9" style="text-align:center;">ยังไม่มีรายการกิจกรรมในระบบ</td></tr>';
      return;
    }

    let html = '';
    result.missions.forEach(m => {
      const statusBadge = m.status === 'COMPLETED' 
        ? '<span class="badge badge-completed">COMPLETED</span>' 
        : '<span class="badge badge-waiting">SCHEDULED</span>';

      html += `
        <tr>
          <td><code>${m.mission_code || 'ACT-' + m.id}</code></td>
          <td><strong style="color:var(--text-heading);">${escapeHtml(m.mission_title)}</strong></td>
          <td>${escapeHtml(m.location || '-')}</td>
          <td><code>${escapeHtml(m.dress_code || 'ชุดปฏิบัติงาน อสป.')}</code></td>
          <td>${formatDate(m.start_date)}</td>
          <td><span class="badge badge-director">${m.directors_count} ท่าน</span></td>
          <td><span class="badge badge-staff">${m.staff_count} ท่าน</span></td>
          <td>${statusBadge}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="openMissionDetailModal(${m.id})">
              <i class="fa-solid fa-eye"></i> รายชื่อ & เปลี่ยนตัว
            </button>
          </td>
        </tr>
      `;
    });

    tbody.innerHTML = html;
  } catch (err) {
    console.error('Error loading all activities:', err);
  }
}

async function openMissionDetailModal(missionId) {
  try {
    const res = await fetch(`/api/missions/${missionId}`);
    const result = await res.json();

    if (!result.success) {
      showToast(result.error, 'danger');
      return;
    }

    const { mission, assigned } = result;

    document.getElementById('md-title').innerText = mission.mission_title;
    document.getElementById('md-location-time').innerText = `สถานที่: ${mission.location || '-'} | ช่วงเวลา: ${formatDate(mission.start_date)} - ${formatDate(mission.end_date)}`;
    document.getElementById('md-dress-code').innerText = `การแต่งกาย: ${mission.dress_code || 'ชุดปฏิบัติงาน อสป.'}`;

    const tbody = document.getElementById('md-assigned-body');
    if (assigned.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">ไม่มีข้อมูลผู้ได้รับจัดสรร</td></tr>';
    } else {
      let html = '';
      assigned.forEach(a => {
        const roleBadge = a.is_leader === 1 
          ? '<span class="badge badge-director">หัวหน้าทีม</span>' 
          : '<span class="badge badge-staff">สมาชิก</span>';

        let ackStatusBadge = '';
        if (a.ack_status === 'ACKNOWLEDGED') {
          ackStatusBadge = '<span class="badge badge-hold"><i class="fa-solid fa-circle-xmark"></i> ติดภารกิจ</span>';
        } else {
          ackStatusBadge = '<span class="badge badge-waiting"><i class="fa-solid fa-clock"></i> รอการตอบรับ</span>';
        }

        let notesText = a.notes ? `<small style="color:var(--warning);">${escapeHtml(a.notes)}</small>` : '-';
        if (a.assignment_status === 'SUBSTITUTED') {
          notesText = `<span class="badge badge-hold">ถูกสลับคิวแทนแล้ว</span><br>${notesText}`;
        }

        let actionBtn = '-';
        if (a.assignment_status === 'JOINED') {
          actionBtn = `
            <div style="display:flex; gap:4px; flex-wrap:wrap;">
              <button class="btn btn-primary btn-sm" onclick="respondToMission(${mission.id}, ${a.personnel_id}, 'ACKNOWLEDGED')">
                <i class="fa-solid fa-check"></i> รับทราบ
              </button>
              <button class="btn btn-warning btn-sm" onclick="respondToMission(${mission.id}, ${a.personnel_id}, 'DECLINED_BUSY')">
                <i class="fa-solid fa-pause"></i> ติดภารกิจ
              </button>
            </div>
          `;
        }

        html += `
          <tr>
            <td>${roleBadge}</td>
            <td><code>${a.emp_code}</code></td>
            <td><strong style="color:var(--text-heading);">${escapeHtml(a.name)}</strong></td>
            <td>${escapeHtml(a.position)} (${escapeHtml(a.department)})</td>
            <td>${ackStatusBadge}<br>${notesText}</td>
            <td class="no-print">${actionBtn}</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }

    openModal('modal-mission-detail');
  } catch (err) {
    console.error('Error loading activity details:', err);
  }
}

async function respondToMission(missionId, personnelId, status) {
  let substituteEmpCode = '';

  // 1. ถ้ากดปุ่ม "ติดภารกิจ" ให้ใช้ SweetAlert2 ถามหารหัสตัวแทน
  if (status === 'DECLINED_BUSY') { 
    const { value: empCode } = await Swal.fire({
      title: '<span style="font-size: 22px;">ระบุตัวแทนปฏิบัติหน้าที่</span>',
      input: 'text',
      inputLabel: 'กรุณากรอกรหัสพนักงาน (EMP-XXX)',
      inputPlaceholder: 'เช่น EMP-001',
      showCancelButton: true,
      confirmButtonText: 'บันทึกข้อมูล',
      cancelButtonText: 'ยกเลิก',
      // 💡 1. กำหนดขนาดความกว้างไม่ให้ใหญ่เกินไป (ค่าปกติคือประมาณ 500px กว่าๆ)
      width: '380px', 
      // 💡 2. เรียกใช้ CSS แบบมนโค้ง
      customClass: {
        popup: 'rounded-popup',
        input: 'rounded-input',
        confirmButton: 'rounded-confirm-btn',
        cancelButton: 'rounded-cancel-btn'
      },
      inputValidator: (value) => {
        if (!value) {
          return 'กรุณาระบุรหัสพนักงานตัวแทน!';
        }
      }
    });

    if (!empCode) return; // ถ้ากดยกเลิก หรือปิดหน้าต่าง ให้หยุดการทำงาน
    substituteEmpCode = empCode.trim();
  }

  // 2. ส่งข้อมูลไปที่หลังบ้าน
  try {
    const res = await fetch('/api/missions/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mission_id: missionId,
        personnel_id: personnelId,
        response_status: status, 
        substitute_emp_code: substituteEmpCode // ส่งรหัสตัวแทนไปแทนเหตุผลเดิม
      })
    });
    const result = await res.json();

    // 3. จัดการแสดงผล Toast แบบเดิมที่ระบบมีอยู่แล้ว
    if (result.success) {
      showToast(`🎉 ${result.message}`, 'success');
      openMissionDetailModal(missionId);
      loadDashboardStats();
      loadAllMissions();
      previewCandidates();
    } else {
      showToast(`Error: ${result.error}`, 'danger');
    }
  } catch (err) {
    console.error('Error responding to mission:', err);
  }
}

async function openNotificationLogsModal() {
  openModal('modal-notif-logs');
  const tbody = document.getElementById('notif-logs-body');
  if (tbody) tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">กำลังโหลดประวัติการส่งแจ้งเตือน...</td></tr>';

  try {
    const res = await fetch('/api/notifications/logs');
    const result = await res.json();

    if (!result.success) return;

    if (!tbody) return;

    if (result.logs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:1.5rem; color:var(--text-muted);">ยังไม่มีประวัติการส่งแจ้งเตือน</td></tr>';
    } else {
      let html = '';
      result.logs.forEach(l => {
        const isLine = l.channel === 'LINE_GROUP';
        const channelBadge = isLine 
          ? '<span class="badge badge-completed" style="background:#06c755; color:#ffffff; font-weight:700;"><i class="fa-brands fa-line"></i> LINE Flex Card</span>'
          : '<span class="badge badge-waiting"><i class="fa-solid fa-envelope"></i> Email</span>';

        let contentPreview = escapeHtml(l.content_body || '-');
        if (isLine) {
          contentPreview = renderLineFlexCardHtml(l.content_body);
        } else {
          contentPreview = `<small style="color:var(--text-muted); font-size:0.78rem;">${contentPreview.slice(0, 120)}...</small>`;
        }

        html += `
          <tr>
            <td>${channelBadge}</td>
            <td><strong>${escapeHtml(l.recipient)}</strong></td>
            <td><strong>${escapeHtml(l.subject_title || '-')}</strong></td>
            <td>${contentPreview}</td>
            <td>${formatDate(l.sent_at)}</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    }
  } catch (err) {
    console.error('Error loading notification logs:', err);
  }
}

function renderLineFlexCardHtml(jsonStr) {
  try {
    const card = JSON.parse(jsonStr);
    const bubble = card.contents || {};
    const header = bubble.header || {};
    const headerTitle = header.contents && header.contents[1] ? header.contents[1].text : 'LINE Notification';
    const headerBg = header.backgroundColor || '#0284c7';

    return `
      <div style="background:#ffffff; color:#0f172a; border-radius:12px; overflow:hidden; border:1px solid #cbd5e1; max-width:320px; box-shadow:0 6px 18px rgba(0,0,0,0.15); font-family:sans-serif; text-align:left;">
        <div style="background:${headerBg}; padding:10px 14px; color:#ffffff;">
          <div style="font-size:0.6rem; font-weight:700; color:#e0f2fe; letter-spacing:1px;">FMO SMART QUEUE SYSTEM</div>
          <div style="font-size:0.9rem; font-weight:700; margin-top:2px;">${escapeHtml(headerTitle)}</div>
        </div>
        <div style="padding:12px 14px; font-size:0.8rem; line-height:1.4;">
          <div style="font-weight:700; font-size:0.88rem; margin-bottom:6px; color:#0f172a;">${escapeHtml(card.altText || '')}</div>
          <div style="background:#fef3c7; color:#b45309; padding:6px 8px; border-radius:6px; font-size:0.72rem; font-weight:600; margin-top:8px;">
            ⏱️ กรุณาเดินทางมาถึงก่อนเวลาเริ่ม 30 นาที
          </div>
        </div>
        <div style="padding:8px 12px; background:#f8fafc; border-top:1px solid #e2e8f0; display:flex; gap:6px;">
          <button style="flex:1; background:#10b981; color:#fff; border:none; padding:6px; border-radius:6px; font-weight:bold; font-size:0.75rem;">🟢 กดรับทราบ</button>
          <button style="flex:1; background:#ef4444; color:#fff; border:none; padding:6px; border-radius:6px; font-weight:bold; font-size:0.75rem;">🔴 ติดภารกิจ(ส่งคนแทน)</button>
        </div>
      </div>
    `;
  } catch (e) {
    return `<pre style="font-size:0.72rem; max-height:120px; overflow:auto;">${escapeHtml(jsonStr)}</pre>`;
  }
}

// -------------------------------------------------------------
// EXPORT SUMMARY DATA
// -------------------------------------------------------------
async function exportSummaryData() {
  try {
    const res = await fetch('/api/reports/export');
    const result = await res.json();

    if (!result.success) {
      showToast(`Export Error: ${result.error || 'ไม่สามารถดึงข้อมูลได้'}`, 'danger');
      return;
    }

    // 💡 1. เพิ่มการรับค่า swapHistory ที่ส่งมาจากหลังบ้าน
    const { missions = [], personnel = [], swapHistory = [] } = result;

    // UTF-8 BOM for Thai language in Microsoft Excel
    let csvContent = '\uFEFF';

    // SECTION 1: MISSIONS SUMMARY
    csvContent += '=== รายงานสรุปกิจกรรมทั้งหมด (FMO SMART QUEUE) ===\n';
    csvContent += '"รหัสกิจกรรม","ชื่อกิจกรรม","สถานที่","การแต่งกาย","วันที่เริ่ม (เวลา 24 ชม.)","ผอ.ฝ่าย (ท่าน)","พนักงาน (ท่าน)","สถานะ"\n';

    missions.forEach(m => {
      const title = `"${(m.mission_title || '').replace(/"/g, '""')}"`;
      const location = `"${(m.location || '-').replace(/"/g, '""')}"`;
      const dress = `"${(m.dress_code || 'ชุดปฏิบัติงาน อสป.').replace(/"/g, '""')}"`;
      const startDate = `"${formatDate(m.start_date)}"`;
      const dirCount = `"${m.directors_count || 0}"`;
      const staffCount = `"${m.staff_count || 0}"`;
      const status = `"${m.status || 'SCHEDULED'}"`;

      csvContent += `"ACT-${m.id}",${title},${location},${dress},${startDate},${dirCount},${staffCount},${status}\n`;
    });

    // SECTION 2: PERSONNEL QUEUE REPORT
    csvContent += '\n=== รายงานสรุปประวัติบุคลากรและการวนคิว (PERSONNEL QUEUE REPORT) ===\n';
    // 💡 2. เพิ่มคอลัมน์ "ส่งตัวแทน/ติดภารกิจ (ครั้ง)"
    csvContent += '"รหัสพนักงาน","ชื่อ-นามสกุล","ตำแหน่ง","หน่วยงาน/ฝ่าย","บทบาท","ลำดับคิว","สถานะในคิว","เข้าร่วมกิจกรรมสะสม (ครั้ง)","ส่งตัวแทน/ติดภารกิจ (ครั้ง)","เข้าร่วมล่าสุด"\n';

    personnel.forEach(p => {
      const code = `"${(p.emp_code || '').replace(/"/g, '""')}"`;
      const name = `"${(p.name || '').replace(/"/g, '""')}"`;
      const pos = `"${(p.position || '').replace(/"/g, '""')}"`;
      const dept = `"${(p.department || '').replace(/"/g, '""')}"`;
      const role = `"${p.role_type === 'DIRECTOR' ? 'ผอ.ฝ่าย' : 'พนักงาน'}"`;
      const qOrder = `"${p.queue_order || '-'}"`;
      const qStatus = `"${p.queue_status || 'WAITING'}"`;
      const totalJoined = `"${p.total_missions_joined || 0}"`;
      const totalSubstituted = `"${p.total_substituted || 0}"`; // 💡 ดึงค่านับจำนวนครั้งที่ส่งตัวแทน
      const lastAssigned = `"${p.last_assigned_at ? formatDate(p.last_assigned_at) : '-'}"`;

      csvContent += `${code},${name},${pos},${dept},${role},${qOrder},${qStatus},${totalJoined},${totalSubstituted},${lastAssigned}\n`;
    });

    // 💡 3. SECTION 3: SWAP HISTORY (เพิ่มส่วนใหม่สำหรับประวัติการสลับคิวโดยเฉพาะ)
    csvContent += '\n=== รายงานประวัติการส่งตัวแทนและสลับคิว (SWAP & SUBSTITUTE HISTORY) ===\n';
    csvContent += '"ชื่อกิจกรรม","รหัสพนักงาน (เดิม)","ชื่อ-นามสกุล (ผู้ติดภารกิจ)","สถานะ","หมายเหตุ/ชื่อตัวแทน","วันที่ทำรายการ"\n';

    swapHistory.forEach(s => {
      const mTitle = `"${(s.mission_title || '').replace(/"/g, '""')}"`;
      const pCode = `"${(s.emp_code || '').replace(/"/g, '""')}"`;
      const pName = `"${(s.original_person || '').replace(/"/g, '""')}"`;
      const aStatus = `"${(s.assignment_status || '').replace(/"/g, '""')}"`;
      
      // ดึงหมายเหตุจากฐานข้อมูล (ช่อง decline_reason หรือ notes)
      const noteStr = s.substitute_note || s.additional_notes || '-';
      const pNote = `"${noteStr.replace(/"/g, '""')}"`;
      const actionDate = `"${s.action_date ? formatDate(s.action_date) : '-'}"`;

      csvContent += `${mTitle},${pCode},${pName},${aStatus},${pNote},${actionDate}\n`;
    });

    // สร้างไฟล์และดาวน์โหลด
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', url);
    downloadAnchor.setAttribute('download', `FMO_Smart_Queue_Report_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    URL.revokeObjectURL(url);

    showToast('📊 ส่งออกข้อมูลสรุปเป็นไฟล์ CSV (พร้อมประวัติการส่งตัวแทน) เรียบร้อยแล้ว!', 'success');
  } catch (err) {
    console.error('Export CSV error:', err);
    showToast('เกิดข้อผิดพลาดในการส่งออกไฟล์ CSV', 'danger');
  }
}
// -------------------------------------------------------------
// HELPERS & MODALS
// -------------------------------------------------------------
function openModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.add('active');
}

function closeModal(modalId) {
  const modal = document.getElementById(modalId);
  if (modal) modal.classList.remove('active');
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatDate(dateStr) {
  if (!dateStr) return '-';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${minutes} น.`;
}

// -------------------------------------------------------------
// IMPORT REAL PERSONNEL DATA (CSV)
// -------------------------------------------------------------
function openImportCsvModal() {
  document.getElementById('csv-file-input').value = '';
  document.getElementById('csv-text-input').value = '';
  openModal('modal-import-csv');
}

function downloadCsvTemplate() {
  const downloadAnchor = document.createElement('a');
  downloadAnchor.setAttribute('href', '/FMO_Real_Personnel_Dataset.csv');
  downloadAnchor.setAttribute('download', `FMO_Real_Personnel_Dataset_${new Date().toISOString().slice(0,10)}.csv`);
  document.body.appendChild(downloadAnchor);
  downloadAnchor.click();
  downloadAnchor.remove();
  showToast('📊 ดาวน์โหลดตารางข้อมูลบุคลากรจริง 102 ท่านเทียบตามไฟล์ PDF (เปิดใน Microsoft Excel ได้ทันที) เรียบร้อยแล้ว!', 'success');
}

function handleCsvFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(e) {
    document.getElementById('csv-text-input').value = e.target.result;
    showToast('อ่านข้อมูลจากไฟล์ CSV เรียบร้อยแล้ว กรุณาตรวจสอบแล้วกด "ยืนยันนำเข้าข้อมูลจริง"', 'info');
  };
  reader.readAsText(file, 'UTF-8');
}

async function submitImportCsv() {
  const text = document.getElementById('csv-text-input').value.trim();
  if (!text) {
    showToast('กรุณาเลือกไฟล์ CSV หรือวางเนื้อหาข้อมูล CSV ก่อนนำเข้า', 'warning');
    return;
  }

  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length <= 1) {
    showToast('ไม่พบข้อมูลรายชื่อในไฟล์ CSV (มีเฉพาะแถวหัวข้อ)', 'warning');
    return;
  }

  const header = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const personnelList = [];

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i].trim();
    if (rawLine.startsWith('===') || rawLine.includes('ลำดับคิว') || rawLine.includes('รหัสพนักงาน')) continue;

    const cols = rawLine.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/).map(c => c.trim().replace(/^"|"$/g, ''));
    if (cols.length < 2) continue;

    let emp_code = cols[0] || '';
    let name = cols[1] || '';
    let position = cols[2] || '';
    let department = cols[3] || '';
    let role_type = cols[4] || (emp_code.startsWith('DIR') ? 'DIRECTOR' : 'STAFF');
    let email = cols[5] || '';

    // Handle shift if first column is numeric index
    if (/^\d+$/.test(emp_code)) {
      emp_code = cols[1] || '';
      name = cols[2] || '';
      position = cols[3] || '';
      department = cols[4] || '';
      email = cols[5] || '';
      role_type = cols[6] || (emp_code.startsWith('DIR') ? 'DIRECTOR' : 'STAFF');
    }

    if (name && !name.includes('ชื่อ-นามสกุล') && !name.includes('===') && !name.includes('ลำดับ')) {
      personnelList.push({ emp_code, name, position, department, role_type, email });
    }
  }

  if (personnelList.length === 0) {
    showToast('ไม่สามารถอ่านข้อมูลรายชื่อจากไฟล์ CSV ได้ กรุณาตรวจสอบรูปแบบคอลัมน์', 'danger');
    return;
  }

  try {
    const res = await fetch('/api/personnel/import-csv', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personnelList })
    });
    const result = await res.json();

    if (result.success) {
      showToast(`🎉 ${result.message}`, 'success');
      closeModal('modal-import-csv');
      loadQueueView('DIRECTOR');
      loadDashboardStats();
      loadPersonnelDropdown();
      previewCandidates();
    } else {
      showToast(`Error: ${result.error}`, 'danger');
    }
  } catch (err) {
    console.error('Import CSV error:', err);
    showToast('เกิดข้อผิดพลาดในการนำเข้าไฟล์ CSV', 'danger');
  }
}

// -------------------------------------------------------------
// TOAST NOTIFICATION SYSTEM
// -------------------------------------------------------------
function showToast(message, type = 'success') {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    document.body.appendChild(container);
  }

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  let icon = 'fa-circle-check text-emerald';
  if (type === 'warning') icon = 'fa-triangle-exclamation text-amber';
  else if (type === 'danger') icon = 'fa-circle-xmark text-danger';
  else if (type === 'info') icon = 'fa-circle-info text-cyan';

  toast.innerHTML = `
    <i class="fa-solid ${icon}" style="font-size: 1.25rem; flex-shrink: 0;"></i>
    <div style="flex: 1; line-height: 1.35;">${message}</div>
  `;

  container.appendChild(toast);

  setTimeout(() => {
    toast.remove();
  }, 4000);
}
