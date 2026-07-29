// Notification Service (LINE Flex Message Card & Email Notification Dispatcher)
const axios = require('axios');
const { dbRun } = require('../db/database');

// 💡 ตั้งค่า URL หลักของระบบ ใช้สำหรับใส่ในลิงก์ปุ่มของ Flex Message / Email
// แก้ผ่าน .env ได้ด้วยการตั้งค่า APP_BASE_URL ถ้าต้องการเปลี่ยน domain
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://fmo-smart-queue.fishmarket.co.th/app';

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

function formatLeaderTitle(person) {
  if (!person) return '-';
  const name = person.name || person.person_name || '-';
  const pos = String(person.position || person.department || '').trim();
  const empCode = String(person.emp_code || '').trim().toUpperCase();

  const cleanName = name.replace(/\s*\([^)]*\)/g, '').trim();

  let title = '';
  if (empCode === 'DIR-09' || pos.includes('ผู้อำนวยการองค์การสะพานปลา') || pos.includes('ผออ.')) {
    title = 'ผออ.';
  } else if (empCode === 'DIR-10' || pos.includes('รองผู้อำนวยการ') || pos.includes('รผอ.') || pos.includes('รผอ.บร.')) {
    title = 'รผอ.บร.';
  } else if (pos) {
    title = pos;
  } else {
    title = 'ผอ.ฝ่าย';
  }

  return title ? `${cleanName} (${title})` : cleanName;
}

function resolveLeaderPerson(directors = [], assignedList = []) {
  const combined = [...(directors || []), ...(assignedList || [])];
  if (combined.length === 0) return null;

  const execLeader = combined.find(p => {
    const code = String(p.emp_code || '').trim().toUpperCase();
    const pos = String(p.position || p.department || '').trim();
    return (
      code === 'DIR-09' ||
      code === 'DIR-10' ||
      pos.includes('ผู้อำนวยการองค์การสะพานปลา') ||
      pos.includes('ผออ.') ||
      pos.includes('รองผู้อำนวยการ') ||
      pos.includes('รผอ.')
    );
  });
  if (execLeader) return execLeader;

  const isLeaderPerson = combined.find(p => Number(p.is_leader) === 1);
  if (isLeaderPerson) return isLeaderPerson;

  const directorPerson = combined.find(p => String(p.role_type || '').toUpperCase() === 'DIRECTOR');
  if (directorPerson) return directorPerson;

  return combined[0] || null;
}

/**
 * Generate LINE Flex Message Card JSON Payload
 */
function createLineFlexCardPayload(mission, directors, staff, isReallocation = false, assignedList = []) {
  const teamLeader = resolveLeaderPerson(directors, assignedList);
  const teamLeaderName = formatLeaderTitle(teamLeader);

  const headerTitle = isReallocation
  ? '🚨 แจ้งเตือนจัดสรรคิวแทน'
  : '📢 แจ้งคำสั่งจัดสรรคิวกิจกรรม อสป.';
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
          { type: 'text', text: 'FMO SMART QUEUE SYSTEM', color: '#e0f2fe', size: 'xxs', weight: 'bold' },
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
                  {
                    type: 'text',
                    text: '👔 หัวหน้าคณะ:',
                    color: '#64748b',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: teamLeaderName,
                    color: '#1e293b',
                    size: 'xs',
                    flex: 5,
                    wrap: true,
                    weight: 'bold'
                  }
                ]
              },

              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: '📍 สถานที่:',
                    color: '#64748b',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: mission.location || 'สะพานปลา อสป.',
                    color: '#1e293b',
                    size: 'xs',
                    flex: 5,
                    wrap: true,
                    weight: 'bold'
                  }
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
            action: { type: 'uri', label: '\ud83d\udfe2 \u0e14\u0e39\u0e23\u0e32\u0e22\u0e25\u0e30\u0e40\u0e2d\u0e35\u0e22\u0e14', uri: APP_BASE_URL }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: { type: 'uri', label: '\ud83d\udd14 \u0e40\u0e1b\u0e34\u0e14\u0e40\u0e27\u0e47\u0e1a', uri: APP_BASE_URL }
          }
        ]
      }
    }
  };

  return JSON.stringify(flexCardObj);
}


