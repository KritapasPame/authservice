# Login capacity — ผลวัดจริง + แผนขยาย (2026-07-23)

> วัดบน pre-test server ผ่านเส้นจริง (esign api BFF → Zitadel) ด้วย login พร้อมกัน N คน
> email เดียวกันทุก request — cost ต่อ login เท่ากันไม่ว่า user ไหน (bcrypt verify ต่อครั้ง)

## ข้อเท็จจริงที่วัดได้

| อะไร | ค่า |
|---|---|
| network ไป Zitadel | ~0.05s/call — ไม่ใช่คอขวด |
| ต้นทุนต่อ 1 login | **~2.3s ≈ ทั้งหมดคือ bcrypt hash verify** (login รหัสผิดใช้เวลาเท่ารหัสถูก = ขั้นอื่นจิ๋วมาก) |
| ต้นทุน signup | ~2.2s (hash ตอนสร้าง) + auto-login อีก ~2.3s = **~5s ต่อการสมัคร** |
| login พร้อมกัน 5 คน | latency ~2.5s, สำเร็จ 100% — จุดสบาย |
| พร้อมกัน 10 / 20 คน | latency 3s / 5s, มี **502 หลุด ~5%** ตั้งแต่ 10 ขึ้นไป |
| เพดาน throughput | **~4 logins/วินาที** (สอดคล้อง ~8 core × bcrypt 2s) |

สาเหตุราก: Zitadel ใช้ **bcrypt cost 14** (default, ช้าโดยตั้งใจกัน brute-force) + CPU pre-test ไม่แรง

## ประเมิน: ตอนนี้พอไหม

พอ — login เป็นเหตุการณ์หายาก (session idle 30 วัน / absolute 90 วัน ลูกค้าไม่ login บ่อย)
~4 logins/s รองรับผู้ใช้ประจำหลักพันคนได้ · **ยังไม่ต้องทำอะไรใน phase นี้**

## แผนเมื่อโตขึ้น (ตามลำดับความคุ้ม)

1. **ลด bcrypt cost 14 → 12** ใน Zitadel config (`PasswordHasher`) → กำลังรองรับ ×4 ทันที ฟรี
   - Zitadel re-hash รหัสเก่าให้เองตอน user login ครั้งถัดไป — ไม่ต้อง migrate
   - trigger: latency login เกิน ~3s เป็นปกติ หรือใกล้เปิดตัวโปรโมชันที่คนสมัครพร้อมกันเยอะ
2. **Retry 1 ครั้งใน esign api** ตอนเรียก Zitadel/entitlement → ตัด 502 หลุด ~5% ช่วง burst
   - ทำได้เลยถ้ามีเวลา — เล็กและได้ผลชัด
3. **อัพ CPU เซิร์ฟ** ตอนขึ้น production จริง — สเกลตรงกับจำนวน core

## สิ่งที่ควรเก็บตาต่อ

- 502 ช่วง burst (~5% ที่ ≥10 พร้อมกัน) — ยังไม่รู้ว่า call ไหนใน chain ล้ม ถ้าจะไล่: เปิด log ใน esign api (`zitadel/oidc.ts`, `zitadel/session.ts` มี source ใน err() อยู่แล้ว) แล้วยิงซ้ำ
- ตอน e-sign ขึ้นเซิร์ฟ (network local) latency ต่อ login จะเหลือ ~2.0-2.2s — ที่เหลือคือ hash ล้วนๆ ลดได้ด้วยข้อ 1 เท่านั้น
