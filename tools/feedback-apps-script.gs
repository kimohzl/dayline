/**
 * Dayline 의견 받는 곳 (Google Apps Script 웹 앱)
 * 앱에서 보낸 글·사진·파일을 내 Gmail로 첨부와 함께 보내 준다.
 *
 * 설치(한 번만):
 * 1. https://script.google.com → 새 프로젝트 → 이 파일 내용을 그대로 붙여넣기 → 저장
 * 2. 오른쪽 위 [배포] → [새 배포] → 톱니바퀴에서 [웹 앱]
 *    - 설명: Dayline 문제 알리기
 *    - 다음 사용자 인증 정보로 실행: 나
 *    - 액세스 권한이 있는 사용자: 모든 사용자
 * 3. [배포] → 권한 검토에서 내 계정 선택 → (확인되지 않은 앱 경고가 뜨면) 고급 → 이동 → 허용
 * 4. 나오는 "웹 앱 URL"(https://script.google.com/macros/s/…/exec)을 복사해서 앱의 FEEDBACK_URL에 넣는다
 *
 * 하루 보낼 수 있는 메일 수는 Google 무료 계정 기준 100통 정도다.
 */
const TO = 'kaeri8970@gmail.com'; // 받는 사람(나)
const KEY = 'dayline-fb';
const MAX_FILES = 10;

function doPost(e) {
  try {
    const raw = e && e.postData ? e.postData.contents : '';
    console.log('받은 크기: ' + raw.length);
    const d = JSON.parse(raw);
    if (d.key !== KEY) {
      console.warn('key 다름: ' + d.key);
      return out({ ok: false, error: 'key' });
    }
    const files = (d.files || []).slice(0, MAX_FILES).map(function (f, i) {
      return Utilities.newBlob(Utilities.base64Decode(f.data), f.type || 'application/octet-stream', f.name || 'file-' + (i + 1));
    });
    const opts = { attachments: files, name: 'Dayline 의견' };
    if (d.replyTo && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.replyTo)) opts.replyTo = d.replyTo;
    const body = String(d.body || '').slice(0, 20000) + (opts.replyTo ? '\n\n답장 받을 메일: ' + opts.replyTo : '');
    MailApp.sendEmail(TO, String(d.subject || '[Dayline] 의견').slice(0, 200), body, opts);
    console.log('보냄: 첨부 ' + files.length + '개, 남은 하루 한도 ' + MailApp.getRemainingDailyQuota());
    return out({ ok: true });
  } catch (err) {
    console.error('실패: ' + err + (err && err.stack ? '\n' + err.stack : ''));
    return out({ ok: false, error: String(err).slice(0, 300) });
  }
}

function doGet() {
  return out({ ok: true, hello: 'Dayline 의견 받는 곳이에요', quota: MailApp.getRemainingDailyQuota() });
}

// 편집기에서 이 함수를 골라 ▶ 실행하면 나에게 시험 메일이 가요(권한 확인용)
function testSend() {
  MailApp.sendEmail(TO, '[Dayline] 시험 메일', '이 메일이 오면 받는 곳 설정이 끝난 거예요.');
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