function generateGoogleCalendarUrl(mission) {
  if (!mission) return 'https://calendar.google.com';
  
  const titleStr = String(mission.mission_title || 'กิจกรรม อสป.').slice(0, 80);
  const locationStr = String(mission.location || 'สะพานปลา อสป.').slice(0, 80);
  const dressStr = String(mission.dress_code || 'ชุดปฏิบัติงาน อสป.').slice(0, 60);
  const descStr = String(mission.description || '-').slice(0, 120);

  const title = encodeURIComponent(titleStr);
  const location = encodeURIComponent(locationStr);
  const details = encodeURIComponent(`การแต่งกาย: ${dressStr}\nรายละเอียด: ${descStr}`);
  
  const formatDateToGCal = (dateStr) => {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return '';
    return d.toISOString().replace(/-|:|\.\d\d\d/g, '');
  };

  const startGCal = formatDateToGCal(mission.start_date);
  const endGCal = formatDateToGCal(mission.end_date) || startGCal;

  if (!startGCal) return 'https://calendar.google.com';

  let url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startGCal}/${endGCal}&details=${details}&location=${location}`;
  
  if (url.length > 950) {
    url = `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${title}&dates=${startGCal}/${endGCal}`;
  }
  return url;
}


/**
 * Generate per-person Flex Card with personalized postback buttons
 * missionId and personnelId embedded so LINE webhook can handle ACK directly
 */
function createPersonalizedFlexCard(

  mission,
  person,
  isReallocation = false,
  teamLeaderName = '-'
) {
  const missionId = mission.id;
  const personnelId = person.personnel_id || person.id;

  const headerTitle = isReallocation
    ? '🚨 แจ้งเตือนจัดสรรคิวแทน'
    : '📢 แจ้งคำสั่งจัดสรรคิวกิจกรรม อสป.';

  const headerBgColor = isReallocation
    ? '#d97706'
    : '#0284c7';

  const timeStr =
    `${formatDate24h(mission.start_date)} - ` +
    `${formatDate24h(mission.end_date)}`;

  return {
    type: 'flex',

    altText: `${headerTitle}: ${mission.mission_title}`,

    // ห้ามลบ contents ชั้นนี้
    contents: {
      type: 'bubble',
      size: 'mega',

      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: headerBgColor,
        paddingAll: '16px',

        contents: [
          {
            type: 'text',
            text: 'FMO SMART QUEUE SYSTEM',
            color: '#e0f2fe',
            size: 'xxs',
            weight: 'bold'
          },
          {
            type: 'text',
            text: headerTitle,
            color: '#ffffff',
            size: 'md',
            weight: 'bold',
            margin: 'xs',
            wrap: true
          },

          // แสดงชื่อผู้ถูกแทนเฉพาะการ์ดสีส้ม
          ...(isReallocation
            ? [
                {
                  type: 'separator',
                  color: '#fbbf24',
                  margin: 'md'
                },
                {
                  type: 'text',
                  text:
                    `👤 ปฏิบัติงานแทน : ` +
                    `${person.substitute_for_name || '-'}`,
                  color: '#ffffff',
                  size: 'xs',
                  weight: 'bold',
                  wrap: true,
                  margin: 'md'
                }
              ]
            : [])
        ]
      },

      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',

        contents: [
          {
            type: 'text',
            text: mission.mission_title || '-',
            weight: 'bold',
            size: 'md',
            color: '#0f172a',
            wrap: true
          },
          {
            type: 'text',
            text: `👤 เรียน: ${person.name || '-'}`,
            size: 'sm',
            color: '#0284c7',
            weight: 'bold',
            margin: 'sm',
            wrap: true
          },

          {
            type: 'box',
            layout: 'vertical',
            margin: 'sm',
            spacing: 'xs',

            contents: [
              // บังคับแสดงหัวหน้าคณะเป็นบรรทัดแรกก่อนสถานที่เสมอ
              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: '👔 หัวหน้าคณะ:',
                    color: '#64748b',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: person.team_leader_name || teamLeaderName || '-',
                    color: '#1e293b',
                    size: 'xs',
                    flex: 5,
                    wrap: true,
                    weight: 'bold'
                  }
                ]
              },



              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: '📍 สถานที่:',
                    color: '#64748b',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text:
                      mission.location ||
                      'สะพานปลา อสป.',
                    color: '#1e293b',
                    size: 'xs',
                    flex: 5,
                    wrap: true,
                    weight: 'bold'
                  }
                ]
              },

              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: '⏰ เวลา:',
                    color: '#64748b',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text: timeStr,
                    color: '#0284c7',
                    size: 'xs',
                    flex: 5,
                    wrap: true,
                    weight: 'bold'
                  }
                ]
              },

              {
                type: 'box',
                layout: 'baseline',
                spacing: 'sm',
                contents: [
                  {
                    type: 'text',
                    text: '👔 การแต่งกาย:',
                    color: '#64748b',
                    size: 'xs',
                    flex: 2
                  },
                  {
                    type: 'text',
                    text:
                      mission.dress_code ||
                      'ชุดปฏิบัติงาน อสป.',
                    color: '#a855f7',
                    size: 'xs',
                    flex: 5,
                    wrap: true,
                    weight: 'bold'
                  }
                ]
              },

              ...(mission.description && String(mission.description).trim()
                ? [
                    {
                      type: 'box',
                      layout: 'vertical',
                      margin: 'sm',
                      spacing: 'xs',

                      contents: [
                        {
                          type: 'text',
                          text: '📝 รายละเอียด/กำหนดการ:',
                          color: '#64748b',
                          size: 'xs',
                          weight: 'bold'
                        },
                        {
                          type: 'text',
                          text: String(mission.description).trim(),
                          color: '#334155',
                          size: 'xs',
                          wrap: true,
                          margin: 'xs'
                        }
                      ]
                    }
                  ]
                : [])
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
              {
                type: 'text',
                text: '⏱️ ข้อปฏิบัติตน:',
                size: 'xxs',
                color: '#d97706',
                weight: 'bold'
              },
              {
                type: 'text',
                text:
                  'กรุณาเดินทางมาถึงสถานที่ปฏิบัติงาน' +
                  'ก่อนเวลาเริ่มอย่างน้อย 30 นาที',
                size: 'xxs',
                color: '#b45309',
                wrap: true,
                margin: 'xs'
              }
            ]
          }
        ]
      },

      footer: {
        type: 'box',
        layout: 'vertical',
        spacing: 'sm',
        paddingAll: '12px',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            spacing: 'sm',
            contents: isReallocation
              ? [
                  {
                    type: 'button',
                    style: 'primary',
                    color: '#10b981',
                    height: 'sm',
                    action: {
                      type: 'postback',
                      label: '🟢 กดรับทราบ',
                      data: `ACK|${missionId}|${personnelId}`,
                      displayText: '✅ รับทราบกิจกรรมแล้ว'
                    }
                  }
                ]
              : [
                  {
                    type: 'button',
                    style: 'primary',
                    color: '#10b981',
                    height: 'sm',
                    action: {
                      type: 'postback',
                      label: '🟢 กดรับทราบ',
                      data: `ACK|${missionId}|${personnelId}`,
                      displayText: '✅ รับทราบกิจกรรมแล้ว'
                    }
                  },
                  {
                    type: 'button',
                    style: 'secondary',
                    height: 'sm',
                    action: {
                      type: 'postback',
                      label: '🔴 ติดภารกิจ',
                      data: `BUSY|${missionId}|${personnelId}`,
                      displayText: 'กรุณาพิมพ์รหัสผู้ปฏิบัติงานแทน'
                    }
                  }
                ]
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            color: '#0284c7',
            action: {
              type: 'uri',
              label: '📅 บันทึกลงปฏิทินมือถือ',
              uri: generateGoogleCalendarUrl(mission)
            }
          }
        ]
      }
    }
  };
}



async function sendMissionNotification(mission, assignedList, isReallocation = false) {
  try {
    const directors = assignedList.filter(
      a =>
        String(a.role_type || '').trim().toUpperCase() === 'DIRECTOR' ||
        Number(a.is_leader) === 1
    );

    const staff = assignedList.filter(
      a =>
        String(a.role_type || '').trim().toUpperCase() === 'STAFF' &&
        Number(a.is_leader) !== 1
    );

    let teamLeader =
      directors.find(item => Number(item.is_leader) === 1) ||
      directors[0] ||
      null;

    if (!teamLeader && mission?.id) {
      try {
        const { dbGet } = require('../db/database');
        const leaderInDb = await dbGet(`
          SELECT p.name, p.position, p.department, p.emp_code, ma.is_leader, ma.role_type
          FROM mission_assignments ma
          JOIN personnel p ON p.id = ma.personnel_id
          WHERE ma.mission_id = ? AND (ma.is_leader = 1 OR UPPER(ma.role_type) = 'DIRECTOR')
          ORDER BY ma.is_leader DESC, p.id ASC LIMIT 1;
        `, [mission.id]);

        if (leaderInDb) {
          teamLeader = leaderInDb;
        }
      } catch (e) {
        console.error('Error fetching team leader from DB:', e);
      }
    }

    const teamLeaderName = formatLeaderTitle(teamLeader);


    const timeStr = `${formatDate24h(mission.start_date)} - ${formatDate24h(mission.end_date)}`;
    const lineHeader = isReallocation ? '🚨 [แจ้งเตือนจัดสรรแทนด่วน]' : '📢 [คำสั่งจัดสรรกิจกรรม อสป.]';

    // 1. GENERATE BEAUTIFUL LINE FLEX CARD JSON
    
    const flexCardJson = createLineFlexCardPayload(
      mission,
      directors,
      staff,
      isReallocation,
      assignedList
    );

    // 💡 ส่งจริงเข้ากลุ่ม LINE ถ้ามีการตั้งค่า LINE_GROUP_ID + LINE_CHANNEL_ACCESS_TOKEN ไว้ใน .env
    // (เดิมโค้ดส่วนนี้แค่บันทึกลง log แต่ไม่เคยส่งเข้ากลุ่มจริงเลย เพราะไม่มี groupId ให้ยิงไป)
    const groupToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    const lineGroupId = process.env.LINE_GROUP_ID;
    let groupSendStatus = 'SENT'; // สถานะที่จะบันทึกลง notification_logs

    if (lineGroupId && groupToken) {
      try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
          to: lineGroupId,
          messages: [JSON.parse(flexCardJson)]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${groupToken}`
          }
        });
        console.log('✅ ส่ง LINE เข้ากลุ่มสำเร็จ');
      } catch (groupError) {
        console.error('❌ ส่ง LINE เข้ากลุ่มไม่สำเร็จ:', groupError.response?.data || groupError.message);
        groupSendStatus = 'FAILED';
      }
    } else {
      console.warn('⚠️ ไม่ได้ตั้งค่า LINE_GROUP_ID ใน .env ระบบจะบันทึก log ไว้เฉยๆ แต่ไม่ได้ส่งเข้ากลุ่ม LINE จริง');
    }

    // Log LINE Group Dispatch with full Flex Message Card JSON
    await dbRun(`
      INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
      VALUES (?, NULL, 'LINE_GROUP', 'กลุ่มไลน์แจ้งเตือนภารกิจ อสป. (FMO Line Flex Card Group)', ?, ?, ?)
    `, [mission.id, `${lineHeader} ${mission.mission_title}`, flexCardJson, groupSendStatus]);

    // 2. DISPATCH INDIVIDUAL EMAIL NOTIFICATIONS
    for (const person of assignedList) {
      const emailSubject = `[FMO Smart Queue] ${isReallocation ? 'แจ้งเตือนจัดสรรแทนด่วน' : 'แจ้งเตือนคำสั่งจัดสรรคิวกิจกรรม'}: ${mission.mission_title}`;
      
      const emailBody = `
        <div style="font-family: sans-serif; padding: 20px; border: 1px solid #e2e8f0; border-radius: 12px; max-width: 600px;">
          <h2 style="color: #0284c7;">📢 แจ้งคำสั่งจัดสรรคิวกิจกรรม อสป.</h2>
          <p>เรียน: <strong>${person.name}</strong> (${person.position} - ${person.department})</p>
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
            <a href="${APP_BASE_URL}" style="background: #10b981; color: white; padding: 10px 18px; border-radius: 6px; text-decoration: none; font-weight: bold; margin-right: 10px;">🟢 กดรับทราบ</a>
          </div>
        </div>
      `;

      await dbRun(`
        INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
        VALUES (?, ?, 'EMAIL', ?, ?, ?, 'SENT')
      `, [mission.id, person.personnel_id || person.id, person.email || `${person.emp_code.toLowerCase()}@fishmarket.co.th`, emailSubject, emailBody]);
    }

    // 3. DISPATCH LINE PUSH MESSAGES TO ASSIGNED PERSONNEL
    // ใช้ createPersonalizedFlexCard แทนเพื่อให้ปุ่มมี postback data เฉพาะบุคคล
    const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

    if (!lineToken) {
      console.warn('⚠️ ไม่ได้ตั้งค่า LINE_CHANNEL_ACCESS_TOKEN ใน .env ระบบจะไม่ส่ง LINE push message ให้ใครเลย');
    }

    for (const person of assignedList) {
      if (!lineToken) continue;

      const targetLineId = String(person.line_user_id || '').trim();
      if (!targetLineId || targetLineId.toLowerCase() === 'email') {
        console.log(`ℹ️ ${person.name} (${person.emp_code || '-'}) กำหนดช่องทางแจ้งเตือนเป็นอีเมล (email) จึงข้ามการส่ง LINE ให้คนนี้`);
        continue;
      }

      // สร้าง Flex Card เฉพาะบุคคล พร้อมปุ่ม postback (ACK|missionId|personnelId)
      const personalCard = createPersonalizedFlexCard(
        mission,
        person,
        isReallocation,
        teamLeaderName
      );

      try {
        await axios.post('https://api.line.me/v2/bot/message/push', {
          to: person.line_user_id,
          messages: [personalCard]
        }, {
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${lineToken}`
          }
        });
        console.log(`✅ ส่ง LINE Flex Card ให้ ${person.name} สำเร็จ (isReallocation = ${isReallocation})`);

        await dbRun(`
          INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
          VALUES (?, ?, 'LINE', ?, ?, ?, 'SENT')
        `, [mission.id, person.personnel_id || person.id, person.name, `${lineHeader} ${mission.mission_title}`, JSON.stringify(personalCard)]);
      } catch (lineError) {
        console.error(`❌ ส่ง LINE ให้ ${person.name} ไม่สำเร็จ:`, lineError.response?.data || lineError.message);
        await dbRun(`
          INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
          VALUES (?, ?, 'LINE', ?, ?, ?, 'FAILED')
        `, [mission.id, person.personnel_id || person.id, person.name, `${lineHeader} ${mission.mission_title}`, lineError.message]);
      }
    }


    return true;

  } catch (err) {
    console.error('Notification dispatch error:', err);
    return false;
  }
}

/**
 * Send Upcoming Queue Notice to Top Candidates in WAITING queue via mapped channel (LINE or Email)
 */
async function sendUpcomingQueueNotice() {
  try {
    const { dbAll } = require('../db/database');
    
    const topDirectors = await dbAll(`
      SELECT p.*, q.current_round, q.queue_order, q.status AS queue_status
      FROM queue_state q
      JOIN personnel p ON p.id = q.personnel_id
      WHERE p.role_type = 'DIRECTOR' AND q.status = 'WAITING'
      ORDER BY q.queue_order ASC
      LIMIT 3
    `);

    const topStaff = await dbAll(`
      SELECT p.*, q.current_round, q.queue_order, q.status AS queue_status
      FROM queue_state q
      JOIN personnel p ON p.id = q.personnel_id
      WHERE p.role_type = 'STAFF' AND q.status = 'WAITING'
      ORDER BY q.queue_order ASC
      LIMIT 5
    `);

    const candidates = [...topDirectors, ...topStaff];
    if (candidates.length === 0) {
      return { success: true, count: 0, message: 'ไม่พบบุคลากรที่รอคิวในระบบ' };
    }

    const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    let sentCount = 0;

    for (const person of candidates) {
      const lineId = String(person.line_user_id || '').trim();
      const roleLabel = person.role_type === 'DIRECTOR' ? 'ผอ.ฝ่าย' : 'พนักงาน';
      const orderText = `ลำดับที่ #${person.queue_order} (${roleLabel})`;

      if (lineToken && lineId && lineId.toLowerCase() !== 'email') {
        const upcomingFlexPayload = {
          type: 'flex',
          altText: `📢 แจ้งเตือนเตรียมพร้อมลำดับคิว อสป.: คุณอยู่อันดับ ${orderText}`,
          contents: {
            type: 'bubble',
            header: {
              type: 'box',
              layout: 'vertical',
              backgroundColor: '#0284c7',
              paddingAll: '16px',
              contents: [
                { type: 'text', text: 'FMO SMART QUEUE SYSTEM', color: '#e0f2fe', size: 'xxs', weight: 'bold' },
                { type: 'text', text: '📢 แจ้งเตือนเตรียมพร้อมลำดับคิว (อสป.)', color: '#ffffff', size: 'sm', weight: 'bold', margin: 'xs', wrap: true }
              ]
            },
            body: {
              type: 'box',
              layout: 'vertical',
              paddingAll: '16px',
              spacing: 'md',
              contents: [
                { type: 'text', text: `👤 เรียน: คุณ ${person.name}`, weight: 'bold', size: 'sm', color: '#0f172a', wrap: true },
                {
                  type: 'box',
                  layout: 'vertical',
                  backgroundColor: '#f0f9ff',
                  paddingAll: '12px',
                  cornerRadius: '10px',
                  contents: [
                    { type: 'text', text: `📊 ตำแหน่งคิวปัจจุบัน: ${orderText}`, size: 'xs', color: '#0284c7', weight: 'bold' },
                    { type: 'text', text: `🔄 รอบปฏิบัติงาน: รอบที่ ${person.current_round || 1}`, size: 'xs', color: '#64748b', margin: 'xs' },
                    { type: 'text', text: '💡 ท่านกำลังจะถึงคิวได้รับการจัดสรรในกิจกรรมถัดไป', size: 'xs', color: '#0f172a', margin: 'sm', wrap: true }
                  ]
                },
                { type: 'text', text: 'หากท่านติดภารกิจล่วงหน้า สามารถเตรียมการหาคนแทนหรือยื่นแจ้งลาล่วงหน้าได้ค่ะ', size: 'xs', color: '#475569', wrap: true }
              ]
            }
          }
        };

        try {
          await axios.post('https://api.line.me/v2/bot/message/push', {
            to: lineId,
            messages: [upcomingFlexPayload]
          }, {
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` }
          });

          await dbRun(`
            INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
            VALUES (NULL, ?, 'LINE', ?, '📢 แจ้งเตือนเตรียมพร้อมลำดับคิว', 'ส่งการ์ดแจ้งเตือนคิวถัดไปทาง LINE สำเร็จ', 'SENT')
          `, [person.id, lineId]);

          sentCount++;
        } catch (lineErr) {
          console.error(`Error pushing upcoming queue LINE to ${person.name}:`, lineErr.message);
        }
      } else {
        const targetEmail = person.email || `${String(person.emp_code).toLowerCase()}@fishmarket.co.th`;
        const emailSubject = `📢 แจ้งเตือนเตรียมพร้อมลำดับคิว อสป. (คุณอยู่ในลำดับคิวถัดไป)`;
        const emailBody = `
          <div style="font-family: Sarabun, sans-serif; padding: 20px; border: 1px solid #0284c7; border-radius: 10px; max-width: 600px;">
            <h2 style="color: #0284c7;">📢 แจ้งเตือนเตรียมความพร้อมลำดับคิว (อสป.)</h2>
            <p>เรียน คุณ <strong>${person.name}</strong> (${person.position || 'พนักงาน อสป.'}),</p>
            <div style="background: #f0f9ff; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid #bae6fd;">
              <p style="margin: 4px 0; color: #0284c7;"><strong>📊 ตำแหน่งคิวปัจจุบัน:</strong> ${orderText}</p>
              <p style="margin: 4px 0; color: #64748b;"><strong>🔄 รอบปฏิบัติงาน:</strong> รอบที่ ${person.current_round || 1}</p>
              <p style="margin: 4px 0; color: #0f172a;"><strong>💡 ท่านกำลังจะถึงคิวได้รับการจัดสรรในกิจกรรมถัดไป</strong></p>
            </div>
            <p style="color: #475569;">หากท่านติดภารกิจล่วงหน้า สามารถเตรียมการหาคนแทนหรือยื่นแจ้งลาล่วงหน้าได้ค่ะ</p>
          </div>
        `;

        await dbRun(`
          INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
          VALUES (NULL, ?, 'EMAIL', ?, ?, ?, 'SENT')
        `, [person.id, targetEmail, emailSubject, emailBody]);

        sentCount++;
      }
    }

    return { success: true, count: sentCount, message: `ส่งแจ้งเตือนเตรียมพร้อมคิวถัดไปสำเร็จ ${sentCount} ท่าน` };
  } catch (err) {
    console.error('Error sending upcoming queue notice:', err);
    return { success: false, error: err.message };
  }
}

/**
 * Dispatch Pre-Event Reminders Automatically (24h & 2h in advance) via mapped channel (LINE/Email)
 */
async function dispatchPreEventReminders() {
  try {
    const { dbAll, dbRun } = require('../db/database');

    const upcomingMissions = await dbAll(`
      SELECT m.*
      FROM missions m
      WHERE m.start_date >= DATETIME('now')
        AND m.start_date <= DATETIME('now', '+24 hours')
        AND m.status IN ('SCHEDULED', 'SUCCESS')
    `);

    if (upcomingMissions.length === 0) {
      return { success: true, count: 0, message: 'ไม่พบกิจกรรมที่จะจัดขึ้นในอีก 24 ชั่วโมงข้างหน้า' };
    }

    const lineToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
    let totalReminded = 0;

    for (const mission of upcomingMissions) {
      const assigned = await dbAll(`
        SELECT ma.*, p.name, p.emp_code, p.position, p.email, p.line_user_id
        FROM mission_assignments ma
        JOIN personnel p ON ma.personnel_id = p.id
        WHERE ma.mission_id = ?
          AND ma.assignment_status IN ('JOINED', 'SUBSTITUTED')
      `, [mission.id]);

      const timeStr = `${formatDate24h(mission.start_date)} - ${formatDate24h(mission.end_date)}`;

      const nowMs = new Date().getTime();
      const startMs = new Date(mission.start_date).getTime();
      const diffHours = (startMs - nowMs) / (1000 * 60 * 60);

      const isUrgent2h = (diffHours <= 2.5 && diffHours >= 0);
      const reminderTag = isUrgent2h ? '🔔 เตือนด่วน (อีก 1-2 ชม.)' : '🔔 เตือนความจำล่วงหน้า (24 ชม.)';

      for (const person of assigned) {
        const alreadySent = await dbAll(`
          SELECT id FROM notification_logs
          WHERE mission_id = ? AND personnel_id = ? AND subject_title LIKE ?
        `, [mission.id, person.id, `%${reminderTag}%`]);

        if (alreadySent.length > 0) continue;

        const lineId = String(person.line_user_id || '').trim();

        if (lineToken && lineId && lineId.toLowerCase() !== 'email') {
          const reminderCard = {
            type: 'flex',
            altText: `${reminderTag}: ${mission.mission_title}`,
            contents: {
              type: 'bubble',
              header: {
                type: 'box',
                layout: 'vertical',
                backgroundColor: isUrgent2h ? '#fcf997' : '#d97706',
                paddingAll: '16px',
                contents: [
                  { type: 'text', text: 'FMO SMART QUEUE AUTOMATED SYSTEM', color: '#fef3c7', size: 'xxs', weight: 'bold' },
                  { type: 'text', text: `${reminderTag}`, color: '#ffffff', size: 'md', weight: 'bold', margin: 'xs', wrap: true }
                ]
              },
              body: {
                type: 'box',
                layout: 'vertical',
                paddingAll: '16px',
                spacing: 'md',
                contents: [
                  { type: 'text', text: mission.mission_title, weight: 'bold', size: 'md', color: '#0f172a', wrap: true },
                  { type: 'text', text: `👤 เรียน: คุณ ${person.name}`, size: 'sm', color: isUrgent2h ? '#dc2626' : '#d97706', weight: 'bold', wrap: true },
                  {
                    type: 'box',
                    layout: 'vertical',
                    margin: 'sm',
                    spacing: 'xs',
                    contents: [
                      { type: 'text', text: `📍 สถานที่: ${mission.location || 'สะพานปลา อสป.'}`, size: 'xs', color: '#1e293b', wrap: true },
                      { type: 'text', text: `⏰ เวลาเริ่มงาน (24 ชม.): ${timeStr}`, size: 'xs', color: isUrgent2h ? '#dc2626' : '#d97706', weight: 'bold' },
                      { type: 'text', text: `👔 การแต่งกาย: ${mission.dress_code || 'ชุดปฏิบัติงาน อสป.'}`, size: 'xs', color: '#a855f7', wrap: true }
                    ]
                  },
                  {
                    type: 'box',
                    layout: 'vertical',
                    backgroundColor: isUrgent2h ? '#fee2e2' : '#fef3c7',
                    paddingAll: '10px',
                    cornerRadius: '8px',
                    margin: 'md',
                    contents: [
                      { type: 'text', text: isUrgent2h ? '🚨 งานกำลังจะเริ่มขึ้นในอีก 1-2 ชั่วโมง! กรุณาเตรียมพร้อมปฏิบัติงานทันที' : '⏱️ กรุณามาถึงสถานที่ปฏิบัติงานก่อนเวลาเริ่มอย่างน้อย 30 นาที', size: 'xxs', color: isUrgent2h ? '#991b1b' : '#b45309', wrap: true }
                    ]
                  }
                ]
              }
            }
          };

          try {
            await axios.post('https://api.line.me/v2/bot/message/push', {
              to: lineId,
              messages: [reminderCard]
            }, {
              headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${lineToken}` }
            });

            await dbRun(`
              INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
              VALUES (?, ?, 'LINE', ?, ?, 'ส่งระบบแจ้งเตือนอัตโนมัติล่วงหน้าสำเร็จ', 'SENT')
            `, [mission.id, person.id, lineId, reminderTag]);

            totalReminded++;
          } catch (err) {
            console.error(`Error sending LINE reminder to ${person.name}:`, err.message);
          }
        } else {
          const targetEmail = person.email || `${String(person.emp_code).toLowerCase()}@fishmarket.co.th`;
          const emailSubject = `${reminderTag}: ${mission.mission_title}`;
          const emailBody = `
            <div style="font-family: Sarabun, sans-serif; padding: 20px; border: 1px solid ${isUrgent2h ? '#dcdc26' : '#d9cb06'}; border-radius: 10px; max-width: 600px;">
              <h2 style="color: ${isUrgent2h ? '#dcdc26' : '#d9cb06'};">${reminderTag}</h2>
              <p>เรียน คุณ <strong>${person.name}</strong>,</p>
              <p>ระบบอัตโนมัติขอแจ้งเตือนความจำปฏิบัติหน้าที่ในกิจกรรม <strong>${mission.mission_title}</strong></p>
              <div style="background: ${isUrgent2h ? '#fff5f5' : '#fffbeb'}; padding: 15px; border-radius: 8px; margin: 15px 0; border: 1px solid ${isUrgent2h ? '#fca5a5' : '#fde68a'};">
                <p style="margin: 4px 0;"><strong>📍 สถานที่:</strong> ${mission.location || '-'}</p>
                <p style="margin: 4px 0;"><strong>⏰ เวลา (24 ชม.):</strong> ${timeStr}</p>
                <p style="margin: 4px 0;"><strong>👔 การแต่งกาย:</strong> ${mission.dress_code || 'ชุดปฏิบัติงาน อสป.'}</p>
              </div>
              <p style="color: ${isUrgent2h ? '#991b1b' : '#b45309'}; font-weight: bold;">
                ${isUrgent2h ? '🚨 งานกำลังจะเริ่มขึ้นในอีก 1-2 ชั่วโมง! กรุณาเตรียมพร้อมปฏิบัติงานทันที' : '⏱️ กรุณาเดินทางมาถึงสถานที่ปฏิบัติงานก่อนเวลาเริ่มอย่างน้อย 30 นาที ขอบคุณค่ะ'}
              </p>
            </div>
          `;

          await dbRun(`
            INSERT INTO notification_logs (mission_id, personnel_id, channel, recipient, subject_title, content_body, status)
            VALUES (?, ?, 'EMAIL', ?, ?, ?, 'SENT')
          `, [mission.id, person.id, targetEmail, emailSubject, emailBody]);

          totalReminded++;
        }
      }
    }

    return { success: true, count: totalReminded, message: `ส่งเตือนความจำล่วงหน้าอัตโนมัติสำเร็จ ${totalReminded} รายการ` };
  } catch (err) {
    console.error('Error dispatching pre-event reminders:', err);
    return { success: false, error: err.message };
  }
}

