// تسليم أصول ورق — cloud API (Supabase Edge Function, verify_jwt=false; does its own auth).
// Auth: the Alola/Al-Rashed login token (alola-maggi-auth) is checked against AUTH_API /api/me?app=handover.
// Test mode: header x-ho-test-key whose sha256 matches ho_config.test_key_sha256 (enabled) → writes ONLY to
// ho_receipts_test and storage prefix test/. Production rows are never deleted (archive flag only).
import { createClient } from "npm:@supabase/supabase-js@2";

const AUTH_API = "https://alola-maggi-auth.onrender.com";
const APP = "handover";
const BUCKET = "ho-files";
const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-ho-test-key, x-client-info, apikey",
  "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS",
  "Access-Control-Max-Age": "86400",
};
const json = (o: unknown, status = 200) => new Response(JSON.stringify(o), { status, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });

const authCache = new Map<string, { at: number; user: { username: string; label: string } }>();
async function sha256(s: string) {
  const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
type Ctx = { test: boolean; user: { username: string; label: string } };
async function auth(req: Request): Promise<Ctx | Response> {
  const tk = req.headers.get("x-ho-test-key");
  if (tk) {
    const { data } = await sb.from("ho_config").select("value,enabled").eq("key", "test_key_sha256").maybeSingle();
    if (data && data.enabled && data.value === (await sha256(tk))) return { test: true, user: { username: "test", label: "اختبار" } };
    return json({ ok: false, error: "مفتاح اختبار غير صالح" }, 401);
  }
  const h = req.headers.get("authorization") || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return json({ ok: false, error: "يلزم تسجيل الدخول", code: "AUTH" }, 401);
  const key = await sha256(token);
  const c = authCache.get(key);
  if (c && Date.now() - c.at < 5 * 60 * 1000) return { test: false, user: c.user };
  let r: Response;
  try {
    r = await fetch(`${AUTH_API}/api/me?app=${APP}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(45000) });
  } catch (_e) {
    return json({ ok: false, error: "سيرفر الدخول مش بيرد، حاول بعد لحظات", code: "AUTH_DOWN" }, 503);
  }
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.ok || !d.user) return json({ ok: false, error: d.error || "يلزم تسجيل الدخول", code: d.code || "AUTH" }, 401);
  const user = { username: String(d.user.username), label: String(d.user.label || d.user.username) };
  authCache.set(key, { at: Date.now(), user });
  if (authCache.size > 500) authCache.clear();
  return { test: false, user };
}
const tbl = (c: Ctx) => (c.test ? "ho_receipts_test" : "ho_receipts");
const pre = (c: Ctx) => (c.test ? "test" : "prod");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FNAME = /^[a-z0-9][a-z0-9_.-]{0,60}$/i;
const s = (v: unknown, n = 200) => (v == null ? null : String(v).slice(0, n));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const url = new URL(req.url);
  const a = url.searchParams.get("a") || "";
  if (a === "ping") return json({ ok: true, t: Date.now() });
  const c = await auth(req);
  if (c instanceof Response) return c;
  try {
    if (a === "whoami") return json({ ok: true, user: c.user, test: c.test });

    if (a === "serial" && req.method === "POST") {
      const yr = new Intl.DateTimeFormat("en", { timeZone: "Africa/Cairo", year: "numeric" }).format(new Date());
      const scope = (c.test ? "test-" : "") + yr;
      const { data, error } = await sb.rpc("ho_next_serial", { p_scope: scope });
      if (error) throw error;
      const serial = (c.test ? "TEST-" : "") + `TA-${yr}-${String(data).padStart(4, "0")}`;
      return json({ ok: true, serial });
    }

    if (a === "file" && req.method === "PUT") {
      const rid = url.searchParams.get("rid") || "", name = url.searchParams.get("name") || "";
      if (!UUID.test(rid) || !FNAME.test(name)) return json({ ok: false, error: "اسم ملف غير صالح" }, 400);
      const type = req.headers.get("content-type") || "image/jpeg";
      const buf = new Uint8Array(await req.arrayBuffer());
      if (buf.length > 4 * 1024 * 1024) return json({ ok: false, error: "الملف أكبر من 4 ميجا" }, 413);
      const path = `${pre(c)}/${rid}/${name}`;
      const { error } = await sb.storage.from(BUCKET).upload(path, buf, { contentType: type, upsert: true });
      if (error) throw error;
      return json({ ok: true, path, size: buf.length });
    }

    if (a === "save" && req.method === "POST") {
      const b = await req.json();
      const r = b && b.record;
      if (!r || !UUID.test(r.id) || !r.serial) return json({ ok: false, error: "بيانات ناقصة" }, 400);
      const f = r.fields || {};
      const row = {
        id: r.id, serial: s(r.serial, 40), container_no: s(f.container), plate_no: s(f.plate), driver_name: s(r.driverName),
        driver_phone: s(f.phone, 40), ref_no: s(f.ref), destination: s(f.destination), pages: Array.isArray(r.docs) ? r.docs.length : 0,
        data: r, saved_at: r.savedAt || new Date().toISOString(), saved_by: c.user.username, device: s(b.device, 80), updated_at: new Date().toISOString(),
      };
      // archived state is only changed via a=archive; keep existing flag on re-save
      const { error } = await sb.from(tbl(c)).upsert(row, { onConflict: "id" });
      if (error) throw error;
      return json({ ok: true, id: r.id });
    }

    if (a === "list") {
      const q = (url.searchParams.get("q") || "").trim().slice(0, 60);
      const from = url.searchParams.get("from"), to = url.searchParams.get("to");
      const arch = url.searchParams.get("archived") === "1";
      let qq = sb.from(tbl(c)).select("id,serial,container_no,plate_no,driver_name,driver_phone,ref_no,destination,pages,saved_at,saved_by,archived").eq("archived", arch).order("saved_at", { ascending: false }).limit(300);
      if (q) {
        const e = q.replace(/[%,()*]/g, " ");
        qq = qq.or(`container_no.ilike.%${e}%,driver_name.ilike.%${e}%,serial.ilike.%${e}%,plate_no.ilike.%${e}%,ref_no.ilike.%${e}%,driver_phone.ilike.%${e}%`);
      }
      if (from) qq = qq.gte("saved_at", from);
      if (to) qq = qq.lte("saved_at", to);
      const { data, error } = await qq;
      if (error) throw error;
      return json({ ok: true, rows: data });
    }

    if (a === "get") {
      const id = url.searchParams.get("id") || "";
      if (!UUID.test(id)) return json({ ok: false, error: "رقم غير صالح" }, 400);
      const { data, error } = await sb.from(tbl(c)).select("*").eq("id", id).maybeSingle();
      if (error) throw error;
      if (!data) return json({ ok: false, error: "غير موجود" }, 404);
      const { data: files } = await sb.storage.from(BUCKET).list(`${pre(c)}/${id}`, { limit: 200 });
      const names = (files || []).map((f) => f.name);
      const urls: Record<string, string> = {};
      if (names.length) {
        const { data: su } = await sb.storage.from(BUCKET).createSignedUrls(names.map((n) => `${pre(c)}/${id}/${n}`), 3600);
        (su || []).forEach((x, i) => { if (x.signedUrl) urls[names[i]] = x.signedUrl; });
      }
      return json({ ok: true, row: data, files: urls });
    }

    if (a === "archive" && req.method === "POST") {
      const b = await req.json();
      if (!UUID.test(b.id)) return json({ ok: false, error: "رقم غير صالح" }, 400);
      const on = b.archived !== false;
      const { error } = await sb.from(tbl(c)).update({ archived: on, archived_at: on ? new Date().toISOString() : null, archived_by: c.user.username, updated_at: new Date().toISOString() }).eq("id", b.id);
      if (error) throw error;
      return json({ ok: true });
    }

    if (a === "usage") {
      const { count } = await sb.from(tbl(c)).select("id", { count: "exact", head: true });
      return json({ ok: true, count });
    }
    return json({ ok: false, error: "طلب غير معروف" }, 400);
  } catch (e) {
    console.error(a, e);
    return json({ ok: false, error: "خطأ في السحابة: " + ((e as Error).message || String(e)).slice(0, 200) }, 500);
  }
});
