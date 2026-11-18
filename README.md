# تسليم أصول ورق — شركة الراشد للتجارة

PWA (mobile-first, Arabic RTL) to record handing original food-safety papers to container truck drivers.
Static site on Render (`alrashed-paper-handover.onrender.com`).

- Wizard: shipment data → scan papers (auto paper-edge detection, perspective fix, scan enhance gray/B&W/color, rotate, retake, reorder, delete with confirm, type labels) → driver signature = full three-part name (two-part rejected) + acknowledgement → driver selfie (front camera; brightness + sharpness checks, face detection via FaceDetector or MediaPipe when available) → review & save → A4 receipt PDF (letterhead from `config.js`, canvas-rendered so Arabic shapes correctly), share/download.
- Autosave: every keystroke/photo is stored instantly on the device (IndexedDB `ho_db`, draft mirrored to localStorage). Drafts resume after closing the page.
- Cloud: saved receipts upload to Supabase (project `lzjyomqttmeqppxdsunb`) through the edge function `paper-handover` (`supabase/functions/`), tables `ho_receipts` (+ `ho_receipts_test` for tests), private bucket `ho-files`. No Supabase key in the browser; the function checks the Alola login token with alola-maggi-auth (`app=handover`).
- Never deletes: receipts can only be archived/unarchived.
- Login: shared Alola gate (`auth-gate.js`, app id `handover`), same accounts as the receiving app; «دخول أمير» on paired devices.
- Branding: set `brand` in `config.js` (`alrashed` or `alola`).

## شيك ليست التحميل (`/loading/`)

صفحة مستقلة (`loading/index.html`، ملف واحد بدون اعتماديات) لتحميل حاويات المبرد — فراولة مجمدة وموالح: 10 خطوات بالصور وتوقيع السائق، والتقرير على ورقة الراشد (حفظ PDF من الطباعة). مستثناة من الـ service worker بتاع تسليم الورق.
