/* إعدادات «تسليم أصول ورق» — غيّر brand لـ 'alola' عشان ورق العلا الرسمي بدل الراشد */
window.HO_CONFIG = {
  version: '1.0.0',
  brand: 'alrashed',
  brands: {
    alrashed: { name: 'شركة الراشد للتجارة', nameEn: 'Al-Rashed Trading Co.', header: 'brand/alrashed_header.png', footer: 'brand/alrashed_footer.png', logo: 'brand/alrashed_logo.jpg', ink: '#1b2a4a' },
    alola: { name: 'العلا', nameEn: 'Al-Ola', header: 'brand/alola_header.png', footer: 'brand/alola_footer.png', logo: 'icon-192.png', ink: '#1d4d2b' }
  },
  api: 'https://lzjyomqttmeqppxdsunb.supabase.co/functions/v1/paper-handover',
  authApi: 'https://alola-maggi-auth.onrender.com',
  authApp: 'handover',
  docTypes: ['شهادة سلامة الغذاء', 'شهادة صحية', 'شهادة منشأ', 'فاتورة', 'باكينج ليست', 'شهادة فحص', 'بوليصة / إذن شحن', 'أخرى']
};
(function () {
  var c = window.HO_CONFIG, local = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  // local test harness only: separate auth server, never on the live site
  if (local) { try { var o = localStorage.getItem('ho_auth_api_override'); if (o) c.authApi = o; } catch (e) {} }
  window.ALOLA_AUTH_API = c.authApi;
  window.ALOLA_AUTH_APP = c.authApp;
})();
