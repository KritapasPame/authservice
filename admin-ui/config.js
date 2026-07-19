// admin-ui/config.js
// Loaded as a plain <script> (not a module) before src/*.js, so it must attach to `window`.
// clientId ต้องตั้งเป็น public client (PKCE) ที่สร้างใน Zitadel Console — ดู README
window.EDM_CONFIG = {
  issuer: 'https://authservice.edmcompany.co.th',
  clientId: 'SET_ME',
  apiBase: '', // same-origin — entitlement service serve ทั้ง UI และ API
}
