// 설치 안내 페이지: 지금 쓰는 기기의 안내로 이동, 바로 설치할 수 있는 브라우저면 설치 버튼 표시
const ua = navigator.userAgent;
const target = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'ios'
  : /Android/.test(ua) ? 'android'
  : /Windows/.test(ua) ? 'windows'
  : /Macintosh/.test(ua) ? 'mac' : null;
if (target && !location.hash) document.getElementById(target).scrollIntoView();

if (matchMedia('(display-mode: standalone)').matches || navigator.standalone === true) {
  document.getElementById('installed-box').hidden = false;
}

let installPrompt = null;
addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  installPrompt = event;
  document.getElementById('install-now-box').hidden = false;
});
document.getElementById('install-now').addEventListener('click', async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  document.getElementById('install-now-box').hidden = true;
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
