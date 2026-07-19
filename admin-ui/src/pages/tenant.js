// admin-ui/src/pages/tenant.js — หน้า 3: รายละเอียดลูกค้า (superadmin)
// STUB (T1) — จะถูกแทนที่ทั้งไฟล์โดย T3
import { route } from '../router.js'

route('#/tenant/:id', (view, params) => {
  view.innerHTML = `
    <div class="frame">
      <div class="framebar">🔐 Platform Console · ลูกค้า #${params.id}</div>
      <div class="framebody">
        <div class="placeholder">กำลังพัฒนา</div>
      </div>
    </div>
  `
})