/**
 * สร้าง LINE Flex Card สีม่วง ขอคำยินยอมสลับลำดับคิวถาวร (Peer Swap Consent Card)
 */
function createPeerSwapConsentFlexCard(swapId, requester, target, reason) {
  return {
    type: 'flex',
    altText: `🔄 คำขอสลับลำดับคิวถาวรจาก คุณ ${requester.name}`,
    contents: {
      type: 'bubble',
      size: 'mega',
      header: {
        type: 'box',
        layout: 'vertical',
        backgroundColor: '#a855f7',
        paddingAll: '16px',
        contents: [
          {
            type: 'text',
            text: 'FMO SMART QUEUE SYSTEM',
            color: '#f3e8ff',
            size: 'xxs',
            weight: 'bold'
          },
          {
            type: 'text',
            text: '🔄 คำขอสลับลำดับคิวถาวร (Peer Swap)',
            color: '#ffffff',
            size: 'md',
            weight: 'bold',
            margin: 'xs',
            wrap: true
          }
        ]
      },
      body: {
        type: 'box',
        layout: 'vertical',
        paddingAll: '16px',
        spacing: 'md',
        contents: [
          {
            type: 'text',
            text: `👤 ผู้ขอสลับคิว: คุณ ${requester.name} (${requester.emp_code})`,
            weight: 'bold',
            size: 'sm',
            color: '#0f172a',
            wrap: true
          },
          {
            type: 'text',
            text: `📊 ลำดับคิวปัจจุบันของผู้ขอ: คิวที่ #${requester.queue_order}`,
            size: 'xs',
            color: '#0284c7',
            weight: 'bold'
          },
          {
            type: 'separator',
            color: '#e2e8f0',
            margin: 'md'
          },
          {
            type: 'text',
            text: `🔁 มีความประสงค์ขอสลับคิวกับ: คุณ ${target.name} (คิวที่ #${target.queue_order})`,
            size: 'xs',
            color: '#a855f7',
            weight: 'bold',
            wrap: true
          },
          {
            type: 'text',
            text: `📝 เหตุผลที่ระบุ: ${reason || 'ขอสลับคิวตามข้อตกลงร่วมกัน'}`,
            size: 'xs',
            color: '#475569',
            wrap: true
          },
          {
            type: 'box',
            layout: 'vertical',
            backgroundColor: '#f3e8ff',
            paddingAll: '10px',
            cornerRadius: '8px',
            margin: 'md',
            contents: [
              {
                type: 'text',
                text: '📌 หมายเหตุการสลับคิว:',
                size: 'xxs',
                color: '#7e22ce',
                weight: 'bold'
              },
              {
                type: 'text',
                text: `หากคุณกดยินยอม ลำดับคิวของคุณ (${target.name}) จะเปลี่ยนเป็น #${requester.queue_order} และลำดับคิวของคุณ (${requester.name}) จะเปลี่ยนเป็น #${target.queue_order} ในรอบปัจจุบัน`,
                size: 'xxs',
                color: '#6b21a8',
                wrap: true,
                margin: 'xs'
              }
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
            action: {
              type: 'postback',
              label: '🟢 ยินยอมสลับคิว',
              data: `SWAP_ACCEPT|${swapId}|${requester.id}|${target.id}`,
              displayText: '✅ ยินยอมสลับลำดับคิว'
            }
          },
          {
            type: 'button',
            style: 'secondary',
            height: 'sm',
            action: {
              type: 'postback',
              label: '🔴 ปฏิเสธการสลับ',
              data: `SWAP_REJECT|${swapId}|${requester.id}|${target.id}`,
              displayText: '❌ ไม่สะดวกสลับคิว'
            }
          }
        ]
      }
    }
  };
}

module.exports = {
  sendMissionNotification,
  sendUpcomingQueueNotice,
  dispatchPreEventReminders,
  formatDate24h,
  createLineFlexCardPayload,
  createPersonalizedFlexCard,
  createPeerSwapConsentFlexCard
};




