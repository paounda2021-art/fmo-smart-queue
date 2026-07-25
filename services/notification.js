// Notification Service (LINE Flex Message Card & Email Notification Dispatcher)
const { dbRun } = require('../db/database');

function formatDate24h(dateStr) {
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

/**
 * Generate LINE Flex Message Card JSON Payload
 */
function createLineFlexCardPayload(mission, directors, staff, isReallocation = false) {
  const headerTitle = isReallocation ? '🚨 แจ้งเตือนจัดสรรพนักงานแทนด่วน' : '📢 แจ้งคำสั่งจัดสรรกิจกรรม อสป.';
  const headerBgColor = isReallocation ? '#d97706' : '#0284c7';
  const timeStr = `${formatDate24h(mission.start_date)} - ${formatDate24h(mission.end_date)}`;

  const dirNamesStr = directors.map(d => `${d.name} (${d.position || 'ผอ.ฝ่าย'})`).join(', ') || '-';
  const staffList = staff.map(s => ({
    type: 'text',
    text: `• ${s.name} (${s.department || 'พนักงาน'})`,
    size: 'xs',
    color: '#334155',
    wrap: true
  }));

  const flexCardObj = {
    type: 'flex',
    altText: `${headerTitle}: ${mission.mission_title}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBgColor,
        paddingAll: '16px',
        contents: [
          { type: 'text', text: 'FMO SMART QUEUE SYSTEM', color: '#e0f2fe', size: 'xxs', weight: 'bold', letterSpacing: '1px' },
          { type: 'text', text: headerTitle, color: '#ffffff', size: 'md', weight: 'bold', margin: 'xs' }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          { type: 'text', text: mission.mission_title, weight: 'bold', size: 'md', color: '#0f172a', wrap: true },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'sm',
            spacing: 'xs',
            contents: [
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: '📍 สถานที่:', color: '#64748b', size: 'xs', flex: 2 },
                  { type: 'text', text: mission.location || 'สะพานปลา อสป.', color: '#1e293b', size: 'xs', flex: 5, wrap: true, weight: 'bold' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: '⏰ เวลา (24 ชม.):', color: '#64748b', size: 'xs', flex: 2 },
                  { type: 'text', text: timeStr, color: '#0284c7', size: 'xs', flex: 5, wrap: true, weight: 'bold' }
                ]
              },
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  { type: 'text', text: '👔 การแต่งกาย:', color: '#64748b', size: 'xs', flex: 2 },
                  { type: 'text', text: mission.dress_code || 'ชุดปฏิบัติงาน อสป.', color: '#a855f7', size: 'xs', flex: 5, wrap: true, weight: 'bold' }
                ]
              }
            ]
          },
          { type: 'separator', margin: 'md' },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'md',
            contents: [
              { type: 'text', text: '👔 หัวหน้าทีม (ผอ.ฝ่าย):', size: 'xs', color: '#64748b', weight: 'bold' },
              { type: 'text', text: dirNamesStr, size: 'xs', color: '#0f172a', weight: 'bold', margin: 'xs', wrap: true }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            margin: 'sm',
            contents: [
              { type: 'text', text: '👥 สมาชิกทีม (พนักงาน):', size: 'xs', color: '#64748b', weight: 'bold' },
              {
                type: 'box',
                layout: 'vertical',
                margin: 'xs',
                spacing: 'xs',
                contents: staffList.length > 0 ? staffList : [{ type: 'text', text: '-', size: 'xs' }]
              }
            ]
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#fef3c7',
            paddingAll: '10px',
            cornerRadius: '8px',
            margin: 'md',
            contents: [
              { type: 'text', text: '⏱️ ข้อปฏิบัติตน:', size: 'xxs', color: '#d97706', weight: 'bold' },
              { type: 'text', text: 'กรุณาเดินทางมาถึงสถานที่ปฏิบัติงานก่อนเวลาเริ่มอย่างน้อย 30 นาที', size: 'xxs', color: '#b45309', wrap: true, margin: 'xs' }
            ]
          }
        ]
      },
      footer: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'button',
            style: 'primary',
            color: '#10b981',
            height: 'sm',
            action: { type: 'uri', label: '🟢 กดรับทราบ', uri: 'http://localhost:3005' }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'uri', label: '🔴 ติดภารกิจ', uri: 'http://localhost:3005' }
          }
        ]
      }
    }
  };

  return JSON.stringify(flexCardObj);
}

/**
 * Dispatch Email & LINE Group Flex Message Notifications when an activity order is issued or re-allocated
 */
async function sendMissionNotification(mission, assignedList, isReallocation = false) {
  try {
    const directors = assignedList.filter(a => a.role_type === 'DIRECTOR' || a.is_leader === 1);
    const staff = assignedList.filter(a => a.role_type === 'STAFF' && a.is_leader !== 1);

    const timeStr = `${formatDate24h(mission.start_date)} - ${formatDate24h(mission.end_date)}`;
    const lineHeader = isReallocation ? '🚨 [แจ้งเตือนจัดสรรแทนด่วน]' : '📢 [คำสั่งจัดสรรกิจกรรม อสป.]';

    // 1. GENERATE BEAUTIFUL LINE FLEX CARD JSON
    const flexCardJson = createLineFlexCardPayload(mission, directors, staff, isReallocation);

    // Log LINE Group Dispatch with full Flex Message Card JSON
    await dbRun(`
      INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
      VALUES (?, NULL, 'LINE_GROUP', 'กลุ่มไลน์แจ้งเตือนภารกิจ อสป. (FMO Line Flex Card Group)', ?, ?, 'SENT')
    `, [mission.id, `${lineHeader} ${mission.mission_title}`, flexCardJson]);

    // 2. DISPATCH INDIVIDUAL EMAIL NOTIFICATIONS
    for (const person of assignedList) {
      const emailSubject = `[FMO Smart Queue] ${isReallocation ? 'แจ้งเตือนจัดสรรแทนด่วน' : 'แจ้งเตือนคำสั่งปฏิบัติกิจกรรม'}: ${mission.mission_title}`;
      
      const emailBody = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 600px;">
          <h2 style="color: #0284c7;">📢 แจ้งคำสั่งปฏิบัติกิจกรรม อสป.</h2>
          <p>เรียน คุณ <strong>${person.name}</strong> (${person.position} - ${person.department})</p>
          <p>ท่านได้รับการจัดสรรตามลำดับคิว Smart Queue ให้ปฏิบัติกิจกรรมดังนี้:</p>
          
          <div style="background: #f8fafc; padding: 15px; border-radius: 8px; margin: 15px 0;">
            <p style="margin: 4px 0;"><strong>กิจกรรม:</strong> ${mission.mission_title}</p>
            <p style="margin: 4px 0;"><strong>สถานที่:</strong> ${mission.location || '-'}</p>
            <p style="margin: 4px 0;"><strong>ช่วงเวลา (24 ชม.):</strong> ${timeStr}</p>
            <p style="margin: 4px 0;"><strong>การแต่งกาย:</strong> ${mission.dress_code || 'ชุดปฏิบัติงาน อสป.'}</p>
          </div>

          <p style="color: #d97706;"><strong>⏰ ข้อปฏิบัติตน:</strong> กรุณามาถึงสถานที่ปฏิบัติงานก่อนเวลาเริ่มอย่างน้อย 30 นาที</p>
          
          <div style="margin-top: 20px; padding-top: 15px; border-top: 1px solid #e2e8f0;">
            <p>กรุณากดตอบรับสถานะเข้าร่วมกิจกรรม:</p>
            <a href="http://localhost:3005" style="background: #10b981; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-right: 10px;">🟢 กดรับทราบ</a>
            <a href="http://localhost:3005" style="background: #ef4444; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold;">🔴 ติดภารกิจ (ขอสลับคิว)</a>
          </div>
        </div>
      `;

      await dbRun(`
        INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
        VALUES (?, ?, 'EMAIL', ?, ?, ?, 'SENT')
      `, [mission.id, person.personnel_id || person.id, person.email || `${person.emp_code.toLowerCase()}@fmo.or.th`, emailSubject, emailBody]);
    }

    return true;
  } catch (err) {
    console.error('Notification dispatch error:', err);
    return false;
  }
}

module.exports = {
  sendMissionNotification,
  formatDate24h,
  createLineFlexCardPayload
};
