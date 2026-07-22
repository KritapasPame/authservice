# Note ฝั่ง platform — สิ่งที่ eSign signup flow ต้องการ (ทำคู่ขนาน)

> จาก: eSign signup spec `e-sign/docs/superpowers/specs/2026-07-22-signup-flow-design.md` (2026-07-22)
> ฝั่ง eSign ทำ: หน้าสมัคร + `POST /auth/signup` (BFF) + จ่ายเงิน mock — เสร็จแล้วรอฝั่ง platform ตามรายการนี้

## ทำแล้วรอบนี้ (แนบไปกับ flow เลย)

- [x] `POST /signup/personal` รับ `password?` → สร้าง Zitadel user พร้อมรหัส (atomic)
- [x] `GET /me/memberships` — membership ของ user เอง (eSign ใช้ประกอบหน้าโปรไฟล์)
- [x] seed packages `small`/`medium`/`large` (selfSignup + `esign.*`) — **local เท่านั้น**

## ต้อง design/ทำเพิ่มฝั่ง platform (ยังไม่มีใน spec V1/V2)

1. **Verify email ตอน self-signup** ← สำคัญสุดก่อนขายจริง
   ตอนนี้ `createZitadelUser` ตั้ง `isVerified: true` ทั้งที่ไม่เคย verify (เหมาะกับ invite flow ที่ admin กรอกเอง
   แต่ self-signup = ใครก็อ้าง email คนอื่นได้) — ต้องออกแบบ: SMTP บน server + ใช้ Zitadel
   email verification flow หรือ OTP ฝั่งเรา · กระทบ UX สมัคร (รอ verify ก่อน login ไหม?)
2. **Packages บน pre-test/prod** — ตอนนี้ seed local ด้วย SQL; ต้องสร้างของจริงผ่าน admin UI
   (slug `small`/`medium`/`large` ให้ตรงกับที่หน้าเว็บ eSign map ไว้) + ตัดสินใจว่าใครเป็นเจ้าของ
   นิยาม quota ต่อแผน (5/20/50 ผู้ใช้, 100/500/1500 ฉบับ/เดือน — ตอนนี้เป็นแค่ข้อความบนเว็บ ไม่มี enforcement)
3. **Quota enforcement** — `signupPersonal` ยังไม่จำกัดจำนวนผู้ใช้/เอกสารตาม package
   (invite flow มี quota check แล้ว แต่ personal ยังไม่มีมิติเอกสาร/เดือน) — ต้อง design ร่วมกับ billing
4. **Billing service integration** (ตาม decision 2026-07-15 แยก service):
   จุดต่อที่ eSign mock ไว้ = "จ่ายสำเร็จแล้วค่อยสมัคร" → ของจริง billing ต้องเป็นคน confirm payment
   แล้วเรียก entitlement (เปิด/ปิด module, เปลี่ยน package, ต่ออายุ/หมดอายุ) — spec การเรียกยังไม่มี
5. **ลืมรหัสผ่าน** — ปุ่มมีบนหน้าเว็บแล้ว ต้องการ endpoint reset password (ผูกกับ SMTP ข้อ 1)
6. **Deploy `/me/memberships` + signup password ขึ้น pre-test server** — merge อยู่ใน main แล้ว
   แต่ server ยังรัน image เก่า (eSign profile จะ degraded จนกว่าจะ deploy)

## ผลกระทบต่อ token/claims

ไม่มี schema claims ใหม่ — personal tenant ใช้เส้น resolver เดิม (isAdmin + package permissions)
